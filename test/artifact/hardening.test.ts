import { describe, test, expect } from 'bun:test';
import { gzipSync } from 'zlib';
import {
  assertPublishableIdentity,
  openArtifact,
  parseArtifactFileName,
  readEnvelope,
  writeEnvelope,
} from '../../src/artifact/envelope';
import { buildArtifactFixture, createFixtureKey, repackArtifactFixture } from '../../src/artifact/fixtures';
import { ConnectorArtifactError } from '../../src/artifact/errors';
import { fromUtf8, utf8 } from '../../src/artifact/digest';
import { MAX_DECOMPRESSED_BYTES, gzip, readSafeEntries, writeTar } from '../../src/artifact/tar';
import { PUBLISHED_MANIFEST_VERSION } from '../../src/artifact/types';
import type { PublishedManifest } from '../../src/artifact/types';

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected a refusal, but it was accepted');
}

function manifest(overrides: Partial<PublishedManifest> = {}): PublishedManifest {
  return {
    manifestVersion: PUBLISHED_MANIFEST_VERSION,
    id: 'fixture-connector',
    displayName: 'Fixture',
    version: '1.0.0',
    connectorApiVersion: 1,
    actions: [],
    ...overrides,
  };
}

async function publish(params: {
  manifest: PublishedManifest;
  files?: Map<string, Uint8Array>;
}): Promise<void> {
  const key = await createFixtureKey();
  await writeEnvelope({
    manifest: params.manifest,
    files: params.files ?? new Map(),
    signers: [{ keyId: key.keyId, privateKey: key.privateKey }],
    publishedAt: '2026-08-30T00:00:00.000Z',
  });
}

describe('decompression bombs', () => {
  // The outer layer is gunzipped BEFORE any signature is checked, and the Drop
  // Folder path has no upload cap in front of it, so the bound has to be here.
  test('a gzip that expands past the cap is refused rather than allocated', () => {
    const bomb = new Uint8Array(gzipSync(new Uint8Array(MAX_DECOMPRESSED_BYTES + 1), { level: 9 }));
    expect(bomb.length).toBeLessThan(1_000_000); // a small file, by design

    let error: unknown;
    try {
      readEnvelope(bomb);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConnectorArtifactError);
    expect((error as ConnectorArtifactError).code).toBe('envelope-malformed');
    expect((error as ConnectorArtifactError).message).toContain('expands to more than');
  });

  test('the inner payload is bounded too, not just the envelope', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bomb = new Uint8Array(gzipSync(new Uint8Array(MAX_DECOMPRESSED_BYTES + 1), { level: 9 }));
    const bytes = gzip(
      writeTar([
        { name: 'payload.tar.gz', data: bomb },
        { name: 'payload.sig', data: readEnvelope(fixture.bytes).signature },
      ]),
    );

    // Refused on the payload digest before the bomb is ever expanded, which is
    // the stronger of the two orderings — the bound is the backstop.
    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('payload-digest-mismatch');
  });
});

describe('a broken ring entry cannot veto a good one', () => {
  test('a dual-signed artifact still verifies when one ring key will not load', async () => {
    const good = await createFixtureKey('a loadable key');
    const broken = await createFixtureKey('a key whose material is corrupt');
    const fixture = await buildArtifactFixture({ signers: [broken, good] });

    const ring = [
      { ...broken.ringKey, publicKey: 'bm90IGEga2V5' }, // "not a key"
      good.ringKey,
    ];
    const opened = await openArtifact(fixture.bytes, ring);
    expect(opened.keyIds).toEqual([good.keyId]);
  });

  test('a ring in which every entry is unloadable fails as signature-invalid, not by crashing', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const error = await refusalOf(
      openArtifact(fixture.bytes, [{ ...key.ringKey, publicKey: 'bm90IGEga2V5' }]),
    );
    expect(error.code).toBe('signature-invalid');
  });
});

