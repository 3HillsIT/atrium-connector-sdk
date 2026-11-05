// The Bundle Contract version a build stamps, and which atrium Release first
// accepts it.

import { pathToFileURL } from 'url';
import { BuildRefusal } from './rules';

/**
 * The names a Connector resolves this SDK by, newest first. `@atrium/connector-sdk`
 * is the name before 1.0.0-beta.1; a Connector repo not yet moved to the new
 * name still builds.
 */
export const SDK_PACKAGE_NAMES = ['@3hillsit/atrium-connector-sdk', '@atrium/connector-sdk'] as const;

/**
 * The Bundle Contract version, read off the SDK that the Connector package
 * resolves, so it is a measurement of what was bundled rather than a claim.
 *
 * Deliberately no fallback to this SDK's own `CURRENT_CONNECTOR_API_VERSION`.
 * That would stamp a number describing an SDK the Artifact doesn't contain,
 * and it would look every bit as authoritative as a real measurement.
 */
export async function readBundleContractVersion(packageDir: string): Promise<number> {
  let resolved: string | undefined;
  for (const name of SDK_PACKAGE_NAMES) {
    try {
      resolved = Bun.resolveSync(name, packageDir);
      break;
    } catch {}
  }
  if (!resolved) {
    throw new BuildRefusal(
      'sdk-installed',
      `${packageDir} does not resolve ${SDK_PACKAGE_NAMES[0]}, so there is no bundled SDK to read ` +
        'a Bundle Contract version from. Run `bun install` in the package directory.',
    );
  }
  const sdk = (await import(pathToFileURL(resolved).href)) as {
    CURRENT_CONNECTOR_API_VERSION?: unknown;
  };
  const version = sdk.CURRENT_CONNECTOR_API_VERSION;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new BuildRefusal(
      'sdk-installed',
      `The SDK at ${resolved} does not export a whole-number CURRENT_CONNECTOR_API_VERSION, so ` +
        'there is no Bundle Contract version to stamp.',
    );
  }
  return version;
}

/**
 * Which atrium Releases accept each Bundle Contract version, in the words
 * `check` and `build` print after "accepted by". A version an atrium Release
 * starts accepting gets its row here in the SDK release that speaks it.
 *
 * Only the Bundle Contract version decides what an Instance accepts, never the
 * SDK's own version.
 */
export const BUNDLE_CONTRACT_RELEASES: Readonly<Record<number, string>> = {
  1: 'every atrium Release',
};

/** The line `check` and `build` print about the Bundle Contract version a build stamps. */
export function bundleContractLine(version: number): string {
  const accepted = BUNDLE_CONTRACT_RELEASES[version];
  if (accepted === undefined) {
    return (
      `Bundle Contract v${version}: this SDK's table does not know which atrium Release accepts it. ` +
      'Update the SDK the command runs from.'
    );
  }
  return `Bundle Contract v${version}: accepted by ${accepted}.`;
}
