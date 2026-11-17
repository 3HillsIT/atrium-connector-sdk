// The one place that says which `kind`s a Connector's Actions may carry
// together (atrium #12326). The build (`src/build/source.ts`) and the reader
// (`envelope.ts`) both ask it, each wording the refusal for its own reader: the
// build tells a developer what to change, the reader tells an admin why an
// Artifact is refused. So the two can never disagree on what is valid.

import { ACTION_KINDS } from './types';

/** What `findActionKindProblem` needs of an Action, source or published. */
export interface KindedAction {
  name: string;
  kind?: unknown;
  write?: unknown;
}

/**
 * The first thing wrong with these Actions' kinds, or `undefined`:
 *
 * - `unknown-kind`: a `kind` that is neither `discovery` nor `template`.
 * - `second-discovery`: more than one Discovery Action (`names` lists them all).
 * - `discovery-writes`: the Discovery Action says `"write": true`; it only reads.
 * - `discovery-without-template`: every Tool discovery generates names a
 *   template, so with none, nothing could run them.
 * - `template-without-discovery`: a template runs only for a Generated Tool,
 *   and only a Discovery Action makes those.
 */
export type ActionKindProblem =
  | { problem: 'unknown-kind'; action: string; kind: unknown }
  | { problem: 'second-discovery'; action: string; names: string[] }
  | { problem: 'discovery-writes'; action: string }
  | { problem: 'discovery-without-template'; action: string }
  | { problem: 'template-without-discovery'; action: string; names: string[] };

/**
 * Checks the kinds of a Connector's Actions together. An Action with no `kind`
 * (`undefined`) is an ordinary one and is skipped; any other value, `null`
 * included, has to be one of `ACTION_KINDS`.
 */
export function findActionKindProblem(
  actions: ReadonlyArray<KindedAction>,
): ActionKindProblem | undefined {
  const discovery: KindedAction[] = [];
  const templates: string[] = [];
  for (const action of actions) {
    const kind = action.kind;
    if (kind === undefined) continue;
    if (!isActionKind(kind)) return { problem: 'unknown-kind', action: action.name, kind };
    if (kind === 'discovery') discovery.push(action);
    else templates.push(action.name);
  }
  const [first, second] = discovery;
  if (second !== undefined) {
    return { problem: 'second-discovery', action: second.name, names: discovery.map((a) => a.name) };
  }
  if (first !== undefined && first.write === true) {
    return { problem: 'discovery-writes', action: first.name };
  }
  if (first !== undefined && templates.length === 0) {
    return { problem: 'discovery-without-template', action: first.name };
  }
  if (first === undefined && templates.length > 0) {
    return { problem: 'template-without-discovery', action: templates[0]!, names: templates };
  }
  return undefined;
}

/** `"discovery" or "template"`, for a refusal's text. */
export const ACTION_KINDS_TEXT = ACTION_KINDS.map((k) => `"${k}"`).join(' or ');

function isActionKind(kind: unknown): kind is (typeof ACTION_KINDS)[number] {
  return (ACTION_KINDS as readonly unknown[]).includes(kind);
}

/** `"a", "b"`, for a refusal naming several Actions. */
export function quotedNames(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(', ');
}
