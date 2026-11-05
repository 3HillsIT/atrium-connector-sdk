// The build record: atrium-builds.json, committed in the Connector repo, one
// entry per version built.
//
// It is the only counter `build --try` has: the Drop Folder of the test
// Instance a try goes to isn't readable from a developer's machine. And it is
// how `build` notices a version built again with other bytes, which an
// Instance that already has the first refuses (atrium's ADR-0007 §8).

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BuildRefusal } from './rules';

export const BUILD_RECORD_FILE = 'atrium-builds.json';

export interface BuildRecordEntry {
  version: string;
  payloadSha256: string;
  /** ISO 8601: when this version's payload was built. */
  builtAt: string;
}

/** The file's shape. `init` writes `{ "builds": [] }`. */
export interface BuildRecord {
  builds: BuildRecordEntry[];
}

/** The record in `packageDir`; an empty one when the file isn't there yet. */
export function readBuildRecord(packageDir: string): BuildRecord {
  const path = join(packageDir, BUILD_RECORD_FILE);
  if (!existsSync(path)) return { builds: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new BuildRefusal(
      'build-record',
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}. ` +
        'Restore it from git; the build numbers try versions from it.',
    );
  }
  const builds = (parsed as { builds?: unknown } | null)?.builds;
  if (
    !Array.isArray(builds) ||
    !builds.every(
      (entry) =>
        typeof entry?.version === 'string' &&
        typeof entry?.payloadSha256 === 'string' &&
        typeof entry?.builtAt === 'string',
    )
  ) {
    throw new BuildRefusal(
      'build-record',
      `${path} is not a build record: it holds { "builds": [{ "version", "payloadSha256", "builtAt" }] }. ` +
        'Restore it from git; the build numbers try versions from it.',
    );
  }
  return { builds: builds as BuildRecordEntry[] };
}

export function writeBuildRecord(packageDir: string, record: BuildRecord): void {
  writeFileSync(join(packageDir, BUILD_RECORD_FILE), JSON.stringify(record, null, 2) + '\n');
}

/**
 * The next try of `version` (a plain X.Y.Z): `X.Y.Z-try.N+1`, N the highest
 * try of X.Y.Z in the record, or `X.Y.Z-try.1` when there is none.
 */
export function nextTryVersion(record: BuildRecord, version: string): string {
  const prefix = `${version}-try.`;
  let highest = 0;
  for (const { version: built } of record.builds) {
    if (!built.startsWith(prefix)) continue;
    const n = built.slice(prefix.length);
    if (/^[1-9]\d*$/.test(n)) highest = Math.max(highest, Number(n));
  }
  return `${prefix}${highest + 1}`;
}

/**
 * The record with `entry` in it, and the entry it had for that version
 * before. One entry per version, the one built first: a version already in
 * the record leaves the record as it was, whatever its payload. An unchanged
 * rebuild changes no committed file, and every rebuild with other bytes is
 * compared with the first bytes (what an Instance that has the version holds),
 * so each of them warns, not only the first.
 */
export function recordBuild(
  record: BuildRecord,
  entry: BuildRecordEntry,
): { record: BuildRecord; previous?: BuildRecordEntry } {
  const previous = record.builds.find((built) => built.version === entry.version);
  if (previous) return { record, previous };
  return { record: { builds: [...record.builds, entry] } };
}
