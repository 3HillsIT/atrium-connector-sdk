// ECDSA P-256 / SHA-256 over a small signed blob, verified with crypto.subtle
// against a ring the CALLER passes in. No cosign binary in the image, no
// network call, no transparency log — an artifact must verify identically
// whether it arrived over a registry or on a USB stick in an air-gapped
// datacentre.
//
// This module holds no key and no ring, and names none. Which keys an
// Instance trusts, and what a set of verified keys means (atrium's Connector
// Key Ring, a Customer Key List), is atrium's to decide (ADR-0007, Amendment
// from #11226; ADR-0021). The verifier reports every key that validated and
// stops there.
//
// P-256 rather than the more pleasant Ed25519 because Azure Key Vault has no
// OKP key type and no EdDSA algorithm, and that is where the private key is
// headed. Starting on P-256 makes that move a ring addition instead of a full
// rotation cycle.
//
// Two rules here are structural, not disciplinary:
//
//   1. The algorithm comes from the RING ENTRY, never from the signature
//      file's `alg` field. A verifier that dispatches on attacker-supplied
//      `alg` is one `alg: none` away from a no-op.
//   2. The signed blob is treated as an opaque octet string — hashed and
//      verified as received, never reserialized from a parsed object. That
//      sidesteps JSON canonicalization entirely.
//
// There is no expiry check anywhere, deliberately: an air-gapped Instance with
// a skewed clock, or one running years past a key's nominal life, must still
// install the artifacts it was shipped to trust. Revocation is "ship an Atrium
// version with that key removed" and is therefore only effective on upgrade.

import { artifactError } from './errors';
import { fromBase64, fromBase64Strict, fromUtf8, sha256Hex, toBase64, utf8 } from './digest';
import type { SubtleBytes } from './digest';
import type { ArtifactSignature, RingKey, SignedBlob } from './types';

export const SIGNATURE_HEADER = 'ATRIUM-SIG-v1';
export const BLOB_HEADER = 'ATRIUM-SIGNED-BLOB-v1';
/** The one algorithm a ring key speaks, and the one every signature line names. */
export const SIGNATURE_ALG = 'ecdsa-p256-sha256';
/** payload.sig's first line: unsigned, and never read back. */
export const SIGNATURE_COMMENT = 'untrusted comment: atrium connector signature';
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const P256_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

// --- keys ----------------------------------------------------------------

/**
 * A key id is the first 8 bytes of SHA-256 over the SPKI, hex — minisign's
 * 8-byte id applied to npm's fingerprint-of-the-public-key idea. It is derived
 * rather than assigned so a ring entry cannot claim an id that is not its own.
 */
export async function deriveKeyId(publicKeySpki: Uint8Array): Promise<string> {
  return (await sha256Hex(publicKeySpki)).slice(0, 16);
}

export interface GeneratedSigningKey {
  keyId: string;
  /** Base64 PKCS#8. Never committed — this half goes to the password manager. */
  privateKey: string;
  /** Base64 SPKI. This half is what the committed ring carries. */
  publicKey: string;
}

export async function generateSigningKey(): Promise<GeneratedSigningKey> {
  const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    keyId: await deriveKeyId(spki),
    privateKey: toBase64(pkcs8),
    publicKey: toBase64(spki),
  };
}

export async function importPrivateKey(privateKeyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    fromBase64(privateKeyBase64) as unknown as SubtleBytes,
    P256,
    false,
    ['sign'],
  );
}

async function importRingKey(key: RingKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(key.publicKey) as unknown as SubtleBytes,
    P256,
    false,
    ['verify'],
  );
}

// --- the signed blob -----------------------------------------------------

/**
 * Line-oriented rather than JSON, so there is no canonicalization question to
 * get wrong. `id` and `version` ride inside the signed bytes — minisign's
 * trusted comment, and the reason the filename can be treated as an assertion
 * the signature settles rather than as trusted input.
 */
export function serializeBlob(blob: SignedBlob): Uint8Array {
  return utf8(
    [
      BLOB_HEADER,
      `id ${blob.id}`,
      `version ${blob.version}`,
      `payload-sha256 ${blob.payloadSha256}`,
      `listing-sha256 ${blob.listingSha256}`,
      `published-at ${blob.publishedAt}`,
      '',
    ].join('\n'),
  );
}

