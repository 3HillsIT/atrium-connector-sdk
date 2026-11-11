// The `atrium-connector` command: one entry, one table of subcommands.
//
// Each subcommand is a `Command` in COMMANDS: its usage line, a one-line
// summary for the help text, and `run`, which takes the arguments after the
// subcommand's name and returns the exit code. A new subcommand is a new file
// beside these and one row in the table.

import { build } from './build';
import { check } from './check';
import { docs } from './docs';
import { init } from './init';
import { keygen } from './keygen';
import { sign } from './sign';
import { ui } from './io';
import type { CliIO, Command } from './io';
import { follow, usageWords } from './output';
import type { Lines } from './output';

export type { CliIO, Command } from './io';
export { consoleIO } from './io';

export const COMMANDS: Record<string, Command> = {
  init,
  check,
  build,
  sign,
  keygen,
  docs,
};

/** `text` in lines of at most `width` characters, broken between words: the help fits 80 columns. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return line ? [...lines, line] : lines;
}

function printUsage(lines: Lines): void {
  lines.text(['usage: atrium-connector ', { placeholder: '<command>' }]);
  lines.text();
  for (const command of Object.values(COMMANDS)) {
    lines.text(['  ', ...usageWords(command.usage)]);
    for (const line of wrap(command.summary, 72)) lines.text(`      ${line}`);
  }
  lines.text();
  lines.text(['Run it in a Connector repo with Bun. The docs are in ', follow('node_modules/@3hillsit/atrium-connector-sdk/docs/'), '.']);
}

/** Runs `atrium-connector <argv…>` and returns the exit code: 0 done, 1 refused, 2 a usage error. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  const [name, ...args] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    printUsage(name === undefined ? ui(io).stderr : ui(io));
    return name === undefined ? 2 : 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    ui(io).stderr.failure(`atrium-connector has no command "${name}".`);
    ui(io).stderr.text();
    printUsage(ui(io).stderr);
    return 2;
  }
  return await command.run(args, io);
}
