import { describe, test, expect } from 'bun:test';
import { openArtifact, readEnvelope } from '../../src/artifact/envelope';
import { buildArtifactFixture, createFixtureKey, repackArtifactFixture } from '../../src/artifact/fixtures';
import { ConnectorArtifactError } from '../../src/artifact/errors';
import { fromBase64, fromUtf8, sha256Hex, toBase64, utf8 } from '../../src/artifact/digest';
import { gunzip, gzip, readSafeEntries, writeTar } from '../../src/artifact/tar';
import {
  parseSignatureFile,
  serializeBlob,
  serializeSignatureFile,
  signBlob,
} from '../../src/artifact/signing';
import { LISTING_FILE, PAYLOAD_ENTRY, SIGNATURE_ENTRY } from '../../src/artifact/types';
import type { RingKey } from '../../src/artifact/types';

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the artifact to be refused, but it was accepted');
}

describe('signature verification', () => {
  test('a tampered payload fails, naming both digests', async () => {
    const fixture = await buildArtifactFixture();
    const parts = readEnvelope(fixture.bytes);

    // Flip one byte of the compressed payload. It no longer matches the
    // digest the signature covers, and nothing downstream ever runs.
    const tampered = new Uint8Array(parts.payload);
    tampered[tampered.length - 20]! ^= 0xff;
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: tampered },
        { name: SIGNATURE_ENTRY, data: parts.signature },
      ]),
    );

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('payload-digest-mismatch');
    expect(error.details.expected).toMatch(/^[0-9a-f]{64}$/);
    expect(error.details.actual).not.toBe(error.details.expected);
  });

  test('an unknown key fails as unknown-key, naming the key id, with update-Atrium as the remedy', async () => {
    const stranger = await createFixtureKey('a key this Atrium does not carry');
    const fixture = await buildArtifactFixture({ signers: [stranger] });
    const otherRing = (await createFixtureKey()).ringKey;

    const error = await refusalOf(openArtifact(fixture.bytes, [otherRing]));
    expect(error.code).toBe('unknown-key');
    expect(error.message).toContain(stranger.keyId);
    expect(error.message).toContain('Update atrium');
  });

  test('an empty ring fails as unknown-key rather than crashing', async () => {
    const fixture = await buildArtifactFixture();
    const error = await refusalOf(openArtifact(fixture.bytes, []));
    expect(error.code).toBe('unknown-key');
  });

  test('a known key id with a corrupted signature fails as signature-invalid, not unknown-key', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const parts = readEnvelope(fixture.bytes);
    const parsed = parseSignatureFile(parts.signature);

    const raw = fromBase64(parsed.signatures[0]!.signature);
    raw[0]! ^= 0xff;
    const forged = serializeSignatureFile(
      [{ ...parsed.signatures[0]!, signature: toBase64(raw) }],
      parsed.blobBytes,
    );
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: parts.payload },
        { name: SIGNATURE_ENTRY, data: forged },
      ]),
    );

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('signature-invalid');
  });

  test('a signature file claiming a different algorithm than the ring entry does not verify', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const parts = readEnvelope(fixture.bytes);
    const parsed = parseSignatureFile(parts.signature);

    const relabelled = serializeSignatureFile(
      [{ ...parsed.signatures[0]!, alg: 'ed25519' }],
      parsed.blobBytes,
    );
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: parts.payload },
        { name: SIGNATURE_ENTRY, data: relabelled },
      ]),
    );

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('signature-invalid');
  });

  test('a signed blob lifted onto a different artifact fails on the payload digest', async () => {
    const key = await createFixtureKey();
    const one = await buildArtifactFixture({ id: 'one', version: '1.0.0', signers: [key] });
    const two = await buildArtifactFixture({ id: 'two', version: '2.0.0', signers: [key] });

    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: readEnvelope(two.bytes).payload },
        { name: SIGNATURE_ENTRY, data: readEnvelope(one.bytes).signature },
      ]),
    );

    const error = await refusalOf(openArtifact(bytes, [key.ringKey]));
    expect(error.code).toBe('payload-digest-mismatch');
  });

  test('a signature file that is not ATRIUM-SIG-v1 is refused as malformed', async () => {
    const fixture = await buildArtifactFixture();
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: readEnvelope(fixture.bytes).payload },
        { name: SIGNATURE_ENTRY, data: utf8('-----BEGIN PGP SIGNATURE-----\n') },
      ]),
    );
    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('signature-malformed');
  });
});

