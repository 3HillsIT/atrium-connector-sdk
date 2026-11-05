# Changelog

## Version policy

The SDK follows semantic versioning from 1.0.0:

- **Breaking changes come only in a new major,** with migration steps in its entry here. That covers the authoring API (what `@3hillsit/atrium-connector-sdk` and `@3hillsit/atrium-connector-sdk/client` export) and the `atrium-connector` commands (`init`, `check`, `build`, `sign`, `keygen`): their options, their output files and their exit codes.
- **Fixes land on the newest major only.**
- **The SDK's version plays no part in what an Instance accepts.** Only the Bundle Contract version (`CURRENT_CONNECTOR_API_VERSION`) does, and the SDK is inlined into every bundle, so a Connector built with an older SDK major keeps running for as long as atrium accepts its Bundle Contract version.

Versions before 1.0.0, the `1.0.0-beta.N` pre-releases included, make no promise.

## Unreleased

A new Connector starts from `init` (#11972).

- **`atrium-connector init [dir]`** writes a Connector repo into an empty folder (or one holding only `.git`) that passes its own `bun test`, typecheck and `check` before anything is changed. It asks the Connector's id, its display name and its sign-in kind (`pat`, `multi-header`, `oauth2`); each is also an option (`--id`, `--display-name`, `--sign-in`), and without a terminal a missing one is a usage error. The repo: `manifest.json` with the answers and the kind's example `connection` block, one read and one write Action with their tests, the parity tests (descriptions, input properties, required list, property types, `httpMethods`, and the write Actions by name), an empty `atrium-builds.json`, `.gitignore`, `AGENTS.md` for a coding agent (the commands, the rules that break a Connector, which guide page to read before which task, and never running `sign`), `CLAUDE.md` (`@AGENTS.md`), the guided-build skill `.claude/skills/build-connector/` (a pointer to `docs/guided-build.md` for now), and a `package.json` pinning the SDK version that ran `init`. It never writes over a file, and installs nothing. A folder that isn't empty is refused under the new rule `new-repo`; an id or sign-in kind a manifest can't take, under `manifest` or `connection`.
- **`examples/` is the repo `init` writes:** `examples/connector/`, with one `connection` block per sign-in kind in `examples/connections/`. The Acme example that was there moved into the SDK's own tests.
- **CI runs `init` for each sign-in kind** from the packed SDK, then the written repo's `bun install`, tests, typecheck and `check` (`scripts/check-init.sh`, runnable locally).

The developer guide ships in the package (#11972, #11229).

- **`docs/`, one page per topic,** in the npm package and on GitHub: concepts, manifest, actions, rules, testing, build and sign, versions, troubleshooting, and the guided build (a stub for now). `node_modules/@3hillsit/atrium-connector-sdk/docs/` describes exactly the SDK installed.
- **The README is rewritten for a developer outside 3HillsIT:** what a Connector is, the quick start, the guide's pages, and the version policy above. 3HillsIT's own release steps moved to atrium's docs.
- **The versions page states both promises:** atrium's (a Bundle Contract version leaves only in an atrium MAJOR, after an overlap Release and 90 days' notice) and the SDK's semver.
- **Every refusal of `sign` and `keygen` names its guide page,** as `check`'s and `build`'s do: a last line `  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/<page>.md`, from three new rules (`key-file`, `signable-artifact`, `new-key`). A test checks every page a rule names exists and mentions the rule.

The Connector Artifact format moves into the SDK (#11227; atrium's ADR-0007, Amendment from #11226).

- **New subpath export `@3hillsit/atrium-connector-sdk/artifact`:** the format itself, moved from atrium's `backend/src/connector-artifact` with its tests. It reads, verifies and writes Connector Artifacts exactly as atrium does: the envelope reader and writer (`openArtifact`, `readEnvelope`, `writeEnvelope`), signing and verifying, the `ATRIUM-SIGNED.json` listing, the published manifest's types and validator (the `connection` block's `pat`, `multi-header` and `oauth2` sign-in kinds included), the `__atriumRun` wrapper text (`actionWrapperSource`), the refusal codes, and fixture builders for tests. The hardened reader's rules are unchanged.
- **The verifier reports every key whose signature verified:** `openArtifact` returns `keyIds: string[]`, in `payload.sig`'s order, where atrium's returned the first `keyId`. It holds no ring and decides nothing about trust; which keys to trust stays atrium's. It no longer names atrium's testing key: an Artifact only keys outside the ring signed is `unknown-key`, with every key id in `details.keyIds`. It runs the collect-all loop of atrium's `signed-file` (the License's verifier), so a signature line that is not canonical base64 now validates nothing, where Buffer's decoder dropped the stray characters.
- **`writeEnvelope` with no signer** writes an unsigned Artifact: `payload.sig` carries the signed blob and no signature line, and opening it is refused as `signature-missing` until it is signed. `writeEnvelopeParts` rebuilds the outer layer from its two parts.
- `./artifact` imports nothing from the build or the authoring layer, never calls `Bun.build` and needs no zod; `test/subpath-isolation.test.ts` holds it.
- Golden tests: an Artifact made by atrium's publish opens here exactly as in atrium, and atrium's own reading of an Artifact written here is committed and matched (`test/golden/`).

The build moves into the SDK too, with a command to run it (#11227).

- **New subpath export `@3hillsit/atrium-connector-sdk/build`:** bundling each Action with the `__atriumRun` wrapper and generating the published manifest, moved from atrium's publish script (`buildConnector`, `buildActionBundle`, `readConnectorSource`), with the Bundle Contract version read off the SDK the Connector resolves (under the new name, or the old `@atrium/connector-sdk`). The same source builds the same payload as atrium's publish did, to the byte on the same Bun (`test/build/golden-build.test.ts`). It imports `./artifact`; `./artifact` still imports nothing from it.
- **New command `atrium-connector`** (`bunx atrium-connector <command>`; needs Bun):
  - `check` builds the Connector and self-checks it, writing and signing nothing: the source manifest and its `connection` block, the version, the entry module's exports against manifest.json (every declared Action exported, the same descriptions, the zod input schema's properties and required list), the `write` flag, then the format half of the self-check on the unsigned Artifact (the listing, the manifest validator, the file name, and each bundle spliced as atrium loads it and imported, for a callable `__atriumRun`). Each failure names its rule and its page in the developer guide; any failure exits 1.
  - `build` does the same, then writes `dist/<id>-<version>.atrium.tar.gz` unsigned and records `{ version, payloadSha256, builtAt }` in `atrium-builds.json`, which the repo commits. A version built again with other bytes gives a warning naming both digests, and still builds.
  - `build --try` builds `X.Y.Z-try.N+1` from a manifest saying `X.Y.Z`, N being the highest try of `X.Y.Z` in `atrium-builds.json`; manifest.json is never edited.
  - Both print which atrium Releases accept the Bundle Contract version built (v1: every atrium Release).
- **The `write` rule:** an Action whose `httpMethods` (in manifest.json, or else in the code) include anything but GET, HEAD or OPTIONS, or that declares no `httpMethods` at all, must say `"write": true`, or `"write": false` when it only reads (a search sent as POST). `check` and `build` fail it otherwise: an Action that says nothing about its methods is unknown, and counts as a write. The published manifest still carries only `"write": true`.

Signing moves out of atrium too: a customer's developer signs with their own Customer Key (#11227, #11228).

- **`atrium-connector sign --key <file> <artifact>`** adds one signature line, made with the key file's private half, to the Artifact's `payload.sig`: an unsigned one `build` wrote, or one already signed (a key rotation's second key). The payload, its listing and the signed blob stay the same bytes, so the version and the payload digest don't move. A signature by the same key id is replaced where it stood, never doubled. Before the file is replaced, the result is opened with the key file's public half alone, as an Instance's Add would, so a key file whose private half isn't its public half's fails at signing. A refusal leaves the Artifact as it was. It needs no source and no repo: build in one place, sign in another.
- **Key files** are the JSON `{keyId, privateKey, publicKey}` (base64 PKCS#8 and SPKI) that atrium's `keygen:signing` writes and the Console's Customer Key download writes with `name` and `account` added; other fields are ignored. `sign` refuses a file whose key id isn't derived from its public half (atrium's derivation: the first 8 bytes of SHA-256 over the SPKI, hex), or whose halves aren't P-256. Its messages name the file and never quote it.
- **`atrium-connector keygen --name <name> --out <file>`** writes a new P-256 key file `{keyId, privateKey, publicKey, name}`, mode 600, never over an existing file. Standard output is exactly the two lines the Console's Register takes, `key-id <id>` and `public-key <base64 SPKI>`, so `keygen … > key.pub` is the paste; the private half is never printed. The name follows the Console's rule (at most 80 characters, no control characters).
- **`addSignature(bytes, signer)`** in `./artifact` is `sign`'s core: it adds or replaces one signature and opens the result with the signer's public half. `parseSignatureFile(bytes, { allowUnsigned: true })` reads a `payload.sig` with no signature line; without the option it is still refused as `signature-missing`.
- `build`'s last line names the `sign` command to run next.

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
