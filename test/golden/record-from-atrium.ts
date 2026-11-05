// Records the golden files test/artifact/golden.test.ts reads, from an atrium
// checkout. Not a test: run by hand, and only when the golden files have to be
// made again (they are committed; a rerun makes new keys and new bytes).
//
//   bun test/golden/record-from-atrium.ts <atrium checkout>
//
// It does two things with that checkout's own code, and changes nothing in it:
//
//   1. Runs atrium's publish (`publishConnector`, test mode) on a small
//      Connector it writes into a temp folder, signing with two fixture keys
//      it generates here, and keeps the Artifact: golden/atrium-made/.
//   2. Writes an Artifact with THIS SDK's `writeEnvelope`, dual-signed with
//      two more fixture keys: golden/sdk-made/.
//
// Then it opens both with atrium's `openArtifact` under several rings and
// writes what atrium answered next to each Artifact (atrium-view.json). The
// rings' public halves go to golden/ring.json. Every private half lives only
// in this run's memory and temp folder, which is deleted.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { writeEnvelope } from '../../src/artifact';
import type { PublishedManifest, RingKey, SignerKey } from '../../src/artifact';

const atriumDir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: bun test/golden/record-from-atrium.ts <atrium checkout>');

const backend = join(atriumDir, 'backend');
const publishing = await import(join(backend, 'src/connector-artifact/publishing.ts'));
const install = await import(join(backend, 'src/connector-artifact/index.ts'));
const publishScript = await import(join(backend, 'scripts/publish-connector.ts'));

const goldenDir = import.meta.dir;
const work = mkdtempSync(join(tmpdir(), 'atrium-golden-'));

function git(repo: string, ...args: string[]): string {
  const proc = Bun.spawnSync(
    ['git', '-c', 'user.name=Golden', '-c', 'user.email=golden@example.test', '-c', 'commit.gpgsign=false',
      '-c', 'init.defaultBranch=main', ...args],
    { cwd: repo, stdout: 'pipe', stderr: 'pipe' },
  );
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${proc.stderr.toString()}`);
  return proc.stdout.toString().trim();
}

interface GoldenKey {
  name: string;
  ringKey: RingKey;
  signer: SignerKey;
  path: string;
}

const keyDir = join(work, 'keys');
mkdirSync(keyDir);

/** A fixture key from atrium's own generator, written as the key file atrium's publish reads. */
async function goldenKey(name: string): Promise<GoldenKey> {
  const generated = await publishing.generateSigningKey();
  const path = join(keyDir, `${generated.keyId}.json`);
  writeFileSync(path, JSON.stringify(generated));
  chmodSync(path, 0o600);
  return {
    name,
    path,
    ringKey: {
      keyId: generated.keyId,
      alg: 'ecdsa-p256-sha256',
      publicKey: generated.publicKey,
      comment: `${name} — golden fixture key, private half discarded`,
    },
    signer: { keyId: generated.keyId, privateKey: await publishing.importPrivateKey(generated.privateKey) },
  };
}

// --- 1. an Artifact made by atrium's publish ------------------------------

function writeConnector(): string {
  const dir = join(work, 'golden-connector');
  const sdk = join(dir, 'node_modules', '@atrium', 'connector-sdk');
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(sdk, { recursive: true });
  writeFileSync(
    join(sdk, 'package.json'),
    JSON.stringify({ name: '@atrium/connector-sdk', version: '0.0.0-golden', type: 'module', exports: { '.': { default: './index.ts' } } }),
  );
  // Only what publish reads off the SDK, and the identity helper the entry uses:
  // a real SDK would inline zod into every bundle, and the golden file is
  // about the format, not about zod.
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
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'golden connector');
  return dir;
}

const testingA = await goldenKey('golden-a');
const testingB = await goldenKey('golden-b');
const release = await goldenKey('golden-release');

const connectorDir = writeConnector();
const outDir = join(work, 'dist');
const published = await publishScript.publishConnector({
  mode: 'test',
  connectorDir,
  atriumDir,
  outDir,
  signingKeyPaths: `${testingA.path},${testingB.path}`,
  rings: { release: [release.ringKey], testing: [testingA.ringKey, testingB.ringKey] },
  installDependencies: false,
  log: (line: string) => console.log(`  publish: ${line}`),
});
const atriumBytes = new Uint8Array(readFileSync(published.filePath));

// --- 2. an Artifact written by this SDK ------------------------------------

const sdkC = await goldenKey('golden-c');
const sdkD = await goldenKey('golden-d');

const sdkManifest: PublishedManifest = {
  manifestVersion: 3,
  id: 'golden-sdk',
  displayName: 'Golden SDK Connector',
  version: '2.1.0-try.3',
  connectorApiVersion: 1,
  actions: [
    {
      name: 'list_projects',
      description: 'Lists projects.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      bundle: 'actions/list_projects.js',
      httpMethods: ['GET'],
      group: 'Projects',
    },
    {
      name: 'update_project',
      description: 'Updates a project.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      bundle: 'actions/update_project.js',
      httpMethods: ['PATCH'],
      write: true,
    },
  ],
  publishedWith: { bun: Bun.version },
  connection: {
    configSchema: { fields: [{ name: 'organization', label: 'Organization', type: 'string', required: true }] },
    request: {
      apiBasePath: 'https://dev.example.test/{organization}',
      healthCheckPath: '/_apis/projects',
      auth: { type: 'oauth2', scope: 'api://golden/.default' },
    },
  },
  code: 'GS',
};
const bundle = (name: string, method: string) =>
  new TextEncoder().encode(
    `// golden bundle for ${name}\nexport async function __atriumRun(ctx, input) {\n  return await ctx.request('${method}', '/${name}', { body: input });\n}\n`,
  );
