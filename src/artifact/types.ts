// The Connector Artifact format, defined once. Both publish and install
// depend on these shapes: atrium's Instance, its CLI and its publish script,
// and the SDK's own build. Nothing here imports anything but its siblings and
// node builtins, which is what lets each of them compile the module in.
//
// Binding: atrium's ADR-0007, the Connector Artifact format and store.

/** The outer envelope's two — and only two — entries. */
export const PAYLOAD_ENTRY = 'payload.tar.gz';
export const SIGNATURE_ENTRY = 'payload.sig';

/** Files inside payload.tar.gz that carry meaning to Atrium rather than to a Connector. */
export const MANIFEST_FILE = 'manifest.json';
export const LISTING_FILE = 'ATRIUM-SIGNED.json';

/**
 * The shape of the published manifest — distinct from the source manifest an
 * author writes. This is the version publish WRITES; what Add accepts and
 * what a held version is read at are the two sets below.
 *
 * 3 adds the `connection` block (ADR-0014 §2), and requires it: it is the
 * only source of a Connector's connection settings (spec part C, "Only the
 * manifest connects").
 */
export const PUBLISHED_MANIFEST_VERSION = 3;

/**
 * Every manifestVersion Add accepts, oldest first. Anything outside it is
 * refused with one of two remedies (ADR-0007's two-remedy rule): above it,
 * upgrade the Instance; below it, obtain a newer Artifact. A version-2
 * Artifact brings no connection settings, and with no other source of them
 * left, a Connector Added from one could never connect.
 */
export const ADDABLE_MANIFEST_VERSIONS = [3] as const;

/**
 * Every manifestVersion a version the Instance already holds is read at,
 * oldest first: wider than what Add accepts, because a Connector Added by an
 * earlier Release is still on the Instance. Read for what it is, it stays
 * listed, can be Removed, and its Actions are still matched against when a
 * newer version is Added. It just cannot connect: only a version-3
 * `connection` block yields connection settings. The legacy `{ entry,
 * actions }` source shape is read too, by atrium's `services/connector-install.ts`.
 */
export const READABLE_MANIFEST_VERSIONS = [2, 3] as const;

export type ReadableManifestVersion = (typeof READABLE_MANIFEST_VERSIONS)[number];

/**
 * Which of the two sets a manifest is checked against: `add` for an Artifact
 * being Added (or published, or self-checked), `held` for a version already
 * in the Connector Volume, or an Artifact `atrium connector inspect` reports on.
 */
export type ManifestReading = 'add' | 'held';

/** The first manifestVersion that may carry a `connection` block, and must. */
export const CONNECTION_MANIFEST_VERSION = 3;

/**
 * One field an Integration of this Connector asks for. The same shape the
 * Integration's config is validated against today, plus an optional
 * `description` the install dialog can show.
 */
export interface ConnectionConfigField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  description?: string;
}

/**
 * How the Integration's credential is attached to a request
 * (atrium's services/connection-request.ts attaches it).
 *
 * `pat`'s `valuePrefix` is e.g. "Bearer " for an `Authorization: Bearer
 * <token>` scheme; a header that takes the raw token has none.
 *
 * `multi-header` (first seen with ADITO CRM) puts the secret in
 * `secretHeader`, plus static headers whose values are not secrets but the
 * Integration's own config (e.g. ADITO's `authMethod`, which can differ per
 * instance), resolved like `instanceUrl` and not entered at link time.
 *
 * `oauth2` carries the scope alone and means "through this Instance's own
 * Microsoft (Entra) registration": the sign-in, token exchange and refresh
 * build their URLs from the Instance's tenant and client id, so nothing
 * tenant-specific ships in an Artifact (ADR-0014 §2, as amended 2026-10-01).
 */
export type ConnectionAuth =
  | { type: 'pat'; headerName: string; valuePrefix?: string }
  | {
      type: 'multi-header';
      secretHeader: string;
      /** { headerName: configFieldName } — values come from the Integration's config. */
      staticHeadersFromConfig: Record<string, string>;
    }
  | { type: 'oauth2'; scope: string };

/**
 * Every sign-in kind a `connection` block can name (`request.auth.type`), in
 * the order they are offered: the validator's list, and `init`'s.
 */
export const CONNECTION_AUTH_TYPES = ['pat', 'multi-header', 'oauth2'] as const satisfies readonly ConnectionAuth['type'][];

/** A sign-in kind: `pat`, `multi-header` or `oauth2`. */
export type ConnectionAuthType = (typeof CONNECTION_AUTH_TYPES)[number];

/**
 * A Connector's connection settings: what an Integration of it asks for, and
 * how a request to the system behind it is built. One per Connector
 * (ADR-0014 §3). Named `connection`, never `provider` — that term is retired.
 */
export interface ConnectorConnection {
  configSchema: { fields: ConnectionConfigField[] };
  request: {
    /** May template config fields as `{fieldName}`, e.g. `https://dev.azure.com/{organization}`. */
    apiBasePath: string;
    /** The connectivity check run before a credential is stored. */
    healthCheckPath: string;
    auth: ConnectionAuth;
  };
}

/**
 * One Action, as the published manifest declares it.
 *
 * `bundle` is the ADR-0007 §6 addition: a per-action path into `actions/`,
 * filled in from the file publish actually wrote, which is what makes the
 * manifest and the hash listing agree by construction rather than by an
 * author's diligence. Top-level `entry` is gone — there is no source to point
 * at.
 */
