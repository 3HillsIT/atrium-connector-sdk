#!/usr/bin/env bun
// `bunx atrium-connector <command>`: see src/cli/index.ts for the commands.

import { consoleIO, main } from '../src/cli';

process.exit(await main(process.argv.slice(2), consoleIO()));
