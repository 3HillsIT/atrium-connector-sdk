import { describe, test, expect } from 'bun:test';
import { openArtifact, readEnvelope, writeEnvelope } from '../../src/artifact/envelope';
import { buildArtifactFixture, createFixtureKey, fixtureBundle } from '../../src/artifact/fixtures';
import { ConnectorArtifactError } from '../../src/artifact/errors';
import { fromUtf8, utf8 } from '../../src/artifact/digest';
import { gzip, writeTar } from '../../src/artifact/tar';
import { PAYLOAD_ENTRY, SIGNATURE_ENTRY, PUBLISHED_MANIFEST_VERSION } from '../../src/artifact/types';
import type { PublishedManifest } from '../../src/artifact/types';

/** Every assertion here is about a refusal's reason, so this reads it off. */
async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the artifact to be refused, but it was accepted');
}

describe('round trip', () => {
  test('an envelope written and read back yields the same manifest and per-action bundles', async () => {
    const fixture = await buildArtifactFixture({
      id: 'azure-devops',
      version: '1.3.1',
      displayName: 'Azure DevOps',
      actions: ['list_projects', 'query_work_items'],
    });

    const opened = await openArtifact(fixture.bytes, fixture.ring);

    expect(opened.manifest).toEqual(fixture.manifest);
    expect(opened.manifest.manifestVersion).toBe(PUBLISHED_MANIFEST_VERSION);
    expect(opened.manifest.actions.map((action) => action.bundle)).toEqual([
      'actions/list_projects.js',
      'actions/query_work_items.js',
    ]);
    for (const name of ['list_projects', 'query_work_items']) {
      expect(opened.files.get(`actions/${name}.js`)).toEqual(fixtureBundle(name));
    }
  });

  // `group` is additive and needs no manifestVersion bump: the reader lets an
  // Action key it doesn't check through, so this Instance and an older one
  // both Add such a manifest.
  test('an Action’s group is read back, and an Action without one has none', async () => {
    const fixture = await buildArtifactFixture({
      actions: ['read_persons', 'ping'],
      manifest: (manifest) => ({
        ...manifest,
        actions: manifest.actions.map((action) =>
          action.name === 'read_persons' ? { ...action, group: 'Persons' } : action,
        ),
      }),
    });

    const opened = await openArtifact(fixture.bytes, fixture.ring);

    expect(opened.manifest.manifestVersion).toBe(PUBLISHED_MANIFEST_VERSION);
    expect(opened.manifest.actions.find((a) => a.name === 'read_persons')!.group).toBe('Persons');
    expect(opened.manifest.actions.find((a) => a.name === 'ping')!).not.toHaveProperty('group');
  });

  test('the filename follows the mandatory <id>-<version>.atrium.tar.gz convention', async () => {
    const fixture = await buildArtifactFixture({ id: 'azure-devops', version: '1.3.1' });
    expect(fixture.fileName).toBe('azure-devops-1.3.1.atrium.tar.gz');
  });

  test('the digest reported by publish is payload.tar.gz’s, and openArtifact agrees', async () => {
    const fixture = await buildArtifactFixture();
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    expect(opened.payloadSha256).toBe(fixture.payloadSha256);
    expect(opened.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the verified artifact names which ring key signed it', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    expect(opened.keyIds).toEqual([key.keyId]);
  });

  test('the verified artifact carries the signed blob\'s publishedAt, which the Connector index lists', async () => {
    const fixture = await buildArtifactFixture({ publishedAt: '2026-09-14T18:02:17.372Z' });
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    expect(opened.publishedAt).toBe('2026-09-14T18:02:17.372Z');
  });

  test('an action bundle round-trips byte for byte, including a large one', async () => {
    const big = utf8('x'.repeat(200_000));
    const fixture = await buildArtifactFixture({
      files: new Map([['actions/list_things.js', big]]),
    });
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    expect(opened.files.get('actions/list_things.js')).toEqual(big);
  });

  test('a unicode bundle round-trips, so the byte length and the character count cannot be confused', async () => {
    const text = "// éü 密码 🔑\nexport async function __atriumRun() { return 'é'; }\n";
    const fixture = await buildArtifactFixture({
      files: new Map([['actions/list_things.js', utf8(text)]]),
    });
    const opened = await openArtifact(fixture.bytes, fixture.ring);
    expect(fromUtf8(opened.files.get('actions/list_things.js')!)).toBe(text);
  });
});

describe('the narrow outer reader', () => {
  const signature = utf8('not really a signature');

  test('accepts exactly payload.tar.gz and payload.sig', async () => {
    const fixture = await buildArtifactFixture();
    const parts = readEnvelope(fixture.bytes);
    expect(parts.payload.length).toBeGreaterThan(0);
    expect(fromUtf8(parts.signature)).toContain('ATRIUM-SIG-v1');
  });

  test('refuses a third entry on its header, before walking it', async () => {
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: utf8('payload') },
        { name: SIGNATURE_ENTRY, data: signature },
        { name: 'README.md', data: utf8('hello') },
      ]),
    );
    const error = await refusalOf(Promise.resolve().then(() => readEnvelope(bytes)));
    expect(error.code).toBe('envelope-malformed');
    expect(error.message).toContain('more than 2 entries');
  });

  test('refuses an entry with an unexpected name', async () => {
    const bytes = gzip(
      writeTar([
        { name: PAYLOAD_ENTRY, data: utf8('payload') },
        { name: 'payload.signature', data: signature },
      ]),
    );
    const error = await refusalOf(Promise.resolve().then(() => readEnvelope(bytes)));
    expect(error.code).toBe('envelope-malformed');
    expect(error.message).toContain('payload.signature');
  });

  test('refuses a nested path, even one that would unpack to the right names', async () => {
    const bytes = gzip(
      writeTar([
        { name: `artifact/${PAYLOAD_ENTRY}`, data: utf8('payload') },
        { name: `artifact/${SIGNATURE_ENTRY}`, data: signature },
      ]),
    );
    const error = await refusalOf(Promise.resolve().then(() => readEnvelope(bytes)));
    expect(error.code).toBe('envelope-malformed');
  });

  test('refuses a single entry', async () => {
    const bytes = gzip(writeTar([{ name: PAYLOAD_ENTRY, data: utf8('payload') }]));
    const error = await refusalOf(Promise.resolve().then(() => readEnvelope(bytes)));
    expect(error.code).toBe('envelope-malformed');
    expect(error.message).toContain('contains 1');
  });

  test('refuses an empty archive', async () => {
    const error = await refusalOf(Promise.resolve().then(() => readEnvelope(gzip(writeTar([])))));
    expect(error.code).toBe('envelope-malformed');
  });

  test('refuses bytes that are not gzip at all', async () => {
    const error = await refusalOf(
      Promise.resolve().then(() => readEnvelope(utf8('this is a text file'))),
    );
    expect(error.code).toBe('envelope-malformed');
    expect(error.message).toContain('gzip');
  });
});

