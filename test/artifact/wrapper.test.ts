import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { actionWrapperSource } from '../../src/artifact';

// The wrapper is the bundle's half of the Bundle Contract, so its text is
// pinned: this is what atrium's backend/scripts/build-action-bundle.ts wrote
// for `list_things` from `./src/index` when it moved here.
const PINNED = `import * as __atriumConnectorModule from './src/index';
const __atriumAction = Object.values(__atriumConnectorModule).find(
  (v) => v && typeof v === 'object' && (v).id === "list_things"
);
if (!__atriumAction) {
  throw new Error("Connector entry module has no action with id \\"list_things\\"");
}
export async function __atriumRun(ctx, input) {
  const parsed = __atriumAction.inputSchema.parse(input);
  return await __atriumAction.handler(ctx, parsed);
}
`;

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Writes an entry module and the wrapper beside it, and imports the wrapper. */
async function load(entry: string, actionName: string): Promise<Record<string, unknown>> {
  dir = mkdtempSync(join(tmpdir(), 'atrium-wrapper-'));
  writeFileSync(join(dir, 'entry.ts'), entry);
  const wrapper = join(dir, `wrapper-${actionName}.ts`);
  writeFileSync(wrapper, actionWrapperSource({ entryImportPath: './entry', actionName }));
  return (await import(pathToFileURL(wrapper).href)) as Record<string, unknown>;
}

describe('the __atriumRun wrapper', () => {
  test('is the text atrium bundled each Action from, byte for byte', () => {
    expect(actionWrapperSource({ entryImportPath: './src/index', actionName: 'list_things' })).toBe(PINNED);
  });

  test('exports one callable __atriumRun that parses the input, then hands it to the handler', async () => {
    const module = await load(
      `export const listThings = {
  id: 'list_things',
  inputSchema: { parse: (input) => ({ ...input, parsed: true }) },
  handler: async (ctx, input) => ({ via: ctx.name, input }),
};
export const other = { id: 'other', inputSchema: { parse: (x) => x }, handler: async () => 'wrong' };
`,
      'list_things',
    );
    expect(Object.keys(module)).toEqual(['__atriumRun']);
    const run = module.__atriumRun as (ctx: unknown, input: unknown) => Promise<unknown>;
    expect(await run({ name: 'ctx' }, { q: 1 })).toEqual({ via: 'ctx', input: { q: 1, parsed: true } });
  });

  test('a parse that throws stops the handler from running', async () => {
    const module = await load(
      `export const strict = {
  id: 'strict',
  inputSchema: { parse: () => { throw new Error('bad input'); } },
  handler: async () => { throw new Error('the handler ran'); },
};
`,
      'strict',
    );
    const run = module.__atriumRun as (ctx: unknown, input: unknown) => Promise<unknown>;
    await expect(run({}, {})).rejects.toThrow('bad input');
  });

  test('an entry module without the Action refuses on import, naming it', async () => {
    await expect(load('export const nothing = 1;\n', 'missing_action')).rejects.toThrow(
      'Connector entry module has no action with id "missing_action"',
    );
  });
});
