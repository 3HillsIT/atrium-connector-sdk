// The signed-fixture builder every later ticket's tests depend on.
//
// It exists so a test can produce a genuinely valid Connector Artifact — real
// tar, real gzip, real ECDSA signature — without a private key being committed
// anywhere. Each fixture ring is generated on the spot and handed back, so the
// tests exercise the real verifier against real keys rather than a bypass.
//
// This is deliberately NOT the committed key ring. Nothing here can sign
// something a production Instance would accept, which is the property that
// lets the dev key sit in the trusted ring with its private half in a password
// manager rather than in this repo.
//
// Shipped in the module rather than in a test directory because atrium's tests
// consume it too, through `./artifact`, and because an untested fixture
// builder would quietly undermine every test built on top of it.

import { readEnvelope, writeEnvelope } from './envelope';
import {
  generateSigningKey,
  importPrivateKey,
  serializeBlob,
  serializeSignatureFile,
  signBlob,
} from './signing';
import { buildListing, serializeListing } from './listing';
import { gunzip, gzip, readSafeEntries, writeTar } from './tar';
import { sha256Hex, utf8 } from './digest';
import {
  CONNECTION_MANIFEST_VERSION,
  LISTING_FILE,
  PAYLOAD_ENTRY,
  SIGNATURE_ENTRY,
  manifestVersionFor,
} from './types';
import type {
  ConnectionAuth,
  ConnectorConnection,
  PublishedManifest,
  PublishedManifestAction,
  RingKey,
} from './types';

/** A generated key pair plus the ring entry that trusts it. */
export interface FixtureKey {
  keyId: string;
  privateKey: CryptoKey;
  ringKey: RingKey;
}

export async function createFixtureKey(comment = 'fixture key'): Promise<FixtureKey> {
  const generated = await generateSigningKey();
  return {
    keyId: generated.keyId,
    privateKey: await importPrivateKey(generated.privateKey),
    ringKey: {
      keyId: generated.keyId,
      alg: 'ecdsa-p256-sha256',
      publicKey: generated.publicKey,
      comment,
    },
  };
}

export interface BuildFixtureParams {
  id?: string;
  version?: string;
  displayName?: string;
  connectorApiVersion?: number;
  /**
   * The manifestVersion to declare. Defaults to what the build writes for
   * these Actions (`manifestVersionFor`): 4 when the fixture has a discovery
   * or template Action, 3 otherwise. 2 builds what was published before the
   * `connection` block existed, 3 with `discovery` builds what an SDK before
   * 1.2.0 never wrote and every reader refuses, and any other number builds
   * an artifact Add must refuse.
   */
  manifestVersion?: number;
  /**
   * A `connection` block to carry — see `fixtureConnection` for a valid one.
   * Typed `unknown` so a test can hand over a deliberately malformed block;
   * nothing here validates it, which is what lets the install side be the one
   * that refuses. Omitted, a manifest version 3 or later carries
   * `fixtureConnection()`, since Add requires the block there, and an older
   * one carries none. `null` carries none whatever the manifest version: an
   * Artifact Add refuses.
   */
  connection?: unknown;
  /**
   * Ordinary Action names; each gets a plausible `__atriumRun` bundle unless
   * overridden. `['list_things']` when absent, or none when the fixture has a
   * `discovery` or `templates`.
   */
  actions?: string[];
  /**
   * A discovery Action (`kind: "discovery"`), for a Connector whose Tools are
   * generated: `{}` gives the default one, named `discover`, answering with
   * `FIXTURE_DISCOVERY_ENTITIES` and `FIXTURE_TOOL_DEFINITIONS`. Its bundle is
   * `fixtureDiscoveryBundle(discovery)`. Listed after `actions`.
   */
  discovery?: FixtureDiscovery;
  /**
   * Template Actions (`kind: "template"`), each a name (a read) or
   * `{ name, write }`. Their bundles echo what they get
   * (`fixtureTemplateBundle`). When absent and `discovery` is given, the two
   * the default Tool definitions name: `FIXTURE_TEMPLATES`. Listed last.
   */
  templates?: Array<string | FixtureTemplate>;
  /** Extra or replacement payload files, keyed by payload-relative path. */
  files?: Map<string, Uint8Array>;
  /** Signed by all of these. More than one produces a dual-signed artifact. */
  signers?: FixtureKey[];
  publishedAt?: string;
  /** Last-word edit of the manifest, for building deliberately wrong artifacts. */
  manifest?: (manifest: PublishedManifest) => PublishedManifest;
}

