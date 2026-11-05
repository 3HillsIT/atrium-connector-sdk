// The rules that break a Connector without breaking its build: manifest.json
// and the code drifting apart, an Action missing from the entry module's
// exports, and a write the manifest doesn't mark.
//
// atrium never runs a Connector's code to learn it: each Tool's name,
// description, input schema and write flag come from the manifest, and only
// `write: true` puts a Tool behind atrium's write approval. A drift between
// the manifest and the code is invisible to the compiler, so `check` holds the
// two together here, from the outside: it loads the entry module as the
// bundles will, and compares what it exports with what the manifest says.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { bundleModule } from './bundle';
import { BuildRefusal } from './rules';
import type { CheckFailure } from './rules';
import type { SourceManifest, SourceManifestAction } from './source';

/** An Action object as the entry module exports it: what the wrapper finds by `id`. */
export interface ExportedAction {
  id: string;
  handler: (...args: unknown[]) => unknown;
  description?: unknown;
  inputSchema?: unknown;
  httpMethods?: unknown;
}

/** The HTTP methods that only read. Any other one is a write unless the manifest says it isn't. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The entry module's exports, bundled and imported as the Action bundles
 * will be, from a new folder under the OS temp directory (so a second check
 * in one process never reads a cached module). Throws a `bundles` refusal
 * when it can't be bundled and a `loads-cleanly` one when importing it throws.
 */
