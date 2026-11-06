import { describe, test, expect } from 'bun:test';
import { buildListing, checkListing, parseListing, serializeListing } from '../../src/artifact/listing';
import { ConnectorArtifactError } from '../../src/artifact/errors';
import { utf8 } from '../../src/artifact/digest';
import { LISTING_FILE } from '../../src/artifact/types';

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the listing check to fail, but it passed');
}

const tree = () =>
  new Map<string, Uint8Array>([
    ['manifest.json', utf8('{"id":"x"}')],
    ['actions/b.js', utf8('export const b = 2;')],
    ['actions/a.js', utf8('export const a = 1;')],
  ]);

async function listingFor(files: Map<string, Uint8Array>) {
  return buildListing({ id: 'x', version: '1.0.0', files });
}

describe('buildListing', () => {
  test('covers every file except itself — it cannot contain its own hash', async () => {
    const files = tree();
    files.set(LISTING_FILE, utf8('placeholder'));
    const listing = await listingFor(files);
    expect(listing.files.map((file) => file.path)).not.toContain(LISTING_FILE);
    expect(listing.files.length).toBe(3);
  });

  test('is sorted by path, so the document does not depend on insertion order', async () => {
    const listing = await listingFor(tree());
    expect(listing.files.map((file) => file.path)).toEqual([
      'actions/a.js',
      'actions/b.js',
      'manifest.json',
    ]);
  });

  test('records size alongside the hash', async () => {
    const listing = await listingFor(tree());
    const entry = listing.files.find((file) => file.path === 'actions/a.js')!;
    expect(entry.size).toBe('export const a = 1;'.length);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('serializes and parses back to the same document', async () => {
    const listing = await listingFor(tree());
    expect(parseListing(serializeListing(listing))).toEqual(listing);
  });
});

describe('checkListing — exact set equality', () => {
  test('passes on the tree it was built from', async () => {
    const files = tree();
    await checkListing(await listingFor(files), files);
  });

  test('an added file fails as unexpected-file, naming the path', async () => {
    const files = tree();
    const listing = await listingFor(files);
    files.set('actions/injected.js', utf8('// injected'));

    const error = await refusalOf(checkListing(listing, files));
    expect(error.code).toBe('unexpected-file');
    expect(error.details.path).toBe('actions/injected.js');
  });

  test('a removed file fails as missing-file, naming the path', async () => {
    const files = tree();
    const listing = await listingFor(files);
    files.delete('actions/a.js');

    const error = await refusalOf(checkListing(listing, files));
    expect(error.code).toBe('missing-file');
    expect(error.details.path).toBe('actions/a.js');
  });

  test('a modified file fails as file-digest-mismatch, naming the path and both digests', async () => {
    const files = tree();
    const listing = await listingFor(files);
    files.set('actions/a.js', utf8('export const a = 9;')); // same length, different content

    const error = await refusalOf(checkListing(listing, files));
    expect(error.code).toBe('file-digest-mismatch');
    expect(error.details.path).toBe('actions/a.js');
    expect(error.details.actual).not.toBe(error.details.expected);
  });

  test('a truncated file fails on size before its hash is computed', async () => {
    const files = tree();
    const listing = await listingFor(files);
    files.set('actions/a.js', utf8('export'));

    const error = await refusalOf(checkListing(listing, files));
    expect(error.code).toBe('file-digest-mismatch');
    expect(error.details.expectedSize).toBe(String('export const a = 1;'.length));
  });

  test('the listing file itself is exempt from the set comparison', async () => {
    const files = tree();
    const listing = await listingFor(files);
    files.set(LISTING_FILE, serializeListing(listing));
    await checkListing(listing, files);
  });
});

describe('parseListing', () => {
  test('refuses non-JSON', async () => {
    const error = await refusalOf(Promise.resolve().then(() => parseListing(utf8('not json'))));
    expect(error.code).toBe('listing-malformed');
  });

  test('refuses a document that is not listingVersion 1', async () => {
    const error = await refusalOf(
      Promise.resolve().then(() =>
        parseListing(utf8(JSON.stringify({ listingVersion: 2, id: 'x', version: '1', files: [] }))),
      ),
    );
    expect(error.code).toBe('listing-malformed');
  });

  test('refuses an entry that is not { path, sha256, size }', async () => {
    const error = await refusalOf(
      Promise.resolve().then(() =>
        parseListing(
          utf8(
            JSON.stringify({
              listingVersion: 1,
              id: 'x',
              version: '1',
              files: [{ path: 'a.js', sha256: 'abc' }],
            }),
          ),
        ),
      ),
    );
    expect(error.code).toBe('listing-malformed');
  });
});
