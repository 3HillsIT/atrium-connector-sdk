import { describe, test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ConnectorArtifactError,
  LISTING_FILE,
  MANIFEST_FILE,
  openArtifact,
  parseSignatureFile,
  readEnvelope,
  serializeSignatureFile,
  sha256Hex,
  writeEnvelope,
  writeEnvelopeParts,
} from '../../src/artifact';
import type { PublishedManifest, RingKey, SignedListing } from '../../src/artifact';

// The golden tests: the move changed nothing in the format (ADR-0007,
// Amendment from #11226).
//
//   golden/atrium-made/  an Artifact atrium's own publish made (test mode,
//                        dual-signed with two fixture keys), and what atrium's
//                        openArtifact answered for it under six rings.
//   golden/sdk-made/     an Artifact this SDK's writeEnvelope wrote, and what
//                        atrium's openArtifact answered for THAT under the
//                        same six rings.
//
// For both, `./artifact` must answer what atrium answered: the same manifest,
// listing, files, digests and refusals, with atrium's one key being the first
// of the keys reported here. And it must make the same bytes: the outer layer,
// payload.sig and payload.tar.gz rebuilt from what it read are the committed
// bytes exactly.
//
// The files were recorded by golden/record-from-atrium.ts against the atrium
// commit atrium-view.json names. Only public halves were kept (ring.json).

const GOLDEN = join(import.meta.dir, '..', 'golden');

const RING = (JSON.parse(readFileSync(join(GOLDEN, 'ring.json'), 'utf-8')) as { keys: Record<string, RingKey> })
  .keys;

interface AtriumOpen {
  ring: string[];
  opened?: {
    keyId: string;
    publishedAt: string;
    payloadSha256: string;
    manifest: PublishedManifest;
    listing: SignedListing;
    files: Record<string, string>;
  };
  refused?: { code: string; message: string; details: Record<string, string> };
}

interface AtriumView {
  recordedWith: { atriumCommit: string; bun: string };
  artifactSha256: string;
  envelope: { payloadSha256: string; signatureSha256: string };
  signedBy: string[];
  opens: AtriumOpen[];
}

function ringOf(names: string[]): RingKey[] {
  return names.map((name) => {
    const key = RING[name];
    if (!key) throw new Error(`ring.json has no key named ${name}`);
    return key;
  });
}

async function digestsOf(files: Map<string, Uint8Array>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [path, data] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    out[path] = await sha256Hex(data);
  }
  return out;
}

for (const folder of ['atrium-made', 'sdk-made']) {
  const dir = join(GOLDEN, folder);
  const fileName = readdirSync(dir).find((name) => name.endsWith('.atrium.tar.gz'))!;
  const bytes = new Uint8Array(readFileSync(join(dir, fileName)));
  const view = JSON.parse(readFileSync(join(dir, 'atrium-view.json'), 'utf-8')) as AtriumView;

  describe(`golden ${folder}: ${fileName}`, () => {
    test('is the file atrium was given', async () => {
      expect(await sha256Hex(bytes)).toBe(view.artifactSha256);
    });

    test('atrium opened it under the ring of its signers', () => {
      expect(view.opens[0]!.ring).toEqual(view.signedBy);
      expect(view.opens[0]!.opened).toBeDefined();
    });

    test('the outer reader finds the two parts atrium found', async () => {
      const parts = readEnvelope(bytes);
      expect(await sha256Hex(parts.payload)).toBe(view.envelope.payloadSha256);
      expect(await sha256Hex(parts.signature)).toBe(view.envelope.signatureSha256);
    });

    for (const atrium of view.opens) {
      test(`under the ring [${atrium.ring.join(', ')}] it answers what atrium answered`, async () => {
        const ring = ringOf(atrium.ring);

        if (atrium.refused) {
          const error = await openArtifact(bytes, ring).catch((err) => err);
          expect(error).toBeInstanceOf(ConnectorArtifactError);
          expect({ code: error.code, message: error.message, details: error.details }).toEqual(atrium.refused);
          return;
        }

        const opened = await openArtifact(bytes, ring);
        const expected = atrium.opened!;
        // Every signer the ring carries, in payload.sig's order; atrium's
        // first-match verifier answered with the first of them.
        const keyIds = view.signedBy.filter((name) => atrium.ring.includes(name)).map((name) => RING[name]!.keyId);
        expect(opened.keyIds).toEqual(keyIds);
        expect(opened.keyIds[0]).toBe(expected.keyId);
        expect(opened.publishedAt).toBe(expected.publishedAt);
        expect(opened.payloadSha256).toBe(expected.payloadSha256);
        expect(opened.manifest).toEqual(expected.manifest);
        expect(opened.listing).toEqual(expected.listing);
        expect(await digestsOf(opened.files)).toEqual(expected.files);
      });
    }

    test('byte for byte: the outer layer and payload.sig rebuilt from their parts are the committed bytes', () => {
      const parts = readEnvelope(bytes);
      expect(writeEnvelopeParts(parts)).toEqual(bytes);
      const parsed = parseSignatureFile(parts.signature);
      expect(serializeSignatureFile(parsed.signatures, parsed.blobBytes)).toEqual(parts.signature);
    });

    test('byte for byte: writeEnvelope given what it read writes the same payload.tar.gz and the same signed blob', async () => {
      const parts = readEnvelope(bytes);
      const opened = await openArtifact(bytes, ringOf(view.signedBy));
      const files = new Map(opened.files);
      files.delete(MANIFEST_FILE);
      files.delete(LISTING_FILE);

      const rewritten = await writeEnvelope({
        manifest: opened.manifest,
        files,
        signers: [],
        publishedAt: opened.publishedAt,
      });
      const rewrittenParts = readEnvelope(rewritten.bytes);
      expect(rewrittenParts.payload).toEqual(parts.payload);
      expect(rewritten.payloadSha256).toBe(view.envelope.payloadSha256);
      // Unsigned, so payload.sig is the blob with no signature line: the
      // committed file's own blob, with its signature lines taken out.
      expect(rewrittenParts.signature).toEqual(
        serializeSignatureFile([], parseSignatureFile(parts.signature).blobBytes),
      );
    });
  });
}
