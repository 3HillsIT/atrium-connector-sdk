// The format half of the self-check, without a signature: what `check` and
// `build` run on the unsigned Artifact before anyone signs it.
//
// It opens the Artifact with the format's own reader (the listing, the
// manifest validator Add runs, the file name), then splices each bundle the
// way atrium's Instance does when it loads an Action and imports it, to
// confirm a callable `__atriumRun`. A bundle that throws on import is
// otherwise found by a customer's admin, at Add.
//
// The trust half (which ring, which keys) is atrium's: its release signs and
// then opens the Artifact with its own Instance code, splice included.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  SIGNATURE_ALG,
  checkArtifactFileName,
  generateSigningKey,
  importPrivateKey,
  openArtifact,
  writeEnvelope,
} from '../artifact';
import type { RingKey, VerifiedArtifact, WrittenEnvelope } from '../artifact';
import type { BuiltConnector } from './build';
import type { CheckFailure } from './rules';

export interface FormatCheck {
  /** The unsigned Artifact: payload.sig carries the signed blob and no signature line. */
  unsigned: WrittenEnvelope;
  /** Empty when the Artifact passed. */
  failures: CheckFailure[];
}

/**
 * Writes `built` as an unsigned Artifact stamped `publishedAt`, and checks
 * it. Signs nothing that outlives the call: the reader only opens a signed
 * Artifact, so the same payload is signed in memory with a key made for this
 * one check and trusted by this one check, and both are dropped.
 */
export async function checkFormat(
  built: BuiltConnector,
  options: { publishedAt: string },
): Promise<FormatCheck> {
  const unsigned = await writeEnvelope({ ...built, signers: [], publishedAt: options.publishedAt });

  const throwaway = await generateSigningKey();
  const signed = await writeEnvelope({
    ...built,
    signers: [{ keyId: throwaway.keyId, privateKey: await importPrivateKey(throwaway.privateKey) }],
    publishedAt: options.publishedAt,
  });
  const ring: RingKey[] = [
    { keyId: throwaway.keyId, alg: SIGNATURE_ALG, publicKey: throwaway.publicKey, comment: 'one self-check' },
  ];
  if (signed.payloadSha256 !== unsigned.payloadSha256) {
    return {
      unsigned,
      failures: [
        {
          rule: 'format',
          message:
            `The same build wrote two payloads (${unsigned.payloadSha256} and ${signed.payloadSha256}). ` +
            'The payload must not depend on the signers; report this against the SDK.',
        },
      ],
    };
  }

  let opened: VerifiedArtifact;
  try {
    opened = await openArtifact(signed.bytes, ring);
    checkArtifactFileName(unsigned.fileName, opened.manifest);
  } catch (err) {
    return {
      unsigned,
      failures: [
        {
          rule: 'format',
          message: `The Artifact doesn't pass the format's reader: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  return { unsigned, failures: await checkBundlesLoad(opened) };
}

// What atrium's Instance appends to a bundle when it loads an Action (its
// services/connector-install.ts, `wrapBundleForEndpoint`), copied for this
// check only. The shape is atrium's and unversioned, so it is never written
// into an Artifact; it is here so a bundle whose own top-level names collide
// with it (a Connector's own top-level `handler`, say) fails on the
// developer's machine instead of at Add.
const CTX_ADAPTER_SNIPPET =
  'const __atriumConnectorCtx = { instanceOrigin: globalThis.atrium?.instanceOrigin, request: (method, path, opts) => globalThis.atrium.request(env.ATRIUM_INTEGRATION_ID, method, path, opts) };';

/** The top-level names the splice declares, for a refusal to name. */
const SPLICED_NAMES = ['__atriumConnectorCtx', 'handler'];

function spliced(bundle: string): string {
  return [
    bundle.trimEnd(),
    '',
    CTX_ADAPTER_SNIPPET,
    'async function handler(input) {',
    '  return await __atriumRun(__atriumConnectorCtx, input);',
    '}',
    '',
    'export const __atriumSelfCheck = { run: __atriumRun, handler };',
    '',
  ].join('\n');
}

/** Each Action's bundle, spliced and imported: it loads, and `__atriumRun` is callable. */
async function checkBundlesLoad(opened: VerifiedArtifact): Promise<CheckFailure[]> {
  const failures: CheckFailure[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'atrium-connector-selfcheck-'));
  try {
    for (const action of opened.manifest.actions) {
      const bundle = new TextDecoder().decode(opened.files.get(action.bundle)!);

      let loaded: { __atriumSelfCheck?: { run?: unknown; handler?: unknown } };
      try {
        loaded = (await importFrom(scratch, action.name, spliced(bundle))) as typeof loaded;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Loading on its own and not once spliced is a name the bundle shares
        // with the splice, which says more than the engine's message does.
        const alone = await importFrom(scratch, action.name, bundle).then(
          () => true,
          () => false,
        );
        failures.push(
          alone
            ? {
                rule: 'bundle-contract',
                message:
                  `The bundle for action "${action.name}" loads on its own but not with what atrium ` +
                  `declares beside it when it loads an Action (${SPLICED_NAMES.join(', ')}): ${reason}. ` +
                  "Rename the Connector's own top-level declaration of that name.",
              }
            : {
                rule: 'loads-cleanly',
                message: `The bundle for action "${action.name}" does not load: ${reason}`,
              },
        );
        continue;
      }
      if (typeof loaded.__atriumSelfCheck?.run !== 'function') {
        failures.push({
          rule: 'bundle-contract',
          message:
            `The bundle for action "${action.name}" does not export a callable __atriumRun, which ` +
            'is the whole of the Bundle Contract.',
        });
      } else if (typeof loaded.__atriumSelfCheck.handler !== 'function') {
        failures.push({
          rule: 'bundle-contract',
          message: `The bundle for action "${action.name}" does not splice into a callable handler.`,
        });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return failures;
}

/**
 * Imports `code` as `<name>.js` from a new folder under `scratch`. One folder
 * per module: Bun caches a folder's listing the first time it resolves a
 * module out of it, so a second file written into it afterwards is reported
 * as missing.
 */
async function importFrom(scratch: string, name: string, code: string): Promise<unknown> {
  const path = join(mkdtempSync(join(scratch, 'action-')), `${name}.js`);
  writeFileSync(path, code);
  return await import(pathToFileURL(path).href);
}
