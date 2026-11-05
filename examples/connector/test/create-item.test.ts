import { describe, expect, test } from 'bun:test';
import { runAction } from '@3hillsit/atrium-connector-sdk';
import { createItem } from '../src/actions/create-item';
import { stubCtx } from './stub-ctx';

describe('create_item', () => {
  test('sends exactly one POST with the name, and returns the new id', async () => {
    const { ctx, calls } = stubCtx({ status: 201, headers: {}, body: { id: 'i9', name: 'New' } });

    const result = await runAction(createItem, ctx, { name: 'New' });

    expect(calls).toEqual([{ method: 'POST', path: '/items', body: { name: 'New' } }]);
    expect(result).toEqual({ id: 'i9', name: 'New' });
  });

  test('a non-2xx answer is an error, not data', async () => {
    const { ctx } = stubCtx({ status: 400, headers: {}, body: { error: 'name taken' } });

    await expect(runAction(createItem, ctx, { name: 'New' })).rejects.toThrow(/400/);
  });

  test('input the schema refuses sends nothing', async () => {
    const { ctx, calls } = stubCtx({ status: 201, headers: {}, body: { id: 'i9', name: '' } });

    await expect(runAction(createItem, ctx, { name: '' })).rejects.toThrow(/Invalid input/);
    expect(calls).toEqual([]);
  });
});
