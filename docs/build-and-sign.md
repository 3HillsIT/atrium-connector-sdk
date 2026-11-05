# Building and signing

From a new Connector repo to a signed Artifact an admin can Add: `init`, `check`, `build`, `sign`, and `keygen` for a key made outside the browser. Read this page before you build, sign or set up a pipeline.

## What you need

- **Bun.** The commands and the build run on Bun, never on Node. The bundles are made by Bun's bundler, and the published manifest records which Bun built them. Use one Bun version for every build of a Connector (pin it in CI) so an unchanged source gives an unchanged payload.
- **The SDK in the repo,** pinned to an exact version, with `bun.lock` committed:

  ```
  bun add --exact @3hillsit/atrium-connector-sdk
  ```

  The commands run from the repo's own copy of the SDK (`bunx atrium-connector …` in the repo), and the build bundles that copy into your Artifact.
- **A Customer Key,** to sign. An owner of your company's account creates one in the atrium Console, or registers one `keygen` made (below).

Nothing else: no atrium checkout, no account with 3HillsIT, no network beyond installing packages.

## The commands

Run each in the Connector repo (the folder holding `package.json` and `manifest.json`), except `init`, which makes one:

| Command | What it does |
|---|---|
| `bunx -p @3hillsit/atrium-connector-sdk atrium-connector init [dir]` | Writes a new Connector repo into an empty folder. Asks the id, the display name and the sign-in kind. |
| `bunx atrium-connector check` | Builds the Connector and checks it as an Instance would. Writes and signs nothing. |
| `bunx atrium-connector build` | Does the same, then writes the unsigned Artifact to `dist/` and records it in `atrium-builds.json`. |
| `bunx atrium-connector build --try` | The same, as the next try version of the manifest's version. |
| `bunx atrium-connector sign --key <key file> <artifact>` | Adds the key's signature to the Artifact. Needs no source. |
| `bunx atrium-connector keygen --name <name> --out <file>` | Makes a new signing key outside the browser. |

Every command exits `0` when it did what it says, `1` when it refused (each refusal names a page of this guide), and `2` for a usage error. `bunx atrium-connector help` lists them.

## init

```
$ bunx -p @3hillsit/atrium-connector-sdk atrium-connector init acme-tasks
Connector id (letters, digits, '.', '_' and '-'; it starts every Tool's name and never changes): acme-tasks
Display name (what the Studio shows): Acme Tasks
How does the system take its credential?
  1. pat          a token or API key, sent in one header
  2. multi-header a secret in one header, and settings from the Integration in others
  3. oauth2       Microsoft Entra ID, through the Instance's own Microsoft registration
Sign-in kind (a name or 1-3): 1
Wrote the Connector acme-tasks ("Acme Tasks") to /home/dev/acme-tasks.
```

