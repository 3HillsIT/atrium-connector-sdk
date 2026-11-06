# The rules that break a Connector

Break one of these and atrium refuses your Connector, or worse, runs it wrongly. `check` and `build` test the first four and name the rule when one fails; the rest are yours to keep, and your tests and review are what hold them.

## exports-and-names

**Every Action `manifest.json` declares is exported from the entry module, under its name.**

For each Action in the manifest, the build imports `entry` and takes the export whose `id` equals the Action's `name`. The `actions` array of `defineConnector` isn't consulted. An Action that is written but not exported from `src/index.ts` can't be built.

- Export every Action from the entry module. The export's name is free (`searchIssuesAction`); its `id` is not.
- Action names match `^[A-Za-z0-9][A-Za-z0-9_-]*$` and appear once in the manifest.
- Never give an Action the Connector's id.

`check` says, for example: `manifest.json declares the action "create_issue", but src/index.ts exports no action whose id is "create_issue". Export it from src/index.ts, or take it out of manifest.json.`

## parity

**`manifest.json` and the code describe the same Actions.**

An AI client sees the manifest's description and input schema; your handler gets input checked against the zod schema. If the two differ, the client sends input the handler refuses, or the model picks a Tool for the wrong reason. `check` compares:

- the exported Actions with the manifest's: an exported Action the manifest doesn't declare fails too;
- each `description`, when the code has one;
- each zod object `inputSchema`'s property names and required list (a property is required unless it is `.optional()`) with the manifest's `properties` and `required`.

It doesn't compare types or formats inside the properties. Keep those equal by hand, and change the code and the manifest in the same commit.

## write-flag

**An Action that may change something says so with `write`.**

Only `"write": true` in `manifest.json` puts a Tool behind atrium's write approval. Without it the Tool runs as a read, with nobody's approval. `check` fails an Action that has no `write` at all and either sends anything but `GET` (by `httpMethods` in the manifest, or else in the code) or declares no `httpMethods` anywhere. An Action that says nothing about its methods is unknown, not a read, so it counts as a write until it declares one or the other:

- `"write": true`: it creates, changes, deletes, sends or triggers something.
- `"write": false`: it only reads, though it sends more than GET (a search sent as `POST`).

`write` is `true` or `false`, or left out for a read whose `httpMethods` are only `GET`. When you aren't sure, it is a write. Making a read Action a write later is a change the admin has to confirm when they Add the new version.

## loads-cleanly

**The entry module and each bundle load without throwing.**

`check` loads your entry module, then each Action's bundle the way an Instance loads it. Code at module top level runs then, outside any handler, with no `ctx`. A top level that reads the environment, opens a file, calls the network or throws fails here; on an Instance it would fail every call of the Tool.

Do that work inside the handler.

## All HTTP goes through ctx.request

No `fetch`, no other HTTP client, no sockets. atrium's broker attaches the credential, sends the call to the Integration's system, and keeps the call where the Instance can see it. A Connector that goes around it carries a credential atrium can't rotate, reaches systems the admin didn't connect, and makes calls nobody can trace.

## No credentials, no environment, no files

A handler never holds a credential: not in code, not in tests, not in a config field. Everything about the target system comes from the Integration through `ctx`. Don't read environment variables or files: on an Instance there is nothing of yours there to read.

If the system needs a sign-in none of the `connection` kinds describes, stop: atrium can't sign in to it yet. See [manifest.md](manifest.md#when-no-kind-fits).

## Check the status of every call

`ctx.request` returns a non-2xx answer as a response, not an exception. Check `res.status` and throw an `Error` that says what failed, or the AI client gets an error page as data. See [actions.md](actions.md#check-the-status).

## One version, one set of bytes

A change that will ship, whether code, manifest, the SDK or a dependency, is a new version: raise `version` in `package.json` and `manifest.json` together. An Instance that has `1.2.0` refuses a different `1.2.0`. `build` warns when it builds a version it already built with other bytes. See [versions.md](versions.md).
