# Changelog

## 1.0.0-beta.1

0.4.0's code, published for the first time on public npm (#11227).

- **Renamed** from `@atrium/connector-sdk` to `@3hillsit/atrium-connector-sdk`: the `@atrium` scope on npm isn't ours. Change the import paths and the dependency's name; nothing else changes.
- The repo moved from Azure DevOps to public GitHub (`3HillsIT/atrium-connector-sdk`), MIT-licensed. Each publish runs from GitHub Actions with npm's trusted publishing and provenance, and needs a person's approval.

## 0.4.0

Brings this repo level with the copy Atrium vendors in `backend/vendor/connector-sdk`, where the #10368 changes landed first. Atrium deletes that copy (#11019), so from here on this repo is the only SDK.

- **Breaking for Connector source:** `connectorApiVersion` is removed from `ConnectorDefinition`. A Connector no longer declares it; Atrium's publish script stamps `CURRENT_CONNECTOR_API_VERSION` into the Artifact manifest from the SDK it bundled. A Connector that still sets the field fails to typecheck until the line is deleted.
- `CURRENT_CONNECTOR_API_VERSION` is the SDK's only version constant: the bundle contract version its `AtriumClient` speaks. The window of versions an Instance accepts is defined in Atrium's own code, so Atrium's copy's `MIN_SUPPORTED_CONNECTOR_API_VERSION` is not part of this SDK. Atrium's publish refuses a Connector whose SDK declares a different version than the publishing Atrium.
- `CURRENT_CONNECTOR_API_VERSION` now means the **bundle contract**: the handshake between Atrium and a published Artifact's Action bundle (`__atriumRun(ctx, input)` and `ctx.request(...)`), not the shape of the authoring types. An SDK change can no longer break a published Artifact, because Bun.build inlines the SDK into it. See `docs/adr/0007-connector-artifact-format-and-store.md` in the Atrium repo, "Clarifications from #10368".
- `CURRENT_CONNECTOR_API_VERSION` stays at 1; already published Artifacts are unaffected.

## 0.3.0

- Add optional `instanceOrigin?: string` to `AtriumClient` (`ctx.instanceOrigin` in a handler): the origin of the instance the linked integration points at, e.g. `https://crm.example.com` for `https://crm.example.com/services/rest`. Connectors use it to return clickable links into the customer's own instance.
- Read from the new `ATRIUM_INSTANCE_ORIGIN` environment variable, which the harness sets to the origin of `instanceUrl + apiBasePath` when spawning the child (so providers with an absolute `apiBasePath` and no instance URL, like Azure DevOps, resolve too) (see `reference/ts-runner.ts` and `reference/py-runner.ts`; Python exposes it as `atrium.instance_origin`). Unlike the broker token it is not removed from the environment, because it is not a credential.
- Undefined when the harness doesn't set it, so older Atrium versions keep working. On Atrium, an Action installed before this change keeps its old `ctx` until it is installed or updated again. `connectorApiVersion` was **not** bumped.

## 0.2.0

- Add optional `httpMethods?: string[]` field to `ActionDefinition`, declaring the HTTP method(s) an action's handler issues via `ctx.request(...)` (e.g. `['GET']`, `['POST']`). Purely additive — advisory metadata for classification, not enforced by the SDK; `runAction` behavior is unchanged.
- **Absent `httpMethods` is treated as write-capable by default** by downstream consumers (fail-safe) — omitting the field is the conservative choice, not the permissive one.
- `connectorApiVersion` was **not** bumped — this is a backward-compatible, non-breaking addition to the contract.

## 0.1.0

- Initial SDK: `defineConnector`, `defineAction`, `runAction`, `createAtriumClient`, and the mediation broker client protocol.
