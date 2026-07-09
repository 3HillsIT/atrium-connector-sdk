import { z, ZodError } from 'zod';
import type { AtriumClient } from './client';

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  handler: (ctx: AtriumClient, input: TInput) => Promise<TOutput>;
}

export interface ConnectorDefinition {
  id: string;
  displayName: string;
  description: string;
  authTypes: Array<'pat' | 'oauth2'>;
  configSchema: z.ZodType<unknown>;
  connectorApiVersion: number;
  // `any, any` (not the default `unknown, unknown`) deliberately — with
  // `unknown`, TS's contravariant check on `handler`'s input parameter makes
  // it impossible to put any concretely-typed action (which is every real
  // action) into this array at all. `any` is the standard escape valve for a
  // heterogeneous array of generic-callback types; see the handover's
  // decision-points list.
  actions: ActionDefinition<any, any>[];
  testConnection?: (ctx: AtriumClient) => Promise<{ ok: boolean; message?: string }>;
}

export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  return def;
}

export function defineAction<TInput, TOutput>(
  def: ActionDefinition<TInput, TOutput>
): ActionDefinition<TInput, TOutput> {
  return def;
}

function formatZodError(error: ZodError, label: string): string {
  const issues = error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
  return `${label}: ${issues}`;
}

/**
 * Runs an action's handler with schema validation at both boundaries:
 * input is parsed before the handler ever sees it, and the handler's return
 * value is parsed against outputSchema (if present) before it's handed back.
 * Neither defineAction nor defineConnector validate anything themselves —
 * they're plain identity functions — validation only happens here, at the
 * actual call boundary.
 */
export async function runAction<TInput, TOutput>(
  action: ActionDefinition<TInput, TOutput>,
  ctx: AtriumClient,
  rawInput: unknown
): Promise<TOutput> {
  let input: TInput;
  try {
    input = action.inputSchema.parse(rawInput);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatZodError(err, `Invalid input for action "${action.id}"`));
    }
    throw err;
  }

  const result = await action.handler(ctx, input);

  if (!action.outputSchema) return result;

  try {
    return action.outputSchema.parse(result);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(formatZodError(err, `Invalid output from action "${action.id}"`));
    }
    throw err;
  }
}
