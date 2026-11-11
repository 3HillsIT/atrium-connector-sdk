# Build your first Connector

A walk from an empty folder to a Connector an admin can Add in atrium's Studio. Each step gives the command, what you should see, and what to do if you don't. Read it top to bottom once; the other pages are the reference you come back to.

**You need no AI tools for any of this.** Everything here is ordinary TypeScript, tests and a command line. If you want a coding agent to do the typing with you, see [guided-build.md](guided-build.md); the steps are the same, and you keep the two that are yours (signing, and Adding in the Studio).

What you will have at the end: a repo with a Connector in it, a signed file `dist/<id>-<version>.atrium.tar.gz`, and the knowledge of what an admin does with it.

## 1. What you need

- **Bun.** The commands run on Bun, not on Node. Check it:

  ```
  bun --version
  ```

  You should see a version number. If the command isn't found, install Bun from [bun.sh](https://bun.sh), open a new terminal and try again.
- **An empty folder** for the new repo, or a folder that holds only `.git`.
- **A system to connect:** your own Jira, CRM, ERP or any other system with an HTTP API. Know how you sign in to its API (a token or API key in one header, a token plus other settings in headers, or Microsoft Entra ID) and have one read call and one write call in mind. For a first run, a read call is enough.
- **Later, for signing:** a Customer Key. An owner of your company's account in the atrium Console creates one (step 8). You don't need it until then.

You don't need an atrium Instance to build and test. You need one only for the last step, and someone who administers it.

## 2. Start the repo

```
bunx -p @3hillsit/atrium-connector-sdk atrium-connector init acme-tasks
```

`init` asks three things, and then writes the repo:

- **The Connector id.** It is the first part of every Tool's name and never changes. `acme-tasks` gives Tools named `acme-tasks_list_tasks`. Letters, digits, `.`, `_` and `-`; keep it short.
- **The display name.** What the Studio's Connector Store shows. `Acme Tasks`. You can change it later.
- **How the system takes its credential:** `pat` (one token or API key in one header), `multi-header` (a secret in one header, and settings the admin enters in others), or `oauth2` (Microsoft Entra ID only). Pick the one that matches your system; you can change the `connection` block later ([manifest.md](manifest.md)).

You should see `✓ Wrote the Connector acme-tasks ("Acme Tasks") to …`, a short list of next steps, and where the docs are.

**If it refuses:** `init` writes only into an empty folder and never over a file. Use another folder, or empty this one. A refusal names a page of this guide; read it.

## 3. See it pass before you change anything

```
cd acme-tasks
bun install
bun test
bunx atrium-connector check
```

`bun install` fetches the SDK, pinned to the version that wrote the repo. Commit the `bun.lock` it creates. `bun test` runs the tests of the two example Actions, and the parity tests that keep `manifest.json` and your code the same. `check` builds the Connector the way atrium will and checks it as an Instance would. You should end with:

```
✓ check passed: acme-tasks 0.1.0, 2 actions. Nothing was written or signed.
```

Why do this first: a repo that is green before you touch it tells you that any red afterwards is yours, and you can see how a passing run looks.

**If a test or `check` fails now:** read the line that names the rule (`parity`, `write-flag`, …) and its page. On a fresh repo it usually means Bun is old or `bun install` didn't finish. Run `bun --version` and `bun install` again.

To read the docs in a browser at any time: `bunx atrium-connector docs`.

## 4. Describe your system in the manifest

Open `manifest.json`. It is what atrium reads: the Connector's name, how it signs in, and one entry per Action. atrium never runs your code to learn any of this ([concepts.md](concepts.md) says what happens to your code and when).

First the `connection` block. It was written for the sign-in kind you chose and holds example values, explained in its `_comment`. Change them to your system's:

- `apiBasePath`: the path every call starts with, for example `/api/v2`.
- `healthCheckPath`: a path that answers when the credential is right and fails when it isn't. atrium calls it when an admin tests the Integration.
- the header name and prefix the system reads the credential from.
- under `configSchema`, the settings an admin enters on the Integration, such as the system's URL. Your code never sees a credential or a URL; atrium's broker adds them to your calls.

Then delete the `_comment`. Run `bunx atrium-connector check`; it should still pass. If it says `connection: …`, the message names the field to fix, and [manifest.md](manifest.md) describes each one.

## 5. Write your first Action

An Action is one thing the Connector can do: "list tasks", "create a task". An AI assistant that an admin connects to atrium reads each Action's description to decide when to use it, so write it for that reader: what it does, what it needs, what it returns.

Start from the example read Action and make it yours. One Action lives in four places, and the parity tests check that they agree:

1. **`src/actions/<name>.ts`**: the code (`defineAction`: `id`, `description`, `inputSchema`, `httpMethods`, `handler`).
2. **`src/index.ts`**: exports it.
3. **`manifest.json`**: an entry under `actions` with the same `name`, the same description, and a JSON Schema with the same properties as the code's `inputSchema`.
4. **`test/<name>.test.ts`**: its test (next step).

For a system that lists tasks at `GET /tasks`:

