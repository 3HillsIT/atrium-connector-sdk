# A Connector for atrium

This repo is an atrium Connector: Actions written as TypeScript handlers with `@3hillsit/atrium-connector-sdk`. atrium reads `manifest.json` to learn each Tool, and runs the handlers with a `ctx` whose broker holds the credentials and makes the HTTP calls. The SDK's guide is in `node_modules/@3hillsit/atrium-connector-sdk/docs/` (after `bun install`), and describes exactly the SDK installed here. Start with `concepts.md`. A person reads them in a browser with `bunx atrium-connector docs`.

## Commands

| Command | |
|---|---|
| `bun install` | Installs the pinned SDK. Commit `bun.lock`. |
| `bun test` | The Action tests and the parity tests in `test/`. |
| `bun run typecheck` | The types. |
| `bunx atrium-connector check` | Builds the Connector and checks it as an Instance would. Writes and signs nothing. Each failure names its rule and the guide page that fixes it: read that page. |
| `bunx atrium-connector build --try`, `build` | Writes the unsigned Artifact to `dist/` and records it in `atrium-builds.json`. Run them when the person asks for an Artifact. |

A change is done when `bun test`, `bun run typecheck` and `bunx atrium-connector check` all pass.

## Signing is the person's

Never run `atrium-connector sign`, and never read, make or ask for a key file. Signing decides what runs on the company's Instances, so it is a person's act: stop after `build` and tell the person the Artifact in `dist/` is ready for them to sign.

## The rules that break a Connector

Each is explained on the guide's `rules.md`, under the name in brackets where `check` tests it.

- **The `write` flag** (`write-flag`): an Action that creates, changes, deletes, sends or triggers anything has `"write": true` in `manifest.json`, and its name is in `WRITE_ACTIONS` in `test/parity.test.ts`. Only that flag puts its Tools behind approval. A read sent as POST says `"write": false`. Every Action declares its `httpMethods`: one with neither those nor `write` counts as a write and fails `check`. Decide which Actions write with the person, by name; when unsure, it is a write.
- **Manifest and code agree** (`parity`): the same Actions, descriptions, input properties and required list in `manifest.json` and the zod `inputSchema`. Change both in the same commit.
- **Exports and names** (`exports-and-names`): every Action is exported from `src/index.ts`, and its `id` equals its `name` in `manifest.json`.
- **All HTTP through `ctx.request`**: no `fetch`, no other HTTP client.
- **No credentials, no environment, no files**: nothing about the system comes from anywhere but `ctx` and the Integration. If the system signs in a way none of the `connection` kinds describes, stop and tell the person: atrium can't sign in to it yet.
- **Check the status** of every `ctx.request` and throw an `Error` that says what failed.
- **Nothing at module top level** that needs the network, the environment or `ctx` (`loads-cleanly`).
- **A change that ships is a new version**: raise `version` in `package.json` and `manifest.json` together (`versions`).

## Read before you work

Pages in `node_modules/@3hillsit/atrium-connector-sdk/docs/`:

| Before you… | Read |
|---|---|
| start on this repo | `concepts.md` |
| touch `manifest.json` or its `connection` block | `manifest.md` |
| write or change an Action | `actions.md`, then `rules.md` |
| write tests | `testing.md` |
| build, or set up CI | `build-and-sign.md` |
| raise a version or update the SDK | `versions.md` |
| fix a refusal from a command or from the Studio | the page the refusal names, else `troubleshooting.md` |
| build a new Connector with the person, step by step | `guided-build.md` (the person can also follow `tutorial.md` alone; it has the same steps) |

The two Actions in `src/actions/` and their tests are examples: replace them with the system's own.
