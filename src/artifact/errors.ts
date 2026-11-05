// Every refusal this module can produce, as a closed set of codes.
//
// The codes are the feature, not an implementation detail: an admin needs to
// tell "we sent you the wrong file" apart from "your Atrium is too old" apart
// from "someone tampered with this", and the add drawer's Verify step renders
// whichever one fired. So they are deliberately non-collapsible — see
// atrium's docs/research/connector-artifact-signing.md §8 — and tests assert on the
// code and on what the message names, never merely that something threw.

export type ConnectorArtifactErrorCode =
  // --- the outer envelope, before anything is trusted ---
  | 'envelope-malformed' // not gzip/tar, or not exactly the two expected flat files
  | 'signature-missing' // no payload.sig entry
  | 'signature-malformed' // payload.sig is not ATRIUM-SIG-v1, or a line is unparseable
  // --- the signature itself ---
  | 'unknown-key' // signed by a key id this Atrium's ring does not carry
  // Not 'unknown-key', because the remedy differs: that one says "update
  // Atrium", and no update makes a Release trust the testing key (#11224).
  | 'testing-key' // signed by atrium-testing alone, which this tree does not trust: a test build
  | 'signature-invalid' // a ring key was named, but the signature does not verify
  | 'payload-digest-mismatch' // signature is good; payload.tar.gz is not what it covers
  // --- the unpacked tree, against ATRIUM-SIGNED.json ---
  | 'listing-malformed' // ATRIUM-SIGNED.json missing or not the expected shape
  | 'listing-digest-mismatch' // ATRIUM-SIGNED.json is not the file the signature covers
  | 'unexpected-file' // a file on disk the listing does not name
  | 'missing-file' // a file the listing names that is not on disk
  | 'file-digest-mismatch' // a listed file whose content changed
  // --- extraction hardening, independent of any signature ---
  | 'unsafe-entry' // symlink, hardlink, absolute path, '..', non-regular, duplicate name
  // --- what the payload declares about itself ---
  | 'manifest-invalid' // manifest.json missing, unparseable, or malformed (its connection block included)
  // Two codes for one check, for the same reason as the contract pair below:
  // the remedies are opposites (ADR-0007's two-remedy rule).
  | 'manifest-too-new' // a manifestVersion above what this Atrium reads — upgrade the Instance
  | 'manifest-too-old' // a manifestVersion this Atrium no longer reads — obtain a newer Artifact
  // --- the bundle contract, which is Atrium's half of the handshake ---
  // Deliberately two codes, not one 'contract-unsupported': the remedies are
  // opposites. Too-old is fixed by re-publishing the Connector; too-new is
  // fixed by upgrading Atrium. An admin who is told only "unsupported" has to
  // guess which, and will guess wrong half the time.
  | 'contract-too-old' // built against a bundle contract this Atrium has dropped
  | 'contract-too-new' // built against a newer contract than this Atrium speaks
  | 'version-mismatch' // the manifest's id@version disagrees with the signed blob
  | 'filename-mismatch'; // the artifact's filename disagrees with the verified manifest

/**
 * The four stages an artifact passes through, in the order they run.
 *
 * These are the section headings above, promoted from comments to a type. The
 * add drawer's Verify step renders the stages in this order and cuts the list
 * off at the one that failed, so which stage a code belongs to is a fact about
 * the format — it belongs here, next to the codes, rather than in whichever UI
 * happens to be rendering them.
 */
export type VerifyStage = 'signature' | 'listing' | 'manifest' | 'contract';

/**
 * Every code's stage. A total `Record`, deliberately: adding a member to
 * `ConnectorArtifactErrorCode` without giving it a stage is a compile error,
 * which is the only thing that keeps a new refusal from being silently
 * attributed to the wrong stage. A `Partial` here with a fallback would
 * report, say, a new manifest refusal as a SIGNATURE failure — which is the
 * "someone tampered with this" answer, and the exact collapse the closed set
 * exists to prevent.
 */
export const STAGE_BY_CODE: Record<ConnectorArtifactErrorCode, VerifyStage> = {
  'envelope-malformed': 'signature',
  'signature-missing': 'signature',
  'signature-malformed': 'signature',
  'unknown-key': 'signature',
  'testing-key': 'signature',
  'signature-invalid': 'signature',
  'payload-digest-mismatch': 'signature',
  'listing-malformed': 'listing',
  'listing-digest-mismatch': 'listing',
  'unexpected-file': 'listing',
  'missing-file': 'listing',
  'file-digest-mismatch': 'listing',
  'unsafe-entry': 'listing',
  'manifest-invalid': 'manifest',
  'manifest-too-new': 'manifest',
  'manifest-too-old': 'manifest',
  'version-mismatch': 'manifest',
  'filename-mismatch': 'manifest',
  'contract-too-old': 'contract',
  'contract-too-new': 'contract',
};

/**
 * The stage a refusal failed at.
 *
 * `unreadable` is not an artifact refusal — the bytes could not be got at all,
 * so nothing was reached — and it is attributed to the first stage for that
 * reason. It is spelled out as its own branch rather than left to a fallback,
 * so that the deliberate case and an unmapped-code accident cannot share one
 * line of code.
 */
export function stageForCode(code: ConnectorArtifactErrorCode | 'unreadable'): VerifyStage {
  return code === 'unreadable' ? 'signature' : STAGE_BY_CODE[code];
}

export class ConnectorArtifactError extends Error {
  readonly code: ConnectorArtifactErrorCode;
  // Whatever the message names — a path, two digests, a key id. Kept
  // structured as well as interpolated so the API layer can render it without
  // re-parsing prose.
  readonly details: Record<string, string>;

  constructor(
    code: ConnectorArtifactErrorCode,
    message: string,
    details: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ConnectorArtifactError';
    this.code = code;
    this.details = details;
  }
}

export function artifactError(
  code: ConnectorArtifactErrorCode,
  message: string,
  details: Record<string, string> = {},
): ConnectorArtifactError {
  return new ConnectorArtifactError(code, message, details);
}
