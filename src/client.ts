// Low-level client for talking to the Atrium mediation broker. This module is
// deliberately standalone: it must not import anything from the
// connector-authoring layer (./connector.ts, ./index.ts), so the main
// Atrium app's custom-code execution harness can eventually import only
// this file (via the "@3hillsit/atrium-connector-sdk/client" subpath) without
// pulling in Zod or any authoring machinery it doesn't need.
//
// Wire protocol here is verified against reference/atrium-broker.ts and
// reference/ts-runner.ts (the real broker + real client harness), not
// reconstructed from memory. See the handover for a full discrepancy list
// against the original spec.

export interface AtriumRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
}

export interface AtriumResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface AtriumClient {
  request(method: string, path: string, opts?: AtriumRequestOptions): Promise<AtriumResponse>;
  /**
   * Origin (scheme + host + port, no path) of the instance the linked
   * integration points at, e.g. `https://crm.example.com` for an instance URL
   * of `https://crm.example.com/services/rest`. Use it to build links back
   * into that instance's own UI for the user to click.
   *
   * Not a credential, so unlike the secret it is handed to the connector
   * directly. Undefined when the harness doesn't provide one (older Atrium
   * versions, or an endpoint without a linked integration).
   */
  readonly instanceOrigin?: string;
}

/** Base class for every error this client throws. Never carries a raw credential. */
export class AtriumClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The broker rejected the bearer token (401 from the broker itself). */
export class AtriumBrokerAuthError extends AtriumClientError {}

/** The integrationId sent did not match the integration the broker is bound to (403). */
export class AtriumIntegrationMismatchError extends AtriumClientError {}

/**
 * Any other broker-level error response (400 invalid body/method, 404 wrong
 * route, 502 broker could not reach the downstream API, etc). Distinct from
 * a non-2xx *downstream* response, which is returned normally, not thrown.
 */
export class AtriumBrokerRequestError extends AtriumClientError {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** The broker process itself could not be reached at all (network failure, not an HTTP error). */
export class AtriumBrokerUnreachableError extends AtriumClientError {}

const REQUIRED_ENV_VARS = ['ATRIUM_BROKER_URL', 'ATRIUM_BROKER_TOKEN'] as const;

function readInstanceOrigin(): string | undefined {
  const value = process.env.ATRIUM_INSTANCE_ORIGIN;
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(
      `@3hillsit/atrium-connector-sdk: environment variable "ATRIUM_INSTANCE_ORIGIN" is not a valid URL: "${value}".`
    );
  }
}

function readRequiredEnv(name: (typeof REQUIRED_ENV_VARS)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `@3hillsit/atrium-connector-sdk: missing required environment variable "${name}". ` +
        `createAtriumClient() must be called from inside an Atrium-managed execution context, ` +
        `where the mediation broker sets this before your connector code runs.`
    );
  }
  return value;
}

/**
 * Reads ATRIUM_BROKER_URL and ATRIUM_BROKER_TOKEN from process.env at call
 * time (not at module import time, since the harness may not have set them
 * yet when this module is first loaded). Throws immediately, naming the
 * missing variable, if either is absent.
 *
 * `integrationId` is NOT read from the environment — it's passed in
 * explicitly here, at construction time, by whatever resolved it before
 * spawning the broker (a future harness/dispatcher). This matches the real
 * wire protocol: atrium-broker.ts binds one integration per broker instance,
 * and the real ts-runner.ts/py-runner.ts client harness already threads
 * integrationId through as an explicit argument on every call rather than
 * via an env var — there's no ATRIUM_INTEGRATION_ID in the real protocol.
 * Every request() call below attaches this constructor-time value automatically;
 * connector-authoring code (Section 4's ctx.request(method, path, opts)) never
 * passes or sees it.
 *
 * ATRIUM_INSTANCE_ORIGIN is optional and exposed as `instanceOrigin`. It is
 * normalized to a bare origin, so a full instance URL with a path is fine too.
 */
export function createAtriumClient(integrationId: string): AtriumClient {
  const brokerUrl = readRequiredEnv('ATRIUM_BROKER_URL');
  const brokerToken = readRequiredEnv('ATRIUM_BROKER_TOKEN');
  const instanceOrigin = readInstanceOrigin();

  return {
    instanceOrigin,
    async request(method, path, opts = {}) {
      let res: Response;
      try {
        res = await fetch(`${brokerUrl}/request`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${brokerToken}`,
          },
          body: JSON.stringify({
            integrationId,
            method,
            path,
            headers: opts.headers,
            body: opts.body,
          }),
        });
      } catch (err) {
        throw new AtriumBrokerUnreachableError(
          `Could not reach the Atrium mediation broker at ${brokerUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        throw new AtriumBrokerRequestError(
          `Atrium broker returned a non-JSON response (status ${res.status})`,
          res.status
        );
      }

      // The broker always answers 200 for a successfully proxied call — even
      // when the *downstream* API returned a non-2xx status, which is carried
      // inside payload.status instead. A non-2xx HTTP status here means the
      // broker itself rejected the request (bad token, integration mismatch,
      // malformed body/method, or it couldn't reach the downstream API at all).
      if (!res.ok) {
        const message =
          payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : `Atrium broker request failed with status ${res.status}`;

        if (res.status === 401) throw new AtriumBrokerAuthError(message);
        if (res.status === 403) throw new AtriumIntegrationMismatchError(message);
        throw new AtriumBrokerRequestError(message, res.status);
      }

      return payload as AtriumResponse;
    },
  };
}