export interface ArtifactFixture {
  bytes: Uint8Array;
  fileName: string;
  payloadSha256: string;
  manifest: PublishedManifest;
  /** A ring that trusts exactly the keys this fixture was signed with. */
  ring: RingKey[];
}

/**
 * A valid `connection` block, for a fixture Connector that brings its own
 * connection settings. One `instanceUrl` field and a token in a header unless
 * told otherwise; `overrides` replaces whole top-level parts of the request.
 */
export function fixtureConnection(
  overrides: { auth?: ConnectionAuth; apiBasePath?: string; healthCheckPath?: string; fields?: ConnectorConnection['configSchema']['fields'] } = {},
): ConnectorConnection {
  return {
    configSchema: {
      fields: overrides.fields ?? [
        { name: 'instanceUrl', label: 'Instance URL', type: 'string', required: true },
      ],
    },
    request: {
      apiBasePath: overrides.apiBasePath ?? '/api/v1',
      healthCheckPath: overrides.healthCheckPath ?? '/me',
      auth: overrides.auth ?? { type: 'pat', headerName: 'X-Fixture-Token' },
    },
  };
}

/** The shape publish emits: one named export, parse-then-handle baked in. */
export function fixtureBundle(actionName: string): Uint8Array {
  return utf8(
    `// fixture bundle for ${actionName}\n` +
      'export async function __atriumRun(ctx, input) {\n' +
      `  return await ctx.request('GET', '/${actionName}', { query: input });\n` +
      '}\n',
  );
}

// ── A Connector whose Tools are generated (atrium #12326) ──────────────────

/** One entity of a discovery catalog, as the discovery contract answers `{}`. */
export interface FixtureCatalogEntity {
  name: string;
  label: string;
  source: 'standard' | 'custom';
  defaultEnabled: boolean;
  operations: Array<{ name: string; write: boolean }>;
}

/** One Tool definition, as the discovery contract answers `{ selection }`. */
export interface FixtureToolDefinition {
  name: string;
  entity: string;
  operation: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
  template: string;
  binding: Record<string, unknown>;
}

/** A template Action of a fixture: a read unless `write` is true. */
export interface FixtureTemplate {
  name: string;
  write?: boolean;
  /**
   * Send the call on to the system (`POST /<name>` with the echo as body for
   * a write, `GET /<name>` for a read), throw unless it answers 2xx, and add
   * its body to the echo as `response`. Off: the template only echoes.
   */
  request?: boolean;
}

/**
 * A discovery Action of a fixture, and what its bundle answers. Every field
 * has a working default; the ones typed `unknown` take anything, so a test
 * can build an answer atrium has to refuse.
 */
export interface FixtureDiscovery {
  /** The Action's name. `discover` when absent. */
  name?: string;
  /** The catalog's entities, answered as given to `{}`. `FIXTURE_DISCOVERY_ENTITIES` when absent. */
  entities?: ReadonlyArray<unknown>;
  /**
   * Every Tool definition it can generate. To `{ selection }` it answers, in
   * this order, those whose `entity` is selected and whose `operation` is
   * among that entity's selected operations, with the entity's `hints`
   * appended to the description after a blank line. A selected entity that
   * isn't in `entities` is skipped with a warning, as the contract says.
   * `FIXTURE_TOOL_DEFINITIONS` when absent.
   */
  tools?: ReadonlyArray<unknown>;
  /** Warnings sent with both answers. None when absent. */
  warnings?: ReadonlyArray<unknown>;
  /** The answers' `contractVersion`: 1 when absent. Given as `undefined`, the answers carry none. */
  contractVersion?: unknown;
  /** Throw an Error with this message instead of answering: the Connector's own refusal. */
  error?: string;
  /**
   * First send `GET /<name>` through `ctx.request`, and throw unless the
   * system answers 2xx: for a test that has to see discovery reach the system
   * with the right credential. Off when absent.
   */
  request?: boolean;
}

