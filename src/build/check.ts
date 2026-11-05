// `check`, as a function: the build and every self-check, collected into one
// report instead of stopping at the first refusal where the next steps can
// still run. Signs nothing and writes nothing into the Connector repo; `build`
// writes what it returns.

import type { WrittenEnvelope } from '../artifact';
import { checkAuthoringRules, loadEntryModule } from './authoring';
import { buildConnector } from './build';
import type { BuiltConnector } from './build';
import { readBundleContractVersion } from './contract';
import { failureOf } from './rules';
import type { CheckFailure } from './rules';
import { checkFormat } from './self-check';
import { assertPlainVersion, readConnectorSource } from './source';
import type { ConnectorSource } from './source';

export interface CheckConnectorOptions {
  /** The source, if the caller has read it already. */
  source?: ConnectorSource;
  /** The version to build: the manifest's when absent, a try version for `build --try`. */
  version?: string;
  /** Stamped into the signed blob; never part of the payload. Now when absent. */
  publishedAt?: string;
}

export interface CheckReport {
  /** Every failed rule, in the order found. Empty when the Connector passed. */
  failures: CheckFailure[];
  /** The source manifest and connection block, once they read cleanly. */
  source?: ConnectorSource;
  /** The Bundle Contract version the build stamps, once the SDK resolved. */
  connectorApiVersion?: number;
  /** The published manifest and bundles, once the build ran. */
  built?: BuiltConnector;
  /** The unsigned Artifact, once the build ran. Only safe to write when `failures` is empty. */
  unsigned?: WrittenEnvelope;
}

/**
 * Reads the source, checks its version is a plain X.Y.Z, reads the Bundle
 * Contract version, loads the entry module and checks the authoring rules
 * (exports, parity, the write flag), builds, and runs the format self-check
 * on the unsigned Artifact. A failure that leaves nothing for the next step
 * to look at ends the report there; the rest are all collected.
 */
export async function checkConnector(
  packageDir: string,
  options: CheckConnectorOptions = {},
): Promise<CheckReport> {
  const report: CheckReport = { failures: [] };
  try {
    report.source = options.source ?? readConnectorSource(packageDir);
    assertPlainVersion(report.source.manifest);
    report.connectorApiVersion = await readBundleContractVersion(packageDir);
  } catch (err) {
    report.failures.push(failureOf(err, 'manifest'));
    return report;
  }
  const { manifest } = report.source;

  try {
    const exports = await loadEntryModule(packageDir, manifest.entry);
    report.failures.push(...checkAuthoringRules(manifest, exports));
  } catch (err) {
    report.failures.push(failureOf(err, 'loads-cleanly'));
    return report;
  }
  // An Action missing from the exports can't be bundled; the failure above
  // already says so, and the bundler's would only repeat it.
  if (report.failures.some((failure) => failure.rule === 'exports-and-names')) return report;

  try {
    report.built = await buildConnector(packageDir, {
      source: report.source,
      version: options.version ?? manifest.version,
    });
  } catch (err) {
    report.failures.push(failureOf(err, 'bundles'));
    return report;
  }

  const format = await checkFormat(report.built, {
    publishedAt: options.publishedAt ?? new Date().toISOString(),
  });
  report.unsigned = format.unsigned;
  report.failures.push(...format.failures);
  return report;
}
