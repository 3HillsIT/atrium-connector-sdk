// Key files: the JSON a signing key lives in, one shape for every side that
// makes or reads one. atrium's `bun run keygen:signing` writes
// `{label, keyId, privateKey, publicKey, generatedAt}`; the Console's browser
// download writes `{keyId, privateKey, publicKey, name, account}`; `keygen`
// here writes `{keyId, privateKey, publicKey, name}`. `sign` reads the three
// halves every one of them has and ignores the rest.
//
// The key id is never trusted from the file: it is derived from the public
// half exactly as atrium derives it (`deriveKeyId`, the first 8 bytes of
// SHA-256 over the SPKI), so a mislabelled file is refused rather than
// signing under an id that isn't its own. Messages name the file, never what
// is in it: a key file's text is a private key.

import { existsSync, readFileSync } from 'fs';
import {
  SIGNATURE_ALG,
  deriveKeyId,
  fromBase64Strict,
  generateSigningKey,
  importPrivateKey,
  importPublicKey,
} from '../artifact';
import type { ArtifactSigner } from '../artifact';

/** What a key file holds. `name` and `account` are the Console's; `keygen` writes `name`. */
export interface KeyFile {
  keyId: string;
  /** Base64 PKCS#8: the private half. */
  privateKey: string;
  /** Base64 SPKI: the public half, what the Console registers. */
  publicKey: string;
  name?: string;
  /** The Console account the key belongs to, when the Console made it. */
  account?: string;
}

/** A key file read and checked: ready to sign with, and to check what it signed. */
export interface LoadedKey extends ArtifactSigner {
  name?: string;
}

/** A key file `sign` won't use, with the reason. Never quotes the file's contents. */
export class KeyFileRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyFileRefusal';
  }
}

/**
 * Reads the key file at `path` and checks it: JSON with `keyId`, `privateKey`
 * and `publicKey`, a P-256 public half whose derived id is `keyId`, and a
 * P-256 private half. Whether the private half is the public half's partner
 * is checked by the signature it makes (`addSignature`).
 */
export async function readKeyFile(path: string): Promise<LoadedKey> {
  const refuse = (why: string) => new KeyFileRefusal(`The key file at ${path} ${why}`);
  if (!existsSync(path)) throw new KeyFileRefusal(`There is no key file at ${path}.`);

  let file: Partial<KeyFile>;
  try {
    file = JSON.parse(readFileSync(path, 'utf-8')) as Partial<KeyFile>;
  } catch {
    // The parse error's own message can quote the text, so it is dropped.
    throw refuse('is not readable as JSON ({ keyId, privateKey, publicKey }).');
  }
  if (
    file === null ||
    typeof file !== 'object' ||
    typeof file.keyId !== 'string' ||
    typeof file.privateKey !== 'string' ||
    typeof file.publicKey !== 'string'
  ) {
    throw refuse('is missing one of { keyId, privateKey, publicKey }.');
  }

  const spki = fromBase64Strict(file.publicKey);
  if (!spki || !(await importPublicKey(spki).then(() => true, () => false))) {
    throw refuse(
      'holds a public half that is not a P-256 public key (base64 SPKI). Connector Artifacts ' +
        `are signed ${SIGNATURE_ALG}, so only a P-256 key signs one.`,
    );
  }
  const derived = await deriveKeyId(spki);
  if (derived !== file.keyId) {
    throw refuse(`claims key id ${file.keyId}, but its public half derives ${derived}.`);
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importPrivateKey(file.privateKey);
  } catch {
    throw refuse(`holds a private half that is not a P-256 private key (base64 PKCS#8).`);
  }
  return {
    keyId: derived,
    privateKey,
    publicKey: file.publicKey,
    ...(typeof file.name === 'string' ? { name: file.name } : {}),
  };
}

/** A new P-256 key, as the key file `keygen` writes. */
export async function makeKeyFile(name: string): Promise<KeyFile> {
  const key = await generateSigningKey();
  return { keyId: key.keyId, privateKey: key.privateKey, publicKey: key.publicKey, name };
}

/** The key file's text: indented JSON, as atrium's keygen and the Console's download write it. */
export function keyFileText(file: KeyFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

/**
 * What `keygen` prints on standard output, and what the Console's Register
 * takes in its Public key field: two lines, the key id and the public half
 * (base64 SPKI), each after its label and one space, `\n` line ends, one
 * trailing `\n`. Nothing else goes to standard output, so
 * `atrium-connector keygen … > key.pub` is the paste.
 *
 *     key-id 5edf8f879585b497
 *     public-key MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…
 *
 * The Console's `keygenPrintout` (contracts/customer-keys.ts) is the other
 * copy; test/fixtures/keygen-output.txt is the Console's shared fixture,
 * copied, and holds both to the same bytes.
 */
export function keygenPrintout(key: { keyId: string; publicKey: string }): string {
  return `key-id ${key.keyId}\npublic-key ${key.publicKey}\n`;
}
