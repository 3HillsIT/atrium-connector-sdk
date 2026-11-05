// `atrium-connector init [dir]`: writes a new Connector repo that passes its
// own tests and `check` as it stands.
//
// The repo is the SDK's examples/connector/ (a manifest, a read and a write
// Action, their tests, the parity tests, AGENTS.md and CLAUDE.md, the
// guided-build skill, an empty build record), with the developer's id, display
// name and sign-in kind put into manifest.json, the kind's `connection` block
// taken from examples/connections/<kind>.json, and a package.json that pins
// the SDK running this command. Each answer is an option, so CI and tests
// drive it; a person at a terminal is asked for what the options leave out.
//
// It writes only into an empty folder (a `.git` alone is allowed) and never
// over a file. It installs nothing: `bun install` is the developer's next step.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { BUILD_RECORD_FILE, RESERVED_CONNECTOR_IDS, guidePagePath } from '../build';
import type { RuleName } from '../build';
import { CONNECTION_AUTH_TYPES, CONNECTOR_ID_PATTERN } from '../artifact';
import type { ConnectionAuthType } from '../artifact';
import { guideLine, parseCommandArgs, refused } from './io';
import type { CliIO, Command } from './io';

const SDK_ROOT = resolve(import.meta.dir, '..', '..');
/** The repo `init` writes, as it stands in the SDK (and its npm package). */
export const TEMPLATE_DIRECTORY = join(SDK_ROOT, 'examples', 'connector');
/** One `{ _comment, connection }` file per sign-in kind. */
export const CONNECTIONS_DIRECTORY = join(SDK_ROOT, 'examples', 'connections');

/** What each sign-in kind a `connection` block can name means, as `init` offers them. */
export const SIGN_IN_KINDS: Record<ConnectionAuthType, string> = {
  pat: 'a token or API key, sent in one header',
  'multi-header': 'a secret in one header, and settings from the Integration in others',
  oauth2: 'Microsoft Entra ID, through the Instance\'s own Microsoft registration',
};

export type SignInKind = ConnectionAuthType;

/** `pat, multi-header or oauth2`. */
const SIGN_IN_NAMES = `${CONNECTION_AUTH_TYPES.slice(0, -1).join(', ')} or ${CONNECTION_AUTH_TYPES.at(-1)}`;

/**
 * Template files written under another name. npm leaves every `.gitignore`
 * out of a package, so the template keeps it without the dot.
 */
const RENAMED: Record<string, string> = { gitignore: '.gitignore' };
/** What a template folder may hold after someone ran it in place; never copied. */
const NOT_COPIED = new Set(['node_modules', 'dist', 'bun.lock', '.DS_Store']);

interface Answers {
  id: string;
  displayName: string;
  signIn: SignInKind;
}

interface Question {
  option: 'id' | 'display-name' | 'sign-in';
  prompt: string;
  /** The answer, normalised, or why it can't be one. */
  read: (answer: string) => { value: string } | { rule: RuleName; problem: string };
}

const SIGN_IN_LIST = CONNECTION_AUTH_TYPES.map(
  (kind, index) => `  ${index + 1}. ${kind.padEnd(12)} ${SIGN_IN_KINDS[kind]}`,
).join('\n');

const QUESTIONS: Question[] = [
  {
    option: 'id',
    prompt: "Connector id (letters, digits, '.', '_' and '-'; it starts every Tool's name and never changes):",
    read(answer) {
      const id = answer.trim();
      if (!id) return { rule: 'manifest', problem: 'Give the Connector an id, for example "acme-tasks".' };
      if (!CONNECTOR_ID_PATTERN.test(id)) {
        return {
          rule: 'manifest',
          problem:
            `"${id}" can't be a Connector's id: it has letters, digits, ".", "_" and "-" only, ` +
            'and starts with a letter or a digit.',
        };
      }
      if (RESERVED_CONNECTOR_IDS.has(id)) {
        return { rule: 'manifest', problem: `"${id}" can't be a Connector's id: atrium keeps it for itself.` };
      }
      return { value: id };
    },
  },
  {
    option: 'display-name',
    prompt: 'Display name (what the Studio shows):',
    read(answer) {
      const name = answer.trim();
      if (!name) return { rule: 'manifest', problem: 'Give the Connector a display name, for example "Acme Tasks".' };
      if (/\p{Cc}/u.test(name)) {
        return { rule: 'manifest', problem: 'A display name is one line of letters, digits, spaces and punctuation.' };
      }
      return { value: name };
    },
  },
  {
    option: 'sign-in',
    prompt: `How does the system take its credential?\n${SIGN_IN_LIST}\nSign-in kind (a name or 1-${CONNECTION_AUTH_TYPES.length}):`,
    read(answer) {
      const given = answer.trim().toLowerCase();
      const kinds: readonly SignInKind[] = CONNECTION_AUTH_TYPES;
      const kind = /^[1-9]$/.test(given) ? kinds[Number(given) - 1] : kinds.find((k) => k === given);
      if (kind) return { value: kind };
      return {
        rule: 'connection',
        problem:
          `"${answer.trim()}" isn't a sign-in kind: ${SIGN_IN_NAMES}. If the system signs in ` +
          "another way, atrium can't sign in to it yet.",
      };
    },
  },
];

