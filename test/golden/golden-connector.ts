// The small Connector the golden Artifact in golden/atrium-made/ was built
// from: record-from-atrium.ts hands it to atrium's publish, and
// test/build/golden-build.test.ts hands it to this SDK's build, which must
// make the same payload.
//
// Its SDK is a stub under the SDK's old name, @atrium/connector-sdk, holding
// only what a build reads off the SDK and the identity helper the entry uses:
// a real SDK would inline zod into every bundle, and the golden file is about
// the format, not about zod.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Writes the golden Connector into `dir` (made if missing), without git. */
export function writeGoldenConnector(dir: string): void {
  const sdk = join(dir, 'node_modules', '@atrium', 'connector-sdk');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(sdk, { recursive: true });
  writeFileSync(
    join(sdk, 'package.json'),
    JSON.stringify({ name: '@atrium/connector-sdk', version: '0.0.0-golden', type: 'module', exports: { '.': { default: './index.ts' } } }),
  );
  writeFileSync(join(sdk, 'index.ts'), 'export const CURRENT_CONNECTOR_API_VERSION = 1;\nexport const defineAction = (action) => action;\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'atrium-connector-golden', version: '1.0.0', private: true, type: 'module' }),
  );
  writeFileSync(
    join(dir, 'src', 'index.ts'),
    [
      "import { defineAction } from '@atrium/connector-sdk';",
      '',
      'export const listThings = defineAction({',
      "  id: 'list_things',",
      '  inputSchema: { parse: (input) => input ?? {} },',
      '  async handler(ctx, input) {',
      "    const res = await ctx.request('GET', '/things', { query: input });",
      '    return res.body;',
      '  },',
      '});',
      '',
      'export const createThing = defineAction({',
      "  id: 'create_thing',",
      '  inputSchema: {',
      '    parse(input) {',
      "      if (typeof input?.name !== 'string') throw new Error('name is required');",
      '      return { name: input.name };',
      '    },',
      '  },',
      '  async handler(ctx, input) {',
      "    const res = await ctx.request('POST', '/things', { body: { name: input.name } });",
      '    return res.body;',
      '  },',
      '});',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        id: 'golden-connector',
        displayName: 'Golden Connector',
        version: '1.0.0',
        entry: 'src/index.ts',
        connection: {
          configSchema: {
            fields: [
              { name: 'instanceUrl', label: 'Instance URL', type: 'string', required: true },
              { name: 'authMethod', label: 'Auth method', type: 'string', required: false, default: 'token' },
            ],
          },
          request: {
            apiBasePath: '/services/rest',
            healthCheckPath: '/me',
            auth: { type: 'multi-header', secretHeader: 'tokenId', staticHeadersFromConfig: { authMethod: 'authMethod' } },
          },
        },
        actions: [
          {
            name: 'list_things',
            description: 'Lists things.',
            inputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: [] },
            httpMethods: ['GET'],
            group: 'Things',
          },
          {
            name: 'create_thing',
            description: 'Creates a thing.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
            httpMethods: ['POST'],
            write: true,
            group: 'Things',
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
}
