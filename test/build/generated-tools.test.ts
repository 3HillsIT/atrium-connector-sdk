import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MANIFEST_FILE, PAYLOAD_ENTRY, gunzip, readEnvelope, readSafeEntries } from '../../src/artifact';
import type { PublishedManifest } from '../../src/artifact';
import { checkConnector } from '../../src/build';
import { ENTRY_SOURCE, makeConnectorRepo, runCommand } from '../support/connector-repo';
import type { ConnectorRepo } from '../support/connector-repo';

// A Connector whose Tools are generated per Integration (atrium #12326): one
// discovery Action and template Actions, marked with `kind` in manifest.json.
// The build carries `kind` into the published manifest and stamps
// manifestVersion 4 only then; a template that declares `__atriumBinding` in
// its zod schema and its manifest inputSchema keeps the parity rule.

const GENERATED_ENTRY = `${ENTRY_SOURCE}
export const discover = defineAction({
  id: 'discover',
  description: 'Lists what the system holds, or the Tools for a selection.',
  inputSchema: z.object({ selection: z.record(z.string(), z.unknown()).optional() }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    return { contractVersion: 1, entities: [], warnings: [] };
  },
});

export const readRecord = defineAction({
  id: 'read_record',
  description: 'Reads records of the entity the binding names.',
  inputSchema: z.looseObject({ __atriumBinding: z.record(z.string(), z.unknown()) }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    const { __atriumBinding: binding, ...rest } = input;
    const res = await ctx.request('GET', '/' + String(binding.service));
    return { binding, rest, body: res.body };
  },
});
`;

const DISCOVERY_ACTION = {
  name: 'discover',
  kind: 'discovery',
  description: 'Lists what the system holds, or the Tools for a selection.',
  inputSchema: { type: 'object', properties: { selection: { type: 'object' } }, required: [] },
  httpMethods: ['GET'],
  write: false,
};

const TEMPLATE_ACTION = {
  name: 'read_record',
  kind: 'template',
  description: 'Reads records of the entity the binding names.',
  inputSchema: {
    type: 'object',
    properties: { __atriumBinding: { type: 'object' } },
    required: ['__atriumBinding'],
    additionalProperties: true,
  },
  httpMethods: ['GET'],
  write: false,
};

/**
 * `build` through the command, and the published manifest it wrote. The
 * command, not `buildConnector` in this process: Bun's resolver keeps the
 * first temp repo's SDK link for the life of a process.
 */
async function builtManifest(): Promise<PublishedManifest> {
  const run = await runCommand(repo.dir, 'build');
  if (run.exitCode !== 0) throw new Error(`build exited ${run.exitCode}:\n${run.stderr}`);
  const bytes = new Uint8Array(readFileSync(join(repo.dir, 'dist', 'thing-connector-1.2.0.atrium.tar.gz')));
  const files = readSafeEntries(gunzip(readEnvelope(bytes).payload, PAYLOAD_ENTRY), PAYLOAD_ENTRY);
  return JSON.parse(new TextDecoder().decode(files.get(MANIFEST_FILE)!)) as PublishedManifest;
}

/** The rule names a failed run printed, in order. */
function rulesIn(stderr: string): string[] {
  return [...stderr.matchAll(/^✗ ([a-z-]+): /gm)].map((match) => match[1]!);
}

let repo: ConnectorRepo;
beforeEach(() => {
  repo = makeConnectorRepo();
  repo.writeEntry(GENERATED_ENTRY);
  repo.editManifest((manifest) => {
    manifest.actions.push(structuredClone(DISCOVERY_ACTION), structuredClone(TEMPLATE_ACTION));
  });
});
afterEach(() => repo.remove());