`init` writes a Connector repo that passes its own tests and `check` before you change a line: `manifest.json` with your answers and an example `connection` block for the sign-in kind, one read and one write Action with their tests, the parity tests, `AGENTS.md` and `CLAUDE.md` for a coding agent, and an empty `atrium-builds.json`. Its `package.json` pins the SDK version that ran `init`. What each file is for is on [concepts.md](concepts.md#what-a-connector-repo-holds).

- **Each answer is also an option:** `--id <id>`, `--display-name <name>`, `--sign-in pat|multi-header|oauth2`. It asks only for what the options leave out, and without a terminal (a script, CI) it asks nothing: an answer left out is a usage error.
- **The folder** is `dir`, or the current one. It may not exist yet, or hold nothing but `.git`.
- **It installs nothing.** Run `bun install` in the new repo, and commit `bun.lock`.

Then replace the example values in the `connection` block (its `_comment` says which) and the example Actions with your system's ([manifest.md](manifest.md), [actions.md](actions.md)).

## check

```
$ bunx atrium-connector check
Bundle Contract v1: accepted by every atrium Release.
check passed: jira-dc 1.0.0, 4 actions. Nothing was written or signed.
```

In order, `check`:

1. reads `manifest.json` and its `connection` block ([manifest.md](manifest.md));
2. checks the version is a plain `MAJOR.MINOR.PATCH`, equal in `manifest.json` and `package.json` ([versions.md](versions.md));
3. reads the Bundle Contract version off the SDK your repo resolves, and prints which atrium Releases accept it;
4. loads your entry module and compares its exports with the manifest: exports and names, parity, the write flag ([rules.md](rules.md));
5. bundles each Action as the build does;
6. writes the Artifact in memory and opens it with the format's own reader, then loads each bundle the way an Instance does and checks it has a callable entry point ([troubleshooting.md](troubleshooting.md)).

It reports every problem it can find, not only the first, each with its rule and its page:

```
$ bunx atrium-connector check
Bundle Contract v1: accepted by every atrium Release.
write-flag: The action "create_issue" sends POST, and manifest.json doesn't say whether it changes anything. Add "write": true if it does, so its Tools wait for approval; add "write": false only if it just reads (a search sent as POST, say).
  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/rules.md
check failed: 1 problem. Nothing was written or signed.
```

Run it as often as you like, and before you call a change done.

## build

```
$ bunx atrium-connector build
Bundle Contract v1: accepted by every atrium Release.
Built jira-dc 1.0.0, unsigned: dist/jira-dc-1.0.0.atrium.tar.gz
Payload 025dbf4c…, recorded in atrium-builds.json. An Instance Adds it once it is signed: atrium-connector sign --key <key file> dist/jira-dc-1.0.0.atrium.tar.gz
```

`build` runs everything `check` does and stops the same way on a problem. When the Connector passes, it writes `dist/<id>-<version>.atrium.tar.gz`. The file is unsigned: an Instance refuses it until it is signed. Keep `dist/` out of git.

The payload is deterministic: the same source, lockfile and Bun give the same payload digest, byte for byte.

### The build record

`atrium-builds.json` holds one entry per version built: the version, its payload digest and when it was built.

```json
{
  "builds": [
    { "version": "1.0.0-try.1", "payloadSha256": "4d0a…", "builtAt": "2026-11-05T22:20:50.928Z" },
    { "version": "1.0.0", "payloadSha256": "025d…", "builtAt": "2026-11-05T22:20:51.075Z" }
  ]
}
```

**Commit it.** It is how `build --try` counts, and how `build` notices a version built twice with different bytes, for everyone who builds the Connector: you, your colleagues and CI. A missing file reads as empty. Rebuilding an unchanged version leaves the file as it was.

When `build` makes a version the record already has with a different payload, it warns, naming both digests, and builds anyway:

```
Warning: atrium-builds.json has jira-dc 1.0.0 built on 2026-11-05T22:20:51.075Z with payload 025dbf4c…; this build's payload is 786210c1…. An Instance that already has 1.0.0 refuses these bytes under the same version: use build --try, or bump the version, for one that does.
```

It doesn't refuse, because you may be rebuilding for a test Instance that never saw the first build. But **one version is one set of bytes**: an Instance that has `1.0.0` refuses another `1.0.0`. Before such a build leaves your machine, raise the version or build a try.

### Try versions

To try a change on a test Instance before you release it, build tries:

```
$ bunx atrium-connector build --try     # 1.2.0-try.1
$ bunx atrium-connector build --try     # 1.2.0-try.2
$ bunx atrium-connector build           # 1.2.0
```

`--try` takes the manifest's version `X.Y.Z` and the highest `X.Y.Z-try.N` in the build record, and builds `X.Y.Z-try.N+1`. You never edit `manifest.json` for a try. The plain `build` after your tries makes `1.2.0`, which the Store offers as an update over the last try.

Each try is a full Artifact. Sign it and Add it on a test Instance like any version. **Try Artifacts pile up there:** atrium never deletes an Artifact from an Instance's Drop Folder, and on a Managed-Hosted Cell nobody can clear it by hand. Try on an Instance meant for testing, never on the one people work on.

## sign

```
$ bunx atrium-connector sign --key ~/keys/acme-5edf8f879585b497.atrium-key.json dist/jira-dc-1.0.0.atrium.tar.gz
Signed jira-dc 1.0.0 with key 5edf8f879585b497 ("CI pipeline"): dist/jira-dc-1.0.0.atrium.tar.gz
payload.sig carries 1 signature (5edf8f879585b497). Payload 025dbf4c…, unchanged.
```

`sign` adds one signature, made with the key file's private half, to the Artifact. The payload and the version stay the same bytes, so the payload digest an Instance records is the one `build` printed.

- **The same key again** replaces its earlier signature, never doubling it.
- **Another key** adds a second signature beside the first. That is how a key rotation works (below).
- **It checks its own work.** Before it replaces the file, `sign` opens the signed Artifact with the key file's public half, as an Instance would. A damaged key file, or one whose private half isn't its public half's partner, fails here, not on the Instance.
- **A refusal changes nothing.** The file is replaced in one rename, only after the check passed.
- **It needs no source.** Build in one place and sign in another: a CI job, or a machine that holds the key and never sees the code.

Signing is a person's decision, or a pipeline's that a person set up. A coding agent never runs `sign`.

### Key files

A key file is JSON with the key id, the private half (base64 PKCS#8) and the public half (base64 SPKI). `sign` reads any file with those three and ignores other fields:

- **The Console's download,** `<account>-<keyId>.atrium-key.json`, offered once when an owner creates a Customer Key. It adds the key's `name` and `account`.
- **`keygen`'s file** (below), with the key's `name`.
- **Any other file** of that shape.

`sign` checks the key id is the one the public half derives (the first 8 bytes of SHA-256 over the SPKI, in hex), and that both halves are P-256 keys. Its messages name the file and never quote it.

**The private half signs code that runs on your company's Instances.** Keep the file where signing runs (a CI secret, a password manager) and nowhere else. Never commit it.

#### key-file

`sign` refuses a key file it can't use and says why: there is no file at the path; it isn't JSON; it lacks `keyId`, `privateKey` or `publicKey`; a half isn't a P-256 key; the key id isn't the public half's; or the signature it made doesn't verify with the public half ("the private half belongs to another key"). Check you passed the file you meant, and that it is the one the Console or `keygen` wrote, unedited. If it was damaged, it can't be repaired: create or register a new key.

### keygen

For a key that should never pass through a browser, such as one a CI secret store holds:

```
$ bunx atrium-connector keygen --name "CI pipeline" --out ci-pipeline.atrium-key.json > ci-pipeline.pub
Wrote the key "CI pipeline" (key 5edf8f879585b497) to /home/dev/ci-pipeline.atrium-key.json, mode 600. …
$ cat ci-pipeline.pub
key-id 5edf8f879585b497
public-key MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…
```

- `--out` gets the key file, private half included, with mode 600. `keygen` never overwrites a file.
- Standard output carries exactly the two lines the Console's Register takes, so `> ci-pipeline.pub` saves the paste. The private half is never printed. Everything else goes to standard error.
- `--name` is what an admin sees on each "Signed by" line. Name the key for who signs with it: a person, or a pipeline. At most 80 characters, no line breaks.

Then an owner of your account registers it: Console, your account's Customer Keys, Register, and paste the two lines. Store the key file as your CI's secret and delete the local copy.

#### new-key

`keygen` refuses an empty or too long name, an `--out` file that already exists, and an `--out` folder that doesn't. Nothing is written.

## From signed to Added

Before an Instance accepts your first Artifact:

1. **3HillsIT turns on Customer Connectors** for your company's account.
2. **An owner creates or registers your Customer Key** in the Console. Each key change makes the Console issue a new Customer Key List.
3. **The newest Customer Key List reaches the Instance.** A Managed-Hosted Cell receives it on its own, minutes after the change. On an On-Premise Instance, whoever runs it downloads the list from the Console and installs it (`atrium key-list install <file>` on the host, or an upload on the Studio's License page).

Then an admin of the Instance Adds the signed Artifact in the Studio's Connector Store: they upload it, or place it in the Drop Folder and rescan. The Add drawer shows your company as the owner and a "Signed by" line for each key that signed it. If the Store refuses the file, [troubleshooting.md](troubleshooting.md) lists each refusal and what to do.

A newer version Added later moves every Tool installed from the Connector to it, in every Workspace; the Add drawer shows what changes before anything does.

## Signing in CI

Build in one job and sign in another, so the job that holds the key never runs your code's tests or install scripts, and protect the signing job (a protected environment, a manual approval).

### GitHub Actions

The key file's whole JSON is the secret `ATRIUM_SIGNING_KEY` of an environment `signing` that needs a reviewer.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun test
      - run: bunx atrium-connector build
      - uses: actions/upload-artifact@v4
        with:
          name: unsigned
          path: dist/

  sign:
    needs: build
    runs-on: ubuntu-latest
    environment: signing
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile   # the SDK only; nothing is built here
      - uses: actions/download-artifact@v4
        with:
          name: unsigned
          path: dist/
      - name: Sign
        env:
          ATRIUM_SIGNING_KEY: ${{ secrets.ATRIUM_SIGNING_KEY }}
        run: |
          key="$RUNNER_TEMP/signing-key.json"
          (umask 077; printf '%s' "$ATRIUM_SIGNING_KEY" > "$key")
          bunx atrium-connector sign --key "$key" dist/*.atrium.tar.gz
          rm -f "$key"
      - uses: actions/upload-artifact@v4
        with:
          name: signed
          path: dist/
```

### Azure Pipelines

The key file is a secure file `atrium-signing-key.json` in the pipeline library, which the pipeline is permitted to use.

```yaml
stages:
  - stage: build
    jobs:
      - job: build
        pool: { vmImage: ubuntu-latest }
        steps:
          - script: |
              curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
              echo "##vso[task.prependpath]$HOME/.bun/bin"
            displayName: Install Bun
          - script: bun install --frozen-lockfile && bun test && bunx atrium-connector build
          - publish: dist
            artifact: unsigned

  - stage: sign
    jobs:
      - deployment: sign
        environment: signing        # add an approval check to this environment
        pool: { vmImage: ubuntu-latest }
        strategy:
          runOnce:
            deploy:
              steps:
                - checkout: self
                - script: |
                    curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
                    echo "##vso[task.prependpath]$HOME/.bun/bin"
                  displayName: Install Bun
                - script: bun install --frozen-lockfile
                - download: current
                  artifact: unsigned
                - task: DownloadSecureFile@1
                  name: signingKey
                  inputs:
                    secureFile: atrium-signing-key.json
                - script: bunx atrium-connector sign --key "$(signingKey.secureFilePath)" $(Pipeline.Workspace)/unsigned/*.atrium.tar.gz
                - publish: $(Pipeline.Workspace)/unsigned
                  artifact: signed
```

`sign` takes exactly one Artifact. A fresh build's `dist/` holds one file; if yours can hold more, name the file.

A machine with the SDK nowhere installed can still sign: `bunx -p @3hillsit/atrium-connector-sdk@<version> atrium-connector sign --key <file> <artifact>`, with the version your repo pins.

## Rotating a key

When a key leaves (a person leaves, a pipeline is replaced) or may have leaked:

1. **Create or register the new key** in the Console, and wait until the newest Customer Key List, which carries it, is on your Instances.
2. **Sign again** each Artifact your Instances have, with the new key: `sign --key <new key file> <artifact>`. It adds a second signature; the version and the payload don't change.
3. **The admin uploads and Adds the re-signed file.** The Instance records the new signer; no new version is needed.
4. **Remove the old key** in the Console.

A removed key can't bring in a new version. A Connector signed only by a key since removed keeps running, and the Store marks it "Key removed" until an Artifact of it signed by a current key is Added. If a key leaked, don't wait for step 3: remove it at once, then sign again with the new key.

## The other refusals on this page

### connector-package

`check` and `build` run in the folder they are started in. That folder needs a `package.json` and a `manifest.json`, and `package.json` must be valid JSON. Run the command in the Connector repo's root.

### sdk-installed

The build reads the Bundle Contract version off the SDK your repo resolves, so the SDK must be installed there: run `bun install`. If `bun install --frozen-lockfile` fails, the lockfile is stale: run `bun install` and commit `bun.lock`.

### new-repo

`init` writes only into an empty folder, and never over a file: the folder you named (or the current one) already holds something besides `.git`. Name a new folder, `init my-connector`, or empty this one. An id or a sign-in kind `init` refuses names [manifest.md](manifest.md) instead, where the id's rule and the three kinds are.

### build-record

`atrium-builds.json` isn't valid JSON, or isn't `{ "builds": [{ "version", "payloadSha256", "builtAt" }] }`. Restore it from git: try versions are numbered from it. Two branches that both built tries can conflict in it; keep every entry from both sides.