export async function loadEntryModule(
  packageDir: string,
  entry: string,
): Promise<Record<string, unknown>> {
  const bundled = await bundleModule(join(packageDir, entry), `the entry module ${entry}`);
  const scratch = mkdtempSync(join(tmpdir(), 'atrium-connector-check-'));
  try {
    const path = join(scratch, 'entry.js');
    writeFileSync(path, bundled);
    try {
      return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (err) {
      throw new BuildRefusal(
        'loads-cleanly',
        `The entry module ${entry} throws when it is loaded: ` +
          `${err instanceof Error ? err.message : String(err)}. Nothing at a module's top level may ` +
          'need the network, the environment or files.',
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The Action objects among a module's exports, by id; the first export wins, as in the wrapper. */
export function exportedActions(exports: Record<string, unknown>): Map<string, ExportedAction> {
  const actions = new Map<string, ExportedAction>();
  for (const value of Object.values(exports)) {
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { id?: unknown }).id === 'string' &&
      typeof (value as { handler?: unknown }).handler === 'function'
    ) {
      const action = value as ExportedAction;
      if (!actions.has(action.id)) actions.set(action.id, action);
    }
  }
  return actions;
}

/**
 * Every authoring rule the manifest and the entry module's exports break,
 * each Action's failures in the manifest's order, then exports the manifest
 * doesn't declare.
 */
export function checkAuthoringRules(
  manifest: SourceManifest,
  exports: Record<string, unknown>,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const exported = exportedActions(exports);

  for (const action of manifest.actions) {
    const code = exported.get(action.name);
    if (!code) {
      failures.push({
        rule: 'exports-and-names',
        message:
          `manifest.json declares the action "${action.name}", but ${manifest.entry} exports no ` +
          `action whose id is "${action.name}". Export it from ${manifest.entry}, or take it out of ` +
          'manifest.json.',
      });
    } else {
      failures.push(...parityFailures(action, code));
    }
    const writeFailure = writeFlagFailure(action, code);
    if (writeFailure) failures.push(writeFailure);
  }

  const declared = new Set(manifest.actions.map((action) => action.name));
  for (const id of exported.keys()) {
    if (declared.has(id)) continue;
    failures.push({
      rule: 'parity',
      message:
        `${manifest.entry} exports the action "${id}", which manifest.json doesn't declare. ` +
        'Declare it in manifest.json, or stop exporting it.',
    });
  }
  return failures;
}

/** The same description, and an input schema with the zod schema's properties and required list. */
function parityFailures(action: SourceManifestAction, code: ExportedAction): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const where = `The action "${action.name}"`;

  if (typeof code.description === 'string' && code.description !== action.description) {
    failures.push({
      rule: 'parity',
      message:
        `${where} has one description in manifest.json and another in the code. The manifest's ` +
        `is what an AI client reads: ${JSON.stringify(action.description)}; the code's: ` +
        `${JSON.stringify(code.description)}. Make them the same.`,
    });
  }

  const shape = zodObjectShape(code.inputSchema);
  if (shape) {
    const schema = action.inputSchema ?? {};
    const properties =
      typeof schema.properties === 'object' && schema.properties !== null
        ? Object.keys(schema.properties)
        : [];
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [];
    const codeProperties = Object.keys(shape);
    const codeRequired = codeProperties.filter((key) => !shape[key]!.isOptional());

    const differences = [
      ...difference(codeProperties, properties).map((key) => `"${key}" is in the code's schema only`),
      ...difference(properties, codeProperties).map((key) => `"${key}" is in manifest.json's schema only`),
      ...difference(codeRequired, required)
        .filter((key) => properties.includes(key))
        .map((key) => `"${key}" is required in the code but not in manifest.json`),
      ...difference(required, codeRequired)
        .filter((key) => codeProperties.includes(key))
        .map((key) => `"${key}" is required in manifest.json but optional in the code`),
    ];
    if (differences.length > 0) {
      failures.push({
        rule: 'parity',
        message:
          `${where}'s inputSchema in manifest.json doesn't match its zod inputSchema: ` +
          `${differences.join('; ')}. An AI client sees the manifest's, the handler gets the code's.`,
      });
    }
  }
  return failures;
}

/**
 * An Action must say whether it changes something, unless it declares that it
 * sends only GET (or HEAD, OPTIONS): `"write": true` puts its Tools behind
 * atrium's write approval, and without it they run with nobody's.
 * `"write": false` is the author's word that it only reads (a search sent as
 * POST), and is never second-guessed. An Action that declares no methods
 * anywhere is unknown, not a read (`ActionDefinition.httpMethods`: treat it as
 * write-capable, fail-safe), so it needs `write` too.
 */
function writeFlagFailure(
  action: SourceManifestAction,
  code: ExportedAction | undefined,
): CheckFailure | undefined {
  const write: unknown = action.write;
  if (write !== undefined && typeof write !== 'boolean') {
    return {
      rule: 'write-flag',
      message:
        `The action "${action.name}" declares "write": ${JSON.stringify(write)}; it is true or ` +
        'false, or left out for an Action whose httpMethods are only GET, HEAD or OPTIONS.',
    };
  }
  if (write !== undefined) return undefined;

  const declared = declaredMethods(action.httpMethods) ?? declaredMethods(code?.httpMethods);
  if (!declared) {
    return {
      rule: 'write-flag',
      message:
        `The action "${action.name}" declares no httpMethods and no "write", so nothing says whether ` +
        'it changes anything, and it counts as a write. Declare its httpMethods (in manifest.json or ' +
        'the code; GET alone makes it a read), or add "write": true if it changes anything, ' +
        '"write": false if it just reads.',
    };
  }
  const writes = declared.map((method) => String(method).toUpperCase()).filter((method) => !READ_METHODS.has(method));
  if (writes.length === 0) return undefined;
  return {
    rule: 'write-flag',
    message:
      `The action "${action.name}" sends ${[...new Set(writes)].join(', ')}, and manifest.json doesn't ` +
      'say whether it changes anything. Add "write": true if it does, so its Tools wait for approval; ' +
      'add "write": false only if it just reads (a search sent as POST, say).',
  };
}

/** A non-empty httpMethods list, or undefined when there is none to judge by. */
function declaredMethods(methods: unknown): unknown[] | undefined {
  return Array.isArray(methods) && methods.length > 0 ? methods : undefined;
}

/** A zod object schema's shape, read by duck type so the Connector's zod copy doesn't matter. */
function zodObjectShape(
  schema: unknown,
): Record<string, { isOptional: () => boolean }> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape !== 'object' || shape === null) return undefined;
  const entries = Object.values(shape as Record<string, unknown>);
  if (!entries.every((value) => typeof (value as { isOptional?: unknown })?.isOptional === 'function')) {
    return undefined;
  }
  return shape as Record<string, { isOptional: () => boolean }>;
}

function difference(a: string[], b: string[]): string[] {
  const other = new Set(b);
  return a.filter((key) => !other.has(key));
}
