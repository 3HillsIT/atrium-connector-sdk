import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  ACTION_KIND_MANIFEST_VERSION,
  ADDABLE_MANIFEST_VERSIONS,
  ConnectorArtifactError,
  FIXTURE_DISCOVERY_ENTITIES,
  FIXTURE_TOOL_DEFINITIONS,
  PUBLISHED_MANIFEST_VERSION,
  READABLE_MANIFEST_VERSIONS,
  buildArtifactFixture,
  checkAddable,
  fixtureDiscoveryBundle,
  fixtureTemplateBundle,
  manifestVersionFor,
  openArtifact,
  parsePublishedManifest,
  utf8,
} from '../../src/artifact';
import type { AtriumClient } from '../../src/client';
import type { PublishedManifest } from '../../src/artifact';

// Action kinds (atrium #12326): a discovery Action and template Actions, for a
// Connector whose Tools are generated per Workspace. The published manifest
// carries them only at manifestVersion 4, which atrium from 5.2.0 Adds and an
// older one refuses; the fixtures build such a Connector for atrium's tests,
// with bundles that answer the discovery contract and echo what a template got.

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorArtifactError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the artifact to be refused, but it was accepted');
}

/** The fixture manifest with `edit` applied to the action named `name`. */
function editAction(name: string, edit: (action: Record<string, unknown>) => void) {
  return (manifest: PublishedManifest): PublishedManifest => ({
    ...manifest,
    actions: manifest.actions.map((action) => {
      if (action.name !== name) return action;
      const copy = { ...action } as Record<string, unknown>;
      edit(copy);
      return copy as unknown as typeof action;
    }),
  });
}

describe('the manifest versions', () => {
  test('4 is Added and read; 3 stays what a Connector without kinds is published at', () => {
    expect(ACTION_KIND_MANIFEST_VERSION).toBe(4);
    expect([...ADDABLE_MANIFEST_VERSIONS]).toEqual([3, 4]);
    expect([...READABLE_MANIFEST_VERSIONS]).toEqual([2, 3, 4]);
    expect(PUBLISHED_MANIFEST_VERSION).toBe(3);
    expect(manifestVersionFor([{}, {}])).toBe(3);
    expect(manifestVersionFor([{}, { kind: 'template' }])).toBe(4);
  });

  test('5 is refused as too new: update the Instance', async () => {
    const fixture = await buildArtifactFixture({ discovery: {}, manifestVersion: 5 });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-too-new');
    expect(error.message).toContain('manifestVersion 3–4');
  });
});

describe('a fixture Connector whose Tools are generated', () => {
  test('carries a discovery Action and the default templates at manifestVersion 4, and opens', async () => {
    const fixture = await buildArtifactFixture({ discovery: {} });

    const opened = await openArtifact(fixture.bytes, fixture.ring);

    expect(opened.manifest.manifestVersion).toBe(4);
    expect(opened.manifest.connection).toBeDefined();
    expect(opened.manifest.actions.map((a) => [a.name, a.kind, a.write === true])).toEqual([
      ['discover', 'discovery', false],
      ['read_record', 'template', false],
      ['write_record', 'template', true],
    ]);
    const template = opened.manifest.actions.find((a) => a.name === 'read_record')!;
    expect(Object.keys(template.inputSchema.properties as object)).toEqual(['__atriumBinding']);
    expect(opened.files.get('actions/discover.js')).toEqual(fixtureDiscoveryBundle({}));
    expect(opened.files.get('actions/write_record.js')).toEqual(
      fixtureTemplateBundle({ name: 'write_record', write: true }),
    );
  });

  test('ordinary Actions, a named discovery and named templates sit side by side, in that order', async () => {
    const fixture = await buildArtifactFixture({
      actions: ['ping'],
      discovery: { name: 'discover_entities' },
      templates: ['read_entity', { name: 'delete_entity', write: true }],
    });

    expect(fixture.manifest.manifestVersion).toBe(4);
    expect(fixture.manifest.actions.map((a) => [a.name, a.kind])).toEqual([
      ['ping', undefined],
      ['discover_entities', 'discovery'],
      ['read_entity', 'template'],
      ['delete_entity', 'template'],
    ]);
    await openArtifact(fixture.bytes, fixture.ring);
  });

  test('without discovery or templates, the fixture is the version-3 one it always was', async () => {
    const fixture = await buildArtifactFixture();
    expect(fixture.manifest.manifestVersion).toBe(3);
    expect(fixture.manifest.actions.map((a) => [a.name, a.kind])).toEqual([['list_things', undefined]]);
  });
});

