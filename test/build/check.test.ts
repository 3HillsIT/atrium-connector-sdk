import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ENTRY_SOURCE, makeConnectorRepo, runCommand } from '../support/connector-repo';
import type { ConnectorRepo } from '../support/connector-repo';

// `atrium-connector check`, driven through the command on a Connector repo in
// a temp folder: what a developer sees, its exit code, and what it leaves.

let repo: ConnectorRepo;
beforeEach(() => {
  repo = makeConnectorRepo();
});
afterEach(() => repo.remove());

/** The rule names a failed run printed, in order: each failure starts a line `<rule>: `. */
function rulesIn(stderr: string): string[] {
  return [...stderr.matchAll(/^✗ ([a-z-]+): /gm)].map((match) => match[1]!);
}

describe('check on a Connector that keeps the rules', () => {
  test('passes, prints the Bundle Contract line, and writes and signs nothing', async () => {
    const run = await runCommand(repo.dir, 'check');

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('Bundle Contract v1: accepted by every atrium Release.');
    expect(run.stdout).toContain('check passed: thing-connector 1.2.0, 2 actions. Nothing was written or signed.');
    expect(existsSync(join(repo.dir, 'dist'))).toBe(false);
    expect(existsSync(join(repo.dir, 'atrium-builds.json'))).toBe(false);
  });

  test('takes "write": false as the author\'s word that an Action sending POST only reads', async () => {
    repo.editManifest((manifest) => {
      manifest.actions[0].httpMethods = ['POST'];
      manifest.actions[0].write = false;
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
  });

  test('counts a property a call may leave out as optional: .optional(), .default(), a transform after .optional()', async () => {
    repo.writeEntry(
      ENTRY_SOURCE.replace(
        "inputSchema: z.object({ status: z.string().optional() }),",
        "inputSchema: z.object({ status: z.string().default('open'), tag: z.string().optional().transform((t) => t?.trim()) }),",
      ),
    );
    repo.editManifest((manifest) => {
      manifest.actions[0].inputSchema.properties.tag = { type: 'string' };
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.stderr).toBe('');
    expect(run.exitCode).toBe(0);
  });
});

describe('check fails, naming the rule and its guide page', () => {
  test('a write Action whose manifest entry lost "write": true', async () => {
    repo.editManifest((manifest) => {
      delete manifest.actions[1].write;
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['write-flag']);
    expect(run.stderr).toContain('The action "create_thing" sends POST');
    expect(run.stderr).toContain('"write": true');
    expect(run.stderr).toContain('Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/rules.md');
    expect(run.stderr).toContain('check failed: 1 problem. Nothing was written or signed.');
  });

  test('the write flag judged from the code\'s httpMethods when the manifest declares none', async () => {
    repo.editManifest((manifest) => {
      delete manifest.actions[1].write;
      delete manifest.actions[1].httpMethods;
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['write-flag']);
    expect(run.stderr).toContain('The action "create_thing" sends POST');
  });

  test('an Action declaring no httpMethods anywhere and no "write": unknown counts as a write', async () => {
    repo.editManifest((manifest) => {
      delete manifest.actions[0].httpMethods;
    });
    repo.writeEntry(ENTRY_SOURCE.replace("  httpMethods: ['GET'],\n", ''));

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['write-flag']);
    expect(run.stderr).toContain('The action "list_things" declares no httpMethods and no "write"');
    expect(run.stderr).toContain('Declare its httpMethods');

    // "write": false is the author's word that it only reads, as for a POST.
    repo.editManifest((manifest) => {
      manifest.actions[0].write = false;
    });
    const declared = await runCommand(repo.dir, 'check');
    expect(declared.stderr).toBe('');
    expect(declared.exitCode).toBe(0);
  });

  test('an Action sending HEAD and no "write": the broker sends only GET as a read', async () => {
    repo.editManifest((manifest) => {
      manifest.actions[0].httpMethods = ['HEAD'];
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['write-flag']);
    expect(run.stderr).toContain('The action "list_things" sends HEAD');
  });

  test('a parity break: another description in the manifest than in the code', async () => {
    repo.editManifest((manifest) => {
      manifest.actions[0].description = 'Lists every thing there is.';
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['parity']);
    expect(run.stderr).toContain('The action "list_things" has one description in manifest.json and another in the code');
    expect(run.stderr).toContain('docs/rules.md');
  });

  test('a parity break: an input schema whose properties and required list differ from the zod one', async () => {
    repo.editManifest((manifest) => {
      manifest.actions[1].inputSchema = {
        type: 'object',
        properties: { title: { type: 'string' }, name: { type: 'string' } },
        required: [],
      };
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['parity']);
    expect(run.stderr).toContain('"title" is in manifest.json\'s schema only');
    expect(run.stderr).toContain('"name" is required in the code but not in manifest.json');
  });

  test('a parity break: an Action the code exports and the manifest does not declare', async () => {
    repo.writeEntry(
      ENTRY_SOURCE +
        `
export const archiveThing = defineAction({
  id: 'archive_thing',
  description: 'Archives a thing.',
  inputSchema: z.object({ id: z.string() }),
  async handler(ctx, input) {
    return (await ctx.request('POST', '/things/' + input.id + '/archive')).body;
  },
});
`,
    );

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['parity']);
    expect(run.stderr).toContain('src/index.ts exports the action "archive_thing", which manifest.json doesn\'t declare');
  });

  test('a missing export: an Action the manifest declares and the entry module does not export', async () => {
    repo.editManifest((manifest) => {
      manifest.actions.push({
        name: 'delete_thing',
        description: 'Deletes a thing.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        httpMethods: ['DELETE'],
        write: true,
      });
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    // Reported once, as the rule it breaks, not again as the bundle it can't make.
    expect(rulesIn(run.stderr)).toEqual(['exports-and-names']);
    expect(run.stderr).toContain('manifest.json declares the action "delete_thing", but src/index.ts exports no action');
    expect(run.stderr).toContain('docs/rules.md');
  });

  test('every failure at once, each with its own guide line', async () => {
    repo.editManifest((manifest) => {
      delete manifest.actions[1].write;
      manifest.actions[0].description = 'Something else.';
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr).sort()).toEqual(['parity', 'write-flag']);
    expect(run.stderr.match(/Guide: /g)).toHaveLength(2);
    expect(run.stderr).toContain('check failed: 2 problems.');
  });

  test('an entry module that throws when it loads', async () => {
    repo.writeEntry(ENTRY_SOURCE + "\nif (!process.env.THING_TOKEN) throw new Error('THING_TOKEN is not set');\n");

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['loads-cleanly']);
    expect(run.stderr).toContain('THING_TOKEN is not set');
  });

  test('a bundle whose own top-level names collide with what atrium splices onto it', async () => {
    // Fine on its own, so the entry module loads; atrium declares `handler`
    // beside the bundle when it loads an Action, and the two can't coexist.
    repo.writeEntry(
      ENTRY_SOURCE.replace(
        "export const listThings",
        'function handler(input: unknown) {\n  return input;\n}\nexport const echo = handler;\n\nexport const listThings',
      ),
    );

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['bundle-contract', 'bundle-contract']);
    expect(run.stderr).toContain(
      'The bundle for action "list_things" loads on its own but not with what atrium declares beside it',
    );
    expect(run.stderr).toContain('__atriumConnectorCtx, handler');
    expect(run.stderr).toContain('docs/troubleshooting.md');
  });

  test('an entry module the bundler cannot build, naming what it could not resolve', async () => {
    repo.writeEntry("import 'not-installed-anywhere';\n" + ENTRY_SOURCE);

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['bundles']);
    expect(run.stderr).toContain('not-installed-anywhere');
    expect(run.stderr).toContain('docs/troubleshooting.md');
  });

  test('a manifest version package.json disagrees with', async () => {
    repo.editManifest((manifest) => {
      manifest.version = '1.3.0';
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['versions']);
    expect(run.stderr).toContain('declares version 1.3.0 but its package.json declares 1.2.0');
    expect(run.stderr).toContain('docs/versions.md');
  });

  test('a connection block Add would refuse, naming the field', async () => {
    repo.editManifest((manifest) => {
      manifest.connection.request.auth = { type: 'pat' };
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['connection']);
    expect(run.stderr).toContain('headerName');
    expect(run.stderr).toContain('docs/manifest.md');
  });

  test('an installed SDK that throws when it loads, naming the install page', async () => {
    const sdk = join(repo.dir, 'node_modules', '@3hillsit', 'atrium-connector-sdk');
    rmSync(sdk);
    mkdirSync(sdk);
    writeFileSync(
      join(sdk, 'package.json'),
      JSON.stringify({ name: '@3hillsit/atrium-connector-sdk', type: 'module', exports: { '.': './index.ts' } }),
    );
    writeFileSync(join(sdk, 'index.ts'), "throw new Error('half installed');\n");

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['sdk-installed']);
    expect(run.stderr).toContain('throws when it is loaded: half installed');
    expect(run.stderr).toContain('docs/build-and-sign.md');
  });

  test('a folder that is not a Connector repo', async () => {
    const run = await runCommand(join(repo.dir, 'src'), 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['connector-package']);
    expect(run.stderr).toContain('it has no package.json and no manifest.json');
  });
});

describe('the command line', () => {
  test('an unknown command is a usage error listing the commands', async () => {
    const run = await runCommand(repo.dir, 'publish');

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('atrium-connector has no command "publish"');
    expect(run.stderr).toContain('check');
    expect(run.stderr).toContain('build [--try]');
  });

  test('an unknown option is a usage error, never ignored', async () => {
    const run = await runCommand(repo.dir, 'check', '--sign');

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('usage: atrium-connector check');
  });

  test('--help lists the commands on stdout', async () => {
    const run = await runCommand(repo.dir, '--help');

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain('usage: atrium-connector <command>');
  });
});
