# A Connector for atrium

This repo is an atrium Connector, written with `@3hillsit/atrium-connector-sdk`. `manifest.json` tells atrium what each Action is; the handlers in `src/actions/` do the work.

## Docs

The SDK's docs are in `node_modules/@3hillsit/atrium-connector-sdk/docs/` (after `bun install`). They describe exactly the SDK version installed here. Start with `concepts.md`. `bunx atrium-connector docs` opens them in your browser, as one page.

## Commands

```
bun install
bun test
bunx atrium-connector check
```

`check` builds the Connector and checks it as an Instance would. It writes and signs nothing; each failure names the rule and the docs page that explains it.

Coding agents: read `AGENTS.md`.
