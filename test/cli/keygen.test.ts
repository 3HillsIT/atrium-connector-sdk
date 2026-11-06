import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildArtifactFixture, deriveKeyId, fromBase64Strict, openArtifact } from '../../src/artifact';
import { keygenPrintout } from '../../src/cli/key-file';
import { runCommand } from '../support/connector-repo';

// `atrium-connector keygen --name <name> --out <file>`, through the command in
// a temp folder: the key file, its mode, and what it prints for the Console's
// Register.
//
// fixtures/keygen-output.txt is the Console's shared fixture, copied byte for
// byte from atrium-console's server/src/customer-keys/fixtures/ (ticket 16):
// keygen's standard output for a throwaway key whose private half was
// discarded. The Console's Register reads it; keygen's output must be the same
// form. Change one, change both.

const FIXTURE = readFileSync(join(import.meta.dir, '..', 'fixtures', 'keygen-output.txt'), 'utf8');
const PRINTOUT = /^key-id ([0-9a-f]{16})\npublic-key ([A-Za-z0-9+/]+=*)\n$/;

let dir: string;
beforeEach(() => {
  // Real path: the command resolves --out against its own cwd, which has no symlinks.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'atrium-connector-keygen-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the printout the Console registers', () => {
  test('is the shared fixture: two labelled lines, one trailing line end, the key id derived from the key', async () => {
    const [, keyId, publicKey] = PRINTOUT.exec(FIXTURE)!;

    expect(keygenPrintout({ keyId: keyId!, publicKey: publicKey! })).toBe(FIXTURE);
    expect(await deriveKeyId(fromBase64Strict(publicKey!)!)).toBe(keyId!);
  });
});

describe('key ids', () => {
  // Public halves only: atrium's Connector Key Ring (backend/src/connector-artifact/
  // key-ring.json, key-ring.testing.json), whose ids atrium derived when it made them.
  const ATRIUM_RING = [
    {
      keyId: '224e6537a5024853',
      publicKey:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE6n/UfPGz5Hi/DlavTlR2Ao+N1x7qOrzm8E0t5dc4VNf75dD26jRZazG6BJusOq2UtreQGYGsz7L0LD3q1KtLzQ==',
    },
    {
      keyId: '87982da9ce7ded43',
      publicKey:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExbPjkRamzaKaFpMIlLmnfA+gcQpMVFjAoMm6b65eNkAHSoF2RsY8Ixl6OOtWD0A8R3g24mE4DfhVzSzd2ekk5Q==',
    },
  ];

  test("derive as atrium's do: its ring's keys, and the golden keys its publish made", async () => {
    const golden = JSON.parse(readFileSync(join(import.meta.dir, '..', 'golden', 'ring.json'), 'utf8')) as {
      keys: Record<string, { keyId: string; publicKey: string }>;
    };
    for (const key of [...ATRIUM_RING, ...Object.values(golden.keys)]) {
      expect(await deriveKeyId(fromBase64Strict(key.publicKey)!)).toBe(key.keyId);
    }
  });
});

describe('keygen', () => {
  test('writes a P-256 key file, mode 600, and prints only the fixture form on stdout', async () => {
    const out = join(dir, 'ci.atrium-key.json');

    const run = await runCommand(dir, 'keygen', '--name', 'CI pipeline', '--out', 'ci.atrium-key.json');

    expect(run.exitCode).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const file = JSON.parse(readFileSync(out, 'utf8'));
    expect(Object.keys(file)).toEqual(['keyId', 'privateKey', 'publicKey', 'name']);
    expect(file.name).toBe('CI pipeline');
    expect(await deriveKeyId(fromBase64Strict(file.publicKey)!)).toBe(file.keyId);

    expect(run.stdout).toMatch(PRINTOUT);
    expect(run.stdout).toBe(keygenPrintout(file));
    expect(run.stdout).not.toContain(file.privateKey);
    expect(run.stderr).not.toContain(file.privateKey);
    expect(run.stderr).toContain(`Wrote the key "CI pipeline" (key ${file.keyId}) to ${out}, mode 600.`);
  });

  test('the key it writes signs an Artifact that its printed public key opens', async () => {
    const fixture = await buildArtifactFixture({ signers: [] });
    const artifactPath = join(dir, fixture.fileName);
    writeFileSync(artifactPath, fixture.bytes);
    const made = await runCommand(dir, 'keygen', '--name', 'laptop', '--out', 'key.json');
    const [, keyId, publicKey] = PRINTOUT.exec(made.stdout)!;

    const signed = await runCommand(dir, 'sign', '--key', 'key.json', fixture.fileName);

    expect(signed.exitCode).toBe(0);
    const ring = [{ keyId: keyId!, alg: 'ecdsa-p256-sha256' as const, publicKey: publicKey!, comment: 'registered' }];
    expect((await openArtifact(new Uint8Array(readFileSync(artifactPath)), ring)).keyIds).toEqual([keyId!]);
  });

  test('never overwrites a file, and writes nothing on a refusal', async () => {
    const out = join(dir, 'key.json');
    writeFileSync(out, 'kept');

    const run = await runCommand(dir, 'keygen', '--name', 'CI', '--out', out);

    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe(
      `keygen failed: ${out} already exists. keygen never overwrites a key file. Nothing was written.\n` +
        '  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/build-and-sign.md\n',
    );
    expect(readFileSync(out, 'utf8')).toBe('kept');
  });

  test("refuses a name the Console wouldn't take", async () => {
    for (const name of ['x'.repeat(81), 'two\nlines']) {
      const run = await runCommand(dir, 'keygen', '--name', name, '--out', 'key.json');
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toStartWith('keygen failed: ');
      expect(existsSync(join(dir, 'key.json'))).toBe(false);
    }
  });

  test('refuses a folder that is not there', async () => {
    const run = await runCommand(dir, 'keygen', '--name', 'CI', '--out', 'nowhere/key.json');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`There is no folder ${join(dir, 'nowhere')} to write the key file in.`);
  });

  test('usage errors: no --name, no --out, a stray argument', async () => {
    for (const args of [['--out', 'k.json'], ['--name', 'CI'], ['--name', 'CI', '--out', 'k.json', 'extra']]) {
      const run = await runCommand(dir, 'keygen', ...args);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain('usage: atrium-connector keygen --name <name> --out <file>');
      expect(existsSync(join(dir, 'k.json'))).toBe(false);
    }
  });
});
