// Tar and gzip, read and written in code rather than by shelling out.
//
// Not a stylistic preference: the signing research note prescribes GNU tar's
// --sort=name / --mtime / --owner=0 --group=0 --numeric-owner for a normalized
// archive, and none of those flags exist on the bsdtar macOS ships. Doing it
// here makes normalization free rather than flag-dependent, and removes a host
// tool dependency instead of adding one. See ADR-0007, "Tar is read and
// written in code".
//
// Byte reproducibility is deliberately NOT claimed even so — Bun.build's
// output is not stable across Bun versions, so two publishes of the same
// source can differ before tar ever sees them. Normalizing headers removes the
// trivial nondeterminism; the guard against a version being republished with
// different bytes is the publish-time ledger, not this file.

import { gzipSync, gunzipSync } from 'zlib';
import { artifactError } from './errors';

const BLOCK = 512;

/** Offsets into a ustar header block. */
const NAME = 0;
const MODE = 100;
const SIZE = 124;
const CHKSUM = 148;
const TYPEFLAG = 156;
const LINKNAME = 157;
const MAGIC = 257;
const PREFIX = 345;

export interface TarEntry {
  name: string;
  /** The raw ustar typeflag byte, as a character. '0' and '\0' are regular files. */
  typeflag: string;
  linkname: string;
  /** Set for entries carried in a `prefix` field — we refuse those, but the name is error text. */
  data: Uint8Array;
}

export interface TarFile {
  name: string;
  data: Uint8Array;
}

// --- writing -------------------------------------------------------------

function writeString(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length >= length) {
    // Every name we write is one we generated (manifest.json, ATRIUM-SIGNED.json,
    // actions/<name>.js), so this is a publish-time bug rather than an
    // untrusted-input case. Refusing beats silently emitting a GNU long-name
    // extension entry the hardened reader would then reject.
    throw new Error(`tar field at offset ${offset} does not fit ${length} bytes: "${value}"`);
  }
  block.set(bytes, offset);
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  // ustar numeric fields are octal, NUL-terminated, zero-padded.
  const text = value.toString(8).padStart(length - 1, '0');
  writeString(block, offset, length, text);
}

function checksum(block: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    // The checksum field itself counts as eight spaces while being computed.
    sum += i >= CHKSUM && i < CHKSUM + 8 ? 0x20 : block[i]!;
  }
  return sum;
}

/**
 * One normalized header for a regular file: mode 0644, uid/gid 0, mtime 0,
 * empty uname/gname. Everything a filesystem would otherwise leak into the
 * archive is pinned to a constant.
 */
function header(name: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  writeString(block, NAME, 100, name);
  writeOctal(block, MODE, 8, 0o644);
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, SIZE, 12, size);
  writeOctal(block, 136, 12, 0); // mtime
  block[TYPEFLAG] = 0x30; // '0' — regular file
  writeString(block, MAGIC, 6, 'ustar');
  block[263] = 0x30; // version "00"
  block[264] = 0x30;
  // uname, gname, devmajor, devminor and prefix stay zero.

  const sum = checksum(block);
  // Historic quirk: six octal digits, NUL, then a space.
  writeString(block, CHKSUM, 7, sum.toString(8).padStart(6, '0'));
  block[CHKSUM + 7] = 0x20;
  return block;
}

