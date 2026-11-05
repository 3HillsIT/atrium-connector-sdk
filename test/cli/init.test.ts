import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GUIDE_PAGES } from '../../src/build';
import { main } from '../../src/cli';
import type { CliIO } from '../../src/cli';
import { CONNECTIONS_DIRECTORY, SIGN_IN_KINDS, TEMPLATE_DIRECTORY } from '../../src/cli/init';
import { SDK_ROOT, runCommand } from '../support/connector-repo';

// `atrium-connector init [dir]`, through the command on temp folders: the repo
// it writes passes its own tests and `check` unchanged, for each sign-in kind.
//
// Nothing is published while the SDK is a beta, so the repo's pinned SDK is
// checked as a string, and the repo then gets this checkout as its installed
// SDK (a symlink, as `bun link` would make it). scripts/check-init.sh does the
// same with the packed SDK and a real `bun install`, typecheck included.

const SDK_VERSION = (JSON.parse(readFileSync(join(SDK_ROOT, 'package.json'), 'utf-8')) as { version: string }).version;
const KINDS = Object.keys(SIGN_IN_KINDS);

let dir: string;
beforeEach(() => {
  // Real path: the command resolves [dir] against its own cwd, which has no symlinks.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'atrium-connector-init-')));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (path: string) => readFileSync(join(dir, path), 'utf-8');
const readJson = (path: string) => JSON.parse(read(path));

/** Every file under a folder, relative to it, sorted. */
function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesUnder(root, path) : [path];
    })
    .sort();
}

function installThisSdk(repo: string): void {
  mkdirSync(join(repo, 'node_modules', '@3hillsit'), { recursive: true });
  symlinkSync(SDK_ROOT, join(repo, 'node_modules', '@3hillsit', 'atrium-connector-sdk'), 'dir');
}

async function bunTest(cwd: string): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(['bun', 'test'], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: stdout + stderr };
}

describe('init writes a repo that passes its own tests and check', () => {
  for (const kind of KINDS) {
    test(
      `sign-in kind ${kind}`,
      async () => {
        const run = await runCommand(dir, 'init', 'acme', '--id', 'acme-tasks', '--display-name', 'Acme Tasks', '--sign-in', kind);
        expect(run.stderr).toBe('');
        expect(run.exitCode).toBe(0);
        expect(run.stdout).toContain(`Wrote the Connector acme-tasks ("Acme Tasks") to ${join(dir, 'acme')}.`);
        expect(run.stdout).toContain('  cd acme\n  bun install\n  bun test\n  bunx atrium-connector check');

        const repo = join(dir, 'acme');
        const manifest = readJson('acme/manifest.json');
        expect(manifest.id).toBe('acme-tasks');
        expect(manifest.displayName).toBe('Acme Tasks');
        expect(manifest.connection.request.auth.type).toBe(kind);
        expect(manifest.connection).toEqual(
          JSON.parse(readFileSync(join(CONNECTIONS_DIRECTORY, `${kind}.json`), 'utf-8')).connection,
        );
        const packageJson = readJson('acme/package.json');
        expect(packageJson.name).toBe('acme-tasks');
        expect(packageJson.version).toBe(manifest.version);
        expect(packageJson.dependencies).toEqual({ '@3hillsit/atrium-connector-sdk': SDK_VERSION });

        installThisSdk(repo);
        const tests = await bunTest(repo);
        expect({ exitCode: tests.exitCode, output: tests.output }).toEqual({ exitCode: 0, output: expect.stringContaining(' 0 fail') });

        const check = await runCommand(repo, 'check');
        expect(check.stderr).toBe('');
        expect(check.exitCode).toBe(0);
        expect(check.stdout).toContain('check passed: acme-tasks 0.1.0, 2 actions. Nothing was written or signed.');
      },
      60_000,
    );
  }
});