describe('parseArtifactFileName', () => {
  test('splits a dashed id from a plain version', () => {
    expect(parseArtifactFileName('azure-devops-1.3.1.atrium.tar.gz')).toEqual({
      id: 'azure-devops',
      version: '1.3.1',
    });
  });

  test('splits a dashed id from a dashed prerelease version', () => {
    expect(parseArtifactFileName('azure-devops-1.0.0-rc.1.atrium.tar.gz')).toEqual({
      id: 'azure-devops',
      version: '1.0.0-rc.1',
    });
  });

  test('handles an id containing digits without splitting inside it', () => {
    expect(parseArtifactFileName('s3-v2-connector-2.0.0.atrium.tar.gz')).toEqual({
      id: 's3-v2-connector',
      version: '2.0.0',
    });
  });

  test('handles a build-metadata version', () => {
    expect(parseArtifactFileName('vendira-config-1.2.3+build.7.atrium.tar.gz')).toEqual({
      id: 'vendira-config',
      version: '1.2.3+build.7',
    });
  });

  test('returns undefined for a name with no version-shaped half', () => {
    expect(parseArtifactFileName('notes.atrium.tar.gz')).toBeUndefined();
    expect(parseArtifactFileName('azure-devops-latest.atrium.tar.gz')).toBeUndefined();
  });

  test('returns undefined for anything without the extension', () => {
    expect(parseArtifactFileName('azure-devops-1.3.1.tar.gz')).toBeUndefined();
    expect(parseArtifactFileName('.incoming-abc.tmp')).toBeUndefined();
  });

  test('every name writeEnvelope produces reads back as the id and version it was built from', async () => {
    for (const [id, version] of [
      ['azure-devops', '1.3.1'],
      ['adito-entity', '0.1.0'],
      ['x', '10.20.30'],
      ['vendira-config', '1.0.0-rc.1'],
    ]) {
      const fixture = await buildArtifactFixture({ id, version });
      expect(parseArtifactFileName(fixture.fileName)).toEqual({ id: id!, version: version! });
    }
  });
});

describe('the install side re-checks identity, because the Store path is built from it', () => {
  test('an artifact whose manifest carries an unusable id is refused', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true,
      mutate: (files) => {
        const built = JSON.parse(fromUtf8(files.get('manifest.json')!));
        built.id = '../escape';
        files.set('manifest.json', utf8(JSON.stringify(built, null, 2) + '\n'));
      },
    });
    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.message).toContain('../escape');
  });

  test('an artifact whose manifest carries an unusable version is refused', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true,
      mutate: (files) => {
        const built = JSON.parse(fromUtf8(files.get('manifest.json')!));
        built.version = '../../etc';
        files.set('manifest.json', utf8(JSON.stringify(built, null, 2) + '\n'));
      },
    });
    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
  });

  test('an action with no inputSchema is refused at the door rather than at the MCP layer', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key] });
    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true,
      mutate: (files) => {
        const built = JSON.parse(fromUtf8(files.get('manifest.json')!));
        delete built.actions[0].inputSchema;
        files.set('manifest.json', utf8(JSON.stringify(built, null, 2) + '\n'));
      },
    });
    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.message).toContain('inputSchema');
  });
});

describe('publish refuses what no Instance could open', () => {
  test('an id with a newline, which would corrupt the signed blob', async () => {
    await expect(publish({ manifest: manifest({ id: 'evil\nid' }) })).rejects.toThrow(
      /cannot be published/,
    );
  });

  test('an id with a path separator', async () => {
    await expect(publish({ manifest: manifest({ id: '../evil' }) })).rejects.toThrow(
      /cannot be published/,
    );
  });

  test('a version that is not semver', async () => {
    await expect(publish({ manifest: manifest({ version: 'latest' }) })).rejects.toThrow(
      /cannot be published/,
    );
  });

  test('a payload path that would traverse out of the Store', async () => {
    await expect(
      publish({
        manifest: manifest(),
        files: new Map([['../evil.js', utf8('x')]]),
      }),
    ).rejects.toThrow(/path traversal/);
  });

  test('a payload path that is not canonical', async () => {
    await expect(
      publish({ manifest: manifest(), files: new Map([['./actions/a.js', utf8('x')]]) }),
    ).rejects.toThrow(/non-canonical path/);
  });

  test('an action whose bundle is not among the published files', async () => {
    await expect(
      publish({
        manifest: manifest({
          actions: [
            {
              name: 'a',
              description: 'a',
              inputSchema: {},
              bundle: 'actions/missing.js',
            },
          ],
        }),
      }),
    ).rejects.toThrow(/not among the files being published/);
  });

  test('assertPublishableIdentity rejects an id that re-splits differently', () => {
    // "foo-1.0.0" + "2.0.0" reads back as id "foo", version "1.0.0-2.0.0".
    expect(() => assertPublishableIdentity('foo-1.0.0', '2.0.0')).toThrow(/does not read back/);
  });
});

