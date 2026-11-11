import { describe, expect, test } from 'bun:test';
import { ASCII_GLYPHS, UTF8_GLYPHS, colourOn, createOutput, follow, isUtf8Locale, placeholder, usageWords } from '../../src/cli/output';
import type { Output, OutputEnv } from '../../src/cli/output';

// The look of every command's output, as the atrium CLI has it (Brand v2):
// the terminal's own 16 colours on glyphs, commands and labels only; plain off
// a terminal, with NO_COLOR or TERM=dumb; ASCII glyphs outside a UTF-8 locale.

function made(env: OutputEnv, tty = true): { out: Output; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = createOutput({
    stdout: { isTTY: tty, writeLine: (line) => stdout.push(line) },
    stderr: { isTTY: tty, writeLine: (line) => stderr.push(line) },
    env,
  });
  return { out, stdout, stderr };
}

const UTF8 = { LANG: 'en_US.UTF-8' };

describe('colour', () => {
  test('only on a terminal, unless FORCE_COLOR asks; NO_COLOR and TERM=dumb win', () => {
    expect(colourOn({ isTTY: true }, {})).toBe(true);
    expect(colourOn({ isTTY: false }, {})).toBe(false);
    expect(colourOn({ isTTY: undefined }, { FORCE_COLOR: '1' })).toBe(true);
    expect(colourOn({ isTTY: true }, { FORCE_COLOR: '0' })).toBe(false);
    expect(colourOn({ isTTY: true }, { NO_COLOR: '' })).toBe(false);
    expect(colourOn({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
    expect(colourOn({ isTTY: true }, { TERM: 'dumb' })).toBe(false);
  });

  test('stdout and stderr are decided apart', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const out = createOutput({
      stdout: { isTTY: false, writeLine: (line) => stdout.push(line) },
      stderr: { isTTY: true, writeLine: (line) => stderr.push(line) },
      env: UTF8,
    });
    out.success('done');
    out.stderr.failure('refused');
    expect(stdout).toEqual(['✓ done']);
    expect(stderr).toEqual(['\x1b[31m✗\x1b[39m refused']);
  });
});

describe('glyphs', () => {
  test('✓ ✗ ! in a UTF-8 locale, ok x ! otherwise', () => {
    expect(isUtf8Locale({ LANG: 'de_AT.UTF-8' })).toBe(true);
    expect(isUtf8Locale({ LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toBe(false);
    expect(isUtf8Locale({})).toBe(false);
    expect(made(UTF8).out.glyphs).toEqual(UTF8_GLYPHS);
    expect(made({}).out.glyphs).toEqual(ASCII_GLYPHS);
  });
});

describe('lines', () => {
  test('on a terminal: bold steps, coloured glyphs, cyan commands, faint labels and placeholders', () => {
    const { out, stdout } = made(UTF8);
    out.step('Building');
    out.success('Built');
    out.warning(['Run ', follow('bun test')]);
    out.failure('Refused');
    out.command('bun install');
    out.labels([
      ['Payload', 'abc'],
      ['Recorded', 'atrium-builds.json'],
    ]);
    out.text(['usage ', placeholder('<dir>')]);
    expect(stdout).toEqual([
      '\x1b[1m==> Building\x1b[22m',
      '\x1b[32m✓\x1b[39m Built',
      '\x1b[33m!\x1b[39m Run \x1b[36mbun test\x1b[39m',
      '\x1b[31m✗\x1b[39m Refused',
      '  \x1b[36mbun install\x1b[39m',
      '  \x1b[2mPayload \x1b[22m  abc',
      '  \x1b[2mRecorded\x1b[22m  atrium-builds.json',
      'usage \x1b[2m<dir>\x1b[22m',
    ]);
  });

  test('off a terminal: the same words, no escape codes', () => {
    const { out, stdout } = made(UTF8, false);
    out.step('Building');
    out.warning(['Run ', follow('bun test')]);
    out.command('bun install');
    out.text();
    expect(stdout).toEqual(['==> Building', '! Run bun test', '  bun install', '']);
  });

  test("a usage line's <placeholders> are marked", () => {
    expect(usageWords('keygen --name <name> --out <file>')).toEqual([
      'keygen --name ',
      placeholder('<name>'),
      ' --out ',
      placeholder('<file>'),
    ]);
  });
});
