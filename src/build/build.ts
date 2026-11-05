// The build: a Connector's source becomes the published manifest and one
// bundle per Action. Writing the envelope and signing it are the caller's.
//
// Moved from atrium's backend/scripts/publish-connector.ts (`buildConnector`,
// `publishedAction`, `installFrozen`). The order is the design, and each step
// is here because leaving it out moves a failure somewhere worse:
//
//   1. Optionally `bun install --frozen-lockfile`: an unpinned install would
//      make the bundle depend on *when* it was built. Then read the Bundle
//      Contract version off the SDK just installed, and let the caller refuse
//      it (atrium's release refuses one other than its own `current`).
//   2. One Bun.build per Action, emitting the Bundle Contract's one export,
//      `__atriumRun(ctx, input)`, with parse-then-handle baked in. Nothing
//      else: the install-time harness shape is atrium's, unversioned, and
//      must never be frozen into a published file (ADR-0007 §7).
//   3. GENERATE the published manifest, never copy the source one. That is
//      what makes ADR-0007 §6's "the manifest and the hash listing agree by
//      construction" true rather than an invariant an author can violate. The
//      one part carried across is the `connection` block, validated before
//      anything is built (readConnectorSource), then copied unchanged.

import { PUBLISHED_MANIFEST_VERSION, utf8 } from '../artifact';
import type { PublishedManifest, PublishedManifestAction } from '../artifact';
import { buildActionBundle } from './bundle';
import { readBundleContractVersion } from './contract';
import { BuildRefusal } from './rules';
import { readConnectorSource } from './source';
import type { ConnectorSource, SourceManifestAction } from './source';

export interface BuildConnectorOptions {
  /** The source, if the caller has read it already (`readConnectorSource`). Read here otherwise. */
  source?: ConnectorSource;
  /** The generated manifest's version. The source manifest's when absent. */
  version?: string;
  /** Run `bun install --frozen-lockfile` in the package first. Off by default. */
  install?: boolean;
  /**
   * Called with the Bundle Contract version read off the Connector's SDK, after
   * the install and before anything is bundled; throw to refuse it. atrium's
   * release refuses a version other than the one it speaks.
   */
  assertContract?: (connectorApiVersion: number, connector: string) => void;
  log?: (line: string) => void;
}

export interface BuiltConnector {
  manifest: PublishedManifest;
  /** Payload-relative path to bytes: one `actions/<name>.js` per Action. */
  files: Map<string, Uint8Array>;
}

/**
 * Steps 1–3 above: the published manifest, carrying `version`, and the
 * bundles. Throws a `BuildRefusal` naming the rule on any refusal.
 */
export async function buildConnector(
  packageDir: string,
  options: BuildConnectorOptions = {},
): Promise<BuiltConnector> {
  const log = options.log ?? (() => {});
  const { manifest: source, connection } = options.source ?? readConnectorSource(packageDir);

  if (options.install) {
    log(`Installing ${source.id}'s dependencies…`);
    installFrozen(packageDir);
  }

  // After the install, which is what puts the SDK where it resolves, and
  // before the bundler: a Connector on the wrong SDK is refused without a
  // byte built.
  const connectorApiVersion = await readBundleContractVersion(packageDir);
  options.assertContract?.(connectorApiVersion, `${source.id}@${source.version}`);

  log(`Bundling ${source.actions.length} action(s)…`);
  const files = new Map<string, Uint8Array>();
  const actions: PublishedManifestAction[] = [];
  for (const action of source.actions) {
    const bundle = await buildActionBundle({
      sourcePath: packageDir,
      entry: source.entry,
      actionName: action.name,
    });
    // The bundle path is taken from the file just written, not declared
    // alongside it: that is what stops the manifest describing something
    // other than what is in the payload.
    const bundlePath = `actions/${action.name}.js`;
    files.set(bundlePath, utf8(bundle));
    actions.push(publishedAction(action, bundlePath));
  }

  const manifest: PublishedManifest = {
    manifestVersion: PUBLISHED_MANIFEST_VERSION,
    id: source.id,
    displayName: source.displayName,
    version: options.version ?? source.version,
    connectorApiVersion,
    actions,
    publishedWith: { bun: Bun.version },
    connection,
  };
  return { manifest, files };
}

/**
 * The source action, carried through unchanged except for the bundle path, a
 * trimmed `group`, and `write`, which is carried only when it is `true`.
 */
function publishedAction(action: SourceManifestAction, bundlePath: string): PublishedManifestAction {
  return {
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,
    bundle: bundlePath,
    ...(action.httpMethods ? { httpMethods: action.httpMethods } : {}),
    ...(action.write === true ? { write: true } : {}),
    ...(typeof action.group === 'string' ? { group: action.group.trim() } : {}),
  };
}

/**
 * Frozen, not a plain install: an unpinned install makes the bundle depend on
 * *when* it was built, the same class of defect as a non-reproducible tarball.
 */
function installFrozen(packageDir: string): void {
  const result = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: packageDir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new BuildRefusal(
      'sdk-installed',
      `\`bun install --frozen-lockfile\` failed in ${packageDir}. The lockfile is probably ` +
        `stale; run \`bun install\` there and commit it.\n${new TextDecoder().decode(result.stderr)}`,
    );
  }
}
