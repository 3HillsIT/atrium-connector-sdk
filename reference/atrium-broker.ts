// The mediated-access broker behind `atrium.request(...)`. Sandboxed endpoint
// code never receives a raw credential — instead it talks, over a loopback
// HTTP server bound to 127.0.0.1 with a random per-execution bearer token, to
// this broker, which runs in Atrium's own backend process (never inside the
// spawned bun/python3 child). The broker resolves the real secret, attaches
// it the way the provider expects, makes the actual HTTP call, and returns
// only the response — the secret itself never crosses into the child.
//
// The broker is bound to exactly one (userId, integrationId, secret) tuple
// per execution — the one already resolved and gated by api/test.ts before
// the child was ever spawned. The `integrationId` argument sandboxed code
// passes to atrium.request(...) is validated against that bound id, not
// trusted blindly: an endpoint can only ever reach the single integration it
// declares via `endpoints.integrationId`, never some other integration the
// calling user happens to have separately linked.

import { attachAuth, buildRequestUrl, type ProviderRequestConfig } from '../services/provider-request';

export interface AtriumRequestContext {
  integrationId: string;
  instanceUrl: string;
  requestConfig: ProviderRequestConfig;
  secret: string;
}

// Origin (scheme + host + port) of the upstream the broker calls, handed to
// the child as ATRIUM_INSTANCE_ORIGIN so a connector can build links into the
// instance's own UI. Not a credential, so it can cross the boundary. Derived
// from the full API base rather than instanceUrl alone, because a provider
// without an instance concept (Azure DevOps) has instanceUrl '' and an
// absolute apiBasePath. Undefined when that base doesn't parse as a URL.
export function resolveInstanceOrigin(ctx: AtriumRequestContext): string | undefined {
  try {
    return new URL(buildRequestUrl(ctx.requestConfig, ctx.instanceUrl, '')).origin;
  } catch {
    return undefined;
  }
}

export interface AtriumBroker {
  url: string;
  token: string;
  stop(): Promise<void>;
}

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UPSTREAM_TIMEOUT_MS = 20_000;
const UNSAFE_RESPONSE_HEADERS = new Set(['set-cookie']);

export function startAtriumBroker(ctx: AtriumRequestContext): AtriumBroker {
  const token = crypto.randomUUID();

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req) => handleBrokerRequest(req, ctx, token),
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    token,
    stop: () => server.stop(true),
  };
}

async function handleBrokerRequest(req: Request, ctx: AtriumRequestContext, token: string): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${token}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (new URL(req.url).pathname !== '/request') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  let body: { integrationId?: string; method?: string; path?: string; headers?: Record<string, string>; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.integrationId !== ctx.integrationId) {
    return Response.json({ error: 'This endpoint is not linked to that integration.' }, { status: 403 });
  }

  const method = typeof body.method === 'string' ? body.method.toUpperCase() : '';
  if (!ALLOWED_METHODS.has(method)) {
    return Response.json({ error: `Unsupported method "${body.method}"` }, { status: 400 });
  }

  const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path : `/${body.path ?? ''}`;

  const authHeaders = attachAuth(ctx.requestConfig, ctx.secret);
  const authHeaderKeys = new Set(Object.keys(authHeaders).map((k) => k.toLowerCase()));
  const safeUserHeaders: Record<string, string> = {};
  if (body.headers && typeof body.headers === 'object') {
    for (const [key, value] of Object.entries(body.headers)) {
      if (typeof value === 'string' && !authHeaderKeys.has(key.toLowerCase())) {
        safeUserHeaders[key] = value;
      }
    }
  }

  const targetUrl = buildRequestUrl(ctx.requestConfig, ctx.instanceUrl, path);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: { ...safeUserHeaders, ...authHeaders },
      body: body.body !== undefined && body.body !== null ? JSON.stringify(body.body) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return Response.json(
      { error: `Could not reach the upstream service: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of upstream.headers.entries()) {
    if (!UNSAFE_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value;
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') ?? '';
  let responseBody: unknown = text;
  if (contentType.includes('application/json') && text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }
  }

  return Response.json({ status: upstream.status, headers: responseHeaders, body: responseBody });
}
