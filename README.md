# Atrium Connector SDK

`@atrium/connector-sdk` is what a Connector is written against: `defineConnector`, `defineAction`, `runAction`, the `AtriumClient` type of a handler's `ctx`, and `CURRENT_CONNECTOR_API_VERSION`. This README is the guide to building or changing a Connector. Publishing one happens in the Atrium repo ([Publishing](#publishing)).

## What a Connector is

A Connector is a versioned package of Actions, and its source lives only in its own Connector repo (Atrium Connector - Azure Devops, - ADITO CRM, - Vendira); the Atrium repo holds none. Atrium's publish builds a checkout of that repo into a signed Connector Artifact, with this SDK inlined into each Action's bundle. An admin Adds the Artifact to an Instance, and installing an Action into a Workspace makes it a Tool named `<connectorId>_<actionName>`. The Tool holds no code: every call runs the Action's bundle from the one Connector version the Instance holds. Nothing is compiled on an Instance.

## Anatomy of a Connector repo

```
package.json      name, version, and this SDK pinned to a commit:
                  "@atrium/connector-sdk": "git+ssh://git@ssh.dev.azure.com/v3/3HillsIT/Atrium%20Connector%20SDK/Atrium%20Connector%20SDK#<commit>"
bun.lock          committed: publish runs `bun install --frozen-lockfile`
manifest.json     id, displayName, version, entry, actions, connection: the contract (below)
src/connector.ts  defineConnector({ id, displayName, description, authTypes, configSchema, actions })
src/actions/*.ts  one defineAction each: id, description, inputSchema, outputSchema?, httpMethods, handler
src/index.ts      the manifest's `entry`: re-exports the connector and every action
test/             bun tests (see Testing)
```

To start a new Connector, copy the layout of an existing Connector repo; Vendira is the smallest one with a full test suite. `examples/acme-connector.ts` shows the SDK calls in one file. Import `z` from the SDK, as the existing Connectors do.

## The manifest is the contract

Atrium never runs Connector code to learn what a Connector is. Publish generates the published manifest from `manifest.json`, and from then on Atrium takes each Action's name, description, input schema and write flag from there; the code runs only when a Tool is called. A difference between the manifest and `src/` is a bug no compiler catches, so change both together and keep a parity test (see Testing).

- `version` must equal `package.json`'s version, or publish refuses. It is the version an Instance holds, that every Tool installed from it runs, and that Add moves between.
- `entry` is the module publish bundles from: `src/index.ts`.
- Each action has `name` (equal to the code's action `id`), `description` (what the model reads to choose the Tool, so write it for the model), a JSON-Schema `inputSchema` (what MCP clients are shown; the zod `inputSchema` in code is what validates a call, so keep the two equal), `httpMethods`, and `write: true` if the Action changes anything.
- `connection` is required: the Connector's own connection settings. `configSchema.fields` is what an Integration asks for (`name`, `label`, `type` of `string`/`number`/`boolean`, `required`, optional `default` and `description`). `request` holds `apiBasePath`, `healthCheckPath` and `auth`. A call goes to `instanceUrl + apiBasePath + path`: `instanceUrl` is the Integration's config field of that name (empty if the Connector declares none), and `{field}` in `apiBasePath` is filled from the Integration's config. `auth` is `pat` (`headerName`, optional `valuePrefix`), `multi-header` (`secretHeader`, `staticHeadersFromConfig`) or `oauth2` (`scope` only; the Instance's own Microsoft registration supplies the rest).
- Publish checks `connection` with the same validator Add uses, before building anything. It refuses unknown keys, so explain the values in a top-level `_comment` array of strings beside the block. Publish leaves `_comment` out of the Artifact.

## Rules that bite

