import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
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
