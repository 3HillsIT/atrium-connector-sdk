# @atrium/connector-sdk — Return handover

Built against the real `reference/atrium-broker.ts`, `ts-runner.ts`, and `py-runner.ts` — read end to end before writing any code, per instructions. Section 2 of the original handover (my reconstruction) turned out to be wrong or incomplete in several places; all are listed below. Confidence in wire-protocol compatibility is high, since the client and mock broker were built by mirroring the real broker's logic directly, not by guessing.

## 1. Discrepancies between Section 2 and the real files

**1. `ATRIUM_INTEGRATION_ID` does not exist in the real protocol — this is the most important one. RESOLVED.**
Section 2 says the SDK client should read `integrationId` implicitly from an `ATRIUM_INTEGRATION_ID` env var. The real client harness (`ts-runner.ts`/`py-runner.ts`) does no such thing: `atrium.request(integrationId, method, path, opts)` takes `integrationId` as an **explicit first argument** on every call, and no `ATRIUM_INTEGRATION_ID` env var is ever set by either runner.

**Resolution applied:** `createAtriumClient(integrationId: string): AtriumClient` — `integrationId` is now passed explicitly at construction time, not read from env. `ctx.request(method, path, opts)` is unchanged from Section 4's spec (no `integrationId` parameter on the connector-authoring side); the client attaches the constructor-time value to every wire request internally. This matches the real protocol's shape (integrationId is known and threaded through explicitly, just one call earlier — at client construction instead of per-request) without requiring an `ATRIUM_INTEGRATION_ID` env var round-trip. Whatever eventually calls `createAtriumClient()` (a future harness/dispatcher, not built yet) will already have resolved the integration before spawning the broker, so it has the value on hand to pass directly. All tests and the Acme example were updated accordingly; `bun test` and `tsc --noEmit` both pass clean after the change.

**2. The broker's error surface is bigger than "403 or 401."**
Section 2 says: only 403 (integration mismatch) and 401 (bad token) are broker-level errors; "any other status" should pass through untouched as a normal `{status,headers,body}` response. That's wrong. The real broker returns its **own** non-2xx HTTP status (with a `{error: string}` body) for several more cases:
- `404` if the path isn't `/request`
- `400` if the JSON body doesn't parse, or if `method` isn't one of GET/POST/PUT/PATCH/DELETE
- `502` if the broker's own `fetch()` to the *downstream* API fails or times out (20s hardcoded timeout)

Critically, the broker **always answers HTTP 200** when it successfully proxies a call — even when the downstream API itself returned a 404/422/500 — because `Response.json({ status: upstream.status, ... })` defaults to a 200 wrapper status. So the correct rule isn't "throw only on 401/403, pass through everything else" — it's "the broker's own HTTP status is the only thing to branch on: non-2xx means a broker-level failure (throw), 2xx means look inside the JSON body for the real downstream status (never throw, let the caller inspect it)." I implemented it this way — `res.ok` gates throwing, not a specific status allowlist — and added a generic `AtriumBrokerRequestError` (carries `.status`) for the 400/404/502 cases Section 2 never mentioned, alongside the two named `AtriumBrokerAuthError`/`AtriumIntegrationMismatchError` classes for 401/403 specifically.

**3. Auth headers strictly win over caller-supplied headers — not a "merge."**
Section 2 describes the `headers` field as "extra headers the caller wants attached, merged with auth headers," implying a plain merge. The real broker actually **drops** any caller-supplied header whose key case-insensitively collides with an auth header key before merging (`safeUserHeaders`), then spreads auth headers last so they can't be shadowed either way. Net effect: a connector action can never override or spoof the `Authorization` header (or whatever header `attachAuth` sets) via `opts.headers`, even accidentally. I mirrored this exactly in the mock broker and added a test (`caller headers cannot override the auth header the broker attaches`) proving it.

**4. Path normalization happens broker-side, not client-side.**
Not wrong in Section 2, just unstated: the broker itself coerces `body.path` to always start with `/` (`path.startsWith('/') ? path : '/' + path`). The client doesn't need to enforce a leading slash — I left the client passing `path` through as-is and let the broker normalize it, matching real behavior.

**5. `set-cookie` is stripped from downstream response headers.**
Not mentioned in Section 2 at all. The real broker filters `set-cookie` out of the headers it forwards back (`UNSAFE_RESPONSE_HEADERS`). Purely informational for connector authors — mirrored in the mock broker and covered by a test — but worth knowing since it means a connector handler can never see or forward a downstream `Set-Cookie`.

**6. `AtriumRequestContext` — likely a naming collision in Section 1, not something to export.**
Section 1 says the main package's export list includes "the `AtriumRequestContext` type." That name belongs, in the real code, to the **broker's own server-side context type** (`atrium-broker.ts`), which has a `secret: string` field — i.e. the raw credential. I'm fairly confident this was a copy-paste/naming slip in the original write-up (conflating the broker-internal context with the client-facing type), not a deliberate ask to expose it — exporting anything by that name would risk someone assuming it's safe to hold a credential. I exported `AtriumClient` (matching the `handler: (ctx: AtriumClient, input) => ...` signature actually given in Section 4) instead, and did not export anything named `AtriumRequestContext` or anything containing a `secret` field. Flagging so you can confirm that reading is correct.