export function parseBlob(data: Uint8Array): SignedBlob {
  const lines = fromUtf8(data).split('\n');
  if (lines[0] !== BLOB_HEADER) {
    throw artifactError(
      'signature-malformed',
      `The signed document is not ${BLOB_HEADER}.`,
      { header: lines[0] ?? '' },
    );
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    const space = line.indexOf(' ');
    if (space === -1) {
      throw artifactError('signature-malformed', 'The signed document has an unreadable line.');
    }
    fields.set(line.slice(0, space), line.slice(space + 1));
  }

  const required = ['id', 'version', 'payload-sha256', 'listing-sha256', 'published-at'];
  for (const field of required) {
    if (!fields.has(field)) {
      throw artifactError(
        'signature-malformed',
        `The signed document is missing its "${field}" field.`,
        { field },
      );
    }
  }
  return {
    id: fields.get('id')!,
    version: fields.get('version')!,
    payloadSha256: fields.get('payload-sha256')!,
    listingSha256: fields.get('listing-sha256')!,
    publishedAt: fields.get('published-at')!,
  };
}

// --- payload.sig ---------------------------------------------------------

/**
 * ```
 * untrusted comment: atrium connector signature
 * ATRIUM-SIG-v1
 * <keyId>  <alg>  <base64 signature>
 * [more signature lines — the dual-sign window]
 * --
 * <base64 of the signed blob>
 * ```
 *
 * The signature list is the single highest-value detail for long-tail
 * air-gapped Instances: one artifact can carry both an old-key and a new-key
 * signature, so a rotation is an overlap rather than a flag day. It costs 64
 * bytes per extra key.
 */
export function serializeSignatureFile(
  signatures: ArtifactSignature[],
  blob: Uint8Array,
  /** Unsigned and never read back. The Connector index's `.sig` names itself here. */
  comment: string = SIGNATURE_COMMENT,
): Uint8Array {
  const lines = [comment, SIGNATURE_HEADER];
  for (const signature of signatures) {
    lines.push(`${signature.keyId}  ${signature.alg}  ${signature.signature}`);
  }
  lines.push('--', toBase64(blob), '');
  return utf8(lines.join('\n'));
}

export interface ParsedSignatureFile {
  signatures: ArtifactSignature[];
  /** The blob exactly as it was signed. Never reserialized before verifying. */
  blobBytes: Uint8Array;
}

export interface ParseSignatureFileOptions {
  /**
   * Reads a file with no signature line, as `build` writes it, instead of
   * refusing it as `signature-missing`. For the one caller that adds a
   * signature (`sign`); every opener keeps the refusal.
   */
  allowUnsigned?: boolean;
}

export function parseSignatureFile(
  data: Uint8Array,
  options: ParseSignatureFileOptions = {},
): ParsedSignatureFile {
  const lines = fromUtf8(data).split('\n');
  const headerAt = lines.indexOf(SIGNATURE_HEADER);
  if (headerAt === -1) {
    throw artifactError('signature-malformed', `The signature file is not ${SIGNATURE_HEADER}.`);
  }
  const separatorAt = lines.indexOf('--', headerAt);
  if (separatorAt === -1) {
    throw artifactError('signature-malformed', 'The signature file has no "--" separator.');
  }

  const signatures: ArtifactSignature[] = [];
  for (const line of lines.slice(headerAt + 1, separatorAt)) {
    if (line.trim() === '') continue;
    const parts = line.split(/\s+/).filter((part) => part !== '');
    if (parts.length !== 3) {
      throw artifactError(
        'signature-malformed',
        'A signature line is not "<keyId>  <alg>  <base64 signature>".',
      );
    }
    signatures.push({ keyId: parts[0]!, alg: parts[1]!, signature: parts[2]! });
  }
  if (signatures.length === 0 && !options.allowUnsigned) {
    throw artifactError('signature-missing', 'The signature file carries no signatures.');
  }

  const blobBase64 = lines
    .slice(separatorAt + 1)
    .join('')
    .trim();
  if (blobBase64 === '') {
    throw artifactError('signature-malformed', 'The signature file carries no signed document.');
  }
  return { signatures, blobBytes: fromBase64(blobBase64) };
}

// --- signing and verifying ----------------------------------------------

export async function signBlob(params: {
  blob: Uint8Array;
  keyId: string;
  privateKey: CryptoKey;
}): Promise<ArtifactSignature> {
  // WebCrypto emits the raw r||s form ES256 wants — unlike node:crypto and
  // openssl, which default to DER. Any future signer routed through those (or
  // through Key Vault) has to convert here rather than downstream.
  const raw = new Uint8Array(
    await crypto.subtle.sign(P256_SIGN, params.privateKey, params.blob as unknown as SubtleBytes),
  );
  return { keyId: params.keyId, alg: SIGNATURE_ALG, signature: toBase64(raw) };
}

