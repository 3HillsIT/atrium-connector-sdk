# Changelog

## 0.2.0

- Add optional `httpMethods?: string[]` field to `ActionDefinition`, declaring the HTTP method(s) an action's handler issues via `ctx.request(...)` (e.g. `['GET']`, `['POST']`). Purely additive — advisory metadata for classification, not enforced by the SDK; `runAction` behavior is unchanged.
- **Absent `httpMethods` is treated as write-capable by default** by downstream consumers (fail-safe) — omitting the field is the conservative choice, not the permissive one.
- `connectorApiVersion` was **not** bumped — this is a backward-compatible, non-breaking addition to the contract.

## 0.1.0

- Initial SDK: `defineConnector`, `defineAction`, `runAction`, `createAtriumClient`, and the mediation broker client protocol.