describe('a Connector with a discovery Action and a template', () => {
  test('passes check, a template declaring __atriumBinding included, and is published at manifestVersion 4 with each kind', async () => {
    const check = await runCommand(repo.dir, 'check');
    expect(check.stderr).toBe('');
    expect(check.exitCode).toBe(0);

    const manifest = await builtManifest();
    expect(manifest.manifestVersion).toBe(4);
    expect(manifest.connectorApiVersion).toBe(1);
    expect(manifest.actions.map((action) => [action.name, action.kind])).toEqual([
      ['list_things', undefined],
      ['create_thing', undefined],
      ['discover', 'discovery'],
      ['read_record', 'template'],
    ]);
    expect(manifest.actions.find((action) => action.name === 'read_record')!.inputSchema).toEqual(
      TEMPLATE_ACTION.inputSchema,
    );
  });

  test('the same Connector without kinds is published at manifestVersion 3, as before', async () => {
    repo.editManifest((manifest) => {
      for (const action of manifest.actions) delete action.kind;
    });

    const manifest = await builtManifest();

    expect(manifest.manifestVersion).toBe(3);
    expect(manifest.actions.some((action) => 'kind' in action)).toBe(false);
  });

  test('a template whose manifest inputSchema leaves __atriumBinding out fails parity', async () => {
    repo.editManifest((manifest) => {
      const template = manifest.actions.find((action: { name: string }) => action.name === 'read_record');
      template.inputSchema = { type: 'object', properties: {}, required: [], additionalProperties: true };
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(rulesIn(run.stderr)).toEqual(['parity']);
    expect(run.stderr).toContain('"__atriumBinding" is in the code\'s schema only');
  });
});

describe('check refuses kinds that make no sense, under the rule action-kind', () => {
  test('a second discovery Action, naming both and the guide page', async () => {
    repo.editManifest((manifest) => {
      manifest.actions.find((action: { name: string }) => action.name === 'list_things').kind = 'discovery';
    });

    const run = await runCommand(repo.dir, 'check');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('✗ action-kind: ');
    expect(run.stderr).toContain('thing-connector declares 2 Discovery Actions ("list_things", "discover")');
    expect(run.stderr).toContain('a Connector has at most one');
    expect(run.stderr).toContain('Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/generated-tools.md');
  });

  type ManifestAction = { name: string; kind?: unknown; write?: unknown };
  /** The source manifest's Action named `name`, to edit in place. */
  const named = (actions: ManifestAction[], name: string): ManifestAction =>
    actions.find((action) => action.name === name)!;

  const refused: { name: string; edit: (actions: ManifestAction[]) => void; message: string }[] = [
    {
      name: 'a kind that is neither discovery nor template',
      edit: (actions) => {
        named(actions, 'read_record').kind = 'tool';
      },
      message: 'thing-connector\'s action "read_record" declares the kind "tool"',
    },
    {
      name: 'a kind that is null, not left out',
      edit: (actions) => {
        named(actions, 'read_record').kind = null;
      },
      message: 'thing-connector\'s action "read_record" declares the kind null',
    },
    {
      name: 'a discovery Action that says it writes',
      edit: (actions) => {
        named(actions, 'discover').write = true;
      },
      message: 'thing-connector\'s Discovery Action "discover" declares "write": true',
    },
    {
      name: 'templates without a discovery Action',
      edit: (actions) => {
        delete named(actions, 'discover').kind;
      },
      message: 'thing-connector declares Template Actions ("read_record") but no Discovery Action',
    },
    {
      name: 'a discovery Action without a template',
      edit: (actions) => {
        delete named(actions, 'read_record').kind;
      },
      message: 'thing-connector declares the Discovery Action "discover" but no Template Action',
    },
  ];
  for (const { name, edit, message } of refused) {
    test(name, async () => {
      repo.editManifest((manifest) => edit(manifest.actions));

      const report = await checkConnector(repo.dir);

      expect(report.failures.map((failure) => failure.rule)).toEqual(['action-kind']);
      expect(report.failures[0]!.message).toContain(message);
    });
  }
});
