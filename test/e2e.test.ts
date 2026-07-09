import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAtriumClient } from '../src/client';
import { runAction } from '../src/connector';
import { acmeConnector } from '../examples/acme-connector';
import { startMockAtriumBroker, type MockAtriumBroker } from './support/mock-broker';
import { startFakeDownstream, type FakeDownstreamServer } from './support/fake-downstream';

// Proves the full authoring surface is usable end-to-end, not just
// individually-tested pieces: a connector built entirely with this SDK's
// public API, exercised against a broker that faithfully mirrors the real one.

describe('the Acme example connector end-to-end', () => {
  let downstream: FakeDownstreamServer;
  let broker: MockAtriumBroker;
  const integrationId = 'acme-integration';

  beforeEach(() => {
    downstream = startFakeDownstream();
    broker = startMockAtriumBroker({ integrationId, downstreamBaseUrl: downstream.url });
    process.env.ATRIUM_BROKER_URL = broker.url;
    process.env.ATRIUM_BROKER_TOKEN = broker.token;
  });

  afterEach(async () => {
    await broker.stop();
    await downstream.stop();
    delete process.env.ATRIUM_BROKER_URL;
    delete process.env.ATRIUM_BROKER_TOKEN;
  });

  test('list-widgets action round-trips through the broker', async () => {
    const client = createAtriumClient(integrationId);
    const listWidgets = acmeConnector.actions.find((a) => a.id === 'list-widgets')!;
    const result = await runAction(listWidgets, client, { status: 'active' });
    expect(result).toEqual({
      widgets: [
        { id: 'w1', name: 'Widget One' },
        { id: 'w2', name: 'Widget Two' },
      ],
    });
  });

  test('create-widget action validates input and round-trips through the broker', async () => {
    const client = createAtriumClient(integrationId);
    const createWidget = acmeConnector.actions.find((a) => a.id === 'create-widget')!;
    const result = await runAction(createWidget, client, { name: 'New Widget' });
    expect(result).toEqual({ id: 'w3', name: 'New Widget' });

    await expect(runAction(createWidget, client, { name: '' })).rejects.toThrow(/Invalid input/);
  });

  test("connector's testConnection reports ok against a working credential", async () => {
    const client = createAtriumClient(integrationId);
    const result = await acmeConnector.testConnection!(client);
    expect(result.ok).toBe(true);
  });
});