export const init: Command = {
  usage: `init [dir] [--id <id>] [--display-name <name>] [--sign-in ${CONNECTION_AUTH_TYPES.join('|')}]`,
  summary:
    'Writes a new Connector repo into an empty folder that passes its tests and check. Asks for what the options leave out.',
  async run(args, io) {
    const parsed = parseCommandArgs(
      init,
      args,
      { id: { type: 'string' }, 'display-name': { type: 'string' }, 'sign-in': { type: 'string' } },
      io,
      [0, 1],
    );
    if (!parsed) return 2;
    const target = resolve(io.cwd, parsed.positionals[0] ?? '.');

    // The folder first, so nobody answers questions for a repo that can't be written.
    const folderProblem = notEmptyProblem(target);
    if (folderProblem) return refused('init', 'new-repo', folderProblem, io);

    const unanswered = QUESTIONS.filter((question) => typeof parsed.values[question.option] !== 'string');
    if (unanswered.length > 0 && !io.ask) {
      io.err(
        `Missing ${unanswered.map((question) => `--${question.option}`).join(', ')}: with nobody at a ` +
          `terminal to ask, init takes every answer as an option.\nusage: atrium-connector ${init.usage}`,
      );
      return 2;
    }

    const answers: Record<string, string> = {};
    for (const question of QUESTIONS) {
      const option = parsed.values[question.option];
      if (typeof option === 'string') {
        const read = question.read(option);
        if ('problem' in read) return refused('init', read.rule, read.problem, io);
        answers[question.option] = read.value;
        continue;
      }
      while (answers[question.option] === undefined) {
        const answer = await io.ask!(question.prompt);
        if (answer === null) {
          io.err('init stopped before every question had an answer. Nothing was written.');
          return 2;
        }
        const read = question.read(answer);
        if ('problem' in read) io.err(`${read.problem}\n${guideLine(read.rule)}`);
        else answers[question.option] = read.value;
      }
    }

    const written = writeConnectorRepo(target, {
      id: answers.id!,
      displayName: answers['display-name']!,
      signIn: answers['sign-in'] as SignInKind,
    });
    io.out(nextSteps(target, written, io));
    return 0;
  },
};

/** Why `init` can't write into the folder, or null when it is empty or isn't there yet. */
function notEmptyProblem(target: string): string | null {
  if (!existsSync(target)) return null;
  if (!statSync(target).isDirectory()) return `${target} is a file, not a folder.`;
  const entries = readdirSync(target).filter((name) => name !== '.git');
  if (entries.length === 0) return null;
  const shown = entries.sort().slice(0, 5).join(', ') + (entries.length > 5 ? ', …' : '');
  return `${target} already holds ${shown}. init writes a new Connector repo into an empty folder only.`;
}

/** The repo, written: what the template holds, with the answers in it. Returns the manifest written. */
function writeConnectorRepo(target: string, answers: Answers): TemplateManifest {
  mkdirSync(target, { recursive: true });
  copyTemplate(TEMPLATE_DIRECTORY, target);

  const template = readJson(join(TEMPLATE_DIRECTORY, 'manifest.json')) as TemplateManifest;
  const { _comment, connection } = readJson(join(CONNECTIONS_DIRECTORY, `${answers.signIn}.json`)) as {
    _comment: string[];
    connection: unknown;
  };
  const manifest = { ...template, id: answers.id, displayName: answers.displayName, _comment, connection };
  writeNew(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const sdk = readJson(join(SDK_ROOT, 'package.json')) as {
    name: string;
    version: string;
    devDependencies: Record<string, string>;
  };
  const packageJson = {
    // npm takes lower-case names only; an id is otherwise a valid one.
    name: answers.id.toLowerCase(),
    version: template.version,
    private: true,
    type: 'module',
    scripts: { test: 'bun test', typecheck: 'tsc --noEmit' },
    // The SDK that wrote the repo, exactly: the build bundles it into every Action.
    dependencies: { [sdk.name]: sdk.version },
    devDependencies: {
      '@types/bun': sdk.devDependencies['@types/bun'],
      typescript: sdk.devDependencies.typescript,
    },
  };
  writeNew(join(target, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  return manifest;
}

interface TemplateManifest {
  id: string;
  version: string;
  actions: Array<{ name: string; write?: boolean }>;
  [key: string]: unknown;
}

/** Every template file but manifest.json, which is written from the answers. */
function copyTemplate(from: string, to: string): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (NOT_COPIED.has(entry.name) || (from === TEMPLATE_DIRECTORY && entry.name === 'manifest.json')) continue;
    const source = join(from, entry.name);
    const destination = join(to, RENAMED[entry.name] ?? entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destination, { recursive: true });
      copyTemplate(source, destination);
    } else {
      writeNew(destination, readFileSync(source));
    }
  }
}

/** Created here or not at all: a file that appeared since the folder was checked is never overwritten. */
function writeNew(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { flag: 'wx' });
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function nextSteps(target: string, manifest: TemplateManifest, io: CliIO): string {
  // A short way there, or the whole path when the folder is somewhere else entirely.
  const fromHere = relative(io.cwd, target);
  const where = fromHere.startsWith('..') ? target : fromHere;
  const reads = manifest.actions.filter((action) => action.write !== true).map((action) => action.name);
  const writes = manifest.actions.filter((action) => action.write === true).map((action) => action.name);
  return [
    `Wrote the Connector ${manifest.id} ("${manifest.displayName}") to ${target}.`,
    `Its example Actions, to replace with your system's own: ${reads.join(', ')} reads, ${writes.join(', ')} writes. ` +
      `${BUILD_RECORD_FILE} is its empty build record; commit it.`,
    '',
    'Next:',
    ...(where ? [`  cd ${where}`] : []),
    '  bun install',
    '  bun test',
    '  bunx atrium-connector check',
    '',
    `AGENTS.md gives a coding agent the commands and the rules. The guide: ${guidePagePath('concepts')}, and the pages beside it.`,
  ].join('\n');
}
