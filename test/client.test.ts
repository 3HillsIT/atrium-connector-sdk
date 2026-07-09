import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createAtriumClient,
  AtriumBrokerAuthError,
  AtriumIntegrationMismatchError,
  AtriumBrokerRequestError,
  AtriumBrokerUnreachableError,
} from '../src/client';
import { startMockAtriumBroker, type MockAtriumBroker } from './support/mock-broker';
import { startFakeDownstream, type FakeDownstreamServer } from './support/fake-downstream';

const ENV_KEYS = ['ATRIUM_BROKER_URL', 'ATRIUM_BROKER_TOKEN'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('createAtriumClient env validation', () => {
  test('throws naming ATRIUM_BROKER_URL when missing', () => {
    delete process.env.ATRIUM_BROKER_URL;
    process.env.ATRIUM_BROKER_TOKEN = 'tok';
    expect(() => createAtriumClient('integration-123')).toThrow(/ATRIUM_BROKER_URL/);
  });

  test('throws naming ATRIUM_BROKER_TOKEN when missing', () => {
    process.env.ATRIUM_BROKER_URL = 'http://127.0.0.1:1';
    delete process.env.ATRIUM_BROKER_TOKEN;
    expect(() => createAtriumClient('integration-123')).toThrow(/ATRIUM_BROKER_TOKEN/);
  });
});

describe('createAtriumClient against the mock broker', () => {
  let downstream: FakeDownstreamServer;
  let broker: MockAtriumBroker;
  const integrationId = 'integration-123';

  beforeEach(() => {
    downstream = startFakeDownstream();
    broker = startMockAtriumBroker({ integrationId, downstreamBaseUrl: downstream.url });
    process.env.ATRIUM_BROKER_URL = broker.url;
    process.env.ATRIUM_BROKER_TOKEN = broker.token;
  });

  afterEach(async () => {
    await broker.stop();
    await downstream.stop();
  });

  test('round-trips a successful GET request', async () => {
    const client = createAtriumClient(integrationId);
    const res = await client.request('GET', '/projects');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: ['alpha', 'beta'] });
  });

  test('attaches the integrationId it was constructed with, and merges caller headers with the downstream call', async () => {
    const client = createAtriumClient(integrationId);
    await client.request('POST', '/echo', { headers: { 'x-custom': 'yes' }, body: { hello: 'world' } });
    expect(downstream.requests).toHaveLength(1);
    const req = downstream.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/echo');
    expect(req.body).toEqual({ hello: 'world' });
    expect(req.headers['x-custom']).toBe('yes');
  });

  test('caller headers cannot override the auth header the broker attaches', async () => {
    const client = createAtriumClient(integrationId);
    await client.request('GET', '/echo', { headers: { authorization: 'Bearer forged' } });
    const req = downstream.requests[0]!;
    expect(req.headers.authorization).toBe('Bearer mock-downstream-secret');
  });

  test('non-2xx downstream responses are returned, not thrown', async () => {
    const client = createAtriumClient(integrationId);
    const res = await client.request('GET', '/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'no such resource' });
  });

  test('non-JSON downstream responses are returned as a string body', async () => {
    const client = createAtriumClient(integrationId);
    const res = await client.request('GET', '/text');
    expect(res.status).toBe(200);
    expect(res.body).toBe('plain text response');
  });

  test('strips set-cookie from the downstream response headers', async () => {
    const client = createAtriumClient(integrationId);
    const res = await client.request('GET', '/set-cookie');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('throws AtriumIntegrationMismatchError when constructed with an integrationId the broker is not bound to', async () => {
    const client = createAtriumClient('some-other-integration');
    await expect(client.request('GET', '/projects')).rejects.toBeInstanceOf(AtriumIntegrationMismatchError);
  });

  test('throws AtriumBrokerAuthError on a 401 from the broker', async () => {
    process.env.ATRIUM_BROKER_TOKEN = 'wrong-token';
    const client = createAtriumClient(integrationId);
    await expect(client.request('GET', '/projects')).rejects.toBeInstanceOf(AtriumBrokerAuthError);
  });

  test('throws AtriumBrokerRequestError on an unsupported method', async () => {
    const client = createAtriumClient(integrationId);
    await expect(client.request('TRACE', '/projects')).rejects.toBeInstanceOf(AtriumBrokerRequestError);
  });

  test('throws AtriumBrokerRequestError (502) when the broker cannot reach the downstream API', async () => {
    await downstream.stop();
    const client = createAtriumClient(integrationId);
    let error: unknown;
    try {
      await client.request('GET', '/projects');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AtriumBrokerRequestError);
    expect((error as AtriumBrokerRequestError).status).toBe(502);
  });

  test('throws AtriumBrokerUnreachableError when the broker process itself is unreachable', async () => {
    process.env.ATRIUM_BROKER_URL = 'http://127.0.0.1:1';
    const client = createAtriumClient(integrationId);
    await expect(client.request('GET', '/projects')).rejects.toBeInstanceOf(AtriumBrokerUnreachableError);
  });
});