const DEFAULT_DISCOVERY_NAME = 'discover';

/**
 * The default catalog: a standard entity with a read and a write operation,
 * preselected, and a custom one with a read, not.
 */
export const FIXTURE_DISCOVERY_ENTITIES: readonly FixtureCatalogEntity[] = [
  {
    name: 'person',
    label: 'Person',
    source: 'standard',
    defaultEnabled: true,
    operations: [
      { name: 'read', write: false },
      { name: 'write', write: true },
    ],
  },
  {
    name: 'event_booking',
    label: 'Event booking',
    source: 'custom',
    defaultEnabled: false,
    operations: [{ name: 'read', write: false }],
  },
];

/** The two templates the default Tool definitions name. */
export const FIXTURE_TEMPLATES: readonly FixtureTemplate[] = [
  { name: 'read_record' },
  { name: 'write_record', write: true },
];

/** The default Tool definitions: one per operation of `FIXTURE_DISCOVERY_ENTITIES`, each valid. */
export const FIXTURE_TOOL_DEFINITIONS: readonly FixtureToolDefinition[] = [
  {
    name: 'read_person',
    entity: 'person',
    operation: 'read',
    description: 'Reads persons.',
    inputSchema: {
      type: 'object',
      properties: { filter: { type: 'string', description: 'Only persons whose name contains this.' } },
      required: [],
    },
    write: false,
    template: 'read_record',
    binding: { entity: 'person', service: 'persons' },
  },
  {
    name: 'write_person',
    entity: 'person',
    operation: 'write',
    description: 'Creates or changes a person.',
    inputSchema: {
      type: 'object',
      properties: { fields: { type: 'object', description: 'The fields to set.' } },
      required: ['fields'],
    },
    write: true,
    template: 'write_record',
    binding: { entity: 'person', service: 'persons' },
  },
  {
    name: 'read_event_booking',
    entity: 'event_booking',
    operation: 'read',
    description: 'Reads event bookings.',
    inputSchema: {
      type: 'object',
      properties: { filter: { type: 'string', description: 'Only bookings whose title contains this.' } },
      required: [],
    },
    write: false,
    template: 'read_record',
    binding: { entity: 'event_booking', service: 'event_bookings' },
  },
];

/**
 * A discovery Action's bundle that answers the discovery contract from
 * `discovery` (see `FixtureDiscovery`): the catalog to `{}`, the selected
 * Tool definitions to `{ selection }`.
 */
export function fixtureDiscoveryBundle(discovery: FixtureDiscovery = {}): Uint8Array {
  const name = discovery.name ?? DEFAULT_DISCOVERY_NAME;
  const spec = {
    name,
    entities: discovery.entities ?? FIXTURE_DISCOVERY_ENTITIES,
    tools: discovery.tools ?? FIXTURE_TOOL_DEFINITIONS,
    warnings: discovery.warnings ?? [],
    contractVersion: 'contractVersion' in discovery ? discovery.contractVersion : 1,
    error: discovery.error ?? null,
    request: discovery.request === true,
  };
  return utf8(
    `// fixture discovery bundle for ${name}\n` +
      `const spec = ${JSON.stringify(spec)};\n` +
      'export async function __atriumRun(ctx, input) {\n' +
      '  if (spec.request) {\n' +
      "    const res = await ctx.request('GET', '/' + spec.name);\n" +
      "    if (res.status < 200 || res.status > 299) throw new Error('The system answered ' + res.status + ' to discovery.');\n" +
      '  }\n' +
      '  if (spec.error !== null) throw new Error(spec.error);\n' +
      '  const warnings = [...spec.warnings];\n' +
      '  const selection = input?.selection;\n' +
      '  if (selection === undefined) {\n' +
      '    return { contractVersion: spec.contractVersion, entities: spec.entities, warnings };\n' +
      '  }\n' +
      '  const known = new Set(spec.entities.map((entity) => entity?.name));\n' +
      '  for (const entity of Object.keys(selection)) {\n' +
      '    if (!known.has(entity)) warnings.push(`The system has no entity "${entity}"; it was skipped.`);\n' +
      '  }\n' +
      '  const tools = [];\n' +
      '  for (const tool of spec.tools) {\n' +
      '    if (!known.has(tool?.entity) || !Object.hasOwn(selection, tool.entity)) continue;\n' +
      '    const choice = selection[tool.entity] ?? {};\n' +
      '    if (!Array.isArray(choice.operations) || !choice.operations.includes(tool.operation)) continue;\n' +
      "    tools.push(choice.hints ? { ...tool, description: tool.description + '\\n\\n' + choice.hints } : tool);\n" +
      '  }\n' +
      '  return { contractVersion: spec.contractVersion, tools, warnings };\n' +
      '}\n',
  );
}

