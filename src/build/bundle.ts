// Bundling one Action: the `__atriumRun` wrapper from `./artifact`, written
// beside the Connector's entry module and bundled with everything it imports.
//
// Moved from atrium's backend/scripts/build-action-bundle.ts. The wrapper text
// is `actionWrapperSource`, byte for byte what atrium wrote, and the output is
// normalised the same way, so the same source bundled by either gives the
// same bytes on the same Bun.

import { realpathSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'path';
import { actionWrapperSource } from '../artifact';
import { BuildRefusal } from './rules';

export interface BuildActionBundleParams {
  /** The Connector package: the folder holding its package.json and manifest.json. */
  sourcePath: string;
  /** The entry module, relative to `sourcePath`, as manifest.json's `entry` names it. */
  entry: string;
  /** The Action's name: the `id` of the exported action object the bundle runs. */
  actionName: string;
}

/**
 * One Action's bundle: an ES module whose one export is `__atriumRun(ctx,
 * input)`, with the Connector's code and everything it imports inlined. Ends
 * in exactly one newline. Throws a `bundles` refusal naming the Action and
 * what the bundler couldn't do.
 */
export async function buildActionBundle(params: BuildActionBundleParams): Promise<string> {
  const entryAbsPath = join(params.sourcePath, params.entry).replace(/\.ts$/, '');
  const entryImportPath = './' + relative(params.sourcePath, entryAbsPath).split(sep).join('/');
  const wrapperPath = join(params.sourcePath, `.atrium-install-${crypto.randomUUID()}.ts`);
  writeFileSync(
    wrapperPath,
    actionWrapperSource({ entryImportPath, actionName: params.actionName }),
    'utf-8',
  );
  try {
    const bundled = await bundleModule(wrapperPath, `connector action "${params.actionName}"`);
    return normalizeBundle(bundled, params.sourcePath, wrapperPath).trimEnd() + '\n';
  } finally {
    try {
      unlinkSync(wrapperPath);
    } catch {}
  }
}

/**
 * One `Bun.build` of `entrypoint` into a single ES module for Bun, as text.
 * `what` names it in a refusal ("connector action \"x\"").
 */
export async function bundleModule(entrypoint: string, what: string): Promise<string> {
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [entrypoint],
      target: 'bun',
      format: 'esm',
      minify: false,
    });
  } catch (err) {
    // Bun reports a failed build by throwing an AggregateError whose own
    // message is only "Bundle failed"; what failed, and where, is in its
    // errors.
    const inner = (err as { errors?: unknown[] }).errors;
    if (!Array.isArray(inner) || inner.length === 0) throw err;
    throw new BuildRefusal('bundles', `Failed to bundle ${what}: ${inner.map(String).join('; ')}`);
  }

  if (!result.success) {
    const messages = result.logs
      .map((l) => String((l as { message?: unknown }).message ?? l))
      .join('; ');
    throw new BuildRefusal('bundles', `Failed to bundle ${what}: ${messages}`);
  }
  if (result.outputs.length !== 1) {
    throw new BuildRefusal(
      'bundles',
      `Expected exactly one bundle output for ${what}, got ${result.outputs.length}.`,
    );
  }
  return await result.outputs[0]!.text();
}

// Bun writes a section comment naming each module it inlined, spelled as a
// path from the CURRENT WORKING DIRECTORY, and the generated wrapper's name
// carries a UUID so two concurrent bundles of one action cannot fight over a
// file. Both land in the output, so the same source bundled twice produces
// different bytes — from a different working directory, a different checkout,
// or on a different day.
//
// That matters more than it looks: a version is one set of bytes (atrium's
// ADR-0007 §8), so incidental nondeterminism would make an honest rebuild
// read as a changed payload and send the developer off to bump a semver for
// no reason.
//
// So each of those comments is re-spelled relative to the connector package,
// which depends on the repository's layout rather than on where anyone stood
// when they ran it. Every candidate line is resolved against the filesystem
// first and left alone if it does not name a real file: the alternative —
// substituting path strings textually — mangles ordinary source, because a
// working directory inside the package makes the package's own relative
// spelling `..`, which appears in every spread operator.
//
// This is NOT a claim of byte reproducibility across Bun versions: Bun.build's
// output is not stable across them, which is why the published manifest
// records the Bun that built it (ADR-0007, "Clarifications from #10367").
function normalizeBundle(bundled: string, sourcePath: string, wrapperPath: string): string {
  const packageRoot = realpathSync(sourcePath);
  const lines = bundled.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    // Bun's section comments are exactly `// <path>` at column 0 — one token,
    // no trailing text. Anything else is the connector author's own comment.
    if (!line.startsWith('// ') || line.includes(' ', 3)) continue;

    const spelled = line.slice(3);
    let real: string;
    try {
      real = realpathSync(isAbsolute(spelled) ? spelled : resolve(process.cwd(), spelled));
      if (!statSync(real).isFile()) continue;
    } catch {
      continue;
    }
    lines[index] = `// ${relative(packageRoot, real).split(sep).join('/')}`;
  }

  // The wrapper's UUID name survives the rewrite above (it is a real file
  // until this function returns), so it is replaced last. No other file can
  // carry that string.
  return lines.join('\n').replaceAll(basename(wrapperPath), '__atrium-entry.ts');
}