describe('the published manifest', () => {
  test('a manifestVersion below the supported set is refused, naming what it declared', async () => {
    const fixture = await buildArtifactFixture({ manifestVersion: 1 });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-too-old');
    expect(error.message).toContain('manifestVersion 1');
  });

  test('a manifestVersion that is not a number is refused as malformed, not as too old or too new', async () => {
    const fixture = await buildArtifactFixture({
      manifest: (manifest) => ({ ...manifest, manifestVersion: '3' as unknown as 3 }),
    });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
  });

  test('a manifest missing connectorApiVersion is refused', async () => {
    const fixture = await buildArtifactFixture({
      manifest: (manifest) => {
        const { connectorApiVersion: _dropped, ...rest } = manifest;
        return rest as PublishedManifest;
      },
    });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.message).toContain('connectorApiVersion');
  });

  // A manifest that disagrees with the signed blob about id@version needs a
  // re-signed payload to construct, so it lives in tamper.test.ts alongside
  // the other re-packing cases.

  test('writeEnvelope refuses a caller-supplied manifest.json, so it cannot disagree with the listing', async () => {
    const key = await createFixtureKey();
    await expect(
      writeEnvelope({
        manifest: {
          manifestVersion: 2,
          id: 'x',
          displayName: 'X',
          version: '1.0.0',
          connectorApiVersion: 1,
          actions: [],
        },
        files: new Map([['manifest.json', utf8('{}')]]),
        signers: [{ keyId: key.keyId, privateKey: key.privateKey }],
        publishedAt: '2026-08-30T00:00:00.000Z',
      }),
    ).rejects.toThrow('generated by writeEnvelope');
  });
});
