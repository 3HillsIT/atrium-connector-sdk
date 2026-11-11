// How `atrium-connector` prints, in Brand v2: the same look and words as the
// atrium CLI, and no more. This is a trimmed copy of that CLI's output module
// (atrium's cli/src/lib/output.ts), kept here on purpose: the SDK stands on
// its own and shares no package with atrium. A command says what a line is (a
// step, a success, a warning, a failure, a command to run next, a label with
// its value) and this module decides how it looks.
//
// The rules it carries:
//
// - Colour is the terminal's own 16: cyan for a command or path to follow;
//   green, yellow and red on the glyph only, never on the sentence; bold for
//   steps; faint for labels and the help's placeholders. No 256 or 24-bit
//   colour, no background colour, no question to the terminal.
// - Colour is decided per stream: `NO_COLOR` (any value, even empty) or
//   `TERM=dumb` turns it off; else `FORCE_COLOR` turns it on; else only a
//   terminal gets it. So a CI log is plain text.
// - Glyphs `✓ ✗ !`, or `ok x !` when the locale isn't UTF-8.
// - What the atrium CLI has for an Instance and this one has no use for is
//   left out: the install banner, the outcome words, digests, `--json`, and
//   the step timer.

/** One stream a command writes to, and whether it is a terminal. */
export interface OutputStream {
  readonly isTTY?: boolean;
  /** Writes one whole line; the stream adds the newline. */
  writeLine(line: string): void;
}

/** The environment variables the output reads. */
export type OutputEnv = Readonly<Record<string, string | undefined>>;

export interface Surroundings {
  stdout: OutputStream;
  stderr: OutputStream;
  env: OutputEnv;
}

/**
 * Whether a stream gets colour: `NO_COLOR` set to anything, or `TERM=dumb`,
 * never; `FORCE_COLOR` always (unless `0` or `false`); otherwise only a
 * terminal. `NO_COLOR` wins over `FORCE_COLOR`.
 */
export function colourOn(stream: Pick<OutputStream, 'isTTY'>, env: OutputEnv): boolean {
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  return stream.isTTY === true;
}

/** Whether the locale is UTF-8: the first of `LC_ALL`, `LC_CTYPE` and `LANG` that is set decides. */
export function isUtf8Locale(env: OutputEnv): boolean {
  for (const key of ['LC_ALL', 'LC_CTYPE', 'LANG']) {
    const value = env[key];
    if (value) return /utf-?8/i.test(value);
  }
  return false;
}

export interface Glyphs {
  success: string;
  failure: string;
  warning: string;
}
export const UTF8_GLYPHS: Glyphs = { success: '✓', failure: '✗', warning: '!' };
export const ASCII_GLYPHS: Glyphs = { success: 'ok', failure: 'x', warning: '!' };

/** A command to run or a path to open, inside a sentence. Cyan. */
export interface Followable {
  readonly follow: string;
}
export function follow(text: string): Followable {
  return { follow: text };
}

/** Something in a line to replace with your own value, such as the help's `<dir>`. Faint. */
export interface Placeholder {
  readonly placeholder: string;
}
export function placeholder(text: string): Placeholder {
  return { placeholder: text };
}

/** A line's words: plain text, or text with followables and placeholders in it. Never a colour. */
export type Words = string | readonly (string | Followable | Placeholder)[];

/** The kinds of line a command prints on one stream. */
export interface Lines {
  /** `==> <words>`, in bold: a step the command is taking. */
  step(words: Words): void;
  /** `✓ <words>`, the glyph in green. */
  success(words: Words): void;
  /** `! <words>`, the glyph in yellow: a warning, or something still to do. */
  warning(words: Words): void;
  /** `✗ <words>`, the glyph in red: a failure or a refusal. */
  failure(words: Words): void;
  /** A plain line; an empty one with no words. A sentence carries its own indent. */
  text(words?: Words): void;
  /** A command to run next, on its own line, indented two spaces and in cyan, ready to copy. */
  command(command: string): void;
  /** `  <label>  <value>` per row, the labels in faint and padded to the longest. */
  labels(rows: readonly (readonly [label: string, value: Words])[]): void;
}

export interface Output extends Lines {
  readonly stderr: Lines;
  readonly glyphs: Glyphs;
}

type Style = readonly [open: string, close: string];
const BOLD = ['1', '22'] as const;
const FAINT = ['2', '22'] as const;
const CYAN = ['36', '39'] as const;
const GREEN = ['32', '39'] as const;
const YELLOW = ['33', '39'] as const;
const RED = ['31', '39'] as const;

function paintWith(colour: boolean, text: string, style: Style): string {
  if (!colour || text === '') return text;
  return `\x1b[${style[0]}m${text}\x1b[${style[1]}m`;
}

function joinWords(words: Words, onFollow: (text: string) => string, onPlaceholder: (text: string) => string): string {
  if (typeof words === 'string') return words;
  return words
    .map((part) => {
      if (typeof part === 'string') return part;
      return 'follow' in part ? onFollow(part.follow) : onPlaceholder(part.placeholder);
    })
    .join('');
}

function linesFor(stream: OutputStream, colour: boolean, glyphs: Glyphs): Lines {
  const paint = (text: string, style: Style): string => paintWith(colour, text, style);
  const render = (words: Words): string =>
    joinWords(words, (text) => paint(text, CYAN), (text) => paint(text, FAINT));
  const marked = (glyph: string, style: Style, words: Words): void =>
    stream.writeLine(`${paint(glyph, style)} ${render(words)}`);
  return {
    // Bold wraps the whole step; a followable inside it stays bold after its cyan closes.
    step: (words) => stream.writeLine(paint(`==> ${render(words)}`, BOLD)),
    success: (words) => marked(glyphs.success, GREEN, words),
    warning: (words) => marked(glyphs.warning, YELLOW, words),
    failure: (words) => marked(glyphs.failure, RED, words),
    text: (words = '') => stream.writeLine(render(words)),
    command: (command) => stream.writeLine(`  ${paint(command, CYAN)}`),
    labels: (rows) => {
      const width = Math.max(0, ...rows.map(([label]) => label.length));
      for (const [label, value] of rows) {
        stream.writeLine(`  ${paint(label.padEnd(width), FAINT)}  ${render(value)}`);
      }
    },
  };
}

/** Builds the output from its surroundings: production from `process`, tests from fakes. */
export function createOutput({ stdout, stderr, env }: Surroundings): Output {
  const glyphs = isUtf8Locale(env) ? UTF8_GLYPHS : ASCII_GLYPHS;
  return {
    ...linesFor(stdout, colourOn(stdout, env), glyphs),
    stderr: linesFor(stderr, colourOn(stderr, env), glyphs),
    glyphs,
  };
}

/** A usage line with its `<placeholders>` marked, so the help draws them faint. */
export function usageWords(usage: string): readonly (string | Placeholder)[] {
  return usage
    .split(/(<[^>]+>)/)
    .filter((part) => part !== '')
    .map((part) => (part.startsWith('<') ? placeholder(part) : part));
}
