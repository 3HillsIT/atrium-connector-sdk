// `@3hillsit/atrium-connector-sdk/build`: a Connector's source becomes an
// Artifact's payload.
//
// It bundles each Action (the `__atriumRun` wrapper from `./artifact`),
// generates the published manifest with the Bundle Contract version read off
// the SDK the Connector resolves, and runs the self-checks `check` and `build`
// report: the authoring rules and the format half, which needs no signature.
//
// Two callers: the `atrium-connector` command (`check`, `build`), and atrium's
// own release, which calls `buildConnector`, signs with its own keys and opens
// the result with its own Instance code.
//
// It may import `./artifact`; `./artifact` never imports it
// (subpath-isolation.test.ts holds that).

// ── Reading the source ──────────────────────────────────────────────────────

export {
  readConnectorSource,
  assertPlainVersion,
  ACTION_NAME_PATTERN,
  ACTION_GROUP_MAX_LENGTH,
  PLAIN_VERSION_PATTERN,
  RESERVED_CONNECTOR_IDS,
} from './source';
export type { ConnectorSource, SourceManifest, SourceManifestAction } from './source';

// ── Building ────────────────────────────────────────────────────────────────

export { buildConnector } from './build';
export type { BuildConnectorOptions, BuiltConnector } from './build';
export { buildActionBundle } from './bundle';
export type { BuildActionBundleParams } from './bundle';

// ── The Bundle Contract version ─────────────────────────────────────────────

export {
  readBundleContractVersion,
  bundleContractLine,
  BUNDLE_CONTRACT_RELEASES,
  SDK_PACKAGE_NAMES,
} from './contract';

// ── Checking ────────────────────────────────────────────────────────────────

export { checkConnector } from './check';
export type { CheckConnectorOptions, CheckReport } from './check';
export { checkFormat } from './self-check';
export type { FormatCheck } from './self-check';
export { checkAuthoringRules, exportedActions, loadEntryModule } from './authoring';
export type { ExportedAction } from './authoring';
export { BuildRefusal, GUIDE_DIRECTORY, GUIDE_PAGES, RULES, failureOf, guidePagePath } from './rules';
export type { CheckFailure, GuidePage, RuleName } from './rules';

// ── The build record ────────────────────────────────────────────────────────

export {
  BUILD_RECORD_FILE,
  nextTryVersion,
  readBuildRecord,
  recordBuild,
  writeBuildRecord,
} from './record';
export type { BuildRecord, BuildRecordEntry } from './record';
