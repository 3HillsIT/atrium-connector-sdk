// A tiny stand-in for the real downstream API (e.g. Azure DevOps) that the
// mock broker proxies to. Lets tests exercise the full client -> broker ->
// downstream -> broker -> client round trip, including non-2xx downstream
// responses and downstream-unreachable (502) cases.

export interface FakeDownstreamServer {
  url: string;
  requests: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }>;
  stop(): Promise<void>;
}

export function startFakeDownstream(): FakeDownstreamServer {
  const requests: FakeDownstreamServer['requests'] = [];

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers.entries()) headers[k] = v;

      let body: unknown = null;
      const raw = await req.text();
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }

      requests.push({ method: req.method, path: url.pathname, headers, body });

      if (url.pathname === '/projects') {
        return Response.json({ projects: ['alpha', 'beta'] });
      }
      if (url.pathname === '/not-found') {
        return Response.json({ error: 'no such resource' }, { status: 404 });
      }
      if (url.pathname === '/widgets' && req.method === 'GET') {
        return Response.json({
          widgets: [
            { id: 'w1', name: 'Widget One' },
            { id: 'w2', name: 'Widget Two' },
          ],
        });
      }
      if (url.pathname === '/widgets' && req.method === 'POST') {
        return Response.json({ id: 'w3', name: (body as { name: string }).name });
      }
      if (url.pathname === '/auth/verify') {
        return Response.json({ verified: true });
      }
      if (url.pathname === '/echo') {
        return Response.json({ receivedBody: body, receivedHeaders: headers });
      }
      if (url.pathname === '/text') {
        return new Response('plain text response', { headers: { 'content-type': 'text/plain' } });
      }
      if (url.pathname === '/set-cookie') {
        return Response.json({ ok: true }, { headers: { 'set-cookie': 'session=secret; HttpOnly' } });
      }

      return Response.json({ error: 'unknown fake route' }, { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  };
}
