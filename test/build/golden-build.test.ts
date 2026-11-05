import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openArtifact, writeEnvelope } from '../../src/artifact';
import type { RingKey, VerifiedArtifact } from '../../src/artifact';
import { buildConnector } from '../../src/build';
import type { BuiltConnector } from '../../src/build';
import { writeGoldenConnector } from '../golden/golden-connector';

// The build moved from atrium's publish script unchanged: the source the
// golden atrium-made Artifact was published from, built here at the same
// version, gives the same published manifest and the same bundles, and so,
// on the Bun that recorded it, the same payload.tar.gz to the byte.
//
// Its SDK is a stub under the old name `@atrium/connector-sdk`, so this also
// holds that a Connector repo not yet moved to the new name still builds.

const GOLDEN = join(import.meta.dir, '..', 'golden');
const ATRIUM_MADE = join(GOLDEN, 'atrium-made');
const view = JSON.parse(readFileSync(join(ATRIUM_MADE, 'atrium-view.json'), 'utf-8')) as {
  recordedWith: { bun: string };
  envelope: { payloadSha256: string };
};
const ring = Object.values(
  (JSON.parse(readFileSync(join(GOLDEN, 'ring.json'), 'utf-8')) as { keys: Record<string, RingKey> }).keys,
);

let dir: string;
let atriumMade: VerifiedArtifact;
let built: BuiltConnector;

beforeAll(async () => {
  const file = readdirSync(ATRIUM_MADE).find((name) => name.endsWith('.atrium.tar.gz'))!;
  atriumMade = await openArtifact(new Uint8Array(readFileSync(join(ATRIUM_MADE, file))), ring);
  dir = mkdtempSync(join(tmpdir(), 'atrium-golden-build-'));
  writeGoldenConnector(dir);
  built = await buildConnector(dir, { version: atriumMade.manifest.version });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the SDK's build of the golden Connector", () => {
  test("generates atrium's published manifest, but for the Bun that built it", () => {
    const { publishedWith, ...manifest } = built.manifest;
    const { publishedWith: atriumBun, ...atriumManifest } = atriumMade.manifest;
    expect(manifest).toEqual(atriumManifest);
    expect(publishedWith).toEqual({ bun: Bun.version });
    expect(atriumBun).toEqual({ bun: view.recordedWith.bun });
  });

  test('makes the same bundles', () => {
    expect([...built.files.keys()].sort()).toEqual(
      [...atriumMade.files.keys()].filter((path) => path.startsWith('actions/')).sort(),
    );
    if (Bun.version !== view.recordedWith.bun) return; // Bun.build is not stable across Bun versions.
    for (const [path, data] of built.files) {
      expect(new TextDecoder().decode(data)).toBe(new TextDecoder().decode(atriumMade.files.get(path)!));
    }
  });

  test.if(Bun.version === view.recordedWith.bun)("writes atrium's payload to the byte", async () => {
    const written = await writeEnvelope({ ...built, signers: [], publishedAt: atriumMade.publishedAt });
    expect(written.payloadSha256).toBe(view.envelope.payloadSha256);
  });
});
