// Reading a Connector's source: the folder, its own manifest.json, and the
// refusals that need nothing installed or built.
//
// Moved from atrium's backend/scripts/publish-connector.ts (`readSource`,
// `assertConnectorPackage`, `assertPublishableConnector`, `assertUsableGroup`)
// and the source-manifest half of its services/connector-install.ts
// (`readConnectorManifest`). The messages are atrium's, with "publish" read as
// "the build", so a developer meets the same refusal whichever side builds.

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  CONNECTOR_ID_PATTERN,
  MANIFEST_FILE,
  ConnectorArtifactError,
  parseRequiredConnection,
} from '../artifact';
import type { ConnectorConnection } from '../artifact';
import { BuildRefusal } from './rules';

/** One Action as a Connector's own manifest.json declares it. */
export interface SourceManifestAction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The HTTP methods the handler sends. Documentation, and what the write-flag rule reads. */
  httpMethods?: string[];
  /**
   * `true` puts a Tool made from the Action behind atrium's write approval.
   * Absent means read. `false` says, in so many words, that an Action sending
   * more than GET only reads (a search sent as POST); the published manifest
   * carries only `true`.
   */
  write?: boolean;
  /** The heading Install Connector groups the Action under, at most 40 characters. */
  group?: string;
}

/**
 * A Connector repo's own manifest.json: TypeScript source plus a top-level
 * `entry` pointing at it. The build generates the published manifest from it
 * and never copies it.
 */
export interface SourceManifest {
  id: string;
  displayName: string;
  version: string;
  /** The entry module, relative to the repo, e.g. `src/index.ts`. */
  entry: string;
  actions: SourceManifestAction[];
  /** The author's connection settings, carried into the published manifest once validated. */
  connection?: unknown;
}

/** The Connector's own manifest, checked, and its validated `connection` block. */
export interface ConnectorSource {
  manifest: SourceManifest;
  connection: ConnectorConnection;
}

/**
 * The catalogue artifact atrium's Registry lists lives at the repository's
 * `index` location, so a Connector called `index` would publish on top of it.
 */
export const RESERVED_CONNECTOR_IDS = new Set(['index']);

/**
 * An Action name has to survive as `actions/<name>.js` inside a signed
 * payload. Deliberately narrower than what a manifest could contain: no dots,
 * no separators, nothing that re-reads as a traversal.
 */
export const ACTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** An Action's `group` is a short heading in Install Connector, so the build keeps it short. */
export const ACTION_GROUP_MAX_LENGTH = 40;

/** A version a Connector declares: MAJOR.MINOR.PATCH and nothing more. */
export const PLAIN_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Every refusal that needs nothing installed or built: the folder, the
 * manifest, the version agreement with package.json, the Action names and
 * groups, and the `connection` block, validated with Add's own validator so a
 * block Add would refuse is refused here, naming the field.
 *
 * It doesn't require a plain version: atrium's modes and `build` decide what
 * they build from the version declared, and say so themselves
 * (`assertPlainVersion`).
 */
export function readConnectorSource(packageDir: string): ConnectorSource {
  assertConnectorPackage(packageDir);
  const manifest = readSourceManifest(packageDir);
  assertBuildableConnector(manifest, packageDir);
  let connection: ConnectorConnection;
  try {
    connection = parseRequiredConnection(manifest.connection, join(packageDir, MANIFEST_FILE));
  } catch (err) {
    if (err instanceof ConnectorArtifactError) throw new BuildRefusal('connection', err.message);
    throw err;
  }
  return { manifest, connection };
}

/**
 * Refuses a version manifest.json declares unless it is a plain
 * MAJOR.MINOR.PATCH: the build adds any pre-release suffix itself (`-try.N`
 * here, atrium's `-rc.N`), and one written by hand would be counted from.
 */
export function assertPlainVersion(manifest: Pick<SourceManifest, 'id' | 'version'>): void {
  if (PLAIN_VERSION_PATTERN.test(manifest.version)) return;
  throw new BuildRefusal(
    'versions',
    `${manifest.id}'s manifest.json declares version ${manifest.version}, but a Connector's version ` +
      'is a plain MAJOR.MINOR.PATCH. The pre-release suffix is added by the build and never written by hand.',
  );
}

/**
 * The first refusal, before the manifest is parsed: a wrong path fails naming
 * the path and what is missing, rather than as an ENOENT.
 */
function assertConnectorPackage(packageDir: string): void {
  const remedy =
    'Point the build at a Connector repo: the folder holding its package.json and manifest.json.';
  if (!existsSync(packageDir) || !statSync(packageDir).isDirectory()) {
    throw new BuildRefusal(
      'connector-package',
      `${packageDir} is not a Connector package: there is no folder there. ${remedy}`,
    );
  }
  const missing = ['package.json', MANIFEST_FILE].filter((file) => !existsSync(join(packageDir, file)));
  if (missing.length > 0) {
    throw new BuildRefusal(
      'connector-package',
      `${packageDir} is not a Connector package: it has no ${missing.join(' and no ')}. ${remedy}`,
    );
  }
}

