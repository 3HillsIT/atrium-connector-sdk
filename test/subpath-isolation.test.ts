import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The handover requires the "/client" subpath export to be genuinely
// decoupled from the connector-authoring layer — checked against the actual
// bundled output/imports, not assumed from source layout. bun build resolves
// and inlines every import reachable from src/client.ts; if that output ever
// contains Zod or anything from connector.ts, the two layers have become
// coupled and the main app's future harness import would drag in machinery
// it doesn't need.

describe('the /client subpath is standalone', () => {
  test('src/client.ts has no static import of zod or connector.ts', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'client.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]zod['"]/);
    expect(source).not.toMatch(/from ['"]\.\/(connector|index)['"]/);
  });

  test('bundling src/client.ts alone produces output with no trace of zod or connector.ts', async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, '..', 'src', 'client.ts')],
      target: 'bun',
    });
    expect(result.success).toBe(true);
    const bundled = await Promise.all(result.outputs.map((o) => o.text()));
    const combined = bundled.join('\n');
    expect(combined).not.toContain('defineConnector');
    expect(combined).not.toContain('defineAction');
    expect(combined.toLowerCase()).not.toContain('zod');
  });

  test('src/client.ts imports cleanly on its own with zero other SDK modules loaded', async () => {
    const mod = await import('../src/client');
    expect(typeof mod.createAtriumClient).toBe('function');
  });
});

// The "/artifact" subpath is the format atrium compiles into its Instance and
// its CLI. It must stay pure: nothing from the build (bundling, the published
// manifest's generation), never `Bun.build`, and nothing from the authoring
// layer. atrium keeps `Bun.build` out of its backend with a guard of its own;
// this is the half of that guarantee the SDK owns (ADR-0007, Amendment from
// #11226).

const ARTIFACT_DIR = join(import.meta.dir, '..', 'src', 'artifact');

function artifactFiles(): string[] {
  return readdirSync(ARTIFACT_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

/** The file's code with its comments removed: the prose names `Bun.build` and `./build`. */
function codeOf(file: string): string {
  return readFileSync(join(ARTIFACT_DIR, file), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
}

function importsOf(file: string): string[] {
  const code = codeOf(file);
  const specifiers: string[] = [];
  for (const match of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1]!);
  for (const match of code.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1]!);
  for (const match of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]!);
  for (const match of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

const NODE_BUILTINS = new Set(['zlib', 'fs', 'path', 'os', 'crypto', 'buffer', 'util', 'stream', 'url']);

describe('the /artifact subpath is pure', () => {
  test('has files to check', () => {
    expect(artifactFiles()).toContain('index.ts');
  });

  test('imports nothing but its own siblings and node builtins: no ./build, no authoring layer, no zod', () => {
    const offenders: string[] = [];
    for (const file of artifactFiles()) {
      for (const specifier of importsOf(file)) {
        // The `__atriumRun` wrapper is import statements as TEXT, with the
        // entry module's path interpolated; that is not an import of this module.
        if (file === 'wrapper.ts' && specifier === '${params.entryImportPath}') continue;
        if (specifier.startsWith('./') && !specifier.includes('..')) continue;
        if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) continue;
        offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('never calls Bun.build', () => {
    const offenders = artifactFiles().filter((file) => /\bBun\s*\.\s*build\b/.test(codeOf(file)));
    expect(offenders).toEqual([]);
  });

  test('bundling src/artifact/index.ts alone produces output with no bundler call, no zod and no authoring layer', async () => {
    const result = await Bun.build({
      entrypoints: [join(ARTIFACT_DIR, 'index.ts')],
      target: 'bun',
    });
    expect(result.success).toBe(true);
    const combined = (await Promise.all(result.outputs.map((o) => o.text()))).join('\n');
    expect(combined).not.toMatch(/\bBun\s*\.\s*build\s*\(/);
    expect(combined).not.toContain('defineConnector');
    expect(combined).not.toContain('createAtriumClient');
    expect(combined.toLowerCase()).not.toContain('zod');
    // It is the format: the opener is in it.
    expect(combined).toContain('openArtifact');
  });

  test('src/artifact/index.ts imports cleanly on its own', async () => {
    const mod = await import('../src/artifact');
    expect(typeof mod.openArtifact).toBe('function');
    expect(typeof mod.writeEnvelope).toBe('function');
    expect(typeof mod.verifySignatures).toBe('function');
  });
});

// The "/build" subpath and the `atrium-connector` command are the build's
// side: they may use `./artifact` (the tests above hold that nothing goes the
// other way).

describe('the /build subpath and the command', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')) as {
    exports: Record<string, { default: string }>;
    bin: Record<string, string>;
    files: string[];
  };

  test('are exported and shipped', () => {
    expect(pkg.exports['./build']?.default).toBe('./src/build/index.ts');
    expect(pkg.bin['atrium-connector']).toBe('bin/atrium-connector.ts');
    expect(pkg.files).toContain('bin');
  });

  test('src/build/index.ts imports cleanly', async () => {
    const mod = await import('../src/build');
    expect(typeof mod.buildConnector).toBe('function');
    expect(typeof mod.checkConnector).toBe('function');
  });
});
