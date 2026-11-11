import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  ConnectorArtifactError,
  MANIFEST_FILE,
  PAYLOAD_ENTRY,
  gunzip,
  openArtifact,
  readEnvelope,
  readSafeEntries,
  sha256Hex,
} from '../../src/artifact';
import { BUILD_RECORD_FILE } from '../../src/build';
import type { BuildRecord } from '../../src/build';
import { ENTRY_SOURCE, makeConnectorRepo, runCommand } from '../support/connector-repo';
import type { ConnectorRepo } from '../support/connector-repo';

// `atrium-connector build [--try]`, driven through the command on a Connector
// repo in a temp folder: the unsigned Artifact in dist/, the build record, the
// try numbering, the warning, and the same bytes from the same source.

let repo: ConnectorRepo;
beforeEach(() => {
  repo = makeConnectorRepo();
});
afterEach(() => repo.remove());

function record(): BuildRecord {
  return JSON.parse(repo.readFile(BUILD_RECORD_FILE)) as BuildRecord;
}

function artifact(version: string): Uint8Array {
  return new Uint8Array(readFileSync(join(repo.dir, 'dist', `thing-connector-${version}.atrium.tar.gz`)));
}

async function build(...args: string[]) {
  const run = await runCommand(repo.dir, 'build', ...args);
  if (run.exitCode !== 0) throw new Error(`build ${args.join(' ')} exited ${run.exitCode}:\n${run.stderr}`);
  return run;
}

describe('build', () => {
  test("writes the manifest's version to dist/ unsigned, and records it", async () => {
    const run = await build();

    expect(run.stdout).toContain('Bundle Contract v1: accepted by every atrium Release.');
    expect(run.stdout).toContain('Built thing-connector 1.2.0, unsigned: dist/thing-connector-1.2.0.atrium.tar.gz');
    expect(readdirSync(join(repo.dir, 'dist'))).toEqual(['thing-connector-1.2.0.atrium.tar.gz']);

    const bytes = artifact('1.2.0');
    const { payload, signature } = readEnvelope(bytes);
    const payloadSha256 = await sha256Hex(payload);
    // Unsigned: the signed blob and no signature line, which no Instance opens.
    expect(new TextDecoder().decode(signature)).not.toMatch(/ecdsa-p256-sha256/);
    const refusal = await openArtifact(bytes, []).catch((err) => err);
    expect(refusal).toBeInstanceOf(ConnectorArtifactError);
    expect(refusal.code).toBe('signature-missing');

    expect(record().builds).toEqual([
      { version: '1.2.0', payloadSha256, builtAt: expect.any(String) },
    ]);
    expect(run.stdout).toContain(`Payload   ${payloadSha256}`);
  });

  test('writes nothing when a check fails', async () => {
    repo.editManifest((manifest) => {
      delete manifest.actions[1].write;
    });

    const run = await runCommand(repo.dir, 'build');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('write-flag: ');
    expect(run.stderr).toContain('build failed: 1 problem. Nothing was written or signed.');
    expect(existsSync(join(repo.dir, 'dist'))).toBe(false);
    expect(existsSync(join(repo.dir, BUILD_RECORD_FILE))).toBe(false);
  });

  test('refuses a manifest version that already carries a pre-release suffix', async () => {
    repo.editManifest((manifest) => {
      manifest.version = '1.2.0-try.4';
    });
    writeFileSync(
      join(repo.dir, 'package.json'),
      JSON.stringify({ name: 'thing-connector', version: '1.2.0-try.4', type: 'module' }),
    );

    const run = await runCommand(repo.dir, 'build', '--try');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('versions: ');
    expect(run.stderr).toContain('plain MAJOR.MINOR.PATCH');
  });

  test('refuses a build record it cannot read, rather than numbering from nothing', async () => {
    writeFileSync(join(repo.dir, BUILD_RECORD_FILE), '{"builds": {}}\n');

    const run = await runCommand(repo.dir, 'build', '--try');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('build-record: ');
    expect(run.stderr).toContain('docs/build-and-sign.md');
  });
});

