import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildArtifactFixture,
  fromUtf8,
  generateSigningKey,
  openArtifact,
  parseSignatureFile,
  readEnvelope,
  sha256Hex,
  toBase64,
  writeEnvelopeParts,
} from '../../src/artifact';
import type { RingKey } from '../../src/artifact';
import { makeConnectorRepo, runCommand } from '../support/connector-repo';

// `atrium-connector sign --key <file> <artifact>`, driven through the command
// in a temp folder: signing what `build` wrote, a second key at a rotation,
// the same key again, and every key file and Artifact it refuses. Every key is
// made here; none is committed.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atrium-connector-sign-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface TestKey {
  keyId: string;
  privateKey: string;
  publicKey: string;
  ring: RingKey[];
}

async function newKey(): Promise<TestKey> {
  const key = await generateSigningKey();
  return { ...key, ring: [{ keyId: key.keyId, alg: 'ecdsa-p256-sha256', publicKey: key.publicKey, comment: 'test' }] };
}

/** A key file in the temp folder; `contents` defaults to the Console's download shape. */
function keyFile(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2) + '\n', {
    mode: 0o600,
  });
  return path;
}

function consoleKeyFile(key: TestKey, name = 'console.atrium-key.json'): string {
  const { keyId, privateKey, publicKey } = key;
  return keyFile(name, { keyId, privateKey, publicKey, name: 'CI pipeline', account: 'acc-test' });
}

/** An unsigned Artifact as `build` writes it (no signature line), in the temp folder. */
async function unsignedArtifact(): Promise<string> {
  const fixture = await buildArtifactFixture({ id: 'thing-connector', version: '1.2.0', signers: [] });
  const path = join(dir, fixture.fileName);
  writeFileSync(path, fixture.bytes);
  return path;
}