describe('the reader refuses a kind it cannot take', () => {
  test('a kind at manifestVersion 3, which an older atrium would offer as a Tool', async () => {
    const fixture = await buildArtifactFixture({ discovery: {}, manifestVersion: 3 });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.details).toMatchObject({ action: 'discover', field: 'kind', manifestVersion: '3' });
    expect(error.message).toContain('only manifestVersion 4 and later may declare');
  });

  test('a kind that is neither discovery nor template', async () => {
    const fixture = await buildArtifactFixture({
      discovery: {},
      manifest: editAction('read_record', (action) => {
        action.kind = 'tool';
      }),
    });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.details).toMatchObject({ action: 'read_record', field: 'kind' });
    expect(error.message).toContain('"discovery" or "template"');
  });

  test('a second discovery Action', async () => {
    const fixture = await buildArtifactFixture({
      discovery: {},
      manifest: editAction('read_record', (action) => {
        action.kind = 'discovery';
      }),
    });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.message).toContain('two discovery actions, "discover" and "read_record"');
  });

  test('a discovery Action that says it writes', async () => {
    const fixture = await buildArtifactFixture({
      discovery: {},
      manifest: editAction('discover', (action) => {
        action.write = true;
      }),
    });
    const error = await refusalOf(openArtifact(fixture.bytes, fixture.ring));
    expect(error.code).toBe('manifest-invalid');
    expect(error.details).toMatchObject({ action: 'discover', field: 'write' });
  });

  test('a held version is held to the same rules, and a valid one is read and Addable', async () => {
    const fixture = await buildArtifactFixture({ discovery: {} });
    const bytes = utf8(JSON.stringify(fixture.manifest));
    const held = parsePublishedManifest(bytes, 'held');
    expect(held.actions.map((a) => a.kind)).toEqual(['discovery', 'template', 'template']);
    expect(() => checkAddable(held)).not.toThrow();

    const lying = utf8(JSON.stringify({ ...fixture.manifest, manifestVersion: 3 }));
    expect(() => parsePublishedManifest(lying, 'held')).toThrow('only manifestVersion 4 and later');
  });
});

// The bundles, run as atrium's executor runs one: imported, then
// `__atriumRun(ctx, input)` called.

// A folder per bundle: Bun's resolver keeps a folder's listing once it has
// imported from it, so a second file in the same folder isn't found.
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

async function run(bundle: Uint8Array, input: unknown, ctx: AtriumClient = refusingCtx()): Promise<any> {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-kind-bundle-'));
  scratch.push(dir);
  const path = join(dir, 'bundle.js');
  writeFileSync(path, bundle);
  const module = (await import(pathToFileURL(path).href)) as {
    __atriumRun: (ctx: AtriumClient, input: unknown) => Promise<unknown>;
  };
  return module.__atriumRun(ctx, input);
}

/** A ctx for a bundle that must not call the system. */
function refusingCtx(): AtriumClient {
  return {
    async request() {
      throw new Error('this bundle should not call the system');
    },
  };
}