describe('what the repo holds', () => {
  test("the template's files, a .gitignore, its package.json, and an empty build record", async () => {
    const run = await runCommand(dir, 'init', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'pat');
    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain('  cd ');

    const template = filesUnder(TEMPLATE_DIRECTORY).filter((path) => !/^(node_modules|dist)\//.test(path));
    expect(filesUnder(dir)).toEqual(
      [...template.map((path) => (path === 'gitignore' ? '.gitignore' : path)), 'package.json'].sort(),
    );
    expect(read('.gitignore').split('\n')).toContain('dist/');
    expect(readJson('atrium-builds.json')).toEqual({ builds: [] });
  });

  test('AGENTS.md for any coding agent, CLAUDE.md pointing at it, and the guided-build skill', async () => {
    await runCommand(dir, 'init', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'pat');

    expect(read('CLAUDE.md')).toBe('@AGENTS.md\n');
    const agents = read('AGENTS.md');
    expect(agents).toContain('Never run `atrium-connector sign`');
    for (const page of GUIDE_PAGES) {
      expect({ page, named: agents.includes(`${page}.md`) }).toEqual({ page, named: true });
    }
    expect(read('.claude/skills/build-connector/SKILL.md')).toContain(
      'node_modules/@3hillsit/atrium-connector-sdk/docs/guided-build.md',
    );
  });

  test("the template's own manifest is what init writes for pat", () => {
    const template = JSON.parse(readFileSync(join(TEMPLATE_DIRECTORY, 'manifest.json'), 'utf-8'));
    const pat = JSON.parse(readFileSync(join(CONNECTIONS_DIRECTORY, 'pat.json'), 'utf-8'));
    expect({ _comment: template._comment, connection: template.connection }).toEqual(pat);
  });

  test('a folder holding only .git is empty enough', async () => {
    mkdirSync(join(dir, '.git'));
    const run = await runCommand(dir, 'init', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'oauth2');
    expect(run.exitCode).toBe(0);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });
});

describe('init refuses, and writes nothing', () => {
  test('a folder that already holds files', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'mine');

    const run = await runCommand(dir, 'init', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'pat');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`init failed: ${dir} already holds notes.txt.`);
    expect(run.stderr).toContain('Nothing was written.\n  Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/build-and-sign.md');
    expect(readdirSync(dir)).toEqual(['notes.txt']);
  });

  test('an id a manifest refuses', async () => {
    const run = await runCommand(dir, 'init', 'repo', '--id', 'Acme Tasks', '--display-name', 'Acme', '--sign-in', 'pat');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`"Acme Tasks" can't be a Connector's id`);
    expect(run.stderr).toContain('Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/manifest.md');
    expect(existsSync(join(dir, 'repo'))).toBe(false);
  });

  test('a sign-in kind there is none of', async () => {
    const run = await runCommand(dir, 'init', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'basic');

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`"basic" isn't a sign-in kind: pat, multi-header or oauth2.`);
    expect(run.stderr).toContain('Guide: node_modules/@3hillsit/atrium-connector-sdk/docs/manifest.md');
    expect(readdirSync(dir)).toEqual([]);
  });

  test('answers left out with nobody at a terminal: a usage error naming them', async () => {
    const run = await runCommand(dir, 'init', '--id', 'acme');

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain('Missing --display-name, --sign-in');
    expect(run.stderr).toContain('usage: atrium-connector init [dir]');
    expect(readdirSync(dir)).toEqual([]);
  });

  test('two folders', async () => {
    const run = await runCommand(dir, 'init', 'one', 'two', '--id', 'acme', '--display-name', 'Acme', '--sign-in', 'pat');

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("Unexpected argument 'two'.");
  });
});

describe('a person at a terminal', () => {
  /** An io whose `ask` answers from a script and records each question. */
  function terminal(answers: Array<string | null>) {
    const asked: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = {
      cwd: dir,
      out: (text) => out.push(text),
      err: (text) => err.push(text),
      now: () => new Date(),
      ask: async (question) => {
        asked.push(question);
        return answers.shift() ?? null;
      },
    };
    return { io, asked, out, err };
  }

  test('is asked what the options leave out, again after an answer that can\'t be one', async () => {
    const { io, asked, err } = terminal(['Acme Tasks', 'acme-tasks', 'Acme Tasks', '2']);

    const code = await main(['init', 'repo'], io);

    expect(code).toBe(0);
    expect(asked.map((question) => question.split(' ')[0])).toEqual(['Connector', 'Connector', 'Display', 'How']);
    expect(asked[3]).toContain('1. pat');
    expect(err.join('\n')).toContain(`"Acme Tasks" can't be a Connector's id`);
    const manifest = JSON.parse(read('repo/manifest.json'));
    expect([manifest.id, manifest.displayName, manifest.connection.request.auth.type]).toEqual([
      'acme-tasks',
      'Acme Tasks',
      'multi-header',
    ]);
  });

  test('is asked only what the options leave out', async () => {
    const { io, asked } = terminal(['oauth2']);

    expect(await main(['init', '--id', 'acme', '--display-name', 'Acme'], io)).toBe(0);
    expect(asked).toHaveLength(1);
    expect(JSON.parse(read('manifest.json')).connection.request.auth.type).toBe('oauth2');
  });

  test('who stops answering gets nothing written', async () => {
    const { io, err } = terminal(['acme', null]);

    expect(await main(['init'], io)).toBe(2);
    expect(err.join('\n')).toContain('Nothing was written.');
    expect(readdirSync(dir)).toEqual([]);
  });
});

test('help lists init', async () => {
  const run = await runCommand(dir, 'help');
  expect(run.stdout).toContain('init [dir] [--id <id>] [--display-name <name>] [--sign-in pat|multi-header|oauth2]');
});
