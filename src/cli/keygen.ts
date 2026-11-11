// `atrium-connector keygen --name <name> --out <file>`: makes a P-256 key
// outside the browser, for a key that should never pass through one (a CI
// secret store). The key file, private half included, goes to `--out`, mode
// 600, and is never overwritten. Standard output carries only what the
// Console's Register takes (`keygenPrintout`), so `keygen … > key.pub` is the
// paste; the private half never reaches it. What to do next goes to stderr.

import { chmodSync, existsSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { keyFileText, keygenPrintout, makeKeyFile } from './key-file';
import { parseCommandArgs, refused, requiredOption } from './io';
import type { Command } from './io';

/** The longest name a key may have: the Console's limit, so the name can be the one registered. */
export const KEY_NAME_MAX = 80;

export const keygen: Command = {
  usage: 'keygen --name <name> --out <file>',
  summary:
    'Writes a new signing key to <file> (mode 600) and prints the key id and public key the Console registers.',
  async run(args, io) {
    const parsed = parseCommandArgs(
      keygen,
      args,
      { name: { type: 'string' }, out: { type: 'string' } },
      io,
    );
    if (!parsed) return 2;
    const nameOption = requiredOption(keygen, parsed.values, 'name', io);
    if (nameOption === undefined) return 2;
    const outOption = requiredOption(keygen, parsed.values, 'out', io);
    if (outOption === undefined) return 2;

    const name = nameOption.trim();
    const problem = keyNameProblem(name);
    if (problem) return refused('keygen', 'new-key', problem, io);
    const outPath = resolve(io.cwd, outOption);
    if (existsSync(outPath)) {
      return refused('keygen', 'new-key', `${outPath} already exists. keygen never overwrites a key file.`, io);
    }
    if (!existsSync(dirname(outPath))) {
      return refused('keygen', 'new-key', `There is no folder ${dirname(outPath)} to write the key file in.`, io);
    }

    const file = await makeKeyFile(name);
    // 'wx': created here or not at all, so a file that appeared since the
    // check above is still never overwritten.
    writeFileSync(outPath, keyFileText(file), { mode: 0o600, flag: 'wx' });
    chmodSync(outPath, 0o600);

    io.out(keygenPrintout(file).trimEnd());
    io.err(
      [
        'This file is the only copy of the private key. Keep it somewhere safe; a password manager is one option.',
        `Wrote the key "${name}" (key ${file.keyId}) to ${outPath}, mode 600.`,
        'Do not commit it. Delete any local copy where signing does not run (a CI secret, say, is the one place it is needed).',
        'If it is lost, remove the key in the Console and make a new one.',
        "Register the two lines above in the Console, under your account's Customer Keys. Your company's Instances trust the key once the Console's next Customer Key List reaches them.",
      ].join('\n\n'),
    );
    return 0;
  },
};

/** Why a name can't be a key's, or null when it can: the Console's rule. */
export function keyNameProblem(name: string): string | null {
  if (!name) return 'Name the key for who uses it, for example "CI pipeline".';
  if (name.length > KEY_NAME_MAX) return `A key's name has at most ${KEY_NAME_MAX} characters.`;
  // A key's name is a line of the Customer Key List: no line breaks or control characters.
  if (/\p{Cc}/u.test(name)) return "A key's name has letters, digits, spaces and punctuation only.";
  return null;
}