/** A ctx that records each call and answers with `status` and `body`. */
function recordingCtx(status: number, body: unknown = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const ctx: AtriumClient = {
    async request(method, path, opts) {
      calls.push({ method, path, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
      return { status, headers: {}, body };
    },
  };
  return { ctx, calls };
}

describe('the fixture discovery bundle answers the discovery contract', () => {
  test('{} gives the catalog', async () => {
    expect(await run(fixtureDiscoveryBundle(), {})).toEqual({
      contractVersion: 1,
      entities: [...FIXTURE_DISCOVERY_ENTITIES],
      warnings: [],
    });
  });

  test('a selection gives its Tool definitions, the hints worked in, and skips an unknown entity with a warning', async () => {
    const answer = await run(fixtureDiscoveryBundle(), {
      selection: {
        person: { operations: ['write', 'read'], hints: 'Only staff.' },
        ticket: { operations: ['read'] },
      },
    });

    const [readPerson, writePerson] = FIXTURE_TOOL_DEFINITIONS;
    expect(answer).toEqual({
      contractVersion: 1,
      tools: [
        { ...readPerson, description: 'Reads persons.\n\nOnly staff.' },
        { ...writePerson, description: 'Creates or changes a person.\n\nOnly staff.' },
      ],
      warnings: ['The system has no entity "ticket"; it was skipped.'],
    });
  });

  test('takes the catalog, the definitions, the warnings and the contract version it is given', async () => {
    const bundle = fixtureDiscoveryBundle({
      entities: [{ name: 'order', label: 'Order', source: 'custom', defaultEnabled: false, operations: [] }],
      tools: [{ name: 'Bad Name!', entity: 'order', operation: 'read' }],
      warnings: ['Two entities have no webservice.'],
      contractVersion: 2,
    });

    expect(await run(bundle, {})).toMatchObject({ contractVersion: 2, warnings: ['Two entities have no webservice.'] });
    expect(await run(bundle, { selection: { order: { operations: ['read'] } } })).toEqual({
      contractVersion: 2,
      tools: [{ name: 'Bad Name!', entity: 'order', operation: 'read' }],
      warnings: ['Two entities have no webservice.'],
    });
    // As the answer leaves the executor: JSON.
    const unversioned = JSON.parse(JSON.stringify(await run(fixtureDiscoveryBundle({ contractVersion: undefined }), {})));
    expect(unversioned).not.toHaveProperty('contractVersion');
  });

  test("throws the Connector's own message when told to", async () => {
    await expect(run(fixtureDiscoveryBundle({ error: 'The system is too old for this Connector.' }), {})).rejects.toThrow(
      'The system is too old for this Connector.',
    );
  });

  test('with request, asks the system first and refuses a non-2xx answer', async () => {
    const ok = recordingCtx(200);
    await run(fixtureDiscoveryBundle({ name: 'discover', request: true }), {}, ok.ctx);
    expect(ok.calls).toEqual([{ method: 'GET', path: '/discover' }]);

    const denied = recordingCtx(403);
    await expect(run(fixtureDiscoveryBundle({ request: true }), {}, denied.ctx)).rejects.toThrow(
      'The system answered 403 to discovery.',
    );
  });
});

describe('the fixture template bundle echoes what it got', () => {
  test('the binding apart from the rest of the input', async () => {
    expect(await run(fixtureTemplateBundle('read_record'), { filter: 'Ann', __atriumBinding: { service: 'persons' } })).toEqual({
      template: 'read_record',
      binding: { service: 'persons' },
      input: { filter: 'Ann' },
    });
    expect(await run(fixtureTemplateBundle('read_record'), { filter: 'Ann' })).toEqual({
      template: 'read_record',
      binding: null,
      input: { filter: 'Ann' },
    });
  });

  test('with request, a write sends the echo on and returns the answer', async () => {
    const { ctx, calls } = recordingCtx(201, { id: 7 });
    const input = { fields: { name: 'Ann' }, __atriumBinding: { service: 'persons' } };

    const answer = await run(fixtureTemplateBundle({ name: 'write_record', write: true, request: true }), input, ctx);

    const echo = { template: 'write_record', binding: { service: 'persons' }, input: { fields: { name: 'Ann' } } };
    expect(calls).toEqual([{ method: 'POST', path: '/write_record', body: echo }]);
    expect(answer).toEqual({ ...echo, response: { id: 7 } });
  });
});
