import { spawn } from 'bun';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveInstanceOrigin, startAtriumBroker, type AtriumRequestContext } from './atrium-broker';

const ATRIUM_GLOBAL = `
import urllib.request as _atrium_urllib_request
import urllib.error as _atrium_urllib_error

_atrium_broker_url = os.environ.get('ATRIUM_BROKER_URL')
_atrium_broker_token = os.environ.get('ATRIUM_BROKER_TOKEN')
os.environ.pop('ATRIUM_BROKER_URL', None)
os.environ.pop('ATRIUM_BROKER_TOKEN', None)

class _AtriumClient:
    instance_origin = os.environ.get('ATRIUM_INSTANCE_ORIGIN')

    @staticmethod
    def request(integration_id, method, path, headers=None, body=None):
        if not _atrium_broker_url or not _atrium_broker_token:
            raise Exception('atrium.request is unavailable: this endpoint has no integration linked.')
        payload = json.dumps({
            "integrationId": integration_id,
            "method": method,
            "path": path,
            "headers": headers,
            "body": body,
        }).encode("utf-8")
        req = _atrium_urllib_request.Request(
            _atrium_broker_url + "/request",
            data=payload,
            method="POST",
            headers={"content-type": "application/json", "authorization": "Bearer " + _atrium_broker_token},
        )
        try:
            with _atrium_urllib_request.urlopen(req) as res:
                return json.loads(res.read().decode("utf-8"))
        except _atrium_urllib_error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            try:
                message = json.loads(error_body).get("error", "atrium.request failed")
            except Exception:
                message = "atrium.request failed with status {}".format(e.code)
            raise Exception(message)

atrium = _AtriumClient()
`;

export async function runPython(
  code: string,
  input: unknown,
  envVars: Record<string, string>,
  timeoutSeconds = 30,
  requestContext?: AtriumRequestContext | null
): Promise<unknown> {
  const envLines = Object.entries(envVars)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');

  const harness = `import sys, json, os

env = {
${envLines}
}
${ATRIUM_GLOBAL}
${code}

input_data = json.loads(sys.stdin.read())
try:
    result = handler(input_data)
    sys.stdout.write(json.dumps({"ok": True, "result": result}))
except Exception as e:
    sys.stdout.write(json.dumps({"ok": False, "error": str(e)}))
sys.exit(0)
`;

  // envVars here never contain a raw integration credential (see
  // executor/atrium-broker.ts) — only team-shared envVars-based secrets,
  // which are a separate, already-accepted risk category. mode 0o600 keeps
  // the file unreadable to other local users regardless; the try/finally
  // guarantees cleanup even if spawn/await throws.
  const tmpFile = join(tmpdir(), `mcp-exec-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
  writeFileSync(tmpFile, harness, { encoding: 'utf-8', mode: 0o600 });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  // Declared here (not assigned until inside the try) so that even a throw
  // from startAtriumBroker itself still reaches the finally below — every
  // exit path, including broker-startup failure, cleans up the temp file and
  // stops any broker that did start.
  let broker: ReturnType<typeof startAtriumBroker> | null = null;
  try {
    broker = requestContext ? startAtriumBroker(requestContext) : null;
    const instanceOrigin = requestContext ? resolveInstanceOrigin(requestContext) : undefined;

    const proc = spawn({
      cmd: ['python3', tmpFile],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        HOME: tmpdir(),
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        ...(broker ? { ATRIUM_BROKER_URL: broker.url, ATRIUM_BROKER_TOKEN: broker.token } : {}),
        ...(instanceOrigin ? { ATRIUM_INSTANCE_ORIGIN: instanceOrigin } : {}),
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

    if (exitCode !== 0) throw new Error(stderr || 'Python execution failed');

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
