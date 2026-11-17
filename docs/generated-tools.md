# Tools generated from the system

An ordinary Connector's Tools are fixed: one per Action in `manifest.json`, the same for every customer. Some systems differ per customer: one has entities of its own (an event booking, a custom project type) that no Connector version can know about in advance. For those, a Connector can let the system say what exists and have atrium make Tools from the answer, per Workspace. Read this page before you build such a Connector.

It needs atrium 5.2.0 or later, and SDK 1.2.0 or later to build.

## How it works

Two kinds of Action do it. Neither is ever offered as a Tool itself.

- **One discovery Action** asks the system what it holds. atrium runs it when an admin installs the Connector in a Workspace, when a new version is Added over one with installed Tools, and when an admin refreshes the Tools. It runs with that admin's own credential for the Integration.
- **Template Actions** are the code the generated Tools run. A template is generic: "read records of an entity", "write a record". What makes it one Tool (which entity, which webservice, which fields) is that Tool's **binding**, which atrium hands the template with every call.

The steps:

1. atrium runs discovery with input `{}`. It answers with the **catalog**: the entities the system has and the operations each allows.
2. The admin picks entities and operations, and may add a hint per entity.
3. atrium runs discovery again with the selection. It answers with finished **Tool definitions**: name, description, input schema, write flag, which template runs it, and its binding.
4. atrium checks every definition and stores it on its Tool in that Workspace.
5. When an AI client calls the Tool, atrium runs its template with the AI's input plus the binding under `__atriumBinding`.

Generated Tools are ordinary Tools everywhere else: write approval, Chat, MCP clients, the Studio's Test, call records.

## In manifest.json

Mark each of the two kinds with `kind`:

```json
"actions": [
  {
    "name": "discover",
    "kind": "discovery",
    "description": "Lists the entities the system holds, or the Tools for a selection of them.",
    "inputSchema": {
      "type": "object",
      "properties": { "selection": { "type": "object" } },
      "required": []
    },
    "httpMethods": ["GET"],
    "write": false
  },
  {
    "name": "read_record",
    "kind": "template",
    "description": "Reads records of the entity the binding names.",
    "inputSchema": {
      "type": "object",
      "properties": { "__atriumBinding": { "type": "object" } },
      "required": ["__atriumBinding"],
      "additionalProperties": true
    },
    "httpMethods": ["GET"],
    "write": false
  },
  {
    "name": "write_record",
    "kind": "template",
    "description": "Creates or changes a record of the entity the binding names.",
    "inputSchema": {
      "type": "object",
      "properties": { "__atriumBinding": { "type": "object" } },
      "required": ["__atriumBinding"],
      "additionalProperties": true
    },
    "httpMethods": ["POST", "PUT"],
    "write": true
  }
]
```

Each needs a `description`, an `inputSchema` and a `write` flag, like any Action, and `check` holds them to the same rules (`parity`, `write-flag`; see [rules.md](rules.md)). The descriptions are for developers: no AI client ever reads them.

- **The discovery Action** says `"write": false`: it only reads.
- **Each template** says `write` truthfully: `false` for one that reads, `true` for one that creates, changes or deletes. A generated Tool's own `write` is what puts it behind approval, but atrium refuses a definition with `"write": false` that names a template with `"write": true`.

A Connector may have ordinary Actions beside these. They stay installable as Tools, as before.

### action-kind

The rule `action-kind`, which `check` and `build` test:

- `kind` is `"discovery"` or `"template"`, or left out for an ordinary Action.
- At most one Action is `"discovery"`, and it doesn't declare `"write": true`.
- Neither kind comes without the other: a discovery Action with no template generates Tools nothing can run, and templates with no discovery Action never run.

### What the build writes

Once any Action has a `kind`, the build publishes the manifest at format version 4 instead of 3, carrying each Action's `kind`. An atrium Release before 5.2.0 Adds only version 3, so it refuses the Connector at Add (`manifest-too-new`) rather than offering your templates as Tools. A Connector without a `kind` is published at version 3 exactly as before.

The Bundle Contract doesn't change: the binding travels in the input, and `ctx` is the same. See [versions.md](versions.md).

## The discovery contract

Your discovery Action takes one of two inputs and answers each with JSON.

### Input `{}`: the catalog

```json
{
  "contractVersion": 1,
  "entities": [
    {
      "name": "person",
      "label": "Person",
      "source": "standard",
      "defaultEnabled": true,
      "operations": [
        { "name": "read", "write": false },
        { "name": "search", "write": false },
        { "name": "write", "write": true },
        { "name": "delete", "write": true }
      ]
    },
    {
      "name": "event_booking",
      "label": "Event booking",
      "source": "custom",
      "defaultEnabled": false,
      "operations": [{ "name": "read", "write": false }]
    }
  ],
  "warnings": []
}
```

| Field | |
|---|---|
| `contractVersion` | `1`. atrium refuses any other. |
| `entities[].name` | The entity's name, unique in the catalog. |
| `entities[].label` | What the admin sees in the picker. |
| `entities[].source` | `"standard"` for what every customer's system has, `"custom"` for what this one added. The picker groups by it. |
| `entities[].defaultEnabled` | `true` preselects a standard entity, with all its operations, when the admin first installs. Custom entities always start unticked. |
| `entities[].operations` | What can be done with the entity, each `{ name, write }`. `name` matches `^[a-z][a-z0-9_]*$`, is unique within its entity, and is your own word: atrium doesn't interpret it. `write` is `true` when the operation changes anything. atrium marks write operations in the picker, and when the admin refreshes, preselects a new standard entity's operations that don't write. |
| `warnings` | Strings atrium shows the admin, such as an entity skipped because it is misconfigured. |

