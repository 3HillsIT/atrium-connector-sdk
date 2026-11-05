# The manifest

`manifest.json` is the contract between your Connector and atrium. atrium takes each Tool's name, description, input schema and write flag from it, and an Integration's fields and sign-in from its `connection` block. It never runs your code to learn any of this. Read this page before you change `manifest.json`.

The build never copies your `manifest.json` into the Artifact. It generates the published manifest from it, adding what only the build knows (each Action's bundle path, the Bundle Contract version, the Bun that built it). So the file you edit is the source manifest described here.

## A complete example

```json
{
  "id": "jira-dc",
  "displayName": "Jira Data Center",
  "version": "1.0.0",
  "entry": "src/index.ts",
  "connection": {
    "configSchema": {
      "fields": [
        { "name": "instanceUrl", "label": "Jira URL", "type": "string", "required": true,
          "description": "The address of your Jira, for example https://jira.example.com" }
      ]
    },
    "request": {
      "apiBasePath": "/rest/api/2",
      "healthCheckPath": "/myself",
      "auth": { "type": "pat", "headerName": "Authorization", "valuePrefix": "Bearer " }
    }
  },
  "actions": [
    {
      "name": "search_issues",
      "description": "Searches issues with a JQL query and returns their keys, summaries and statuses.",
      "inputSchema": {
        "type": "object",
        "properties": { "jql": { "type": "string" }, "maxResults": { "type": "number" } },
        "required": ["jql"]
      },
      "httpMethods": ["POST"],
      "write": false,
      "group": "Issues"
    },
    {
      "name": "create_issue",
      "description": "Creates an issue in a project and returns its key.",
      "inputSchema": {
        "type": "object",
        "properties": { "project": { "type": "string" }, "summary": { "type": "string" } },
        "required": ["project", "summary"]
      },
      "httpMethods": ["POST"],
      "write": true,
      "group": "Issues"
    }
  ]
}
```

## The top-level fields

`check` reports a problem with any of these under the rule `manifest`, unless a section below names another.

| Field | What it is |
|---|---|
| `id` | The Connector's id. Letters, digits, `.`, `_` and `-`, starting with a letter or digit (`^[A-Za-z0-9][A-Za-z0-9._-]*$`), and not `index`. It starts every Tool name (`<id>_<actionName>`), so keep it short and plain. It never changes: a different id is a different Connector. |
| `displayName` | The name the Studio shows. |
| `version` | The Connector's version, a plain `MAJOR.MINOR.PATCH`, equal to `package.json`'s. Never write a pre-release suffix; `build --try` adds one. See [versions.md](versions.md). |
| `entry` | The module the build bundles each Action from, relative to the repo: `src/index.ts`. It exports every Action. |
| `actions` | The Actions, at least one. See below. |
| `connection` | Required. What an Integration asks for and how a request is built and signed in. See below. |

Other top-level keys are left out of the published manifest. A `_comment` array of strings beside `connection` is a good place to explain your values, since `connection` itself accepts no extra keys.

## Each Action

| Field | What it is |
|---|---|
| `name` | The Action's name: equal to the `id` of the Action object your entry module exports. Letters, digits, `_` and `-`, starting with a letter or digit (`^[A-Za-z0-9][A-Za-z0-9_-]*$`), once per manifest. |
| `description` | What the AI model reads to choose the Tool. Write it for the model: what the Action does, what it returns, when to use it. It must equal the code's `description`. |
| `inputSchema` | A JSON Schema object: what an AI client is shown. Its `properties` and `required` must match your zod `inputSchema`, which is what checks a call. |
| `httpMethods` | The HTTP methods the handler sends, such as `["GET"]`. atrium treats it as documentation; `check` reads it for the `write-flag` rule. |
| `write` | `true` if the Action changes anything in the system. Only `true` puts its Tools behind atrium's write approval. `false` says an Action that sends more than GET only reads (a search sent as POST). Leave it out only for a read whose `httpMethods` say `GET`. See [rules.md](rules.md). |
| `group` | Optional. The heading the Studio groups the Action under when an admin installs it ("Issues", "Projects"). The rule `action-group`: a non-empty string of at most 40 characters, trimmed. Leave it out rather than empty. |

The rules that hold `actions` and your code together (`exports-and-names`, `parity`, `write-flag`) are on [rules.md](rules.md).

## The connection block

The rule `connection`: the block must be one an Instance's Add accepts. `check` runs the same validator Add runs, so a block Add would refuse fails on your machine, naming the field. The validator is strict: an unknown key is refused, so a typo such as `valueprefix` fails here and not at a customer's first call.

```
connection
  configSchema
    fields[]        what an Integration asks the admin for
  request
    apiBasePath     the path every call starts with
    healthCheckPath what atrium calls to test an Integration's credential
    auth            how the credential is attached: pat, multi-header or oauth2
```

### configSchema.fields

Each field is one value the admin enters on the Integration.

| Key | |
|---|---|
| `name` | Letters, digits and `_`, not starting with a digit. Unique. |
| `label` | What the Studio shows beside the input. |
| `type` | `"string"`, `"number"` or `"boolean"`. |
| `required` | `true` or `false`. |
| `default` | Optional, of the field's type. |
| `description` | Optional help text. |

A field named `instanceUrl` is special: it is the system's address. A call goes to `instanceUrl + apiBasePath + path`. A Connector whose system always lives at one address declares no `instanceUrl` and puts the full address in `apiBasePath`.

### request

- **`apiBasePath`** (string, may be empty): prefixed to every path your handler sends. It may name config fields in braces, filled from the Integration: `"https://dev.azure.com/{organization}"` needs a field `organization`.
- **`healthCheckPath`** (starts with `/`): a cheap read atrium calls when an admin tests an Integration, before it stores the credential. Pick one that fails with a wrong credential, such as "who am I".
- **`auth`:** one of the three sign-in kinds below.

### Sign-in kind `pat`: a token in one header

For a system that takes one secret (a personal access token, an API key) in one header.

```json
"auth": { "type": "pat", "headerName": "Authorization", "valuePrefix": "Bearer " }
```

- `headerName`: the header the secret goes in.
- `valuePrefix`: optional text before the secret, such as `"Bearer "` or `"Basic "`. Leave it out for a header that takes the raw token, such as `"X-API-Key"`.

The admin enters the token on the Integration. With the example above, atrium sends `Authorization: Bearer <token>` on every call.

### Sign-in kind `multi-header`: a secret plus settings in headers

For a system that wants the secret in one header and some of the Integration's own settings in others.

```json
"connection": {
  "configSchema": {
    "fields": [
      { "name": "instanceUrl", "label": "Server URL", "type": "string", "required": true },
      { "name": "tenant", "label": "Tenant", "type": "string", "required": true },
      { "name": "authMethod", "label": "Sign-in method", "type": "string", "required": true, "default": "token" }
    ]
  },
  "request": {
    "apiBasePath": "/services/rest",
    "healthCheckPath": "/session",
    "auth": {
      "type": "multi-header",
      "secretHeader": "X-Api-Token",
      "staticHeadersFromConfig": { "X-Tenant": "tenant", "X-Auth-Method": "authMethod" }
    }
  }
}
```

- `secretHeader`: the header the secret goes in, as entered on the Integration.
- `staticHeadersFromConfig`: header name to config field name. Each value comes from the Integration's settings, so every field it names must be in `configSchema.fields`. These are settings, not secrets.

### Sign-in kind `oauth2`: Microsoft Entra ID

For an API protected by Microsoft Entra ID. The block carries the scope and nothing else:

```json
"auth": { "type": "oauth2", "scope": "api://orders.example.com/.default" }
```

The sign-in, the token exchange and the refresh go through the Instance's own Microsoft registration, so nothing tenant-specific ships in your Artifact. Any other key here is refused. A system that signs in with another OAuth provider has no sign-in kind yet; tell 3HillsIT in an issue rather than working around the broker.

### When no kind fits

If the system needs a sign-in none of the three kinds describes, atrium can't sign in to it yet. Don't fetch tokens in your handler or read credentials from the environment: open an issue on the SDK's repo describing the sign-in.

## What the build adds

The published manifest in the Artifact carries, besides your fields: `manifestVersion` (the format's version), `connectorApiVersion` (the Bundle Contract version, read off the SDK your repo resolves; see [versions.md](versions.md)), each Action's `bundle` path, and `publishedWith.bun`. You never write these. `write` is carried only when it is `true`.
