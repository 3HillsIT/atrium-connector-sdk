import { describe, expect, test } from 'bun:test';
import { defineAction, runAction } from '../src/connector';
import { z } from 'zod';
import type { AtriumClient } from '../src/client';

const stubCtx: AtriumClient = {
  request: async () => ({ status: 200, headers: {}, body: null }),
};

describe('defineAction / runAction validation', () => {
  const echoLength = defineAction({
    id: 'echo-length',
    description: 'Returns the length of the input string.',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ length: z.number() }),
    handler: async (_ctx, input) => ({ length: input.text.length }),
  });

  test('valid input reaches the handler and output passes validation', async () => {
    const result = await runAction(echoLength, stubCtx, { text: 'hello' });
    expect(result).toEqual({ length: 5 });
  });

  test('malformed input throws before the handler runs', async () => {
    let handlerRan = false;
    const action = defineAction({
      id: 'should-not-run',
      description: 'test',
      inputSchema: z.object({ text: z.string() }),
      handler: async () => {
        handlerRan = true;
        return {};
      },
    });
    await expect(runAction(action, stubCtx, { text: 123 })).rejects.toThrow(/Invalid input/);
    expect(handlerRan).toBe(false);
  });

  test('a handler returning output that fails outputSchema throws', async () => {
    const action = defineAction({
      id: 'bad-output',
      description: 'test',
      inputSchema: z.object({}),
      outputSchema: z.object({ length: z.number() }),
      handler: async () => ({ length: 'not-a-number' }) as unknown as { length: number },
    });
    await expect(runAction(action, stubCtx, {})).rejects.toThrow(/Invalid output/);
  });

  test('an action with no outputSchema skips output validation', async () => {
    const action = defineAction({
      id: 'no-output-schema',
      description: 'test',
      inputSchema: z.object({}),
      handler: async () => ({ anything: 'goes' }),
    });
    const result = await runAction(action, stubCtx, {});
    expect(result).toEqual({ anything: 'goes' });
  });

  test('handler receives the AtriumClient, never a raw credential', async () => {
    let receivedCtx: unknown;
    const action = defineAction({
      id: 'capture-ctx',
      description: 'test',
      inputSchema: z.object({}),
      handler: async (ctx) => {
        receivedCtx = ctx;
        return {};
      },
    });
    await runAction(action, stubCtx, {});
    expect(receivedCtx).toBe(stubCtx);
    expect(JSON.stringify(receivedCtx)).not.toMatch(/secret|credential|token/i);
  });
});