/**
 * A template Action's bundle that echoes what it was given:
 * `{ template, binding, input }`, where `binding` is the input's
 * `__atriumBinding` (null when there was none) and `input` the rest. With
 * `request`, it sends the call on to the system first (see `FixtureTemplate`).
 */
export function fixtureTemplateBundle(template: string | FixtureTemplate): Uint8Array {
  const spec = templateOf(template);
  return utf8(
    `// fixture template bundle for ${spec.name}\n` +
      `const spec = ${JSON.stringify({ name: spec.name, write: spec.write === true, request: spec.request === true })};\n` +
      'export async function __atriumRun(ctx, input) {\n' +
      '  const { __atriumBinding: binding, ...rest } = input ?? {};\n' +
      '  const echo = { template: spec.name, binding: binding ?? null, input: rest };\n' +
      '  if (!spec.request) return echo;\n' +
      '  const res = spec.write\n' +
      "    ? await ctx.request('POST', '/' + spec.name, { body: echo })\n" +
      "    : await ctx.request('GET', '/' + spec.name);\n" +
      "  if (res.status < 200 || res.status > 299) throw new Error('The system answered ' + res.status + ' to ' + spec.name + '.');\n" +
      '  return { ...echo, response: res.body };\n' +
      '}\n',
  );
}

/** A template given by name alone is a read template that doesn't call the system. */
function templateOf(template: string | FixtureTemplate): FixtureTemplate {
  return typeof template === 'string' ? { name: template } : template;
}

/**
 * Builds a valid, signed artifact. Every parameter has a working default, so a
 * test that cares about one property states only that property.
 */
export async function buildArtifactFixture(
  params: BuildFixtureParams = {},
): Promise<ArtifactFixture> {
  const id = params.id ?? 'fixture-connector';
  const version = params.version ?? '1.0.0';
  const generatesTools = params.discovery !== undefined || params.templates !== undefined;
  const actionNames = params.actions ?? (generatesTools ? [] : ['list_things']);
  const templates = (params.templates ?? (params.discovery ? FIXTURE_TEMPLATES : [])).map(templateOf);
  const signers = params.signers ?? [await createFixtureKey()];

  const files = new Map<string, Uint8Array>();
  const actions: PublishedManifestAction[] = actionNames.map((name) => {
    files.set(`actions/${name}.js`, fixtureBundle(name));
    return {
      name,
      description: `Fixture action ${name}.`,
      inputSchema: { type: 'object', properties: {}, required: [] },
      bundle: `actions/${name}.js`,
      httpMethods: ['GET'],
    };
  });
  if (params.discovery) {
    const name = params.discovery.name ?? DEFAULT_DISCOVERY_NAME;
    files.set(`actions/${name}.js`, fixtureDiscoveryBundle(params.discovery));
    actions.push({
      name,
      description: `Fixture discovery action ${name}.`,
      inputSchema: {
        type: 'object',
        properties: { selection: { type: 'object', additionalProperties: true } },
        required: [],
      },
      bundle: `actions/${name}.js`,
      httpMethods: ['GET'],
      kind: 'discovery',
    });
  }
  for (const template of templates) {
    files.set(`actions/${template.name}.js`, fixtureTemplateBundle(template));
    actions.push({
      name: template.name,
      description: `Fixture template ${template.name}.`,
      // What the developer guide asks of a template: the binding declared,
      // the AI's keys let through.
      inputSchema: {
        type: 'object',
        properties: { __atriumBinding: { type: 'object', additionalProperties: true } },
        required: ['__atriumBinding'],
        additionalProperties: true,
      },
      bundle: `actions/${template.name}.js`,
      httpMethods: template.write ? ['POST'] : ['GET'],
      ...(template.write ? { write: true } : {}),
      kind: 'template',
    });
  }

  const manifestVersion = params.manifestVersion ?? manifestVersionFor(actions);
  // `null` first: `??` would treat it as omitted and supply the default.
  const connection = params.connection === null
    ? undefined
    : params.connection ?? (manifestVersion >= CONNECTION_MANIFEST_VERSION ? fixtureConnection() : undefined);
  const base: PublishedManifest = {
    manifestVersion: manifestVersion as PublishedManifest['manifestVersion'],
    id,
    displayName: params.displayName ?? `Fixture ${id}`,
    version,
    connectorApiVersion: params.connectorApiVersion ?? 1,
    actions,
    publishedWith: { bun: Bun.version },
    ...(connection !== undefined ? { connection: connection as ConnectorConnection } : {}),
  };
  const manifest = params.manifest ? params.manifest(base) : base;

  if (params.files) for (const [path, data] of params.files) files.set(path, data);

  const written = await writeEnvelope({
    manifest,
    files,
    signers: signers.map((signer) => ({ keyId: signer.keyId, privateKey: signer.privateKey })),
    publishedAt: params.publishedAt ?? '2026-08-30T00:00:00.000Z',
  });

  return {
    bytes: written.bytes,
    fileName: written.fileName,
    payloadSha256: written.payloadSha256,
    manifest,
    ring: signers.map((signer) => signer.ringKey),
  };
}