function readSourceManifest(packageDir: string): SourceManifest {
  const path = join(packageDir, MANIFEST_FILE);
  let parsed: Partial<SourceManifest> & { manifestVersion?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new BuildRefusal(
      'manifest',
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BuildRefusal('manifest', `${path} is not a JSON object.`);
  }
  if (parsed.manifestVersion !== undefined) {
    // A published manifest names bundles, not an entry module, so there is
    // nothing to build from: an unpacked Artifact, not a Connector's source.
    throw new BuildRefusal(
      'manifest',
      `${path} is a published manifest (manifestVersion ${String(parsed.manifestVersion)}), not a ` +
        "Connector's own, so there is no entry module to build. Point the build at a Connector repo.",
    );
  }
  const missing = (['id', 'displayName', 'version', 'entry'] as const).filter(
    (field) => typeof parsed[field] !== 'string' || parsed[field] === '',
  );
  if (missing.length > 0) {
    throw new BuildRefusal('manifest', `${path} declares no ${missing.join(', no ')}.`);
  }
  if (!Array.isArray(parsed.actions)) {
    throw new BuildRefusal('manifest', `${path} declares no actions array.`);
  }
  for (const action of parsed.actions as unknown[]) {
    if (action === null || typeof action !== 'object' || typeof (action as { name?: unknown }).name !== 'string') {
      throw new BuildRefusal('manifest', `${path} has an action without a name.`);
    }
  }
  return parsed as SourceManifest;
}

/**
 * Everything refused before a single byte is built. Each of these produces an
 * Artifact that either can't be Added or collides with something, so the
 * cheapest place to find out is before the bundler runs.
 *
 * The folder's name is deliberately not checked against the id: a repo
 * checkout is named after the repo, and the manifest's id is the one the
 * Artifact carries.
 */
function assertBuildableConnector(source: SourceManifest, packageDir: string): void {
  if (RESERVED_CONNECTOR_IDS.has(source.id)) {
    throw new BuildRefusal(
      'manifest',
      `"${source.id}" cannot be used as a Connector id: it collides with the catalogue ` +
        "artifact's location in the registry. Rename the connector.",
    );
  }
  if (!CONNECTOR_ID_PATTERN.test(source.id)) {
    throw new BuildRefusal(
      'manifest',
      `"${source.id}" cannot be used as a Connector id: ids must match ${CONNECTOR_ID_PATTERN}.`,
    );
  }

  // The semver an Instance holds and its Tools run comes from package.json,
  // while the manifest is what an Instance reads. A disagreement means one of
  // the two silently wins, so neither does.
  let packageVersion: unknown;
  try {
    packageVersion = (JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8')) as {
      version?: unknown;
    }).version;
  } catch (err) {
    throw new BuildRefusal(
      'connector-package',
      `${join(packageDir, 'package.json')} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (packageVersion !== source.version) {
    throw new BuildRefusal(
      'versions',
      `${source.id}'s manifest.json declares version ${source.version} but its package.json ` +
        `declares ${String(packageVersion)}. Bump both together.`,
    );
  }

  const seen = new Set<string>();
  for (const action of source.actions) {
    if (!ACTION_NAME_PATTERN.test(action.name)) {
      throw new BuildRefusal(
        'exports-and-names',
        `${source.id} declares an action named "${action.name}", which cannot be published as ` +
          `actions/<name>.js. Action names must match ${ACTION_NAME_PATTERN}.`,
      );
    }
    if (seen.has(action.name)) {
      throw new BuildRefusal(
        'exports-and-names',
        `${source.id}'s manifest declares the action "${action.name}" twice; each action is one ` +
          'bundle, so a duplicate has no meaning.',
      );
    }
    seen.add(action.name);
    assertUsableGroup(source.id, action);
  }
  if (seen.size === 0) {
    throw new BuildRefusal(
      'manifest',
      `${source.id}'s manifest declares no actions, so there is nothing to build.`,
    );
  }
}

/**
 * An Action's optional `group` heads its group in Install Connector. A key
 * that is there must say something: an empty, blank or non-string one is a
 * mistake in the manifest, not "no group", so it is refused with the Action's
 * name rather than dropped.
 */
function assertUsableGroup(connectorId: string, action: SourceManifestAction): void {
  const group: unknown = action.group;
  if (group === undefined) return;
  const where = `${connectorId}'s action "${action.name}" declares a group`;
  if (typeof group !== 'string') {
    throw new BuildRefusal(
      'action-group',
      `${where} that is not a string (${JSON.stringify(group)}). Give it a name, or leave group out.`,
    );
  }
  const trimmed = group.trim();
  if (trimmed === '') {
    throw new BuildRefusal('action-group', `${where} that is empty. Give it a name, or leave group out.`);
  }
  if (trimmed.length > ACTION_GROUP_MAX_LENGTH) {
    throw new BuildRefusal(
      'action-group',
      `${where} of ${trimmed.length} characters ("${trimmed}"); a group is at most ` +
        `${ACTION_GROUP_MAX_LENGTH}. Shorten it.`,
    );
  }
}
