// SHA-256 and base64, via WebCrypto only — no node:crypto, so the module
// keeps the same shape whether it is running in the backend or compiled into
// the CLI.

/**
 * The bytes crypto.subtle takes (WebIDL's BufferSource), named off the
 * function itself so the module typechecks with and without the DOM lib: the
 * SDK compiles without it, atrium with it.
 */
export type SubtleBytes = Parameters<typeof crypto.subtle.digest>[1];

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as SubtleBytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/** Lenient, as Buffer is: characters that are not base64 are dropped, not refused. */
export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Canonical, padded base64, or `null` for anything else. The verify loop
 * decodes signatures with this, as atrium's `signed-file` does: a signature
 * that only decodes after junk is dropped from it has been tampered with.
 */
export function fromBase64Strict(text: string): Uint8Array | null {
  if (!BASE64.test(text)) return null;
  return new Uint8Array(Buffer.from(text, 'base64'));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromUtf8(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Constant-time-ish comparison of two hex digests. Not a defence against a
 * timing attack that matters here — the attacker supplies both sides — but it
 * costs nothing and keeps the habit.
 */
export function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
