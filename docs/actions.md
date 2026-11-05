# Writing an Action

An Action is one object made with `defineAction` and exported from your entry module. Read this page before you write or change one.

## The shape

```ts
// src/actions/search-issues.ts
import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

export const searchIssues = defineAction({
  id: 'search_issues',
  description: 'Searches issues with a JQL query and returns their keys, summaries and statuses.',
  inputSchema: z.object({
    jql: z.string().min(1),
    maxResults: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    issues: z.array(z.object({ key: z.string(), summary: z.string(), status: z.string() })),
  }),
  httpMethods: ['POST'],
  async handler(ctx, input) {
    const res = await ctx.request('POST', '/search', {
      body: { jql: input.jql, maxResults: input.maxResults ?? 20, fields: ['summary', 'status'] },
    });
    if (res.status !== 200) {
      throw new Error(`Jira answered ${res.status} to the search: ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { issues: Array<{ key: string; fields: { summary: string; status: { name: string } } }> };
    return {
      issues: body.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
      })),
    };
  },
});
```

```ts
// src/index.ts: the manifest's entry
export { searchIssues } from './actions/search-issues';
export { createIssue } from './actions/create-issue';
```

Import `z` from the SDK, so your schemas use the zod the SDK was written for.

| Field | |
|---|---|
| `id` | The Action's name: equal to `name` in `manifest.json`. The export's own name is free (`searchIssues`); the `id` is what atrium finds it by. |
| `description` | The text the AI model reads. Equal to the manifest's `description`. |
| `inputSchema` | A zod object schema. atrium checks every call's input against it before your handler runs. Its properties and required list must match the manifest's JSON Schema. |
| `outputSchema` | Optional. `runAction` checks the handler's result against it in your tests; atrium doesn't check it when a Tool runs. |
| `httpMethods` | The methods the handler sends. Documentation for atrium; `check` reads it for the `write-flag` rule if the manifest has none. With neither list nor a `write` in the manifest, `check` fails the Action. |
| `handler` | `async (ctx, input) => result`. `input` is already parsed by `inputSchema`. The result goes back to the AI client as the Tool's answer. |

`defineAction` and `defineConnector` return what you pass them and check nothing. The checks happen in `runAction` (your tests), in `check` and on the Instance.

## ctx.request

```ts
ctx.request(method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown })
  : Promise<{ status: number; headers: Record<string, string>; body: unknown }>
```

- **`method`:** `GET`, `POST`, `PUT`, `PATCH` or `DELETE`.
- **`path`:** appended to the Integration's address and the manifest's `apiBasePath`. Put query parameters in it, encoded: `` `/issue/${encodeURIComponent(key)}?fields=summary` ``.
- **`body`:** a value atrium sends as JSON.
- **`headers`:** your own headers. The credential's header is atrium's and wins over one of the same name.

atrium adds the credential, sends the call and returns the system's answer.

### Check the status

A non-2xx answer from the system comes back as a response, not as an exception. A handler that reads `res.body` without looking at `res.status` returns an error page as if it were data. Check `status` on every call and throw an `Error` that says what failed; the message reaches the AI client.

The call itself throws only when atrium's broker can't make it: the broker refused the request, or couldn't reach the system. Those errors come from `@3hillsit/atrium-connector-sdk/client` (`AtriumBrokerRequestError`, `AtriumBrokerUnreachableError` and others) and need no handling of their own: let them propagate.

### ctx.instanceOrigin

The origin (`https://jira.example.com`) of the system the Integration points at, when atrium knows it. Use it to build links back into the system for the user to click. It is not a credential.

## Write Actions

An Action that changes anything in the system (creates, updates, deletes, sends, transitions) says `"write": true` in `manifest.json`. Nothing else marks it:

- With `"write": true`, a call to its Tool waits for approval by whoever the Tool's approval policy names, unless an admin has set the Tool or its Workspace to run writes without approval in atrium.
- Without it, the Tool is a read and runs at once, for anyone the Workspace lets call it.

`httpMethods` doesn't decide it: a search sent as `POST` is a read (`"write": false`), and a `GET` that triggers a job is a write. `check` refuses an Action that says neither and sends anything but `GET`, `HEAD` or `OPTIONS`, or declares no `httpMethods` at all (the `write-flag` rule on [rules.md](rules.md)). When in doubt, it is a write.

## What a handler never does

- Calls `fetch`, opens sockets, or reads environment variables or files. All HTTP goes through `ctx.request`.
- Holds or logs a credential.
- Does work at module top level. Code outside the handler runs whenever the bundle loads (during `check` on your machine, and on the Instance), and it must not need the network, the environment or `ctx`.

These are on [rules.md](rules.md) with the reasons.

## Tool names

A Tool installed from your Action is named `<connectorId>_<actionName>`. atrium replaces every character outside `[a-zA-Z0-9_-]` with `_` and cuts the name at 64 characters, MCP's limit. Keep the Connector id short so Action names survive whole.

## defineConnector

`defineConnector({ id, displayName, description, authTypes, configSchema, actions, testConnection })` describes the Connector for your repo and your tests. atrium reads none of it: the id, the connection and the Actions come from `manifest.json`, and `testConnection` is never called (the Integration test calls `healthCheckPath`). You may keep it as a list of your Actions for tests, or leave it out.

## Adding an Action

1. Write `src/actions/<name>.ts` with `defineAction`.
2. Export it from `src/index.ts`.
3. Add it to `actions` in `manifest.json`: `name` equal to the `id`, the same description, the JSON Schema, `httpMethods`, and `"write": true` if it changes anything. A write Action's name also goes in `WRITE_ACTIONS` in `test/parity.test.ts`, if `init` wrote your repo.
4. Write its tests ([testing.md](testing.md)).
5. Run `bun test` and `bunx atrium-connector check`.
6. Before it ships, raise `version` in `package.json` and `manifest.json` together ([versions.md](versions.md)).
