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
  /** A refusal, a warning, a usage error, or a note that must stay off stdout (keygen's), for stderr. */
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
 * `positionals` is how many arguments the command takes besides its options
 * (`sign`'s Artifact: 1); any other number is a usage error too.
 */
export function parseCommandArgs<T extends NonNullable<ParseArgsConfig['options']>>(
  command: Pick<Command, 'usage'>,
  args: string[],
  options: T,
  io: CliIO,
  positionals = 0,
): { values: Record<keyof T, unknown>; positionals: string[] } | undefined {
  const usageError = (message: string) => {
    io.err(`${message}\nusage: atrium-connector ${command.usage}`);
    return undefined;
  };
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: positionals > 0 });
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err));
  }
  if (parsed.positionals.length !== positionals) {
    return usageError(
      parsed.positionals.length < positionals
        ? `Missing ${plural(positionals - parsed.positionals.length, 'argument', 'arguments')}.`
        : `Unexpected argument '${parsed.positionals[positionals]}'.`,
    );
  }
  return {
    values: parsed.values as unknown as Record<keyof T, unknown>,
    positionals: parsed.positionals,
  };
}

/**
 * A required string option, or a usage error naming it. parseArgs already
 * refuses `--key` with no value; this refuses the option left out.
 */
export function requiredOption(
  command: Pick<Command, 'usage'>,
  values: Record<string, unknown>,
  name: string,
  io: CliIO,
): string | undefined {
  const value = values[name];
  if (typeof value === 'string' && value.trim() !== '') return value;
  io.err(`Option '--${name}' is required.\nusage: atrium-connector ${command.usage}`);
  return undefined;
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
