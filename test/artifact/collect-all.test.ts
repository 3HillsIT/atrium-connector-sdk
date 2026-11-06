import { describe, test, expect } from 'bun:test';
import {
  ConnectorArtifactError,
  buildArtifactFixture,
  createFixtureKey,
  openArtifact,
  parseSignatureFile,
  readEnvelope,
  serializeSignatureFile,
  verifySignatures,
  writeEnvelope,
  writeEnvelopeParts,
  SIGNATURE_COMMENT,
  SIGNATURE_HEADER,
} from '../../src/artifact';
import { fromBase64, fromUtf8, toBase64 } from '../../src/artifact/digest';
import type { ArtifactSignature } from '../../src/artifact';

// The verifier reports EVERY ring key whose signature validated, and decides
// nothing about trust (ADR-0007, Amendment from #11226). atrium's trust step
// needs the whole set: a Connector Key Ring key and a Customer Key both
// verifying is `mixed-owners`, which a first-match verifier could never see.

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the artifact to be refused, but it was accepted');
}

/** The fixture's envelope with payload.sig's signature lines replaced. */
function withSignatures(
  bytes: Uint8Array,
  edit: (signatures: ArtifactSignature[]) => ArtifactSignature[],
): Uint8Array {
  const parts = readEnvelope(bytes);
  const parsed = parseSignatureFile(parts.signature);
  return writeEnvelopeParts({
    payload: parts.payload,
    signature: serializeSignatureFile(edit(parsed.signatures), parsed.blobBytes),
  });
}

function corrupted(signature: ArtifactSignature): ArtifactSignature {
  const raw = fromBase64(signature.signature);
  raw[0]! ^= 0xff;
  return { ...signature, signature: toBase64(raw) };
}

describe('every key that verified is reported', () => {
  test('a dual-signed artifact under a ring carrying both keys reports both, in payload.sig order', async () => {
    const first = await createFixtureKey('first');
    const second = await createFixtureKey('second');
    const fixture = await buildArtifactFixture({ signers: [first, second] });

    // The ring lists them the other way round: the order is the file's.
    const opened = await openArtifact(fixture.bytes, [second.ringKey, first.ringKey]);
    expect(opened.keyIds).toEqual([first.keyId, second.keyId]);
  });

  test('a ring carrying only one of them reports only that one', async () => {
    const first = await createFixtureKey();
    const second = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [first, second] });

    expect((await openArtifact(fixture.bytes, [second.ringKey])).keyIds).toEqual([second.keyId]);
  });

  test('a key whose line appears twice is reported once', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = withSignatures(fixture.bytes, (lines) => [...lines, ...lines]);

    expect((await openArtifact(bytes, fixture.ring)).keyIds).toEqual([key.keyId]);
  });

  test('a corrupted line does not veto the next line of the same key', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = withSignatures(fixture.bytes, (lines) => [corrupted(lines[0]!), lines[0]!]);

    expect((await openArtifact(bytes, fixture.ring)).keyIds).toEqual([key.keyId]);
  });

  test('a corrupted line of one key leaves the other key reported, and only it', async () => {
    const first = await createFixtureKey();
    const second = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [first, second] });
    const bytes = withSignatures(fixture.bytes, (lines) => [corrupted(lines[0]!), lines[1]!]);

    const opened = await openArtifact(bytes, [first.ringKey, second.ringKey]);
    expect(opened.keyIds).toEqual([second.keyId]);
  });

  test('a signature that is not canonical base64 validates nothing', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    // Buffer would decode this to the real signature by dropping the '*'.
    const bytes = withSignatures(fixture.bytes, (lines) => [
      { ...lines[0]!, signature: `*${lines[0]!.signature}` },
    ]);

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('signature-invalid');
  });

  test('verifySignatures returns the blob exactly as signed, with every key', async () => {
    const first = await createFixtureKey();
    const second = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [first, second] });
    const parsed = parseSignatureFile(readEnvelope(fixture.bytes).signature);

    const verified = await verifySignatures(parsed, [first.ringKey, second.ringKey]);
    expect(verified.keyIds).toEqual([first.keyId, second.keyId]);
    expect(verified.blobBytes).toEqual(parsed.blobBytes);
  });
});

describe('the verifier knows no key by name', () => {
  test('a key the ring lacks is unknown-key whatever it is, and details.keyIds names every key the file carries', async () => {
    const first = await createFixtureKey();
    const second = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [first, second] });

    const error = await refusalOf(openArtifact(fixture.bytes, []));
    expect(error.code).toBe('unknown-key');
    // A caller that knows one of these keys (atrium's testing key, say) can
    // name it in its own refusal; this module never does.
    expect(error.details.keyIds).toBe(`${first.keyId}, ${second.keyId}`);
  });

  test('the module names no key id of its own', async () => {
    const { readdirSync, readFileSync } = await import('fs');
    const { join } = await import('path');
    const dir = join(import.meta.dir, '..', '..', 'src', 'artifact');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      // A key id is 16 hex characters; none belongs in the format's code.
      if (/['"`][0-9a-f]{16}['"`]/.test(readFileSync(join(dir, file), 'utf-8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('an unsigned envelope', () => {
  async function writeBoth() {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    const files = new Map(opened.files);
    files.delete('manifest.json');
    files.delete('ATRIUM-SIGNED.json');
    const params = { manifest: opened.manifest, files, publishedAt: opened.publishedAt };
    return {
      key,
      fixture,
      signed: await writeEnvelope({ ...params, signers: [key] }),
      unsigned: await writeEnvelope({ ...params, signers: [] }),
    };
  }

  test('writeEnvelope with no signer writes the signed blob and no signature line, which opening refuses as signature-missing', async () => {
    const { fixture, unsigned } = await writeBoth();
    const text = fromUtf8(readEnvelope(unsigned.bytes).signature);
    expect(text.split('\n').slice(0, 3)).toEqual([SIGNATURE_COMMENT, SIGNATURE_HEADER, '--']);

    const error = await refusalOf(openArtifact(unsigned.bytes, fixture.ring));
    expect(error.code).toBe('signature-missing');
  });

  test('its payload and signed blob are the signed one\'s, byte for byte: a signature line is all that differs', async () => {
    const { fixture, signed, unsigned } = await writeBoth();
    expect(unsigned.payloadSha256).toBe(signed.payloadSha256);
    const signedParts = readEnvelope(signed.bytes);
    expect(readEnvelope(unsigned.bytes).payload).toEqual(signedParts.payload);

    const parsed = parseSignatureFile(signedParts.signature);
    expect(readEnvelope(unsigned.bytes).signature).toEqual(serializeSignatureFile([], parsed.blobBytes));
    // Adding the line back gives the signed Artifact exactly.
    const resigned = writeEnvelopeParts({
      payload: readEnvelope(unsigned.bytes).payload,
      signature: serializeSignatureFile(parsed.signatures, parsed.blobBytes),
    });
    expect(resigned).toEqual(signed.bytes);
    expect((await openArtifact(resigned, fixture.ring)).keyIds).toEqual(fixture.ring.map((k) => k.keyId));
  });
});
