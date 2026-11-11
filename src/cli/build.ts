// `atrium-connector build [--try]`: everything `check` does, then the
// unsigned Artifact into dist/ and its entry into atrium-builds.json.
//
// A plain build builds the version manifest.json declares. `--try` builds the
// next try of it, X.Y.Z-try.N+1, counted from the build record; manifest.json
// is never edited. A version already in the record with other bytes is built
// anyway, with a warning naming both digests: the developer may be rebuilding
// for a test Instance that never saw the first, and an Instance that did
// refuses the second set of bytes itself (atrium's ADR-0007 §8).

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  BUILD_RECORD_FILE,
  bundleContractLine,
  checkConnector,
  failureOf,
  nextTryVersion,
  readBuildRecord,
  readConnectorSource,
  recordBuild,
  writeBuildRecord,
} from '../build';
import type { BuildRecord, ConnectorSource } from '../build';
import { parseCommandArgs, refusedFailures, ui } from './io';
import type { Command } from './io';

/** Where `build` writes the Artifact, relative to the Connector repo. */
export const OUTPUT_DIRECTORY = 'dist';

export const build: Command = {
  usage: 'build [--try]',
  summary:
    "Writes the unsigned Artifact to dist/ and records it in atrium-builds.json. --try builds the manifest's version as its next -try.N.",
  async run(args, io) {
    const parsed = parseCommandArgs(build, args, { try: { type: 'boolean' } }, io);
    if (!parsed) return 2;
    const tryVersion = parsed.values.try === true;
    const out = ui(io);
    out.step(tryVersion ? 'Building the next try version of the Connector' : 'Building the Connector');

    // The source once, for the version to build; checkConnector takes it as
    // read, and refuses a version that isn't a plain X.Y.Z.
    let source: ConnectorSource;
    let record: BuildRecord;
    try {
      source = readConnectorSource(io.cwd);
      record = readBuildRecord(io.cwd);
    } catch (err) {
      return refusedFailures('build', [failureOf(err, 'manifest')], io);
    }
    const plainVersion = source.manifest.version;
    const version = tryVersion ? nextTryVersion(record, plainVersion) : plainVersion;

    const builtAt = io.now().toISOString();
    const report = await checkConnector(io.cwd, { source, version, publishedAt: builtAt });
    if (report.connectorApiVersion !== undefined) out.text(bundleContractLine(report.connectorApiVersion));
    if (report.failures.length > 0) return refusedFailures('build', report.failures, io);
    const unsigned = report.unsigned!;
    const { id } = report.built!.manifest;

    const { record: updated, previous } = recordBuild(record, {
      version,
      payloadSha256: unsigned.payloadSha256,
      builtAt,
    });
    if (previous && previous.payloadSha256 !== unsigned.payloadSha256) {
      out.stderr.warning(
        `${BUILD_RECORD_FILE} has ${id} ${version} built on ${previous.builtAt} with payload ` +
          `${previous.payloadSha256}; this build's payload is ${unsigned.payloadSha256}. ` +
          `An Instance that already has ${version} refuses these bytes under the same version: ` +
          'use build --try, or bump the version, for one that does.',
      );
    }

    const outDir = join(io.cwd, OUTPUT_DIRECTORY);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, unsigned.fileName), unsigned.bytes);
    if (updated !== record) writeBuildRecord(io.cwd, updated);

    const file = `${OUTPUT_DIRECTORY}/${unsigned.fileName}`;
    out.success(`Built ${id} ${version}, unsigned: ${file}`);
    out.labels([
      ['Payload', unsigned.payloadSha256],
      ['Recorded', BUILD_RECORD_FILE],
    ]);
    out.text();
    out.text('An Instance Adds it once it is signed. Sign it with your Customer Key:');
    out.command(`bunx atrium-connector sign --key <key file> ${file}`);
    return 0;
  },
};
