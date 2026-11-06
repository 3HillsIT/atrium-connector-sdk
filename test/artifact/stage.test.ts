// `STAGE_BY_CODE` is total, enforced rather than trusted.
//
// The type is `Record<ConnectorArtifactErrorCode, VerifyStage>`, so a missing
// entry is a type error — but nothing in this repo runs `tsc` over the
// backend, and `bun test` does not typecheck. So the guarantee the add
// drawer's Verify step depends on is asserted here instead, by reading the
// union out of the source the same way no-forbidden-imports.test.ts reads
// imports.
//
// What breaks without it: a code added to the union and forgotten here would
// hand Verify `undefined`, and a refusal would be rendered under whichever
// stage the UI falls back to — attributing, say, a manifest problem to the
// signature, which is the "someone tampered with this" answer. The whole
// point of a non-collapsible code set is that those stay distinct.

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { STAGE_BY_CODE, stageForCode } from '../../src/artifact/errors';

/** The union members, read off the `ConnectorArtifactErrorCode` declaration. */
function declaredCodes(): string[] {
  // Line comments go first. Each member is documented inline and the prose
  // contains both semicolons ("signature is good; payload.tar.gz is not...")
  // and apostrophes, either of which would end the slice or the match early.
  const source = readFileSync(join(import.meta.dir, '..', '..', 'src', 'artifact', 'errors.ts'), 'utf-8').replace(
    /\/\/[^\n]*/g,
    '',
  );
  const start = source.indexOf('export type ConnectorArtifactErrorCode =');
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf(';', start));
  return [...body.matchAll(/\|\s*'([a-z-]+)'/g)].map((match) => match[1]!);
}

describe('every refusal code has a verification stage', () => {
  test('the declared union and the map have exactly the same members', () => {
    const declared = declaredCodes().sort();
    const mapped = Object.keys(STAGE_BY_CODE).sort();

    // Sanity-check the parser itself before trusting its verdict — an empty
    // list would make this test pass by finding nothing to disagree about.
    expect(declared.length).toBeGreaterThan(10);
    expect(mapped).toEqual(declared);
  });

  test('stageForCode answers for every declared code', () => {
    for (const code of declaredCodes()) {
      expect(stageForCode(code as never)).toBeTruthy();
    }
  });

  test('unreadable is attributed to the first stage, since nothing was reached', () => {
    expect(stageForCode('unreadable')).toBe('signature');
  });

  test('the stages a code can map to are the four Verify renders, in order', () => {
    // Verify walks signature → listing → manifest → contract and cuts off at
    // the failure; a stage outside that list would render nowhere at all.
    const stages = new Set(Object.values(STAGE_BY_CODE));
    for (const stage of stages) {
      expect(['signature', 'listing', 'manifest', 'contract']).toContain(stage);
    }
  });
});