export interface RepackParams {
  bytes: Uint8Array;
  /** Whoever re-signs the result. Usually the same key the fixture was built with. */
  signer: FixtureKey;
  /** Free rein over the unpacked payload tree. */
  mutate: (files: Map<string, Uint8Array>) => void;
  /**
   * Rebuild ATRIUM-SIGNED.json over the mutated tree. Without it the listing
   * still describes the original tree, which is how a set-equality failure is
   * constructed; with it the artifact is internally consistent and only what
   * the mutation actually broke is left to fail.
   */
  relist?: boolean;
  id?: string;
  version?: string;
}

/**
 * Rebuilds an artifact around a mutated payload tree, re-signing it properly.
 *
 * This is how a test constructs the artifact only an attacker WITH a signing
 * key could produce — which is exactly the case the per-file listing exists
 * for. Without it, every "the listing catches X" test would really be testing
 * the signature, since an unsigned mutation never gets that far.
 *
 * Bypasses writeEnvelope on purpose: publish refuses to emit most of these,
 * and the point is that the install side refuses them independently.
 */
export async function repackArtifactFixture(params: RepackParams): Promise<Uint8Array> {
  const id = params.id ?? 'fixture-connector';
  const version = params.version ?? '1.0.0';

  const parts = readEnvelope(params.bytes);
  const files = readSafeEntries(gunzip(parts.payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY);
  const originalListing = files.get(LISTING_FILE)!;
  params.mutate(files);

  if (params.relist) {
    files.set(LISTING_FILE, serializeListing(await buildListing({ id, version, files })));
  }

  const sorted = [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = gzip(writeTar(sorted.map(([name, data]) => ({ name, data }))));

  const blobBytes = serializeBlob({
    id,
    version,
    payloadSha256: await sha256Hex(payload),
    // The listing digest the blob commits to is whatever the tree carries,
    // unless the caller deliberately removed it.
    listingSha256: await sha256Hex(files.get(LISTING_FILE) ?? originalListing),
    publishedAt: '2026-08-30T00:00:00.000Z',
  });
  const signature = await signBlob({
    blob: blobBytes,
    keyId: params.signer.keyId,
    privateKey: params.signer.privateKey,
  });

  return gzip(
    writeTar([
      { name: PAYLOAD_ENTRY, data: payload },
      { name: SIGNATURE_ENTRY, data: serializeSignatureFile([signature], blobBytes) },
    ]),
  );
}

/**
 * The payload tree an artifact carries, exactly as Add extracts it into the
 * Connector Volume, without verifying or judging it. For a test that has to
 * hold a version an earlier Release Added and this one no longer would.
 */
export function payloadFilesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  return readSafeEntries(gunzip(readEnvelope(bytes).payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY);
}
