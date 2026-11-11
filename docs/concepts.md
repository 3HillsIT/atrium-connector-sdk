# Concepts

This page names the parts of atrium a Connector touches, and what happens to your code between `bun test` and an AI client calling it. Read it once before you write your first Connector.

## The words

- **Instance:** one installation of atrium, run by your company or for it. An admin manages it in the **atrium Studio**.
- **Workspace:** a group of Tools on an Instance that AI clients reach as one MCP server.
- **Connector:** what connects an Instance to one outside system. The kind you build with this SDK is a **Packaged Connector**: a versioned package of Actions, built and signed into one file.
- **Action:** one thing the Connector can do in the system, such as "search issues" or "create an issue". You write each Action as a handler with `defineAction`.
- **Tool:** an Action installed into a Workspace. Its name is `<connectorId>_<actionName>`, and it runs your Action's code when an AI client calls it. It holds no code of its own.
- **Integration:** one configured use of your Connector in a Workspace: which system (its URL and other settings) and whose credentials. The admin enters these in the Studio, never in your code.
- **Connector Artifact:** the file `build` makes, `<id>-<version>.atrium.tar.gz`. It holds the published manifest and one bundle of JavaScript per Action. It is the only thing that travels to an Instance.
- **Customer Key:** your company's signing key. An account owner creates it in the atrium Console (or registers one `keygen` made). Your Instances trust an Artifact only if a current Customer Key of your company signed it.
- **Customer Key List:** the signed file that tells an Instance which Customer Keys your company has. The Console issues a new one whenever a key is created or removed. A Managed-Hosted Cell receives it on its own; an On-Premise Instance gets it from whoever runs it.
- **Customer Connector:** a Connector signed with a Customer Key. Only your company's Instances accept it, and the Studio shows your company as its owner.

## The credential stays with atrium

Your handler never holds a password, token or secret. Every HTTP call goes through `ctx.request(method, path, { headers, body })`. atrium's broker adds the Integration's credential as your manifest's `connection` block says, sends the call to the Integration's system, and hands you back `{ status, headers, body }`.

That is why the rules forbid `fetch`, environment variables and files in a handler: there is nothing there to read, and a Connector that tries would carry a credential atrium can't see or rotate. See [rules.md](rules.md).

## What atrium reads, and what it runs

atrium never runs your code to learn what your Connector is.

- **It reads the manifest.** Each Tool's name, description, input schema and whether it writes come from `manifest.json`, as the build publishes it. So does what an Integration asks for and how a request is signed in. See [manifest.md](manifest.md).
- **It runs the bundle.** When a Tool is called, atrium loads that Action's bundle, which checks the input against your zod `inputSchema` and calls your handler with `ctx`.

The two must describe the same Actions. A difference between them is a bug no compiler catches, so `check` compares them for you (the `parity` rule in [rules.md](rules.md)).

## From source to Tool

1. **You write** the Connector in its own repo: `manifest.json`, `src/`, tests. See [manifest.md](manifest.md), [actions.md](actions.md) and [testing.md](testing.md).
2. **`atrium-connector check`** builds it and checks it the way an Instance will, writing nothing. See [build-and-sign.md](build-and-sign.md).
3. **`atrium-connector build`** writes the unsigned Artifact into `dist/`.
4. **`atrium-connector sign --key <key file> <artifact>`** adds your Customer Key's signature. Signing can happen on another machine, such as a CI job that holds the key.
5. **An admin Adds it** in the Studio's Connector Store: they upload the file, or place it in the Instance's Drop Folder. The Add drawer shows your company as the owner and one "Signed by" line for each key that signed it.
6. **An admin installs Actions** into a Workspace, which makes them Tools, and creates an Integration with the system's URL and a credential.
7. **An AI client calls a Tool.** A Tool whose Action writes waits for approval, as the Workspace's approval policy says.

Nothing is compiled on an Instance. The SDK is inlined into each bundle at build time, so the Artifact runs the SDK it was built with, whatever SDK version is current later. See [versions.md](versions.md).

## What a Connector repo holds

`atrium-connector init` writes this layout, with one read and one write Action as examples ([build-and-sign.md](build-and-sign.md#init)):

```
package.json        name, version, and this SDK pinned to an exact version
bun.lock            committed, so a build months later bundles the same dependencies
manifest.json       the contract atrium reads (manifest.md)
src/index.ts        the manifest's entry: exports every Action
src/actions/*.ts    one defineAction each (actions.md)
test/               bun tests: one file per Action, and the parity tests (testing.md)
atrium-builds.json  the build record, committed (build-and-sign.md)
dist/               the Artifacts build writes; .gitignore leaves it out of git
README.md           where the docs are and the first commands
AGENTS.md           for a coding agent: the commands, the rules, which page to read first
CLAUDE.md           "@AGENTS.md", so Claude Code reads the same
.claude/skills/build-connector/   the guided build as a Claude Code skill (guided-build.md)
```

Only `manifest.json`, `package.json` and the entry module are required by the build; the rest is how a repo stays maintainable. Keep `AGENTS.md` true as the repo grows: a coding agent follows it.

## Who supports what

You answer for what your Connector does, its write Actions above all. 3HillsIT supports atrium and this SDK, not your Connector's code. Report a problem with the SDK or the commands as an issue on [the SDK's GitHub repo](https://github.com/3HillsIT/atrium-connector-sdk/issues).
