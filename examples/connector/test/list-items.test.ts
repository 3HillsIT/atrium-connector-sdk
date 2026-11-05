import { describe, expect, test } from 'bun:test';
import { runAction } from '@3hillsit/atrium-connector-sdk';
import { listItems } from '../src/actions/list-items';
import { stubCtx } from './stub-ctx';

describe('list_items', () => {
  test('sends one GET with the status and the limit, and returns the items', async () => {
    const { ctx, calls } = stubCtx({
      status: 200,
      headers: {},
      body: { items: [{ id: 'i1', name: 'First', status: 'open', createdBy: 'someone' }] },
    });

    const result = await runAction(listItems, ctx, { status: 'open', limit: 5 });

    expect(calls).toEqual([{ method: 'GET', path: '/items?limit=5&status=open' }]);
    expect(result).toEqual({ items: [{ id: 'i1', name: 'First', status: 'open' }] });
  });

  test('without input, asks for the first 20 of any status', async () => {
    const { ctx, calls } = stubCtx({ status: 200, headers: {}, body: { items: [] } });

    await runAction(listItems, ctx, {});

    expect(calls).toEqual([{ method: 'GET', path: '/items?limit=20' }]);
  });

  test('a non-2xx answer is an error, not data', async () => {
    const { ctx } = stubCtx({ status: 401, headers: {}, body: { error: 'unauthorized' } });

    await expect(runAction(listItems, ctx, {})).rejects.toThrow(/401/);
  });

  test('input the schema refuses never reaches the handler', async () => {
    const { ctx, calls } = stubCtx({ status: 200, headers: {}, body: { items: [] } });

    await expect(runAction(listItems, ctx, { status: 'deleted' })).rejects.toThrow(/Invalid input/);
    expect(calls).toEqual([]);
  });
});