describe('a dangling bundle path is caught at the door, not when an Action is loaded', () => {
  test('an artifact whose manifest names a bundle it does not contain is refused, naming both', async () => {
    // writeEnvelope refuses to emit this, so it is repacked and re-signed: the
    // case that matters is an artifact from a publisher that skipped the check,
    // which the install side must not depend on.
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key], actions: ['list_things'] });

    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true, // internally consistent — only the dangling path is wrong
      mutate: (files) => {
        const built = JSON.parse(fromUtf8(files.get('manifest.json')!));
        built.actions.push({
          name: 'ghost',
          description: 'an action whose bundle was never published',
          inputSchema: {},
          bundle: 'actions/ghost.js',
        });
        files.set('manifest.json', utf8(JSON.stringify(built, null, 2) + '\n'));
      },
    });

    const error = await refusalOf(openArtifact(bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.message).toContain('ghost');
    expect(error.message).toContain('actions/ghost.js');
  });

  test('the same artifact with the bundle actually present verifies', async () => {
    const key = await createFixtureKey();
    const fixture = await buildArtifactFixture({ signers: [key], actions: ['list_things'] });

    const bytes = await repackArtifactFixture({
      bytes: fixture.bytes,
      signer: key,
      relist: true,
      mutate: (files) => {
        const built = JSON.parse(fromUtf8(files.get('manifest.json')!));
        built.actions.push({
          name: 'ghost',
          description: 'now with a bundle',
          inputSchema: {},
          bundle: 'actions/ghost.js',
        });
        files.set('manifest.json', utf8(JSON.stringify(built, null, 2) + '\n'));
        files.set('actions/ghost.js', utf8('export async function __atriumRun() {}\n'));
      },
    });

    const opened = await openArtifact(bytes, fixture.ring);
    expect(opened.manifest.actions.map((action) => action.name)).toEqual(['list_things', 'ghost']);
  });
});

describe('the pre-signature read is bounded in entries as well as in bytes', () => {
  test('a many-entry archive is refused on the third header, not after being walked', () => {
    // Entry data is held as views rather than copies, so the total is bounded
    // by the decompressed size; the entry cap bounds the walk itself.
    const many = Array.from({ length: 5000 }, (_, index) => ({
      name: `entry-${index}.bin`,
      data: utf8('x'.repeat(1024)),
    }));
    let error: unknown;
    try {
      readEnvelope(gzip(writeTar(many)));
    } catch (err) {
      error = err;
    }
    expect((error as ConnectorArtifactError).code).toBe('envelope-malformed');
    expect((error as ConnectorArtifactError).details.maxEntries).toBe('2');
  });
});

describe('non-canonical entry names', () => {
  test('a backslash in an entry name is refused outright, not merely split on', () => {
    let error: unknown;
    try {
      readSafeEntries(writeTar([{ name: 'actions\\a.js', data: utf8('x') }]), 'test');
    } catch (err) {
      error = err;
    }
    expect((error as ConnectorArtifactError).code).toBe('unsafe-entry');
    expect((error as ConnectorArtifactError).message).toContain('backslash');
  });

  test('a "." entry is refused during extraction rather than at write time', () => {
    let error: unknown;
    try {
      readSafeEntries(writeTar([{ name: './manifest.json', data: utf8('{}') }]), 'test');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConnectorArtifactError);
    expect((error as ConnectorArtifactError).code).toBe('unsafe-entry');
    expect((error as ConnectorArtifactError).message).toContain('non-canonical path');
  });

  test('a doubled separator is refused, so one file cannot have two spellings', () => {
    let error: unknown;
    try {
      readSafeEntries(writeTar([{ name: 'actions//a.js', data: utf8('x') }]), 'test');
    } catch (err) {
      error = err;
    }
    expect((error as ConnectorArtifactError).code).toBe('unsafe-entry');
  });
});
