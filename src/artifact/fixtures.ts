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
  PUBLISHED_MANIFEST_VERSION,
  SIGNATURE_ENTRY,
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
   * The manifestVersion to declare. Defaults to what publish writes today
   * (PUBLISHED_MANIFEST_VERSION); 2 builds what was published before the
   * `connection` block existed, and any other number builds an artifact Add
   * must refuse.
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
  /** Action names; each gets a plausible `__atriumRun` bundle unless overridden. */
  actions?: string[];
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

/**
 * Builds a valid, signed artifact. Every parameter has a working default, so a
 * test that cares about one property states only that property.
 */
export async function buildArtifactFixture(
  params: BuildFixtureParams = {},
): Promise<ArtifactFixture> {
  const id = params.id ?? 'fixture-connector';
  const version = params.version ?? '1.0.0';
  const actionNames = params.actions ?? ['list_things'];
  const signers = params.signers ?? [await createFixtureKey()];

  const actions: PublishedManifestAction[] = actionNames.map((name) => ({
    name,
    description: `Fixture action ${name}.`,
    inputSchema: { type: 'object', properties: {}, required: [] },
    bundle: `actions/${name}.js`,
    httpMethods: ['GET'],
  }));

  const manifestVersion = params.manifestVersion ?? PUBLISHED_MANIFEST_VERSION;
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

  const files = new Map<string, Uint8Array>();
  for (const name of actionNames) files.set(`actions/${name}.js`, fixtureBundle(name));
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
