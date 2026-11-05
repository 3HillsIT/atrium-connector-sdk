// ATRIUM-SIGNED.json — built at publish, checked after unpacking.
//
// It is a pure integrity document: a sorted per-file SHA-256 listing plus the
// id and version it belongs to. Nothing semantic lives here, because anything
// semantic belongs in the manifest — which the listing covers like any other
// file, so the manifest is protected without the listing having to understand
// it.
//
// The check is exact SET EQUALITY, not "everything named is authentic". A file
// on disk the listing does not name is a failure, because loading an Action
// resolves what it finds, so an injected file is as dangerous as a modified
// one. See ADR-0007 §3.

import { artifactError } from './errors';
import { digestsEqual, fromUtf8, sha256Hex, utf8 } from './digest';
import { LISTING_FILE } from './types';
import type { ListedFile, SignedListing } from './types';

/**
 * Builds the listing over every payload file except itself — the listing
 * cannot contain its own hash, which is the same reason the envelope has two
 * layers. Its own integrity is anchored by the digest inside the signed blob.
 */
export async function buildListing(params: {
  id: string;
  version: string;
  files: Map<string, Uint8Array>;
}): Promise<SignedListing> {
  const files: ListedFile[] = [];
  for (const [path, data] of params.files) {
    if (path === LISTING_FILE) continue;
    files.push({ path, sha256: await sha256Hex(data), size: data.length });
  }
  // Sorted by path so the document is stable regardless of insertion order.
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { listingVersion: 1, id: params.id, version: params.version, files };
}

/** Serialized with two-space indent, and it is these exact bytes that get hashed and signed. */
export function serializeListing(listing: SignedListing): Uint8Array {
  return utf8(JSON.stringify(listing, null, 2) + '\n');
}

export function parseListing(data: Uint8Array): SignedListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(data));
  } catch (err) {
    throw artifactError('listing-malformed', `${LISTING_FILE} is not valid JSON.`, {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const candidate = parsed as Partial<SignedListing>;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.listingVersion !== 1 ||
    typeof candidate.id !== 'string' ||
    typeof candidate.version !== 'string' ||
    !Array.isArray(candidate.files)
  ) {
    throw artifactError(
      'listing-malformed',
      `${LISTING_FILE} is not a version 1 hash listing ({ listingVersion, id, version, files }).`,
    );
  }
  for (const file of candidate.files) {
    if (
      typeof file?.path !== 'string' ||
      typeof file?.sha256 !== 'string' ||
      typeof file?.size !== 'number'
    ) {
      throw artifactError(
        'listing-malformed',
        `${LISTING_FILE} has an entry that is not { path, sha256, size }.`,
      );
    }
  }
  return candidate as SignedListing;
}

/**
 * Exact set equality between the unpacked tree and the listing, plus a content
 * hash per file. Reports the first divergence by name — "which file" is the
 * whole reason the format carries a per-file listing rather than one digest.
 */
export async function checkListing(
  listing: SignedListing,
  files: Map<string, Uint8Array>,
): Promise<void> {
  const listed = new Map(listing.files.map((file) => [file.path, file]));

  for (const path of files.keys()) {
    if (path === LISTING_FILE) continue;
    if (!listed.has(path)) {
      throw artifactError(
        'unexpected-file',
        `The artifact contains a file that was not signed (${path}).`,
        { path },
      );
    }
  }

  for (const file of listing.files) {
    const data = files.get(file.path);
    if (data === undefined) {
      throw artifactError(
        'missing-file',
        `The artifact is missing a file it was signed with (${file.path}).`,
        { path: file.path },
      );
    }
    if (data.length !== file.size) {
      throw artifactError(
        'file-digest-mismatch',
        `A file inside the artifact does not match what was signed (${file.path}).`,
        { path: file.path, expectedSize: String(file.size), actualSize: String(data.length) },
      );
    }
    const actual = await sha256Hex(data);
    if (!digestsEqual(actual, file.sha256)) {
      throw artifactError(
        'file-digest-mismatch',
        `A file inside the artifact does not match what was signed (${file.path}).`,
        { path: file.path, expected: file.sha256, actual },
      );
    }
  }
}