const sdkWritten = await writeEnvelope({
  manifest: sdkManifest,
  files: new Map([
    ['actions/list_projects.js', bundle('list_projects', 'GET')],
    ['actions/update_project.js', bundle('update_project', 'PATCH')],
  ]),
  signers: [sdkC.signer, sdkD.signer],
  publishedAt: '2026-11-05T12:00:00.000Z',
});

// --- what atrium makes of each ---------------------------------------------

async function sha256(data: Uint8Array): Promise<string> {
  return publishing.sha256Hex(data);
}

/** atrium's openArtifact under `ring`, as plain JSON: what it returned, or how it refused. */
async function atriumOpens(bytes: Uint8Array, ring: GoldenKey[]): Promise<unknown> {
  const ringKeys = ring.map((key) => key.ringKey);
  try {
    const opened = await install.openArtifact(bytes, ringKeys);
    const files: Record<string, string> = {};
    for (const [path, data] of [...opened.files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      files[path] = await sha256(data);
    }
    return {
      ring: ring.map((key) => key.name),
      opened: {
        keyId: opened.keyId,
        publishedAt: opened.publishedAt,
        payloadSha256: opened.payloadSha256,
        manifest: opened.manifest,
        listing: opened.listing,
        files,
      },
    };
  } catch (err) {
    const error = err as { code?: string; message: string; details?: Record<string, string> };
    if (!error.code) throw err;
    return { ring: ring.map((key) => key.name), refused: { code: error.code, message: error.message, details: error.details } };
  }
}

async function atriumView(bytes: Uint8Array, signers: GoldenKey[], stranger: GoldenKey) {
  const parts = install.readEnvelope(bytes);
  return {
    recordedWith: {
      atriumCommit: git(atriumDir, 'rev-parse', 'HEAD'),
      bun: Bun.version,
      recordedAt: new Date().toISOString(),
    },
    artifactSha256: await sha256(bytes),
    envelope: { payloadSha256: await sha256(parts.payload), signatureSha256: await sha256(parts.signature) },
    signedBy: signers.map((key) => key.name),
    opens: [
      await atriumOpens(bytes, signers),
      await atriumOpens(bytes, [...signers].reverse()),
      await atriumOpens(bytes, [signers[1]!]),
      await atriumOpens(bytes, [stranger, signers[1]!]),
      await atriumOpens(bytes, [stranger]),
      await atriumOpens(bytes, []),
    ],
  };
}

function writeGolden(folder: string, fileName: string, bytes: Uint8Array, view: unknown): void {
  const dir = join(goldenDir, folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), bytes);
  writeFileSync(join(dir, 'atrium-view.json'), JSON.stringify(view, null, 2) + '\n');
}

writeGolden('atrium-made', published.fileName, atriumBytes, await atriumView(atriumBytes, [testingA, testingB], release));
writeGolden('sdk-made', sdkWritten.fileName, sdkWritten.bytes, await atriumView(sdkWritten.bytes, [sdkC, sdkD], release));
writeFileSync(
  join(goldenDir, 'ring.json'),
  JSON.stringify(
    { keys: Object.fromEntries([testingA, testingB, release, sdkC, sdkD].map((key) => [key.name, key.ringKey])) },
    null,
    2,
  ) + '\n',
);

rmSync(work, { recursive: true, force: true });
console.log(`Recorded ${published.fileName} (atrium-made) and ${sdkWritten.fileName} (sdk-made) into ${goldenDir}.`);
