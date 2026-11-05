# Troubleshooting

What each refusal means and what to do about it: first those of `check`, `build`, `sign` and `keygen` on your machine, then those an Instance gives when an admin uploads or Adds your Artifact. Read this page when a command or the Studio refuses.

## On your machine

`check` and `build` print each problem as `<rule>: <message>` with the guide page that explains the rule. `sign` and `keygen` print `sign failed: …` or `keygen failed: …` and their page. The message says what to change; the page says why the rule exists.

| Rule | Page |
|---|---|
| `connector-package`, `sdk-installed`, `build-record` | [build-and-sign.md](build-and-sign.md#the-other-refusals-on-this-page) |
| `manifest`, `connection`, `action-group` | [manifest.md](manifest.md) |
| `versions` | [versions.md](versions.md#the-versions-rule) |
| `exports-and-names`, `parity`, `write-flag`, `loads-cleanly` | [rules.md](rules.md) |
| `bundles`, `bundle-contract`, `format` | below |
| `key-file`, `new-key` | [build-and-sign.md](build-and-sign.md#key-file) |
| `signable-artifact` | below |

### bundles

Bun's bundler couldn't build an Action's bundle, or your entry module: `Failed to bundle connector action "create_issue": …`. The rest of the message is Bun's, for example `Could not resolve: "some-package". Maybe you need to "bun install"?`. Usually it is an import that doesn't resolve (a package not installed, a path with a typo) or a syntax error. Run `bun install`, then `bun run typecheck`, and fix what they report.

### bundle-contract

Each Action's bundle must export a callable `__atriumRun`, and keep working once atrium declares its own names beside it when it loads the Action.

- `does not export a callable __atriumRun`: the build's wrapper didn't make it into the bundle. Report it as an SDK issue, with the command's output.
- `loads on its own but not with what atrium declares beside it when it loads an Action (__atriumConnectorCtx, handler)`: your code declares one of those names at module top level. Rename your declaration.

### format

The Artifact the build made in memory doesn't pass the format's own reader. Either the message names a manifest field the reader refuses, which you fix in `manifest.json`, or it says the build wrote two payloads: report that as an SDK issue.

### signable-artifact

`sign` was given a path with no file, or a file it can't sign: not an Artifact, cut short, or changed since it was built (`The Artifact at … can't be signed: …`). Sign the file `build` wrote, as it wrote it. If it was copied, copy it again; if that fails too, build again.

### Usage errors

An unknown option, a missing `--key`, `--name` or `--out`, or the wrong number of files exits with `2` and prints the command's usage line. Nothing was read or written.

## When an Instance refuses the Artifact

An admin sees a refusal in the Studio's Add Connector drawer or under Refused in the Connector Store, with its code, a title and a "What to do". A refusal can't be overridden; the file has to change, or the Instance does. These are the ones a developer can cause, with what the developer does.

### signature-missing

**The Studio says:** "Not signed".
**It means:** the file has no signature: it is the unsigned Artifact `build` wrote.
**What to do:** sign it with a current Customer Key (`sign --key`) and upload the signed file.

### unknown-key

**The Studio says:** "Signed by a key this Instance doesn't trust".
**It means:** no key that signed it is on the Instance's Customer Key List, though the Instance has a list that counts.
**What to do:** check the key is one of your company's current Customer Keys in the Console, under the account this Instance is licensed to. If the key is new, the Instance needs the newest Customer Key List: a Managed-Hosted Cell receives it on its own within minutes; on an On-Premise Instance, whoever runs it installs the newest list. Then upload again. A file signed by another company's key is refused here for good.

### key-list-missing

**The Studio says:** "Install your Customer Key List".
**It means:** the file is signed by a key that isn't 3HillsIT's, and the Instance has no Customer Key List that counts: none was installed, or the installed one belongs to another account than the Instance's License.
**What to do:** have the Instance's operator install your account's newest Customer Key List, from the Console (`atrium key-list install <file>` on the host, or an upload on the Studio's License page). Updating atrium doesn't fix this.

### key-removed

**It means:** every key that signed the file was on an earlier Customer Key List and has since been removed. A removed key can't bring in a new version.
**What to do:** sign this version again with a current key (`sign --key <current key file> <artifact>`) and upload it again. The version doesn't change.

### owner-mismatch

**It means:** the Instance already has a Connector with this id from another owner, for example a 3HillsIT Connector, and your file is signed by your company's key, or the reverse. The Studio names both: "<name> is added from <owner>; this file is signed by <key name>, a key of <other owner>". An update must come from the installed version's owner; a file of another owner is never offered as an update.
**What to do:** a Connector of your own needs an id of its own. Change `id` in `manifest.json`, build, sign and upload. Tools installed from the other Connector stay where they are.

### mixed-owners

**It means:** the file is signed both by 3HillsIT's key and by a Customer Key. Every Connector has exactly one owner.
**What to do:** sign only the Artifacts you built, with your own keys. Build your own Connector from your source, under an id of its own, and sign that.

### digest-collision

**It means:** the Instance already has, or holds in its Drop Folder, the same id and version with different contents. One version is one set of bytes, and atrium refuses rather than overwrite it: Tools pin a version, and replacing its code would make that pin a lie.
**What to do:** build the change as a new version: raise `version` in `manifest.json` and `package.json`, or build a try with `build --try`. `build` warns you of this before it happens when the build record knows the version ([build-and-sign.md](build-and-sign.md#the-build-record)).

### contract-too-old

**The Studio says:** "Built for a Connector API this atrium doesn't run any more".
**It means:** the file speaks a Bundle Contract version this atrium no longer accepts. It is Incompatible, not damaged.
**What to do:** update the SDK to one that speaks a version the Instance accepts, raise your Connector's version, build, sign and upload. The "Leaving version" mark warns of this months ahead ([versions.md](versions.md#atriums-promise-a-bundle-contract-version-leaves-slowly)).

### contract-too-new

**The Studio says:** "Built for a newer Connector API".
**It means:** the file speaks a Bundle Contract version newer than this atrium runs.
**What to do:** the Instance needs a newer atrium; its operator updates it, then rescans. If the Instance must take the Connector before that, build it with an SDK major whose Bundle Contract version the Instance accepts, under a new version.

### filename-mismatch

**The Studio says:** "The file name doesn't match its manifest".
**It means:** the file was renamed. Its name must be `<id>-<version>.atrium.tar.gz`, as the build wrote it.
**What to do:** rename it back, or upload it in the Studio, which names the file from its manifest.

### The file was changed after it was signed

`signature-invalid`, `payload-digest-mismatch`, `listing-digest-mismatch`, `unexpected-file`, `missing-file`, `file-digest-mismatch`, `unsafe-entry`: the file is not what was signed. It was changed, or cut short on the way. Copy the signed file again from where `sign` wrote it. If a fresh copy is refused too, build and sign again, and find out what changed it.
