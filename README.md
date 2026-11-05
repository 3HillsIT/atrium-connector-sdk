# atrium Connector SDK

Build Connectors for atrium. A Connector gives AI clients Tools that read from and write to one of your systems, such as your own Jira, CRM or ERP. You write each Action as a TypeScript handler; atrium holds the credentials, makes the HTTP calls for your handler, and can hold each write for a person's approval. This SDK is what you write the Connector with, and its `atrium-connector` command checks, builds and signs it.

```
bun add --exact @3hillsit/atrium-connector-sdk
```

Until 1.0.0 it is published on the `next` dist-tag only: add `@next` or an exact version (`bun add --exact @3hillsit/atrium-connector-sdk@next`). It needs [Bun](https://bun.sh). It is MIT-licensed ([LICENSE](LICENSE)).

## Quick start

0. Start a Connector repo in a new folder:

   ```
   bunx -p @3hillsit/atrium-connector-sdk atrium-connector init my-connector
   cd my-connector && bun install
   ```

   Until 1.0.0 the package is published on the `next` dist-tag only, so the first command needs `@next` or an exact version: `bunx -p @3hillsit/atrium-connector-sdk@next atrium-connector init my-connector`. The repo it writes pins that exact version.

   It asks the Connector's id, its display name and how the system signs in, and writes a repo that passes its tests and `check` as it stands: a manifest, one read and one write Action with their tests, and `AGENTS.md` for a coding agent ([concepts](docs/concepts.md#what-a-connector-repo-holds)).
1. Replace the example Actions with your system's: the manifest and its `connection` block ([manifest](docs/manifest.md)), then each Action ([actions](docs/actions.md)).
2. `bun test`: your tests, with a stand-in for atrium ([testing](docs/testing.md)).
3. `bunx atrium-connector check`: builds and checks the Connector as an Instance would. Writes and signs nothing.
4. `bunx atrium-connector build --try`, then `build`: the unsigned Artifact in `dist/`, a try version for a test Instance or the release.
5. `bunx atrium-connector sign --key <key file> dist/<id>-<version>.atrium.tar.gz`: your company's Customer Key signs it.
6. An admin Adds it in the atrium Studio's Connector Store.

[build-and-sign](docs/build-and-sign.md) has each step, keys and CI.

## The guide

One page per topic, in `docs/`. The same pages ship inside the package, in `node_modules/@3hillsit/atrium-connector-sdk/docs/`, so they describe exactly the version you installed.

| Page | Read it before you… |
|---|---|
| [concepts](docs/concepts.md) | start: Connector, Action, Tool, Integration, and what atrium reads and runs |
| [manifest](docs/manifest.md) | touch `manifest.json` or its `connection` block |
| [actions](docs/actions.md) | write an Action |
| [rules](docs/rules.md) | ship: the rules that break a Connector |
| [testing](docs/testing.md) | write tests |
| [build-and-sign](docs/build-and-sign.md) | build, sign, make a key or set up CI |
| [versions](docs/versions.md) | release a version, update the SDK or update atrium |
| [troubleshooting](docs/troubleshooting.md) | fix a refusal from a command or from the Studio |
| [guided-build](docs/guided-build.md) | build a new Connector with a coding agent |

Every refusal from `init`, `check`, `build`, `sign` and `keygen` names the page that explains it.

## Versions

The SDK follows semantic versioning from 1.0.0:

- **Breaking changes come only in a new major,** with migration steps in the [CHANGELOG](CHANGELOG.md). That covers the authoring API (what the package and its `/client` subpath export) and the `init`, `check`, `build`, `sign` and `keygen` commands. The `/artifact` and `/build` subpaths are for atrium's own tools and are not covered: build on the commands, not on them.
- **Fixes land on the newest major only.**
- **The SDK's version plays no part in what an Instance accepts.** The SDK is inlined into every Action's bundle, so a Connector built with an older SDK keeps running for as long as atrium accepts its Bundle Contract version, and you update the SDK when you choose. atrium's own promise for the Bundle Contract is on [versions](docs/versions.md).

The `1.0.0-beta.N` pre-releases make no promise.

## Issues and contributions

Report a bug or ask a question in this repo's [GitHub issues](https://github.com/3HillsIT/atrium-connector-sdk/issues). Pull requests from outside 3HillsIT aren't taken for now; open an issue instead.

Working on the SDK itself: `bun install`, then `bun test` and `bun run typecheck`. `scripts/check-init.sh` runs `init` from the packed SDK for each sign-in kind, then the new repo's install, tests, typecheck and `check`, as CI does. The repo `init` writes is `examples/connector/`.
