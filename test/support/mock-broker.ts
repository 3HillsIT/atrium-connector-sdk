// Faithful stand-in for reference/atrium-broker.ts, built by mirroring its
// real request-handling logic line for line: same route, same auth check,
// same integrationId-binding check, same allowed-methods set, same body
// normalization, same auth-header-wins-over-user-header merge, same
// response-wrapping shape, same error bodies for every non-2xx case.
//
// The one thing intentionally NOT reproduced is attachAuth/buildRequestUrl
// from the main app's `services/provider-request` — those resolve a real
// provider's auth scheme and base URL, which live outside this repo and are
// irrelevant to the SDK/broker wire contract this package needs to prove out.
// They're replaced by a single fixed auth header and a fixed downstream base
// URL, both supplied by the test.

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const UNSAFE_RESPONSE_HEADERS = new Set(['set-cookie']);

export interface MockBrokerContext {
  integrationId: string;
  downstreamBaseUrl: string;
  authHeaderKey?: string;
  authHeaderValue?: string;
}

export interface MockAtriumBroker {
  url: string;
  token: string;
  stop(): Promise<void>;
}

export function startMockAtriumBroker(ctx: MockBrokerContext): MockAtriumBroker {
  const token = crypto.randomUUID();
  const authHeaderKey = ctx.authHeaderKey ?? 'authorization';
  const authHeaderValue = ctx.authHeaderValue ?? 'Bearer mock-downstream-secret';

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (req) => handleBrokerRequest(req),
  });

  async function handleBrokerRequest(req: Request): Promise<Response> {
    if (req.headers.get('authorization') !== `Bearer ${token}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (new URL(req.url).pathname !== '/request') {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    let body: { integrationId?: string; method?: string; path?: string; headers?: Record<string, string>; body?: unknown };
    try {
      body = (await req.json()) as typeof body;
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

    const authHeaders: Record<string, string> = { [authHeaderKey]: authHeaderValue };
    const authHeaderKeys = new Set(Object.keys(authHeaders).map((k) => k.toLowerCase()));
    const safeUserHeaders: Record<string, string> = {};
    if (body.headers && typeof body.headers === 'object') {
      for (const [key, value] of Object.entries(body.headers)) {
        if (typeof value === 'string' && !authHeaderKeys.has(key.toLowerCase())) {
          safeUserHeaders[key] = value;
        }
      }
    }

    const targetUrl = `${ctx.downstreamBaseUrl}${path}`;

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        method,
        headers: { ...safeUserHeaders, ...authHeaders },
        body: body.body !== undefined && body.body !== null ? JSON.stringify(body.body) : undefined,
        signal: AbortSignal.timeout(20_000),
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

  return {
    url: `http://127.0.0.1:${server.port}`,
    token,
    stop: () => server.stop(true),
  };
}
