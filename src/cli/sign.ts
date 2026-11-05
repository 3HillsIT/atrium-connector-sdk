// `atrium-connector sign --key <file> <artifact>`: adds the key file's
// signature to an Artifact `build` wrote, or to one already signed (a key
// rotation's second key). Only payload.sig changes, so the version and the
// payload digest an Instance records stay what `build` made. A signature by
// the same key is replaced, never doubled.
//
// The signed Artifact is opened with the key file's public half before it is
// written, so a damaged or mismatched key file fails here, at signing, rather
// than on the Instance. The file is replaced only once that passed, and in one
// rename, so a refusal leaves it exactly as it was.
//
// It needs neither the Connector's source nor its repo: build in one place,
// sign in another (a CI job holding the key file as a secret).

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { ConnectorArtifactError, addSignature } from '../artifact';
import type { AddedSignature } from '../artifact';
import type { RuleName } from '../build';
import { KeyFileRefusal, readKeyFile } from './key-file';
import type { LoadedKey } from './key-file';
import { guideLine, parseCommandArgs, plural, requiredOption } from './io';
import type { CliIO, Command } from './io';

export const sign: Command = {
  usage: 'sign --key <file> <artifact>',
  summary:
    "Adds the key file's signature to the Artifact, at a rotation too; the payload and its version stay the same.",
  async run(args, io) {
    const parsed = parseCommandArgs(sign, args, { key: { type: 'string' } }, io, 1);
    if (!parsed) return 2;
    const keyOption = requiredOption(sign, parsed.values, 'key', io);
    if (keyOption === undefined) return 2;
    const keyPath = resolve(io.cwd, keyOption);
    const artifactArg = parsed.positionals[0]!;
    const artifactPath = resolve(io.cwd, artifactArg);

    let key: LoadedKey;
    try {
      key = await readKeyFile(keyPath);
    } catch (err) {
      if (err instanceof KeyFileRefusal) return refused('key-file', err.message, io);
      throw err;
    }

    if (!existsSync(artifactPath)) {
      return refused('signable-artifact', `There is no Artifact at ${artifactPath}.`, io);
    }
    let added: AddedSignature;
    try {
      added = await addSignature(new Uint8Array(readFileSync(artifactPath)), key);
    } catch (err) {
      if (!(err instanceof ConnectorArtifactError)) throw err;
      return err.code === 'signature-invalid'
        ? refused('key-file', `${err.message} Check the key file at ${keyPath}.`, io)
        : refused('signable-artifact', `The Artifact at ${artifactPath} can't be signed: ${err.message}`, io);
    }

    replaceFile(artifactPath, added.bytes);

    const { id, version } = added.opened.manifest;
    const named = key.name ? `key ${key.keyId} ("${key.name}")` : `key ${key.keyId}`;
    io.out(
      `Signed ${id} ${version} with ${named}${added.replaced ? ', replacing its earlier signature' : ''}: ${artifactArg}\n` +
        `payload.sig carries ${plural(added.signedBy.length, 'signature', 'signatures')} ` +
        `(${added.signedBy.join(', ')}). Payload ${added.opened.payloadSha256}, unchanged.`,
    );
    return 0;
  },
};

/** Writes beside the file, then renames over it: the file is the old bytes or the new, never half. */
function replaceFile(path: string, bytes: Uint8Array): void {
  const temp = join(dirname(path), `.${basename(path)}.signing`);
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function refused(rule: RuleName, message: string, io: CliIO): number {
  io.err(`sign failed: ${message} Nothing was written.\n${guideLine(rule)}`);
  return 1;
}