## 2. Things inferred rather than read directly

- **Env-var deletion timing is a real hazard for the future harness integration, found from a static read but worth calling out explicitly.** `ts-runner.ts`/`py-runner.ts` capture `ATRIUM_BROKER_URL`/`ATRIUM_BROKER_TOKEN` into local closure variables and **delete them from `process.env`/`os.environ` immediately**, before any connector/handler code executes at all. `createAtriumClient()` in this SDK reads those env vars when *it's* called (per Section 3's literal spec — "at call time, not import time"), which works fine in this repo's own tests and in any harness that keeps the vars around until `createAtriumClient()` runs. But if a future harness reuses the exact same "capture-then-delete-before-user-code-runs" pattern when it eventually imports `/client` instead of using the inline `ATRIUM_GLOBAL` string, `createAtriumClient()` would find the vars already gone and throw the "missing env var" error — even though the broker is running fine. This isn't something I could resolve from a static read of the current files (the current files don't call this SDK at all); it's a lifecycle contract the future harness rewrite will need to get right — either keep the vars live until first client creation, or pass values directly rather than through env.
- Everything else in this section was read directly, not inferred — the wire protocol, error bodies, and header-merge logic above all came from actually reading `atrium-broker.ts` line by line, not from behavioral guessing.

## 3. Decision points to confirm before building the Azure DevOps connector

1. ~~`ATRIUM_INTEGRATION_ID` vs. per-call `integrationId`~~ — **resolved**, see discrepancy #1 above: `createAtriumClient(integrationId)` now takes it at construction time.
2. **`ConnectorDefinition.actions` had to be typed `ActionDefinition<any, any>[]`, not `ActionDefinition[]` (i.e. `ActionDefinition<unknown, unknown>[]`) as Section 4's snippet showed.** With `unknown`, TypeScript's contravariant check on `handler`'s input parameter makes it a compile error to put *any* concretely-typed action (which is every real action) into the array — so the literal snippet as given doesn't actually compile once you try to use it. `any` is the standard escape valve for a heterogeneous array of generic-callback types. Flagging in case there's a reason to want something stricter (e.g. a discriminated-union approach) once real actions exist.
3. **`runAction()` didn't exist in either code snippet in the handover but had to be added.** Section 4 requires "validate `inputSchema`/`outputSchema` at actual call boundaries" but `defineAction`/`defineConnector` are specified as identity-returning functions with no execution logic. I added `export async function runAction(action, ctx, rawInput)` in `src/connector.ts` as the actual validation+execution entry point. Whatever eventually calls a connector's action (the main app's action-invocation code) will need to call `runAction`, not `action.handler` directly — worth confirming this is the shape/name you want before that call site gets written elsewhere.
4. **`testConnection` and `configSchema` are defined but nothing in this repo calls them** — correct per Section 6 (no live integration), just noting they're currently only exercised by the Acme example's own test, not by anything resembling the main app's generic health-check path.

## 4. Section 7 verification checklist

- [x] Full test suite passes — 25 tests, 0 failures (`bun test`).
- [x] `bunx tsc --noEmit` passes cleanly.
- [x] Both entry points resolve independently through `package.json`'s `exports` field under real Bun module resolution (verified via a temporary self-referencing `node_modules` symlink, not just relative-path imports from within `src/`) — see `test/subpath-isolation.test.ts` for the static + bundled-output checks, confirming `src/client.ts` pulls in neither Zod nor `connector.ts`/`index.ts`.
- [x] The Acme example connector lives at `examples/acme-connector.ts` and is exercised end-to-end against the mock broker in `test/e2e.test.ts`.
- [x] `CURRENT_CONNECTOR_API_VERSION` is exported from `src/version.ts` (currently `1`) and re-exported from `src/index.ts`.
- [x] Grepped `src/` and `examples/` for `secret`/`credential` — the only hits are a doc comment ("Never carries a raw credential") and a user-facing error message string in the Acme example ("Acme rejected the credential"); no field, type, or code path anywhere carries an actual secret value. `index.ts` re-exports only *types* from `client.ts` (`AtriumClient`, `AtriumRequestOptions`, `AtriumResponse`), not `createAtriumClient` itself, so authoring code always goes through the typed `ctx` parameter.

## 5. Layout

```
src/
  client.ts       — standalone broker client (the "/client" subpath), typed errors
  connector.ts    — defineConnector, defineAction, runAction (validation)
  version.ts      — CURRENT_CONNECTOR_API_VERSION
  index.ts        — main entry point, re-exports the above + zod
examples/
  acme-connector.ts — fictional reference connector
test/
  client.test.ts, connector.test.ts, e2e.test.ts, subpath-isolation.test.ts
  support/mock-broker.ts     — faithful mirror of reference/atrium-broker.ts
  support/fake-downstream.ts — stand-in for a real downstream API
```

Nothing from Section 6 (real Azure DevOps connector, live broker integration, registry/distribution/signing) was built.
