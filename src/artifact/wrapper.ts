// The `__atriumRun` wrapper: the source each Action is bundled from.
//
// It is the bundle's half of the Bundle Contract (see ../version.ts): one
// export, `__atriumRun(ctx, input)`, with parse-then-handle baked in. The
// build writes this text beside the Connector's entry module and bundles it,
// one bundle per Action; nothing else in a published bundle is the format's.
//
// It is text, not code that runs here, so that this module stays pure: the
// bundling that consumes it, and `Bun.build`, belong to the build, never to
// `./artifact` (subpath-isolation.test.ts holds that).
//
// The install-time harness atrium wraps a bundle in when it loads an Action
// is atrium's own and is NOT here: its shape is unversioned and must never be
// frozen into a published file (ADR-0007 §7).
//
// Moved from atrium's backend/scripts/build-action-bundle.ts unchanged, byte
// for byte; wrapper.test.ts pins the text.

export interface ActionWrapperParams {
  /**
   * The Connector's entry module as the wrapper imports it: relative to the
   * wrapper's own folder, forward-slashed, starting `./`, without `.ts`
   * (e.g. `./src/index`).
   */
  entryImportPath: string;
  /** The Action's name: the `id` of the exported action object it runs. */
  actionName: string;
}

/**
 * The wrapper module for one Action. It finds the exported action object
 * whose `id` is `actionName` among the entry module's exports, refuses on
 * import if there is none, and exports `__atriumRun`, which parses the input
 * with the action's `inputSchema` and hands the result to its `handler`.
 */
export function actionWrapperSource(params: ActionWrapperParams): string {
  return (
    `import * as __atriumConnectorModule from '${params.entryImportPath}';\n` +
    `const __atriumAction = Object.values(__atriumConnectorModule).find(\n` +
    `  (v) => v && typeof v === 'object' && (v).id === ${JSON.stringify(params.actionName)}\n` +
    `);\n` +
    `if (!__atriumAction) {\n` +
    `  throw new Error(${JSON.stringify(`Connector entry module has no action with id "${params.actionName}"`)});\n` +
    `}\n` +
    `export async function __atriumRun(ctx, input) {\n` +
    `  const parsed = __atriumAction.inputSchema.parse(input);\n` +
    `  return await __atriumAction.handler(ctx, parsed);\n` +
    `}\n`
  );
}