export interface SignatureVerification {
  blob: SignedBlob;
  /**
   * Every ring key whose signature validated, in file order, each once. Never
   * empty. Which of them to trust, and as whose, is the caller's decision.
   */
  keyIds: string[];
}

/** An Artifact's payload.sig: the signatures checked, then the blob read as a SignedBlob. */
export async function verifySignatureFile(
  file: ParsedSignatureFile,
  ring: RingKey[],
): Promise<SignatureVerification> {
  const { blobBytes, keyIds } = await verifySignatures(file, ring);
  return { blob: parseBlob(blobBytes), keyIds };
}

/**
 * Verification passes when ANY signature in the file validates against ANY key
 * in the ring. That is the whole mechanism behind dual-signing: an Instance
 * shipped before a rotation and one shipped after both accept the same file.
 *
 * It does not stop at the first key that validates. It reports every one, so
 * that the caller can decide what the set means (a Connector Key Ring key, a
 * Customer Key, both): this function holds no ring of its own and decides
 * nothing about trust.
 *
 * The failure ordering matters. An entirely unknown key id is `unknown-key` —
 * the expected failure for an out-of-date Instance, and the only one whose
 * remedy is "update Atrium" rather than "something is wrong". A known key id
 * whose signature does not check out is `signature-invalid`, which is never
 * benign. `unknown-key` carries every key id the file names in
 * `details.keyIds`, comma-separated, so a caller that knows a key by name (a
 * testing key, say) can say so in its own refusal.
 *
 * Returns the blob as it was signed, unread: what it holds is the caller's
 * kind of document, an Artifact's SignedBlob or the Connector index's.
 */
export async function verifySignatures(
  file: ParsedSignatureFile,
  ring: RingKey[],
): Promise<{ blobBytes: Uint8Array; keyIds: string[] }> {
  const { keyIds, sawKnownKey } = await collectVerifiedKeyIds(file, ring);
  if (keyIds.length > 0) return { blobBytes: file.blobBytes, keyIds };

  const seen = file.signatures.map((signature) => signature.keyId).join(', ');
  if (!sawKnownKey) {
    throw artifactError(
      'unknown-key',
      `This artifact was signed with a key this atrium Version does not trust (key ${seen}). ` +
        'It was most likely published after your atrium Release. Update atrium, or request an ' +
        'artifact signed with a key this version carries.',
      { keyIds: seen },
    );
  }
  throw artifactError(
    'signature-invalid',
    'The signature does not match this artifact. Do not install it; contact 3 Hills IT.',
    { keyIds: seen },
  );
}

/**
 * The collect-all loop of atrium's `signed-file` module (ADR-0010 §4), which
 * the License verifies with: every signature line is tried, and every ring
 * key that validated is kept, in file order and once each.
 *
 * Its rules are structural:
 *
 *   - The algorithm comes from the RING ENTRY, never from the signature
 *     line's `alg`. A line claiming another algorithm than its ring key is
 *     not merely wrong about itself, it is trying something.
 *   - A ring entry that will not load is skipped, never fatal. One malformed
 *     key must not be able to veto a dual-signed artifact that another ring
 *     key would have validated — that would turn the mechanism built to
 *     survive a rotation into a single point of failure.
 *   - A signature that is not canonical base64, or that the platform refuses
 *     to check, validates nothing; it vetoes nothing either.
 *
 * `sawKnownKey` says whether any line named a ring key at all, which is what
 * tells `unknown-key` from `signature-invalid`.
 */
async function collectVerifiedKeyIds(
  file: ParsedSignatureFile,
  ring: RingKey[],
): Promise<{ keyIds: string[]; sawKnownKey: boolean }> {
  const ringById = new Map(ring.map((key) => [key.keyId, key]));
  let sawKnownKey = false;
  const keyIds: string[] = [];

  for (const signature of file.signatures) {
    const ringKey = ringById.get(signature.keyId);
    if (!ringKey) continue;
    sawKnownKey = true;
    if (keyIds.includes(ringKey.keyId)) continue;

    if (ringKey.alg !== SIGNATURE_ALG || signature.alg !== ringKey.alg) continue;

    let publicKey: CryptoKey;
    try {
      publicKey = await importRingKey(ringKey);
    } catch {
      continue;
    }

    const raw = fromBase64Strict(signature.signature);
    if (!raw) continue;
    let ok = false;
    try {
      ok = await crypto.subtle.verify(
        P256_SIGN,
        publicKey,
        raw as unknown as SubtleBytes,
        file.blobBytes as unknown as SubtleBytes,
      );
    } catch {
      ok = false;
    }
    if (ok) keyIds.push(ringKey.keyId);
  }
  return { keyIds, sawKnownKey };
}
