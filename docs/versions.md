# Versions

Three version numbers meet in a Connector, and each answers a different question:

| | Who sets it | What it answers |
|---|---|---|
| Your Connector's version | You, in `manifest.json` and `package.json` | Which build of your Connector an Instance holds |
| The Bundle Contract version | The SDK, stamped by the build | Which atrium Releases can run your Artifact |
| The SDK's version | 3HillsIT, on npm | Which authoring API and commands you build with |

Read this page before you release a version, update the SDK, or update atrium.

## Your Connector's version

### The versions rule

The rule `versions`: `version` in `manifest.json` is a plain `MAJOR.MINOR.PATCH`, and equal to `version` in `package.json`. Bump both together. A pre-release suffix (`-try.1`) is never written by hand; `build --try` adds it.

Use semver for what an admin sees: a new Action or option is a minor, a fix is a patch, and a removed Action, a renamed input or a read that became a write is a major.

### One version, one set of bytes

An Instance records each version's payload digest when it first sees it, and refuses a different payload under the same version. So any change that will ship (code, manifest, the SDK or a dependency) is a new version. `build` warns you when it builds a version again with different bytes, from the committed build record ([build-and-sign.md](build-and-sign.md#the-build-record)).

### Try versions

`build --try` builds `X.Y.Z-try.1`, `-try.2` and so on from a manifest saying `X.Y.Z`, so each try on a test Instance is its own version and never collides with another. A plain `build` then makes `X.Y.Z`, which sorts after its tries, so the Store offers it as an update. Try Artifacts stay in the test Instance's Drop Folder: atrium never deletes one. See [build-and-sign.md](build-and-sign.md#try-versions).

### Updating on an Instance

An Instance holds one version of a Connector at a time. Adding another version, newer or older, moves every Tool installed from it, in every Workspace, in one step; a Tool whose Action the new version no longer has is uninstalled, and an Action that became a write needs the admin's confirmation. The Add drawer shows all of this before anything changes. An update must be signed by the same owner as the installed version: your Customer Key can update your Connector, never a 3HillsIT one, and the reverse.

## The Bundle Contract version

The Bundle Contract is the handshake between atrium and your bundles: atrium calls the bundle's `__atriumRun(ctx, input)`, and the bundle calls `ctx.request(…)`. Its version is `CURRENT_CONNECTOR_API_VERSION` in the SDK. You never declare it: the build reads it off the SDK your repo resolves and stamps it into the Artifact's manifest.

`check` and `build` print which atrium Releases accept it:

```
Bundle Contract v1: accepted by every atrium Release.
```

| Bundle Contract version | Accepted by |
|---|---|
| 1 | every atrium Release |

Each Instance accepts a window of Bundle Contract versions. An Artifact outside it is **Incompatible**: it verified, but this atrium can't run it. Either the Artifact needs a build with a newer SDK (`contract-too-old`), or the Instance needs a newer atrium (`contract-too-new`); see [troubleshooting.md](troubleshooting.md#contract-too-old).

If the line says the SDK's table doesn't know the version, the command runs from an older SDK than the one your repo resolves: update the SDK.

## atrium's promise: a Bundle Contract version leaves slowly

A signed Connector keeps running across atrium updates for as long as atrium accepts its Bundle Contract version, and a version leaves only like this:

1. **An overlap.** At least one atrium Release accepts both the old version and its successor, so there is always a Release you can rebuild on before you have to.
2. **Notice.** A Release announces the old version as leaving, at least 90 days before it goes.
3. **Only in a major.** The Release that drops it is an atrium MAJOR.

While a version is leaving, the Studio marks every Connector built on it with a "Leaving version" chip on its tile and in its drawer, telling the admin to get a build on the current Bundle Contract version. It isn't a problem and the Connector keeps running. Before an update, `atrium update` lists every Connector the target Release would make Incompatible and asks before going on.

When the Studio marks your Connector: update the SDK to one that speaks the current version, raise your Connector's version, build, sign, and have it Added.

## The SDK's promise: semver

From 1.0.0, the SDK follows semantic versioning:

- **Breaking changes only in a new major,** with migration steps in the [CHANGELOG](../CHANGELOG.md). That covers the authoring API (what `@3hillsit/atrium-connector-sdk` and `@3hillsit/atrium-connector-sdk/client` export) and the `atrium-connector` commands (`init`, `check`, `build`, `sign`, `keygen`), their options, their output files and their exit codes. A minor update never breaks your build.
- **Fixes land on the newest major only.** Staying on an older major is safe for what you have built (below), but it gets no more fixes.
- **The SDK's version plays no part in what an Instance accepts.** Only the Bundle Contract version does. The SDK is inlined into every bundle, so a Connector built with an old SDK major keeps running for as long as atrium accepts its Bundle Contract version. You update the SDK when you choose to.

The `/artifact` and `/build` exports are the Artifact format and the build the commands run, for atrium's own tools, and this promise doesn't cover them. Build on the commands, not on them.

Versions before 1.0.0, the `1.0.0-beta.N` pre-releases included, make no promise.

Updating the SDK in a Connector repo: `bun add --exact @3hillsit/atrium-connector-sdk@<version>`, commit `package.json` and `bun.lock`, run your tests and `check`. The new SDK changes your bundles' bytes, so the next build is a new version of your Connector.