describe('the key ring, and why rotation is a dual-sign', () => {
  test('any single ring key validating is sufficient — a ring may carry keys the artifact never used', async () => {
    const signer = await createFixtureKey('the key that signed');
    const bystander = await createFixtureKey('another trusted key');
    const fixture = await buildArtifactFixture({ signers: [signer] });

    const ring: RingKey[] = [bystander.ringKey, signer.ringKey];
    const opened = await openArtifact(fixture.bytes, ring);
    expect(opened.keyIds).toEqual([signer.keyId]);
  });

  test('a dual-signed artifact verifies on an Instance that trusts only the old key', async () => {
    const oldKey = await createFixtureKey('key being rotated out');
    const newKey = await createFixtureKey('key being rotated in');
    const fixture = await buildArtifactFixture({ signers: [oldKey, newKey] });

    const opened = await openArtifact(fixture.bytes, [oldKey.ringKey]);
    expect(opened.keyIds).toEqual([oldKey.keyId]);
  });

  test('the same dual-signed artifact verifies on an Instance that trusts only the new key', async () => {
    const oldKey = await createFixtureKey('key being rotated out');
    const newKey = await createFixtureKey('key being rotated in');
    const fixture = await buildArtifactFixture({ signers: [oldKey, newKey] });

    const opened = await openArtifact(fixture.bytes, [newKey.ringKey]);
    expect(opened.keyIds).toEqual([newKey.keyId]);
  });

  test('a dual-signed artifact is refused by an Instance that trusts neither key', async () => {
    const oldKey = await createFixtureKey();
    const newKey = await createFixtureKey();
    const unrelated = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [oldKey, newKey] });

    const error = await refusalOf(openArtifact(fixture.bytes, [unrelated.ringKey]));
    expect(error.code).toBe('unknown-key');
    expect(error.message).toContain(oldKey.keyId);
    expect(error.message).toContain(newKey.keyId);
  });
});

describe('the hash listing survives a valid signature', () => {
  test('a modified file is refused even though the artifact is correctly signed', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });

    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      mutate: (files) => files.set('actions/list_things.js', utf8('// swapped\n')),
    });

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('file-digest-mismatch');
    expect(error.message).toContain('actions/list_things.js');
  });

  test('an added file is refused as loudly as a modified one', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });

    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      mutate: (files) => files.set('actions/extra.js', utf8('// injected\n')),
    });

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('unexpected-file');
    expect(error.message).toContain('actions/extra.js');
  });

  test('a removed file is refused', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });

    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      mutate: (files) => files.delete('actions/list_things.js'),
    });

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('missing-file');
    expect(error.message).toContain('actions/list_things.js');
  });

  test('a swapped hash listing is refused before its contents are consulted', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const other = await buildArtifactFixture({ id: 'other-connector', signers: [key] });
    const otherListing = readSafeEntries(
      gunzip(readEnvelope(other.bytes).payload, PAYLOAD_ENTRY),
      PAYLOAD_ENTRY,
    ).get(LISTING_FILE)!;

    // Re-signed, so the payload digest matches — the only thing standing
    // between this and acceptance is the listing's own digest in the blob.
    const parts = readEnvelope(fixture.bytes);
    const files = readSafeEntries(gunzip(parts.payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY);
    files.set(LISTING_FILE, otherListing);
    const sorted = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const payload = gzip(writeTar(sorted.map(([name, data]) => ({ name, data }))));
    const blobBytes = serializeBlob({
      id: 'fixture-connector',
      version: '1.0.0',
      payloadSha256: await sha256Hex(payload),
      // Deliberately still the original listing's digest.
      listingSha256: await sha256Hex(
        readSafeEntries(gunzip(parts.payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY).get(LISTING_FILE)!,
      ),
      publishedAt: '2026-08-30T00:00:00.000Z',
    });
    const signature = await signBlob({
      blob: blobBytes,
      keyId: key.keyId,
      privateKey: key.privateKey,
    });
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: payload },
        { name: SIGNATURE_ENTRY, data: serializeSignatureFile([signature], blobBytes) },
      ]),
    );

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('listing-digest-mismatch');
  });

  test('a manifest whose id@version disagrees with the signed blob is refused, naming both', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({
      id: 'fixture-connector',
      version: '1.0.0',
      signers: [key],
    });

    // A fully re-signed, internally consistent payload — except that the blob
    // and the listing say 1.0.0 while the manifest inside says 9.9.9.
    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true,
      mutate: (files) => {
        const manifest = JSON.parse(fromUtf8(files.get('manifest.json')!));
        manifest.version = '9.9.9';
        files.set('manifest.json', utf8(JSON.stringify(manifest, null, 2) + '\n'));
      },
    });

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('version-mismatch');
    expect(error.message).toContain('fixture-connector@9.9.9');
    expect(error.message).toContain('fixture-connector@1.0.0');
  });

  test('the repack helper itself produces a valid artifact when nothing is changed', async () => {
    // Otherwise every refusal above could be an artefact of the helper rather
    // than of the property under test.
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = await repackArtifactFixture({ bytes: fixture.bytes, signer: key, mutate: () => {} });
    const opened = await openArtifact(bytes, fixture.ring);
    expect(opened.manifest.id).toBe('fixture-connector');
  });
});