/** Writes a flat tar of regular files, in the order given. */
export function writeTar(files: TarFile[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    total += chunk.length;
  };

  for (const file of files) {
    push(header(file.name, file.data.length));
    push(file.data);
    const remainder = file.data.length % BLOCK;
    if (remainder !== 0) push(new Uint8Array(BLOCK - remainder));
  }
  // Two zero blocks terminate the archive.
  push(new Uint8Array(BLOCK * 2));

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// --- gzip ----------------------------------------------------------------

const GZIP_MTIME = 4; // bytes 4..7 hold a timestamp zlib would otherwise stamp in
const GZIP_OS = 9; // byte 9 records the building platform

/** Gzip with the header's own nondeterminism — timestamp and OS byte — zeroed out. */
export function gzip(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(gzipSync(data, { level: 9 }));
  out[GZIP_MTIME] = 0;
  out[GZIP_MTIME + 1] = 0;
  out[GZIP_MTIME + 2] = 0;
  out[GZIP_MTIME + 3] = 0;
  out[GZIP_OS] = 0xff; // "unknown"
  return out;
}

/**
 * How much any single layer may expand to.
 *
 * This is not a size policy — it is a decompression-bomb bound, and it has to
 * live here because `readEnvelope` gunzips the outer layer BEFORE any
 * signature has been checked. Without it a few hundred kilobytes of hostile
 * gzip expands to hundreds of megabytes in the Instance's heap, and the Drop
 * Folder path has no upload cap standing in front of it. Real artifacts are
 * 1–4 MB, so this leaves two orders of magnitude of headroom.
 */
export const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;

export function gunzip(data: Uint8Array, what: string): Uint8Array {
  try {
    return new Uint8Array(gunzipSync(data, { maxOutputLength: MAX_DECOMPRESSED_BYTES }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && 'code' in err && err.code === 'ERR_BUFFER_TOO_LARGE') {
      throw artifactError(
        'envelope-malformed',
        `${what} expands to more than ${MAX_DECOMPRESSED_BYTES} bytes and was refused before ` +
          'being read.',
        { what, limit: String(MAX_DECOMPRESSED_BYTES) },
      );
    }
    throw artifactError('envelope-malformed', `${what} is not readable as gzip.`, { what, reason });
  }
}

// --- reading -------------------------------------------------------------

function readString(block: Uint8Array, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) return Number.NaN;
  return parseInt(text, 8);
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

/**
 * Parses a tar into its raw entries, preserving the typeflag and linkname so
 * the caller can refuse what it must. This does no safety filtering of its own
 * — that is `readSafeEntries`' job, and keeping the two apart is what lets the
 * hardening tests drive real hostile archives through a real parser.
 */
export function readTar(data: Uint8Array, what: string, maxEntries?: number): TarEntry[] {
  const bad = (message: string, details: Record<string, string> = {}) =>
    artifactError('envelope-malformed', `${what} is not a readable tar archive: ${message}`, {
      what,
      ...details,
    });

  const entries: TarEntry[] = [];
  let at = 0;
  while (at + BLOCK <= data.length) {
    const block = data.subarray(at, at + BLOCK);
    if (isZeroBlock(block)) break; // end-of-archive marker
    at += BLOCK;

    const stored = readOctal(block, CHKSUM, 8);
    if (!Number.isFinite(stored) || stored !== checksum(block)) {
      throw bad('a header block failed its checksum.');
    }

    const size = readOctal(block, SIZE, 12);
    if (!Number.isFinite(size) || size < 0) throw bad('a header block has an unreadable size.');
    if (at + size > data.length) throw bad('an entry claims more data than the archive holds.');

    if (maxEntries !== undefined && entries.length >= maxEntries) {
      // Refused on the header, before this entry's bytes are looked at. The
      // gzip cap bounds how much can be decompressed; this bounds how many
      // times a caller expecting a fixed number of entries walks that buffer.
      throw artifactError(
        'envelope-malformed',
        `${what} contains more than ${maxEntries} entries.`,
        { what, maxEntries: String(maxEntries) },
      );
    }

    const prefix = readString(block, PREFIX, 155);
    const name = readString(block, NAME, 100);
    const typeflagByte = block[TYPEFLAG]!;
    entries.push({
      // A prefix is a legitimate ustar way to spell a long path. We never
      // write one, and rejoining it here keeps the refusal about the path
      // rather than about an oddly truncated name.
      name: prefix === '' ? name : `${prefix}/${name}`,
      typeflag: typeflagByte === 0 ? '0' : String.fromCharCode(typeflagByte),
      linkname: readString(block, LINKNAME, 100),
      // A view, not a copy. With `slice` the entries of a crafted archive sum
      // to many times the decompressed size before any of them is rejected;
      // with `subarray` total memory stays bounded by MAX_DECOMPRESSED_BYTES
      // no matter how the entries are shaped. Nothing downstream mutates an
      // entry's bytes.
      data: data.subarray(at, at + size),
    });

    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

// --- hardening -----------------------------------------------------------

const REGULAR_TYPEFLAGS = new Set(['0', '\0', '7']); // '7' is contiguous; treat as regular

function unsafe(message: string, details: Record<string, string>) {
  return artifactError('unsafe-entry', message, details);
}

/**
 * The path rules, shared by the extractor and by the envelope writer.
 *
 * Publish runs them too, deliberately: emitting a signed artifact no Instance
 * can open is a failure that should fire on the publishing machine, not at a
 * customer's. Same rules on both sides means there is one definition of a
 * legal payload path rather than two that can drift.
 */
export function assertSafeEntryName(name: string, what: string): void {
  if (name === '' || name.endsWith('/')) {
    throw unsafe(`${what} contains an entry with no file name (${name || '<empty>'}).`, {
      what,
      path: name,
    });
  }
  // Backslashes are checked alongside '/' so a Windows-shaped path cannot
  // smuggle a traversal past a forward-slash-only split.
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    throw unsafe(`${what} contains an absolute path (${name}), which is refused.`, {
      what,
      path: name,
    });
  }
  const segments = name.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    throw unsafe(`${what} contains a path traversal (${name}), which is refused.`, {
      what,
      path: name,
    });
  }
  // A backslash is refused outright rather than merely split on. Treating it
  // as a separator here and as a literal on a POSIX host is what would let
  // 'actions\x.js' and 'actions/x.js' be one file in one place and two in the
  // other — the same shadowing the duplicate-name rule exists to stop.
  if (name.includes('\\')) {
    throw unsafe(
      `${what} contains a backslash in an entry name (${name}), which is refused — payload ` +
        'paths are forward-slashed.',
      { what, path: name },
    );
  }
  // '.' and '' segments are refused not because they escape anything but
  // because they make two spellings of one file: './manifest.json' and
  // 'manifest.json' are distinct listing entries and the same file on disk,
  // which is exactly the shadowing the duplicate-name rule exists to stop.
  if (segments.some((segment) => segment === '.' || segment === '')) {
    throw unsafe(
      `${what} contains a non-canonical path (${name}), which is refused — a file must appear ` +
        'under exactly one name.',
      { what, path: name },
    );
  }
  if (name.includes('\0')) {
    throw unsafe(`${what} contains an entry name with an embedded NUL.`, { what, path: name });
  }
}

/**
 * The hardened extractor. Every rule here exists because the alternative is a
 * write outside the Connector Store, and none of them is implied by a valid
 * signature — a per-file content listing says nothing about tar *headers*,
 * which is exactly why ADR-0007 keeps this separate from the signature check.
 *
 * Refused: symlinks, hardlinks, absolute paths, any `..` component, anything
 * that is not a regular file (directories, devices, fifos, and the pax/GNU
 * extension entries a long name would otherwise arrive as), and duplicate
 * names. Modes are not read at all — the writer forces them.
 */
export function readSafeEntries(data: Uint8Array, what: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();

  for (const entry of readTar(data, what)) {
    const name = entry.name;

    if (entry.typeflag === '2') {
      throw unsafe(`${what} contains a symlink (${name} -> ${entry.linkname}), which is refused.`, {
        what,
        path: name,
        linkname: entry.linkname,
      });
    }
    if (entry.typeflag === '1') {
      throw unsafe(`${what} contains a hardlink (${name} -> ${entry.linkname}), which is refused.`, {
        what,
        path: name,
        linkname: entry.linkname,
      });
    }
    if (!REGULAR_TYPEFLAGS.has(entry.typeflag)) {
      throw unsafe(
        `${what} contains a non-regular entry (${name}, type '${entry.typeflag}'), which is refused.`,
        { what, path: name, typeflag: entry.typeflag },
      );
    }
    assertSafeEntryName(name, what);
    if (files.has(name)) {
      throw unsafe(`${what} contains a duplicate entry name (${name}), which is refused.`, {
        what,
        path: name,
      });
    }

    files.set(name, entry.data);
  }

  return files;
}
