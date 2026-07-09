import { spawn } from 'bun';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startAtriumBroker, type AtriumRequestContext } from './atrium-broker';

const ATRIUM_GLOBAL = `
const __atriumBrokerUrl = process.env.ATRIUM_BROKER_URL;
const __atriumBrokerToken = process.env.ATRIUM_BROKER_TOKEN;
delete process.env.ATRIUM_BROKER_URL;
delete process.env.ATRIUM_BROKER_TOKEN;
globalThis.atrium = Object.freeze({
  request: async (integrationId, method, path, opts) => {
    if (!__atriumBrokerUrl || !__atriumBrokerToken) {
      throw new Error('atrium.request is unavailable: this endpoint has no integration linked.');
    }
    const res = await fetch(__atriumBrokerUrl + '/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + __atriumBrokerToken },
      body: JSON.stringify({ integrationId, method, path, headers: opts && opts.headers, body: opts && opts.body }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error((payload && payload.error) || ('atrium.request failed with status ' + res.status));
    return payload;
  },
});
`;

export async function runTypeScript(
  code: string,
  input: unknown,
  envVars: Record<string, string>,
  timeoutSeconds = 30,
  requestContext?: AtriumRequestContext | null
): Promise<unknown> {
  const envInjection = `const env = Object.freeze(${JSON.stringify(envVars)});\n`;
  const harness = `${envInjection}${ATRIUM_GLOBAL}${code}\n\nconst input = JSON.parse(await Bun.stdin.text());\ntry {\n  const result = await handler(input);\n  process.stdout.write(JSON.stringify({ ok: true, result }));\n} catch (err) {\n  process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));\n}\nprocess.exit(0);`;

  // envVars here never contain a raw integration credential (see
  // executor/atrium-broker.ts) — only team-shared envVars-based secrets,
  // which are a separate, already-accepted risk category. mode 0o600 keeps
  // the file unreadable to other local users regardless; the try/finally
  // guarantees cleanup even if spawn/await throws.
  const tmpFile = join(tmpdir(), `mcp-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(tmpFile, harness, { encoding: 'utf-8', mode: 0o600 });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  // Declared here (not assigned until inside the try) so that even a throw
  // from startAtriumBroker itself still reaches the finally below — every
  // exit path, including broker-startup failure, cleans up the temp file and
  // stops any broker that did start.
  let broker: ReturnType<typeof startAtriumBroker> | null = null;
  try {
    broker = requestContext ? startAtriumBroker(requestContext) : null;

    const proc = spawn({
      cmd: ['bun', 'run', tmpFile],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        HOME: tmpdir(),
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        ...(broker ? { ATRIUM_BROKER_URL: broker.url, ATRIUM_BROKER_TOKEN: broker.token } : {}),
      },
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    timeout = setTimeout(() => proc.kill(), timeoutSeconds * 1000);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) throw new Error(stderr || 'TypeScript execution failed');

    let parsed: { ok: boolean; result?: unknown; error?: string };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`Invalid executor output: ${stdout}`);
    }

    if (!parsed.ok) throw new Error(parsed.error ?? 'Handler threw an error');
    return parsed.result;
  } finally {
    if (timeout) clearTimeout(timeout);
    try { unlinkSync(tmpFile); } catch {}
    await broker?.stop();
  }
}
