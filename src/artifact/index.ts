// `@3hillsit/atrium-connector-sdk/artifact`: the Connector Artifact format.
//
// Everything that says what an Artifact IS lives here, once, for every side
// that touches one: atrium's Instance opens Artifacts with it, atrium's CLI
// inspects them, atrium's publish script and the SDK's own build write them.
// It holds the envelope reader and writer, signing and verifying, the
// ATRIUM-SIGNED.json listing, the published manifest's types and validator
// (its `connection` block included), and the `__atriumRun` wrapper text.
//
// Two things it deliberately does not hold:
//
//   - Trust. It holds no key and no ring. The verifier takes a ring and
//     reports every key whose signature validated (`keyIds`); which keys an
//     Instance trusts, and what a set of them means, is atrium's
//     (ADR-0007, Amendment from #11226; ADR-0021).
//   - Bundling. It never calls `Bun.build` and imports nothing from the
//     build, so an Instance can compile it in without the bundler
//     (subpath-isolation.test.ts holds both).
//
// It imports nothing but its own siblings and node builtins.

// ── Opening an Artifact ─────────────────────────────────────────────────────

export {
  openArtifact,
  readEnvelope,
  unpackSignedPayload,
  parsePublishedManifest,
  checkAddable,
  checkArtifactFileName,
  parseArtifactFileName,
  assertPublishableIdentity,
} from './envelope';

/** The `connection` block's validators: the ones Add runs, and a build runs first. */
export { parseConnection, parseRequiredConnection } from './connection';

// ── Writing one ─────────────────────────────────────────────────────────────

export { writeEnvelope, writeEnvelopeParts } from './envelope';
export type { EnvelopeParts, SignerKey, WriteEnvelopeParams, WrittenEnvelope } from './envelope';

/** The source each Action is bundled from: the bundle's half of the Bundle Contract. */
export { actionWrapperSource } from './wrapper';
export type { ActionWrapperParams } from './wrapper';

// ── Signing and verifying ───────────────────────────────────────────────────

export {
  SIGNATURE_HEADER,
  SIGNATURE_ALG,
  SIGNATURE_COMMENT,
  BLOB_HEADER,
  deriveKeyId,
  generateSigningKey,
  importPrivateKey,
  serializeBlob,
  parseBlob,
  serializeSignatureFile,
  parseSignatureFile,
  signBlob,
  verifySignatures,
  verifySignatureFile,
} from './signing';
export type { GeneratedSigningKey, ParsedSignatureFile, SignatureVerification } from './signing';

// ── ATRIUM-SIGNED.json ──────────────────────────────────────────────────────

export { buildListing, serializeListing, parseListing, checkListing } from './listing';

// ── Tar, gzip and digests, as the format writes and reads them ─────────────

export {
  MAX_DECOMPRESSED_BYTES,
  assertSafeEntryName,
  gunzip,
  gzip,
  readSafeEntries,
  readTar,
  writeTar,
} from './tar';
export type { TarEntry, TarFile } from './tar';

export {
  digestsEqual,
  fromBase64,
  fromBase64Strict,
  fromUtf8,
  sha256Hex,
  toBase64,
  utf8,
} from './digest';

// ── Refusals ────────────────────────────────────────────────────────────────

export { ConnectorArtifactError, STAGE_BY_CODE, artifactError, stageForCode } from './errors';
export type { ConnectorArtifactErrorCode, VerifyStage } from './errors';

// ── Names and shapes ────────────────────────────────────────────────────────

export {
  ARTIFACT_EXTENSION,
  PAYLOAD_ENTRY,
  SIGNATURE_ENTRY,
  LISTING_FILE,
  MANIFEST_FILE,
  PUBLISHED_MANIFEST_VERSION,
  ADDABLE_MANIFEST_VERSIONS,
  READABLE_MANIFEST_VERSIONS,
  CONNECTION_MANIFEST_VERSION,
  CONNECTOR_ID_PATTERN,
  CONNECTOR_VERSION_PATTERN,
  artifactFileName,
} from './types';
export type {
  ArtifactSignature,
  ConnectionAuth,
  ConnectionConfigField,
  ConnectorConnection,
  ListedFile,
  ManifestReading,
  PublishedManifest,
  PublishedManifestAction,
  ReadableManifestVersion,
  RingKey,
  SignedBlob,
  SignedListing,
  VerifiedArtifact,
} from './types';

// ── Fixtures, for tests ─────────────────────────────────────────────────────

/**
 * Real, validly signed Artifacts built with keys generated on the spot, for
 * tests on either side of the format. Nothing here can sign anything a ring
 * of real keys accepts.
 */
export {
  buildArtifactFixture,
  createFixtureKey,
  fixtureBundle,
  fixtureConnection,
  payloadFilesOf,
  repackArtifactFixture,
} from './fixtures';
export type { ArtifactFixture, BuildFixtureParams, FixtureKey, RepackParams } from './fixtures';
