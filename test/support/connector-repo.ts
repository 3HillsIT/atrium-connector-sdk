// A small Connector repo in a temp folder, for driving `atrium-connector` from
// outside: a manifest, a read and a write Action on zod, and this SDK
// installed as its dependency (a symlink to this checkout, as `bun link`
// would make it).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

export const SDK_ROOT = resolve(import.meta.dir, '..', '..');
export const BIN = join(SDK_ROOT, 'bin', 'atrium-connector.ts');

export const ENTRY_SOURCE = `import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

export const listThings = defineAction({
  id: 'list_things',
  description: 'Lists things.',
  inputSchema: z.object({ status: z.string().optional() }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    const res = await ctx.request('GET', '/things', { query: input.status ? { status: input.status } : {} });
    return res.body;
  },
});

export const createThing = defineAction({
  id: 'create_thing',
  description: 'Creates a thing.',
  inputSchema: z.object({ name: z.string() }),
  httpMethods: ['POST'],
  async handler(ctx, input) {
    const res = await ctx.request('POST', '/things', { body: { name: input.name } });
    return res.body;
  },
});
`;

export function manifestOf(version = '1.2.0'): Record<string, unknown> {
  return {
    id: 'thing-connector',
    displayName: 'Thing Connector',
    version,
    entry: 'src/index.ts',
    connection: {
      configSchema: {
        fields: [{ name: 'instanceUrl', label: 'Instance URL', type: 'string', required: true }],
      },
      request: {
        apiBasePath: '/api',
        healthCheckPath: '/me',
        auth: { type: 'pat', headerName: 'Authorization', valuePrefix: 'Bearer ' },
      },
    },
    actions: [
      {
        name: 'list_things',
        description: 'Lists things.',
        inputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: [] },
        httpMethods: ['GET'],
      },
      {
        name: 'create_thing',
        description: 'Creates a thing.',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        httpMethods: ['POST'],
        write: true,
      },
    ],
  };
}

export interface ConnectorRepo {
  dir: string;
  /** Reads manifest.json, lets `edit` change it, and writes it back. */
  editManifest: (edit: (manifest: any) => void) => void;
  writeEntry: (source: string) => void;
  readFile: (path: string) => string;
  remove: () => void;
}

export function makeConnectorRepo(): ConnectorRepo {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-connector-repo-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'node_modules', '@3hillsit'), { recursive: true });
  symlinkSync(SDK_ROOT, join(dir, 'node_modules', '@3hillsit', 'atrium-connector-sdk'), 'dir');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'thing-connector', version: '1.2.0', private: true, type: 'module' }, null, 2),
  );
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifestOf(), null, 2));
  writeFileSync(join(dir, 'src', 'index.ts'), ENTRY_SOURCE);

  return {
    dir,
    editManifest(edit) {
      const path = join(dir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(path, 'utf-8'));
      edit(manifest);
      writeFileSync(path, JSON.stringify(manifest, null, 2));
    },
    writeEntry(source) {
      writeFileSync(join(dir, 'src', 'index.ts'), source);
    },
    readFile(path) {
      return readFileSync(join(dir, path), 'utf-8');
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface CommandRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** `bun bin/atrium-connector.ts <args…>` in `cwd`, as a developer runs `bunx atrium-connector`. */
export async function runCommand(cwd: string, ...args: string[]): Promise<CommandRun> {
  const proc = Bun.spawn(['bun', BIN, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
