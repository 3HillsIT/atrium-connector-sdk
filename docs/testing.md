# Testing

Your tests run on your machine, with no Instance and no real system: atrium's broker holds the credentials, so a test never needs one. Read this page before you write tests.

A repo `init` wrote starts with both kinds of test this page describes: one file per example Action (`test/list-items.test.ts`, `test/create-item.test.ts`, with the stand-in ctx in `test/stub-ctx.ts`) and the parity tests (`test/parity.test.ts`). Copy an Action's file for each Action you add.

Run them with `bun test`, the types with `bun run typecheck` (`tsc --noEmit`), and finish with `bunx atrium-connector check`, which builds the Connector and runs the checks an Instance would.

## Per-Action tests with a stand-in ctx

`runAction(action, ctx, input)` does what atrium does when a Tool is called: it checks `input` against the Action's `inputSchema`, calls the handler, and checks the result against `outputSchema` if there is one. Give it a `ctx` that records what the handler sends and answers what the system would.

```ts
// test/search-issues.test.ts
import { describe, expect, test } from 'bun:test';
import { runAction } from '@3hillsit/atrium-connector-sdk';
import type { AtriumClient, AtriumResponse } from '@3hillsit/atrium-connector-sdk';
import { searchIssues } from '../src/actions/search-issues';

function stubCtx(answer: AtriumResponse) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const ctx: AtriumClient = {
    async request(method, path, opts) {
      calls.push({ method, path, body: opts?.body });
      return answer;
    },
  };
  return { ctx, calls };
}

describe('search_issues', () => {
  test('sends the JQL and returns the issues', async () => {
    const { ctx, calls } = stubCtx({
      status: 200,
      headers: {},
      body: { issues: [{ key: 'OPS-1', fields: { summary: 'Disk full', status: { name: 'Open' } } }] },
    });

    const result = await runAction(searchIssues, ctx, { jql: 'project = OPS' });

    expect(calls).toEqual([
      { method: 'POST', path: '/search', body: { jql: 'project = OPS', maxResults: 20, fields: ['summary', 'status'] } },
    ]);
    expect(result).toEqual({ issues: [{ key: 'OPS-1', summary: 'Disk full', status: 'Open' }] });
  });

  test('a non-2xx answer is an error, not data', async () => {
    const { ctx } = stubCtx({ status: 400, headers: {}, body: { errorMessages: ['Bad JQL'] } });
    await expect(runAction(searchIssues, ctx, { jql: 'nonsense' })).rejects.toThrow(/400/);
  });

  test('input the schema refuses never reaches the handler', async () => {
    const { ctx, calls } = stubCtx({ status: 200, headers: {}, body: { issues: [] } });
    await expect(runAction(searchIssues, ctx, { jql: '' })).rejects.toThrow(/Invalid input/);
    expect(calls).toEqual([]);
  });
});
```

For each Action, test:

- the method, path and body it sends;
- what it returns for a typical answer;
- what it does with a non-2xx answer;
- input the schema refuses.

A write Action deserves one more: that it sends exactly one changing call, and nothing when its input is refused.

## An end-to-end test through the broker's protocol

`createAtriumClient(integrationId)` from `@3hillsit/atrium-connector-sdk/client` is the real client a bundle's `ctx` speaks through. Pointed at a stand-in broker (`ATRIUM_BROKER_URL`, `ATRIUM_BROKER_TOKEN`) that forwards to a fake system, it tests your Actions over the same protocol an Instance uses.

The SDK's own repo has both stand-ins: `test/support/mock-broker.ts` and `test/support/fake-downstream.ts`, with `test/e2e.test.ts` using them, on [GitHub](https://github.com/3HillsIT/atrium-connector-sdk/tree/main/test). They aren't in the npm package; copy them into your `test/support/` if you want this test. The per-Action tests above are the ones that matter most.

## Manifest and code agree

`check` holds `manifest.json` and your exports together (the `parity` and `exports-and-names` rules on [rules.md](rules.md)). A test of your own can hold more, in `bun test` where you run it most. The parity tests `init` writes, `test/parity.test.ts`, hold each Action in the manifest to the code's:

- the same Actions, exported under their names, and no other;
- the same description, input properties and required list, as `check` compares;
- every property's type in the manifest's JSON Schema matches the zod schema's, which `check` doesn't compare;
- the same `httpMethods`;
- exactly the Actions named in its `WRITE_ACTIONS` list have `"write": true`. Adding a write Action means adding its name there too: which Actions write is a decision written down twice, on purpose.

They need no change as you add Actions, beyond `WRITE_ACTIONS`. A zod type they don't know (a union, say) is left out of the type comparison.

## Before you hand it over

1. `bun test` passes.
2. `bun run typecheck` passes.
3. `bunx atrium-connector check` passes.

Then build and sign it ([build-and-sign.md](build-and-sign.md)), and try it on a test Instance before anyone Adds it where people work.
