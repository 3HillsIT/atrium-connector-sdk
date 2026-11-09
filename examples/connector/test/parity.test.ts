import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from '@3hillsit/atrium-connector-sdk';

// manifest.json is what atrium reads: each Tool's name, description, input
// schema and write flag. The code is what atrium runs. These tests hold the
// two together, a little further than `atrium-connector check` does (the
// property types and httpMethods), and make the write Actions a decision
// written down by name.

interface ManifestAction {
  name: string;
  description: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
  httpMethods?: string[];
  write?: boolean;
}

interface CodeAction {
  id: string;
  description?: string;
  inputSchema: z.ZodType;
  httpMethods?: string[];
  handler: (...args: unknown[]) => unknown;
}

/**
 * The Actions that create, change, delete, send or trigger something in the
 * system, by name. Each has "write": true in manifest.json, so its Tools wait
 * for approval. Decide this list with the person you build the Connector for.
 */
const WRITE_ACTIONS = ['create_item'];

const ROOT = join(import.meta.dir, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf-8')) as {
  entry: string;
  actions: ManifestAction[];
};
const entry = (await import(join(ROOT, manifest.entry))) as Record<string, unknown>;

/** The Action objects the entry module exports, by id: what atrium finds each Action by. */
const exported = new Map<string, CodeAction>();
for (const value of Object.values(entry)) {
  const action = value as Partial<CodeAction> | null;
  if (typeof action?.id === 'string' && typeof action.handler === 'function') {
    exported.set(action.id, action as CodeAction);
  }
}

/** The JSON Schema types a zod schema can stand for; undefined when this test doesn't know it. */
function jsonTypes(schema: z.ZodType): string[] | undefined {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  ) {
    return jsonTypes(schema.unwrap() as z.ZodType);
  }
  // A .transform() is a pipe; a client sends what goes in.
  if (schema instanceof z.ZodPipe) return jsonTypes(schema.in as z.ZodType);
  // z.email(), z.url(), z.uuid() and the other string formats are strings.
  if (schema instanceof z.ZodString || schema instanceof z.ZodStringFormat || schema instanceof z.ZodEnum) {
    return ['string'];
  }
  if (schema instanceof z.ZodNumber) return schema.isInt ? ['integer', 'number'] : ['number'];
  if (schema instanceof z.ZodBoolean) return ['boolean'];
  if (schema instanceof z.ZodArray) return ['array'];
  if (schema instanceof z.ZodObject || schema instanceof z.ZodRecord) return ['object'];
  return undefined;
}

/** Whether a call may leave the property out: what zod itself checks. */
function isOptional(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

describe('manifest.json and the code', () => {
  test('declare the same Actions: every one in the manifest is exported under its name, and no other', () => {
    expect([...exported.keys()].sort()).toEqual(manifest.actions.map((action) => action.name).sort());
  });

  for (const action of manifest.actions) {
    describe(action.name, () => {
      const code = () => exported.get(action.name)!;

      test('has one description', () => {
        expect(code().description).toBe(action.description);
      });

      test('has the same input properties, required list and property types', () => {
        expect(code().inputSchema).toBeInstanceOf(z.ZodObject);
        const shape = (code().inputSchema as z.ZodObject).shape as Record<string, z.ZodType>;
        const properties = action.inputSchema.properties ?? {};

        expect(Object.keys(shape).sort()).toEqual(Object.keys(properties).sort());
        expect(Object.keys(shape).filter((key) => !isOptional(shape[key]!)).sort()).toEqual(
          [...(action.inputSchema.required ?? [])].sort(),
        );
        for (const [key, property] of Object.entries(properties)) {
          const types = jsonTypes(shape[key]!);
          if (!types) continue;
          expect({ property: key, typeMatchesCode: types.includes(String(property.type)) }).toEqual({
            property: key,
            typeMatchesCode: true,
          });
        }
      });

      test('sends the same HTTP methods', () => {
        expect(action.httpMethods).toEqual(code().httpMethods);
      });

      test(WRITE_ACTIONS.includes(action.name) ? 'is a write: "write": true' : 'is a read: no "write": true', () => {
        expect(action.write === true).toBe(WRITE_ACTIONS.includes(action.name));
      });
    });
  }
});
