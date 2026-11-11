// The rules the `atrium-connector` commands hold a Connector, a key file and
// an Artifact to, each with the page of the developer guide that explains it.
//
// A failure always names its rule, and the rule names its page, so a developer
// (or their coding agent) reads the page that fixes it rather than guessing.
// The pages ship in the package under docs/, so the one named matches the SDK
// that is installed; test/docs.test.ts checks every page named here exists
// and mentions the rule.

/** The developer guide's pages, as file names under the package's docs/ without `.md`. */
export const GUIDE_PAGES = [
  'tutorial',
  'concepts',
  'manifest',
  'actions',
  'rules',
  'testing',
  'build-and-sign',
  'versions',
  'troubleshooting',
  'guided-build',
] as const;

export type GuidePage = (typeof GUIDE_PAGES)[number];

/** Every rule a command can fail, and the guide page that explains it. */
export const RULES = {
  /** The folder holds a package.json and a manifest.json. */
  'connector-package': { page: 'build-and-sign' },
  /** manifest.json is a Connector's own manifest, readable and complete. */
  manifest: { page: 'manifest' },
  /** The `connection` block is one Add accepts. */
  connection: { page: 'manifest' },
  /** An Action's `group` is a usable heading. */
  'action-group': { page: 'manifest' },
  /** The version is a plain MAJOR.MINOR.PATCH, the same in manifest.json and package.json. */
  versions: { page: 'versions' },
  /** Every Action manifest.json declares is exported from the entry module, under a usable name. */
  'exports-and-names': { page: 'rules' },
  /** manifest.json and the code describe the same Actions. */
  parity: { page: 'rules' },
  /** An Action that may change something says so with `write`. */
  'write-flag': { page: 'rules' },
  /** The entry module and each bundle load without throwing. */
  'loads-cleanly': { page: 'rules' },
  /** The SDK is installed where the Connector resolves it. */
  'sdk-installed': { page: 'build-and-sign' },
  /** The bundler can build each Action. */
  bundles: { page: 'troubleshooting' },
  /** Each bundle exports a callable `__atriumRun` that survives atrium's splice. */
  'bundle-contract': { page: 'troubleshooting' },
  /** The Artifact passes the format's own reader: listing, manifest, file name. */
  format: { page: 'troubleshooting' },
  /** atrium-builds.json is a build record this SDK can read. */
  'build-record': { page: 'build-and-sign' },
  /** `sign`: the key file is a P-256 key whose key id and private half are its public half's. */
  'key-file': { page: 'build-and-sign' },
  /** `sign`: the Artifact is there and is one that can be signed. */
  'signable-artifact': { page: 'troubleshooting' },
  /** `keygen`: the key's name is one the Console takes, and the key file is a new file. */
  'new-key': { page: 'build-and-sign' },
  /** `init`: the folder it writes the new repo into is empty. */
  'new-repo': { page: 'build-and-sign' },
} as const satisfies Record<string, { page: GuidePage }>;

export type RuleName = keyof typeof RULES;

/** Where an installed SDK keeps its guide, from the root of a Connector repo. */
export const GUIDE_DIRECTORY = 'node_modules/@3hillsit/atrium-connector-sdk/docs';

/** Where the guide page lives in a Connector repo with the SDK installed. */
export function guidePagePath(page: GuidePage): string {
  return `${GUIDE_DIRECTORY}/${page}.md`;
}

/**
 * A refusal from the build or the check, naming the rule it broke. It is an
 * `Error` whose message reads on its own, so a caller that doesn't care about
 * rules (atrium's publish) can treat it as one.
 */
export class BuildRefusal extends Error {
  readonly rule: RuleName;

  constructor(rule: RuleName, message: string) {
    super(message);
    this.name = 'BuildRefusal';
    this.rule = rule;
  }
}

/** One failed rule, as `check` reports it. */
export interface CheckFailure {
  rule: RuleName;
  message: string;
}

/** A thrown refusal as a failure; anything else falls under `fallback`. */
export function failureOf(err: unknown, fallback: RuleName): CheckFailure {
  if (err instanceof BuildRefusal) return { rule: err.rule, message: err.message };
  return { rule: fallback, message: err instanceof Error ? err.message : String(err) };
}
