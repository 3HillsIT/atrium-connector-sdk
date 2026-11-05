// The `atrium-connector` command: one entry, one table of subcommands.
//
// Each subcommand is a `Command` in COMMANDS: its usage line, a one-line
// summary for the help text, and `run`, which takes the arguments after the
// subcommand's name and returns the exit code. A new subcommand is a new file
// beside these and one row in the table.

import { build } from './build';
import { check } from './check';
import { keygen } from './keygen';
import { sign } from './sign';
import type { CliIO, Command } from './io';

export type { CliIO, Command } from './io';
export { consoleIO } from './io';

export const COMMANDS: Record<string, Command> = {
  check,
  build,
  sign,
  keygen,
};

function usage(): string {
  const width = Math.max(...Object.values(COMMANDS).map((command) => command.usage.length));
  return [
    'usage: atrium-connector <command>',
    '',
    ...Object.values(COMMANDS).map(
      (command) => `  ${command.usage.padEnd(width)}  ${command.summary}`,
    ),
    '',
    'Run it in a Connector repo with Bun. The guide is in node_modules/@3hillsit/atrium-connector-sdk/docs/.',
  ].join('\n');
}

/** Runs `atrium-connector <argv…>` and returns the exit code: 0 done, 1 refused, 2 a usage error. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    (name === undefined ? io.err : io.out)(usage());
    return name === undefined ? 2 : 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    io.err(`atrium-connector: there is no command "${name}".\n\n${usage()}`);
    return 2;
  }
  return await command.run(args, io);
}