describe('build --try', () => {
  test('numbers -try.1, -try.2, then a plain build is the release version; manifest.json is never edited', async () => {
    const manifestBefore = repo.readFile('manifest.json');

    expect((await build('--try')).stdout).toContain('Built thing-connector 1.2.0-try.1, unsigned');
    expect((await build('--try')).stdout).toContain('Built thing-connector 1.2.0-try.2, unsigned');
    expect((await build()).stdout).toContain('Built thing-connector 1.2.0, unsigned');

    expect(record().builds.map((entry) => entry.version)).toEqual(['1.2.0-try.1', '1.2.0-try.2', '1.2.0']);
    expect(readdirSync(join(repo.dir, 'dist')).sort()).toEqual([
      'thing-connector-1.2.0-try.1.atrium.tar.gz',
      'thing-connector-1.2.0-try.2.atrium.tar.gz',
      'thing-connector-1.2.0.atrium.tar.gz',
    ]);
    expect(repo.readFile('manifest.json')).toBe(manifestBefore);
    // The version is the generated manifest's: the payload carries the try.
    const { payload } = readEnvelope(artifact('1.2.0-try.2'));
    const manifest = readSafeEntries(gunzip(payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY).get(MANIFEST_FILE)!;
    expect(JSON.parse(new TextDecoder().decode(manifest)).version).toBe('1.2.0-try.2');
  });

  test("counts from the highest try of the manifest's version in the record, and only of that version", async () => {
    const entry = (version: string) => ({ version, payloadSha256: 'a'.repeat(64), builtAt: '2026-11-01T00:00:00.000Z' });
    writeFileSync(
      join(repo.dir, BUILD_RECORD_FILE),
      JSON.stringify({
        builds: [entry('1.2.0-try.7'), entry('1.2.0-try.3'), entry('1.1.0-try.12'), entry('1.2.0-try.07x')],
      }),
    );

    expect((await build('--try')).stdout).toContain('Built thing-connector 1.2.0-try.8, unsigned');
  });
});

describe('the same source gives the same payload', () => {
  test('two builds of unchanged source: one digest, the record and the Artifact unchanged', async () => {
    await build();
    const firstRecord = repo.readFile(BUILD_RECORD_FILE);
    const first = readEnvelope(artifact('1.2.0')).payload;

    const run = await build();

    expect(run.stderr).toBe('');
    expect(repo.readFile(BUILD_RECORD_FILE)).toBe(firstRecord);
    expect(await sha256Hex(readEnvelope(artifact('1.2.0')).payload)).toBe(await sha256Hex(first));
  });

  test('a try of unchanged source differs from the release only in its version', async () => {
    await build('--try');
    await build();
    const filesOf = (version: string) =>
      readSafeEntries(gunzip(readEnvelope(artifact(version)).payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY);
    const tried = filesOf('1.2.0-try.1');
    const released = filesOf('1.2.0');

    for (const bundle of ['actions/list_things.js', 'actions/create_thing.js']) {
      expect(tried.get(bundle)).toEqual(released.get(bundle)!);
    }
    const manifestOf = (files: Map<string, Uint8Array>) =>
      JSON.parse(new TextDecoder().decode(files.get(MANIFEST_FILE)!));
    expect({ ...manifestOf(tried), version: '1.2.0' }).toEqual(manifestOf(released));
  });
});

describe('a version built again with other bytes', () => {
  test('warns naming both digests, still builds, and keeps the first payload in the record', async () => {
    await build();
    const first = record().builds[0]!;
    const recordText = repo.readFile(BUILD_RECORD_FILE);

    repo.writeEntry(ENTRY_SOURCE.replace("'/things'", "'/things/'"));
    const run = await build();
    const rebuilt = await sha256Hex(readEnvelope(artifact('1.2.0')).payload);

    expect(rebuilt).not.toBe(first.payloadSha256);
    expect(run.stderr).toContain(`! ${BUILD_RECORD_FILE} has thing-connector 1.2.0 built on ${first.builtAt}`);
    expect(run.stderr).toContain(first.payloadSha256);
    expect(run.stderr).toContain(rebuilt);
    expect(run.stdout).toContain('Built thing-connector 1.2.0, unsigned');
    // One entry per version, the digest built first: an Instance that has
    // 1.2.0 has those bytes, whatever was built since.
    expect(repo.readFile(BUILD_RECORD_FILE)).toBe(recordText);
  });

  test('every rebuild that differs from the first warns: A, then B, then B again', async () => {
    await build();
    const first = record().builds[0]!;

    repo.writeEntry(ENTRY_SOURCE.replace("'/things'", "'/things/'"));
    const second = await build();
    const third = await build();

    for (const run of [second, third]) {
      expect(run.stderr).toContain(`! ${BUILD_RECORD_FILE} has thing-connector 1.2.0 built on ${first.builtAt}`);
      expect(run.stderr).toContain(first.payloadSha256);
    }
    expect(record().builds).toEqual([first]);
  });
});
