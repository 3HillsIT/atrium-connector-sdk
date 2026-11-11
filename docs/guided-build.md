# The guided build

The procedure for a coding agent that builds a Connector together with a person. The steps are the ones of [tutorial.md](tutorial.md), which a person can also follow alone; here the agent does the typing, and the person decides. Read this page before you start on a new Connector in a repo `init` wrote, and keep to it until the Artifact is built.

## How to work

- **Explain, then do.** Before each step, say in a sentence or two what you are about to do and why. After it, say what happened.
- **Propose, then ask.** Where the person's knowledge decides (which system, how it signs in, which calls to wrap, which Actions write), put your proposal on the table and ask. One question at a time. Don't guess an answer and carry on.
- **Check after every step.** Run the step's check (below) and show the person the result. If it fails, read the rule and the page it names, fix it, and run it again before going on. Don't stack steps on a failing one.
- **Say what you don't know.** If the system's API docs don't answer something, ask the person. Don't invent an endpoint, a field or a status code.
- **The person may know no AI tooling.** Say "Action", "manifest" and "test", not "prompt" or "tool call". An AI assistant reads Action descriptions: that is the reason to write them well, and the only AI idea the person needs.

## What is never yours

- **Signing.** Never run `atrium-connector sign`. Never read, make, move or ask for a key file, and never run `keygen`. Signing decides what runs on the company's Instances, so it is a person's act. When the Artifact is built, stop, say it is ready, and give the person the command to run themselves.
- **Adding it in the Studio** and anything on an atrium Instance or in the Console. Those are the person's and an admin's.
- **Credentials.** Nothing about the system comes from anywhere but `ctx` and the Integration. If the person offers a token, don't put it in a file, a test or a command; it belongs to the admin's Integration.

## The steps

Each step has what you do, what to ask, and the check that ends it.

### 1. Understand the goal

Read `AGENTS.md` and `concepts.md` in the SDK's docs (`node_modules/@3hillsit/atrium-connector-sdk/docs/`). Ask the person:

- Which system is this for, and where are its API docs?
- What should an AI assistant be able to do with it? List it as plain sentences ("find a task by title", "create a task").
- How does the system's API take a credential: one token or API key in one header, a secret in one header plus other settings in headers, or Microsoft Entra ID? If none of these, stop: atrium can't sign in to it yet, and the person should know.

Check: you can restate the goal in a few lines and the person agrees.

### 2. Start from a green repo

If the repo isn't there yet, `init` writes it: `bunx -p @3hillsit/atrium-connector-sdk atrium-connector init <dir> --id <id> --display-name <name> --sign-in <kind>`. Take the id and display name from the person: the id starts every Tool's name and never changes, so propose one and have it confirmed. Then `bun install`, `bun test` and `bunx atrium-connector check`.

Check: all three pass, before you change a line.

### 3. The manifest's connection

Replace the example values in `manifest.json`'s `connection` block with the system's (`apiBasePath`, a `healthCheckPath` that fails with a wrong credential, the header it reads, the settings an admin enters), and delete the `_comment`. Show the person the block and what an admin will be asked to enter. Details: `manifest.md`.

Check: `bunx atrium-connector check` passes.

### 4. Decide the Actions, and which write

Propose the list of Actions from step 1, each with its `id` (snake_case), a description written for the AI assistant that reads it, its inputs, and the HTTP method it sends. Ask which of them change anything in the system. **Decide the write list with the person, by name.** An Action that creates, changes, deletes, sends or triggers anything is a write and gets `"write": true`; a read sent as POST says `"write": false`; when unsure, it is a write. Only that flag puts a Tool behind approval.

Check: the person agrees to the list and to which Actions write. Start with the reads.

### 5. One Action at a time

For each Action, in this order, and check after each:

1. Write `src/actions/<name>.ts` (`actions.md`): all HTTP through `ctx.request`, the status checked, an `Error` that says what failed.
2. Export it from `src/index.ts`.
3. Add its entry to `manifest.json`: the same `name`, description and input properties as the code, `httpMethods`, and the write flag. Add a write Action's name to `WRITE_ACTIONS` in `test/parity.test.ts`.
4. Write its test (`testing.md`): the request sent, the shape returned, a non-2xx answer as an error.

Check: `bun test` and `bunx atrium-connector check` pass. Replace the two example Actions as you go, with their tests, their manifest entries and their names in `WRITE_ACTIONS`; the finished Connector holds none of them.

### 6. Typecheck and read it through

Run `bun run typecheck`. Then go through `rules.md` with the person's Actions in front of you, and say which of its rules each Action keeps: nothing at module top level that needs the network or the environment, no `fetch`, no credentials, no files.

Check: `bun test`, `bun run typecheck` and `bunx atrium-connector check` pass.

### 7. Build a try version

Run `bunx atrium-connector build --try`. It writes the unsigned Artifact to `dist/` and records it in `atrium-builds.json`; commit the record. Explain that a try version is for testing on an Instance meant for it, and that the release is the plain `build`.

Check: the command prints `✓ Built <id> <version>-try.N, unsigned: dist/…`.

### 8. Hand over

Stop here and say what is done and what is the person's:

- The Artifact is built and **unsigned**: `dist/<id>-<version>-try.N.atrium.tar.gz`.
- **Signing is theirs.** They need a Customer Key (an owner of their company's account creates one in the atrium Console, or registers one `keygen` made), and run `bunx atrium-connector sign --key <key file> dist/<file>` themselves. `tutorial.md` steps 8 to 10 walk them through it, and `build-and-sign.md` has the detail.
- An admin of the Instance then Adds the signed file in the Studio's Connector Store.

Give the person the exact `sign` command with the real file name, and don't run it.

## When a command refuses

Every refusal names its rule and a page of the docs. Read that page before you change anything, and fix what the message says. `troubleshooting.md` lists them all. If the same refusal comes back after a fix, say so to the person and ask rather than trying something else.
