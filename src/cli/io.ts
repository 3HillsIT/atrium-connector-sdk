// What a subcommand gets from the command line, and the shape it has.

import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { guidePagePath, RULES } from '../build';
import type { CheckFailure } from '../build';

export interface CliIO {
  /** The folder the command runs in: the Connector repo. */
  cwd: string;
  /** A line of what happened, for stdout. */
  out: (text: string) => void;
  /** A refusal, a warning or a usage error, for stderr. */
  err: (text: string) => void;
  /** The clock: when a build happened. */
  now: () => Date;
}

export interface Command {
  /** The usage line, starting with the command's name: `build [--try]`. */
  usage: string;
  /** One line for the help text. */
  summary: string;
  /** Runs with the arguments after the command's name; returns the exit code. */
  run: (args: string[], io: CliIO) => Promise<number>;
}

export function consoleIO(): CliIO {
  return {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text + '\n'),
    err: (text) => process.stderr.write(text + '\n'),
    now: () => new Date(),
  };
}

/**
 * The command's own options, strictly: an unknown option or a stray argument
 * is a usage error (exit 2) naming the usage line, never ignored.
 */
export function parseCommandArgs<T extends NonNullable<ParseArgsConfig['options']>>(
  command: Pick<Command, 'usage'>,
  args: string[],
  options: T,
  io: CliIO,
): { values: Record<keyof T, unknown> } | undefined {
  try {
    const { values } = parseArgs({ args, options, strict: true, allowPositionals: false });
    return { values: values as unknown as Record<keyof T, unknown> };
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : String(err)}\nusage: atrium-connector ${command.usage}`);
    return undefined;
  }
}

/** Each failure with its rule's name and its guide page. */
export function printFailures(failures: CheckFailure[], io: CliIO): void {
  for (const failure of failures) {
    io.err(`${failure.rule}: ${failure.message}\n  Guide: ${guidePagePath(RULES[failure.rule].page)}`);
  }
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