- **Only `write: true` makes an Action a write.** Atrium's `deriveIsWrite` reads the manifest's `write` field and nothing else. Absent or `false` means read, and a read Tool runs without Atrium's write approval. `httpMethods` is documentation only: a WIQL query is a `POST` and a pure read.
- **Publish finds Actions by `.id` among the entry module's exports.** For each manifest action it imports `entry` and takes the export whose `id` equals the action's `name`. The `actions` array in `src/connector.ts` is not consulted. Export names are free (`listProjectsAction`); the `id` is not. An action that is registered but not re-exported from `src/index.ts` fails publish's self-check. The connector object has an `id` too, so never give an action the Connector's id.
- **Names.** Publish refuses an action name that does not match `^[A-Za-z0-9][A-Za-z0-9_-]*$`. The Tool name `<connectorId>_<actionName>` has every character outside `[a-zA-Z0-9_-]` replaced by `_` and is cut to 64 characters (MCP's limit), so keep the Connector id short and plain.
- **A handler never holds a credential.** All HTTP goes through `ctx.request(method, path, { headers?, body? })`. Atrium's broker attaches the secret as the `connection` block says, makes the call, and returns `{ status, headers, body }`. A downstream non-2xx comes back as that response, not as an exception, so check `status`. Don't call `fetch` or read environment variables; everything about the target system comes from the Integration. `ctx.instanceOrigin`, when set, is the origin of the Integration's system, for building links back into it.
- **A bundle must load in plain Bun.** Before signing, publish's self-check imports every bundle outside Atrium. Code at module top level must not need the network, environment variables or Atrium's globals. Do that work inside the handler.
- **In Atrium only the input is validated.** The published bundle parses input against the zod `inputSchema` and calls the handler. `outputSchema` is not checked when a Tool runs. `runAction` checks both, and it is what tests call. `defineAction` and `defineConnector` are identity functions and validate nothing.
- **`defineConnector` is for the repo, not for Atrium.** Atrium reads none of its fields: connection settings come from the manifest, and `authTypes`, `configSchema` and `testConnection` are not consulted. It has no `version` field, since the semver lives in `package.json` and the manifest. Adding one fails the typecheck.
- **A published version is frozen.** Publish refuses to rebuild an `id@version` that the Publish Ledger records with different bytes. Any change that will be published, whether code, manifest, SDK or dependency, is a new semver in `package.json` and `manifest.json` together.

## The Bundle Contract version

A Connector does not declare it. `CURRENT_CONNECTOR_API_VERSION` in `src/version.ts` (currently 1) is the Bundle Contract version this SDK's `AtriumClient` speaks: the version of the handshake in which Atrium calls a bundle's `__atriumRun(ctx, input)` and the bundle calls `ctx.request(...)`. Atrium defines in its own code the window of versions an Instance accepts. Publish reads the constant from the SDK the Connector resolves, stamps it into the Artifact's manifest, and refuses unless it equals the Bundle Contract version the publishing Atrium speaks. When Atrium bumps that version, a Connector moves to an SDK that speaks the new one (change the pinned commit, `bun install`, commit `bun.lock`) before it can be published again. The SDK's own package version plays no part in compatibility: the SDK is inlined into every bundle, so no SDK release can break a published Artifact.

Changing the SDK itself: run `bun test` and `bun run typecheck`, and give every release a version and a CHANGELOG entry. Bump `CURRENT_CONNECTOR_API_VERSION` only together with Atrium's side, when the shape of `ctx` changes. Renaming a field of an authoring type is not a bump. The reasoning is in the Atrium repo's [ADR-0007](https://dev.azure.com/3HillsIT/Atrium%20by%203%20Hills%20IT/_git/Atrium%20by%203%20Hills%20IT?path=/docs/adr/0007-connector-artifact-format-and-store.md&version=GBdev), "Clarifications from #10368". A Connector repo picks up an SDK change only when it moves its pinned commit.

## Testing

In a Connector repo, run `bun test` and `bun run typecheck`. The existing repos carry:

- **Per-Action tests:** `runAction(action, ctx, input)` with a stub `AtriumClient`, asserting the method and path sent, the result, downstream errors and rejected input.
- **An end-to-end test:** the real `createAtriumClient` from `@atrium/connector-sdk/client` against a mock broker (`test/support/mock-broker.ts`, copied from this repo's) that proxies to a fake downstream server.
- **Export-surface parity:** every action in `connector.actions` is exported from `src/index.ts`, and the other way round.
- **Manifest parity** (Vendira): the manifest's id, version and entry match the code and `package.json`; its actions, descriptions and `httpMethods` match the code; exactly the write Actions carry `write: true`; and each input schema's properties and `required` list match the zod schema.

ADITO CRM has no tests yet. None of these exercise publish. To build and self-check a checkout without signing anything, run `bun run publish:connector --rebuild <checkout>` in Atrium.

## Adding an Action

1. Add `src/actions/<name>.ts` with `defineAction` (`id`, `description`, `inputSchema`, optional `outputSchema`, `httpMethods`, `handler`).
2. Re-export it from `src/index.ts` and add it to `actions` in `src/connector.ts`.
3. Add its entry to `manifest.json`: `name` equal to the id, description, JSON-Schema `inputSchema`, `httpMethods`, and `write: true` if it changes anything.
4. Add its tests and extend the parity tests' lists.
5. Bump `version` in `package.json` and `manifest.json` together.

## Publishing

Publishing happens in the Atrium repo, not in a Connector repo. `bun run publish:connector <connector-checkout>`, run from Atrium's `backend/`, takes a path to a checkout of a Connector repo (the folder holding its `package.json` and `manifest.json`) and builds it into one signed Connector Artifact plus an entry in the Publish Ledger. The signing keys, the Key Ring and the Ledger stay in Atrium. See [`docs/connector-publishing.md`](https://dev.azure.com/3HillsIT/Atrium%20by%203%20Hills%20IT/_git/Atrium%20by%203%20Hills%20IT?path=/docs/connector-publishing.md&version=GBdev) in the Atrium repo.
