# Changelog

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