function read(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

/** payload.sig's signature lines, as the file names them. */
function signatureLines(path: string) {
  return parseSignatureFile(readEnvelope(read(path)).signature).signatures;
}

async function sign(keyPath: string, artifactPath: string) {
  return await runCommand(dir, 'sign', '--key', keyPath, artifactPath);
}

describe('sign', () => {
  test('signs the Artifact build wrote, and an Instance trusting the key opens it', async () => {
    const repo = makeConnectorRepo();
    try {
      const built = await runCommand(repo.dir, 'build');
      expect(built.exitCode).toBe(0);
      const [fileName] = readdirSync(join(repo.dir, 'dist'));
      const artifactPath = join(repo.dir, 'dist', fileName!);
      const before = readEnvelope(read(artifactPath));
      const key = await newKey();

      const run = await runCommand(repo.dir, 'sign', '--key', consoleKeyFile(key), `dist/${fileName}`);

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe('');
      const opened = await openArtifact(read(artifactPath), key.ring);
      expect(opened.keyIds).toEqual([key.keyId]);
      expect(opened.manifest.id).toBe('thing-connector');
      const after = readEnvelope(read(artifactPath));
      expect(after.payload).toEqual(before.payload);
      expect(parseSignatureFile(after.signature).blobBytes).toEqual(
        parseSignatureFile(before.signature, { allowUnsigned: true }).blobBytes,
      );
      expect(run.stdout).toBe(
        `Signed thing-connector 1.2.0 with key ${key.keyId} ("CI pipeline"): dist/${fileName}\n` +
          `payload.sig carries 1 signature (${key.keyId}). Payload ${opened.payloadSha256}, unchanged.\n`,
      );
      expect(built.stdout).toContain(`atrium-connector sign --key <key file> dist/${fileName}`);
    } finally {
      repo.remove();
    }
  });

  test('a second key adds a second signature: both verify, the payload is the same bytes', async () => {
    const artifactPath = await unsignedArtifact();
    const payloadSha256 = await sha256Hex(readEnvelope(read(artifactPath)).payload);
    const first = await newKey();
    const second = await newKey();

    expect((await sign(consoleKeyFile(first, 'first.json'), artifactPath)).exitCode).toBe(0);
    const run = await sign(consoleKeyFile(second, 'second.json'), artifactPath);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`payload.sig carries 2 signatures (${first.keyId}, ${second.keyId}).`);
    const bytes = read(artifactPath);
    expect(await sha256Hex(readEnvelope(bytes).payload)).toBe(payloadSha256);
    expect((await openArtifact(bytes, [...first.ring, ...second.ring])).keyIds).toEqual([first.keyId, second.keyId]);
    expect((await openArtifact(bytes, first.ring)).keyIds).toEqual([first.keyId]);
    expect((await openArtifact(bytes, second.ring)).keyIds).toEqual([second.keyId]);
  });

  test('the same key again replaces its signature where it stood, never doubling it', async () => {
    const artifactPath = await unsignedArtifact();
    const first = await newKey();
    const second = await newKey();
    const firstPath = consoleKeyFile(first, 'first.json');
    await sign(firstPath, artifactPath);
    await sign(consoleKeyFile(second, 'second.json'), artifactPath);
    const firstLine = signatureLines(artifactPath)[0]!;

    const run = await sign(firstPath, artifactPath);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`with key ${first.keyId} ("CI pipeline"), replacing its earlier signature:`);
    const lines = signatureLines(artifactPath);
    expect(lines.map((line) => line.keyId)).toEqual([first.keyId, second.keyId]);
    // ECDSA signs with a fresh nonce: a new line, in the old one's place.
    expect(lines[0]!.signature).not.toBe(firstLine.signature);
    expect((await openArtifact(read(artifactPath), [...first.ring, ...second.ring])).keyIds).toEqual([
      first.keyId,
      second.keyId,
    ]);
  });

  test("reads atrium's key file shape, with its label and no name", async () => {
    const artifactPath = await unsignedArtifact();
    const key = await newKey();
    const path = keyFile('atrium-key.json', {
      label: 'atrium-testing',
      keyId: key.keyId,
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      generatedAt: '2026-11-05T00:00:00.000Z',
    });

    const run = await sign(path, artifactPath);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`with key ${key.keyId}: `);
    expect((await openArtifact(read(artifactPath), key.ring)).keyIds).toEqual([key.keyId]);
  });

  describe('refuses, and leaves the Artifact as it was', () => {
    let artifactPath: string;
    let original: Uint8Array;
    beforeEach(async () => {
      artifactPath = await unsignedArtifact();
      original = read(artifactPath);
    });

    async function refusal(keyPath: string, target = artifactPath) {
      const run = await sign(keyPath, target);
      expect(run.exitCode).toBe(1);
      expect(run.stdout).toBe('');
      expect(read(artifactPath)).toEqual(original);
      expect(readdirSync(dir).filter((name) => name.startsWith('.'))).toEqual([]);
      return run.stderr;
    }

    test('a key file whose key id is not derived from its public half', async () => {
      const key = await newKey();
      const other = await newKey();
      const path = keyFile('key.json', { ...key, ring: undefined, keyId: other.keyId });

      expect(await refusal(path)).toBe(
        `sign failed: The key file at ${path} claims key id ${other.keyId}, but its public half derives ` +
          `${key.keyId}. Nothing was written.\n` +
          '  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/build-and-sign.md\n',
      );
    });

    test('a key that is not P-256', async () => {
      for (const algorithm of [
        { name: 'ECDSA', namedCurve: 'P-384' },
        { name: 'Ed25519' },
      ] as const) {
        const pair = (await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])) as CryptoKeyPair;
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
        const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
        const keyId = (await sha256Hex(spki)).slice(0, 16);
        const path = keyFile('key.json', { keyId, privateKey: toBase64(pkcs8), publicKey: toBase64(spki) });

        const stderr = await refusal(path);

        expect(stderr).toContain(`The key file at ${path} holds a public half that is not a P-256 public key`);
      }
    });

    test('a P-256 public half with a private half of another curve', async () => {
      const key = await newKey();
      const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, [
        'sign',
        'verify',
      ])) as CryptoKeyPair;
      const pkcs8 = toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)));
      const path = keyFile('key.json', { keyId: key.keyId, privateKey: pkcs8, publicKey: key.publicKey });

      expect(await refusal(path)).toContain('holds a private half that is not a P-256 private key');
    });

    test("a private half that isn't the public half's: the signature it made doesn't verify", async () => {
      const key = await newKey();
      const other = await newKey();
      const path = keyFile('key.json', { keyId: key.keyId, privateKey: other.privateKey, publicKey: key.publicKey });

      expect(await refusal(path)).toBe(
        `sign failed: The signature made with key ${key.keyId} does not verify with that key's public half: ` +
          `the private half belongs to another key. Check the key file at ${path}. Nothing was written.\n` +
          '  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/build-and-sign.md\n',
      );
    });

    test('a key file that is not JSON, or lacks a half, without quoting it', async () => {
      const key = await newKey();
      const notJson = keyFile('a.json', `${key.privateKey} not json`);
      const noPrivate = keyFile('b.json', { keyId: key.keyId, publicKey: key.publicKey });

      const first = await refusal(notJson);
      expect(first).toContain(`The key file at ${notJson} is not readable as JSON ({ keyId, privateKey, publicKey }).`);
      expect(first).not.toContain(key.privateKey);
      expect(await refusal(noPrivate)).toContain('is missing one of { keyId, privateKey, publicKey }.');
      expect(await refusal(join(dir, 'missing.json'))).toContain(`There is no key file at ${join(dir, 'missing.json')}.`);
    });

    test('an Artifact whose payload is not the one its blob signed', async () => {
      const key = await newKey();
      const other = await buildArtifactFixture({ id: 'thing-connector', version: '1.2.0', signers: [], actions: ['x'] });
      writeFileSync(
        artifactPath,
        writeEnvelopeParts({
          payload: readEnvelope(other.bytes).payload,
          signature: readEnvelope(original).signature,
        }),
      );
      original = read(artifactPath);

      const stderr = await refusal(consoleKeyFile(key));

      expect(stderr).toContain(`sign failed: The Artifact at ${artifactPath} can't be signed: The artifact does not match its signature`);
      expect(stderr).toEndWith('  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/troubleshooting.md\n');
    });

    test('a file that is not an Artifact, or none at all', async () => {
      const key = await newKey();
      writeFileSync(artifactPath, 'not an artifact');
      original = read(artifactPath);

      expect(await refusal(consoleKeyFile(key))).toContain(`The Artifact at ${artifactPath} can't be signed: `);
      const missing = join(dir, 'missing.atrium.tar.gz');
      const none = await refusal(consoleKeyFile(key), missing);
      expect(none).toContain(`There is no Artifact at ${missing}.`);
      expect(none).toContain('docs/troubleshooting.md');
    });
  });

  test('usage errors: no --key, no Artifact, two Artifacts', async () => {
    const artifactPath = await unsignedArtifact();
    for (const args of [[artifactPath], ['--key', 'k.json'], ['--key', 'k.json', artifactPath, artifactPath]]) {
      const run = await runCommand(dir, 'sign', ...args);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain('usage: atrium-connector sign --key <file> <artifact>');
    }
  });

  test('an unsigned Artifact stays unreadable to every opener', async () => {
    const artifactPath = await unsignedArtifact();
    const sig = readEnvelope(read(artifactPath)).signature;
    expect(fromUtf8(sig)).not.toMatch(/ecdsa-p256-sha256/);
    expect(() => parseSignatureFile(sig)).toThrow('carries no signatures');
    expect(parseSignatureFile(sig, { allowUnsigned: true }).signatures).toEqual([]);
  });
});
