// What a subcommand gets from the command line, and the shape it has.

import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
import { guidePagePath, RULES } from '../build';
import type { CheckFailure, RuleName } from '../build';
import { openInBrowser } from './open';
import { createOutput, follow, usageWords } from './output';
import type { Lines, Output, OutputEnv, Words } from './output';

export interface CliIO {
  /** The folder the command runs in: the Connector repo. */
  cwd: string;
  /** A line of what happened, for stdout. */
  out: (text: string) => void;
  /** A refusal, a warning, a usage error, or a note that must stay off stdout (keygen's), for stderr. */
  err: (text: string) => void;
  /** The clock: when a build happened. */
  now: () => Date;
  /**
   * Asks a person at a terminal and returns their answer, or null when the
   * input ended. Absent when nobody is there to answer (a pipe, CI, a test):
   * a command then takes every answer as an option.
   */
  ask?: (question: string) => Promise<string | null>;
  /** Opens a file in the browser; true when it opened. Absent when nothing can open one (a test). */
  open?: (path: string) => Promise<boolean>;
  /** The environment the output reads (`NO_COLOR`, `FORCE_COLOR`, `TERM`, the locale). None: plain ASCII. */
  env?: OutputEnv;
  /** Whether stdout and stderr are terminals, which is when they get colour. */
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
}

const outputs = new WeakMap<CliIO, Output>();

/** How a command prints: the lines of Brand v2, over the IO's own `out` and `err`. */
export function ui(io: CliIO): Output {
  let output = outputs.get(io);
  if (!output) {
    output = createOutput({
      stdout: { isTTY: io.stdoutIsTTY, writeLine: io.out },
      stderr: { isTTY: io.stderrIsTTY, writeLine: io.err },
      env: io.env ?? {},
    });
    outputs.set(io, output);
  }
  return output;
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
    // Bun's prompt() writes the question and reads one line from stdin.
    ask: process.stdin.isTTY ? async (question) => prompt(question) : undefined,
    open: openInBrowser,
    env: process.env,
    stdoutIsTTY: process.stdout.isTTY,
    stderrIsTTY: process.stderr.isTTY,
  };
}

/**
 * The command's own options, strictly: an unknown option or a stray argument
 * is a usage error (exit 2) naming the usage line, never ignored.
 * `positionals` is how many arguments the command takes besides its options
 * (`sign`'s Artifact: 1), or the least and the most (`init [dir]`: [0, 1]);
 * any other number is a usage error too.
 */
export function parseCommandArgs<T extends NonNullable<ParseArgsConfig['options']>>(
  command: Pick<Command, 'usage'>,
  args: string[],
  options: T,
  io: CliIO,
  positionals: number | [min: number, max: number] = 0,
): { values: Record<keyof T, unknown>; positionals: string[] } | undefined {
  const refuseUsage = (message: string) => {
    usageError(command, message, io);
    return undefined;
  };
  const [least, most] = typeof positionals === 'number' ? [positionals, positionals] : positionals;
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: most > 0 });
  } catch (err) {
    return refuseUsage(err instanceof Error ? err.message : String(err));
  }
  if (parsed.positionals.length < least) {
    return refuseUsage(`Missing ${plural(least - parsed.positionals.length, 'argument', 'arguments')}.`);
  }
  if (parsed.positionals.length > most) {
    return refuseUsage(`Unexpected argument '${parsed.positionals[most]}'.`);
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
  usageError(command, `Option '--${name}' is required.`, io);
  return undefined;
}

/** A usage error, on stderr: what is wrong, then the usage line. Exit code 2 is the caller's. */
export function usageError(command: Pick<Command, 'usage'>, message: string, io: CliIO): void {
  ui(io).stderr.failure(message);
  ui(io).stderr.text(['usage: atrium-connector ', ...usageWords(command.usage)]);
}

/** The line under a refusal naming the guide page that explains its rule. */
export function guideLine(rule: RuleName): Words {
  return ['  Guide: ', follow(guidePagePath(RULES[rule].page))];
}

/** A refusal's problem and the guide page of its rule, on `lines`. */
export function printProblem(lines: Lines, rule: RuleName, problem: string): void {
  lines.failure(problem);
  lines.text(guideLine(rule));
}

/**
 * A command's one refusal, on stderr: `<command> failed: <message> Nothing
 * was written.` and the guide page of its rule. Returns the exit code, 1.
 */
export function refused(command: string, rule: RuleName, message: string, io: CliIO): number {
  printProblem(ui(io).stderr, rule, `${command} failed: ${message} Nothing was written.`);
  return 1;
}

/**
 * `check`'s and `build`'s refusal, on stderr: each failure with its rule's
 * name and its guide page, then `<command> failed: N problem(s). Nothing was
 * written or signed.` Returns the exit code, 1.
 */
export function refusedFailures(command: string, failures: CheckFailure[], io: CliIO): number {
  const lines = ui(io).stderr;
  for (const failure of failures) printProblem(lines, failure.rule, `${failure.rule}: ${failure.message}`);
  lines.failure(`${command} failed: ${plural(failures.length, 'problem', 'problems')}. Nothing was written or signed.`);
  return 1;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