```ts
// src/actions/list-tasks.ts
import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

export const listTasks = defineAction({
  id: 'list_tasks',
  description: 'Lists tasks, newest first, optionally only those with one status. Returns each task\'s id, title and status.',
  inputSchema: z.object({ status: z.enum(['open', 'done']).optional() }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    const query = input.status ? `?status=${input.status}` : '';
    const res = await ctx.request('GET', `/tasks${query}`);
    if (res.status !== 200) {
      throw new Error(`The system answered ${res.status} to the list: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  },
});
```

Three things to know:

- **All HTTP goes through `ctx.request`.** Not `fetch`, not another HTTP client. The path is relative to `apiBasePath`; atrium adds the base URL and the credential.
- **Check the status** and throw an `Error` that says what failed. The message goes back to the person using the AI assistant.
- **Say whether it writes.** An Action that creates, changes, deletes, sends or triggers anything has `"write": true` in the manifest, and its name goes in `WRITE_ACTIONS` in `test/parity.test.ts`. atrium holds a write Action's calls for a person's approval; only that flag does it. When you're unsure, it is a write. A first Connector can be read-only: delete the example write Action (its file, its test, its manifest entry, its export and its name in `WRITE_ACTIONS`) and add one later.

[actions.md](actions.md) has the whole shape and the rules; [rules.md](rules.md) the ones that break a Connector.

After you've changed the four places, run `bunx atrium-connector check`. You should see the same `✓ check passed` with your Action count. If it fails with `parity`, it names the property or description that differs between the manifest and the code; fix one to match the other. If it fails with `exports-and-names`, the Action isn't exported from `src/index.ts`, or its `id` differs from its `name` in the manifest.

## 6. Test it

You can't call a real system from a test, and you don't need to: your handler talks to `ctx`, and a test gives it a stand-in `ctx` that records what the handler sent and answers what the system would.

Copy the example test (`test/list-items.test.ts`) to `test/list-tasks.test.ts` and change it. Test what matters: the request sent (method, path, query), the shape returned, and that a non-2xx answer becomes an error.

```
bun test
```

You should see every test pass, the parity tests among them. [testing.md](testing.md) explains `runAction` and the stand-in `ctx`.

**If a test fails:** the diff in the output shows the value you got and the one you expected. A failing parity test names the Action and what differs. Fix the code or the manifest, whichever is wrong, and run it again.

## 7. Check, then build a try version

```
bunx atrium-connector check
bunx atrium-connector build --try
```

`check` runs everything `build` does without writing anything; run it as often as you like. `build --try` writes the unsigned Artifact, the one file that travels to an Instance, into `dist/`, and records it in `atrium-builds.json`. You should see:

```
✓ Built acme-tasks 0.1.0-try.1, unsigned: dist/acme-tasks-0.1.0-try.1.atrium.tar.gz
```

Why a try version: an Instance refuses a second, different file under a version it already has, so while you are testing, each build is `0.1.0-try.1`, `-try.2`, … and your `manifest.json` stays at `0.1.0`. Commit `atrium-builds.json`; it is how the tries are counted. Try Artifacts pile up on the Instance you use them on, so try on one meant for testing. When you release, `bunx atrium-connector build` makes plain `0.1.0` ([versions.md](versions.md)).

**If `build` refuses,** it prints the same `<rule>: <message>` lines as `check`, each with its page. `bundles` means Bun couldn't build your code, usually an import that doesn't resolve: run `bun install` and `bun run typecheck`. [troubleshooting.md](troubleshooting.md) lists every refusal.

## 8. Get a key

An Instance runs only Connectors signed by a Customer Key of your company's account, so it knows the code comes from you. Two ways to get one:

- **In the Console** (the usual way): an owner of your company's account opens the atrium Console, your account's Customer Keys, and chooses Create. The browser makes the key and saves the key file once, to that computer.
- **On your machine,** for a key a pipeline holds:

  ```
  bunx atrium-connector keygen --name "My laptop" --out my-laptop.atrium-key.json > my-laptop.pub
  ```

  You should see a warning first: **the key file is the only copy of the private key.** Then `my-laptop.pub` holds two lines, `key-id …` and `public-key …`, that an owner pastes into the Console's Register.

Either way, the same rules for the file: keep it somewhere safe (a password manager is one option, a CI secret another), don't commit it, and delete copies where signing doesn't run. If it is lost, remove the key in the Console and make a new one. And an Instance only trusts the key once the Console's next Customer Key List has reached it ([build-and-sign.md](build-and-sign.md#from-signed-to-added)).

## 9. Sign

Signing is the step that says "this code may run on our Instances", so it is yours: a person's decision, or a pipeline's that a person set up.

```
bunx atrium-connector sign --key my-laptop.atrium-key.json dist/acme-tasks-0.1.0-try.1.atrium.tar.gz
```

You should see `✓ Signed acme-tasks 0.1.0-try.1 with key …` and the number of signatures in the file. `sign` checks its own work before it replaces the file, so a damaged or wrong key file fails here, not later on the Instance.

**If it refuses** with `key-file`, the file isn't one the Console or `keygen` wrote, or it was edited: check the path, and if the file is damaged make a new key (step 8).

## 10. Added in the Studio

Hand the signed file to an admin of the atrium Instance, or do it yourself if you are one. In the Studio's Connector Store they upload it (or place it in the Drop Folder and rescan). The Add drawer shows your company as the owner and a "Signed by" line for the key that signed it, and what will change before anything does. When they confirm, the Connector's Actions can be installed as Tools in a Workspace.

You should see the Connector in the Store with your display name, and its Tools in the Workspace it was installed to.

**If the Store refuses the file,** it says why; [troubleshooting.md](troubleshooting.md), "When an Instance refuses the Artifact", lists each refusal and what to do. The common first ones are `unknown-key` (the Instance doesn't have your Customer Key's list yet) and `owner-mismatch` (the key belongs to another account).

## Where to go from here

- Change a Connector that is already out: raise the version in `package.json` and `manifest.json` together, then build and sign again ([versions.md](versions.md)).
- Build and sign in CI, with the key as a secret ([build-and-sign.md](build-and-sign.md#signing-in-ci)).
- The words used here (Instance, Workspace, Tool, Integration) are explained on [concepts.md](concepts.md).