### Input `{ "selection": … }`: the Tool definitions

```json
{
  "selection": {
    "person": { "operations": ["read", "write"], "hints": "Only staff, never customers." },
    "event_booking": { "operations": ["read"] }
  }
}
```

The selection names entities from the catalog, each with the operations the admin picked and the admin's optional `hints`, a text you work into those Tools' descriptions. Answer with:

```json
{
  "contractVersion": 1,
  "tools": [
    {
      "name": "read_person",
      "entity": "person",
      "operation": "read",
      "description": "Reads persons by id or filter. Only staff, never customers.",
      "inputSchema": {
        "type": "object",
        "properties": { "filter": { "type": "string", "description": "Only persons whose name contains this." } },
        "required": []
      },
      "write": false,
      "template": "read_record",
      "binding": { "service": "persons", "fields": ["id", "name", "email"] }
    }
  ],
  "warnings": []
}
```

An entity in the selection that the system no longer has: skip it and say so in `warnings`. Don't fail the whole answer.

### Tool definition rules

atrium checks every definition and refuses the whole answer, with a reason per failure, when one breaks a rule:

| Field | Rule |
|---|---|
| `name` | Matches `^[a-z][a-z0-9_]*$`, at most 50 characters, unique in the answer. The Tool is named `<connectorId>_<name>`, so the 50 leave room for your Connector's id within MCP's 64. Keep a name stable: an installed Tool is matched to its new definition by name when a new version is Added. |
| `entity`, `operation` | An entity and one of its operations from the selection; nothing the admin didn't pick. |
| `description` | The final text the AI client reads, the admin's hints worked in. |
| `inputSchema` | A JSON Schema object for the AI's input. It declares no property whose name starts with `__atrium`. No `$ref` and no `$defs` anywhere in it: some MCP clients refuse a whole Tool list over one. Write nested schemas out in full. atrium serves it exactly as written. |
| `write` | `true` or `false`, equal to its operation's `write` in the catalog. |
| `template` | The name of one of this Connector version's `"kind": "template"` Actions. A definition with `"write": false` may not name a template with `"write": true`. |
| `binding` | A JSON object of at most 64 KB: everything the template needs that the AI must not choose (the webservice, the fields, options). Keep help texts out of it. |

### Errors and limits

- **A refusal:** when discovery can't answer (the system is too old, or the admin's account has no access), throw an `Error` whose message tells the admin what to do. atrium shows it as it is.
- **Time:** a whole discovery run gets 60 seconds. Each `ctx.request` keeps its 20 seconds.
- **Size:** a run's output is capped at 10 MB.
- **Credential:** discovery runs with the credential of the admin who starts it. If they haven't linked one for the Integration, atrium asks them to before it runs.

## Writing a template

The SDK parses a template's input with its zod `inputSchema` before your handler runs, and a zod `z.object` drops every key it doesn't declare. So a template's schema declares `__atriumBinding` and lets the AI's keys through, with `z.looseObject`:

```ts
// src/actions/read-record.ts
import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

const Binding = z.object({ service: z.string(), fields: z.array(z.string()) });

export const readRecord = defineAction({
  id: 'read_record',
  description: 'Reads records of the entity the binding names.',
  inputSchema: z.looseObject({ __atriumBinding: z.record(z.string(), z.unknown()) }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    const { __atriumBinding, ...aiInput } = input;
    const binding = Binding.parse(__atriumBinding);
    const filter = z.object({ filter: z.string().optional() }).parse(aiInput);
    const query = filter.filter ? `?filter=${encodeURIComponent(filter.filter)}` : '';
    const res = await ctx.request('GET', `/${binding.service}${query}`);
    if (res.status !== 200) {
      throw new Error(`The system answered ${res.status} reading ${binding.service}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  },
});
```

- Take `__atriumBinding` out first, then check the rest of the input against what the binding says the Tool takes.
- The template's `inputSchema` in `manifest.json` lists `__atriumBinding` too, as in the example above, because `check`'s `parity` rule compares the two lists of properties.
- atrium removes any `__atriumBinding` an AI client sends, so the binding a template gets always comes from the stored definition.

## Approvals of generated Tools

atrium remembers approvals of write Tools, and a remembered approval ends when what the Tool does changes. For a generated Tool that is its template's code, its binding, its input schema and its write flag. Its description doesn't count, and neither do `description`, `title` and `examples` inside its input schema, so improving a text never makes people approve again. Anything else in the schema (a type, `required`, an enum) does count, and so does every byte of the binding.

## Testing

Test both kinds with `runAction` and a stand-in `ctx`, as any Action ([testing.md](testing.md)):

- the discovery Action with `{}`, and with a selection: the definitions keep the rules above, an unknown entity gives a warning, a refusal from the system gives a clear `Error`;
- each template with an input that carries `__atriumBinding`, and one that doesn't.
