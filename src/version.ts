/**
 * The version of the **bundle contract** this SDK speaks — the two-signature
 * handshake where Atrium's code and a published Connector Artifact's Action
 * bundle meet:
 *
 *   app → bundle:   __atriumRun(ctx, input)          (the bundle's one export)
 *   bundle → app:   ctx.request(method, path, opts)  (the object app supplies)
 *
 * The bundle's side of `ctx.request` is a Connector's handlers, compiled
 * against this SDK's `AtriumClient` type. This constant says which version of
 * the handshake that type describes.
 *
 * Atrium owns the other half: it supplies `ctx`, and it defines in its own
 * code the window of versions an Instance accepts. Atrium's publish reads this
 * constant from the SDK a Connector resolves, stamps it into the Artifact's
 * manifest (Connector authors never declare it), and refuses unless it equals
 * the version the publishing Atrium speaks. So a bump changes both sides
 * together: Atrium's `ctx` and window, and here this constant with the
 * `AtriumClient` that matches.
 *
 * It is not the SDK's package version, and the two move independently.
 * Bun.build inlines the SDK into every published bundle, so an SDK release —
 * additive or breaking — cannot break an already-published Artifact. Renaming
 * a ConnectorDefinition field is therefore NOT a bump; changing the shape of
 * `ctx` IS.
 *
 * See docs/adr/0007-connector-artifact-format-and-store.md in the Atrium repo,
 * "Clarifications from #10368".
 */
export const CURRENT_CONNECTOR_API_VERSION = 1;