export interface PublishedManifestAction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Path within the payload, e.g. "actions/list_projects.js". */
  bundle: string;
  /** Documentation only — never consulted for write-derivation. */
  httpMethods?: string[];
  /** Author-declared write-ness. Absent means read. */
  write?: boolean;
  /**
   * The author's group for this Action ("Persons", "Offers"): what Install
   * Connector groups the Actions by. Optional and additive, so no
   * manifestVersion bump; publish trims it and refuses an empty one or one
   * over 40 characters. A missing or blank one reads as none.
   */
  group?: string;
}

export interface PublishedManifest {
  manifestVersion: ReadableManifestVersion;
  id: string;
  displayName: string;
  version: string;
  /**
   * The Bundle Contract this artifact speaks — Atrium's half of the
   * `__atriumRun(ctx, input)` / `ctx.request(...)` handshake. Publish stamps
   * it from the SDK it just bundled; authors never declare it.
   */
  connectorApiVersion: number;
  actions: PublishedManifestAction[];
  /**
   * The Bun that built the bundles. Recorded because byte reproducibility is
   * explicitly not claimed — Bun.build is not stable across versions — so a
   * divergence between two publishes needs to be diagnosable.
   */
  publishedWith?: { bun: string };
  /**
   * The Connector's own connection settings. Version 3 only. Add requires it;
   * it is optional here only because a held version 2 has none, and a held
   * version 3 Added before Add required it may lack it; both are still read,
   * and cannot connect. A
   * version-2 manifest carrying it is refused — the field is what the version
   * number announces.
   */
  connection?: ConnectorConnection;
  /**
   * The Connector's tile code (Brand Guide 23): two characters, A to Z and 0
   * to 9, set by its author. Optional and additive; nothing checks it at Add.
   * The Connector Store shows it when it is two such characters and derives
   * one from the id otherwise (atrium's connectors/tile-code.ts). No SDK writes it yet.
   */
  code?: string;
}

/** One row of ATRIUM-SIGNED.json's hash listing. */
export interface ListedFile {
  /** Payload-relative, forward-slashed, never starting with './'. */
  path: string;
  sha256: string;
  size: number;
}

/**
 * ATRIUM-SIGNED.json — a pure integrity document. It carries id and version
 * so a listing cannot be lifted onto another artifact, and nothing else
 * semantic: anything meaningful lives in the manifest, which the listing
 * covers like any other file.
 */
export interface SignedListing {
  listingVersion: 1;
  id: string;
  version: string;
  /** Sorted by path. Covers every payload file except this one. */
  files: ListedFile[];
}

/** One trusted public key. The ring is a set of these; any of them validating is enough. */
export interface RingKey {
  /** First 8 bytes of SHA-256 over the SPKI, hex. Named by every signature line. */
  keyId: string;
  /** Taken from here, never from the signature file — see research note §5. */
  alg: 'ecdsa-p256-sha256';
  /** Base64 SPKI (DER SubjectPublicKeyInfo). */
  publicKey: string;
  /** Free text: who holds the private half, and when the key entered the ring. */
  comment: string;
}

/**
 * One signature line from payload.sig. A file may carry several, so a
 * rotation is a dual-sign rather than a flag day.
 */
export interface ArtifactSignature {
  keyId: string;
  alg: string;
  /** Base64, raw r||s (64 bytes for P-256) — the form crypto.subtle verifies. */
  signature: string;
}

/**
 * The document the signature actually covers. It names two digests because a
 * file cannot contain its own hash: payload.tar.gz's digest anchors the bytes
 * as received, and ATRIUM-SIGNED.json's digest anchors the listing that
 * survives unpacking.
 */
export interface SignedBlob {
  id: string;
  version: string;
  payloadSha256: string;
  listingSha256: string;
  /** ISO 8601. Recorded, never enforced — no verifier of ours rejects on a clock. */
  publishedAt: string;
}

/** What a fully verified artifact yields. */
export interface VerifiedArtifact {
  manifest: PublishedManifest;
  listing: SignedListing;
  /** Every payload file, keyed by payload-relative path, ATRIUM-SIGNED.json included. */
  files: Map<string, Uint8Array>;
  /** payload.tar.gz's SHA-256 — the digest recorded everywhere, per ADR-0007. */
  payloadSha256: string;
  /**
   * Every ring key whose signature validated, in payload.sig's order, each
   * once. Never empty. Surfaced so a rotation is legible in the Verify step,
   * and so the caller can decide what the set means: the verifier decides
   * nothing about trust (ADR-0007, Amendment from #11226).
   */
  keyIds: string[];
  /** The signed blob's `publishedAt`, which the Connector index lists. Recorded, never enforced. */
  publishedAt: string;
}

/** The mandatory filename convention: `<id>-<version>.atrium.tar.gz`. */
export const ARTIFACT_EXTENSION = '.atrium.tar.gz';

/**
 * A Connector id, constrained to what can survive a filename and a
 * line-oriented signed blob without ambiguity. Deliberately no path
 * separators, whitespace or newlines.
 */
export const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Semver, including a prerelease or build suffix. Anchored so it can also be
 * used to find where `<id>-<version>` splits — a version always starts with a
 * digit, which is what makes a dashed id like `azure-devops` and a dashed
 * version like `1.0.0-rc.1` distinguishable in one filename.
 */
export const CONNECTOR_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export function artifactFileName(id: string, version: string): string {
  return `${id}-${version}${ARTIFACT_EXTENSION}`;
}
