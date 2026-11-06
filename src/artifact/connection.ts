// The one validator for a manifest's `connection` block — the Connector's own
// connection settings (ADR-0014 §2).
//
// Shared by Add (through `parsePublishedManifest`) and by the publish script,
// which runs it on the source manifest before anything is built or signed, so
// an author gets exactly the refusal an Instance would give, at publish time
// rather than from a customer. It lives here, with the rest of the format,
// because this module is what both sides — and the CLI — compile in; nothing
// database- or HTTP-shaped belongs in it.
//
// Strict on purpose: an unknown key is refused rather than ignored. The block
// is versioned by `manifestVersion`, so a field this Atrium does not know is a
// field it would silently drop, and a typo'd optional key (`valueprefix`) is
// exactly the mistake that otherwise ships and fails at a customer's first
// call. Every refusal names the field, as a path from `connection`.

import { artifactError } from './errors';
import { CONNECTION_AUTH_TYPES } from './types';
import type { ConnectorConnection } from './types';

/** What a config field's name must look like: an apiBasePath placeholder is `{\w+}`. */
const CONFIG_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An HTTP header name — RFC 9110's `token`. Anything else fails at call time. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const CONFIG_FIELD_TYPES = new Set(['string', 'number', 'boolean']);

/** `{fieldName}` in an apiBasePath — the same placeholder atrium's resolveConnection (services/connection-request.ts) substitutes. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The `connection` block a manifest must carry, validated. A manifest without
 * one is refused naming the field: the block is the only source of a
 * Connector's connection settings, so a Connector without it could never
 * have an Integration that connects (spec part C, "Only the manifest
 * connects"). Add runs it on a version-3 manifest, and publish on the source
 * manifest, so an author meets the refusal at publish time.
 */
export function parseRequiredConnection(raw: unknown, where = 'manifest.json'): ConnectorConnection {
  if (raw === undefined) {
    throw artifactError(
      'manifest-invalid',
      `${where} declares no connection block. A Connector must bring its connection settings ` +
        '(connection: its configSchema and its request), or no Integration of it can connect.',
      { field: 'connection' },
    );
  }
  return parseConnection(raw, where);
}

/**
 * Validates a `connection` block, throwing `manifest-invalid` naming the field
 * at fault. Returns the block unchanged, typed — strictness means a value that
 * passes is exactly the shape, so there is nothing to normalise.
 *
 * `where` names the document in the message: `manifest.json` on Add, the
 * source manifest's path at publish.
 */
export function parseConnection(raw: unknown, where = 'manifest.json'): ConnectorConnection {
  const refuse = (field: string, problem: string): never => {
    throw artifactError(
      'manifest-invalid',
      `${where} declares a malformed connection block: ${field} ${problem}`,
      { field },
    );
  };

  const onlyKeys = (value: Plain, path: string, allowed: string[], hint = ''): void => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        refuse(`${path}.${key}`, `is not a recognised field${hint}.`);
      }
    }
  };

  const nonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== 'string' || value.trim() === '') refuse(field, 'must be a non-empty string.');
    return value as string;
  };

  const headerName = (value: unknown, field: string): string => {
    const name = nonEmptyString(value, field);
    if (!HEADER_NAME_PATTERN.test(name)) refuse(field, `("${name}") is not a valid HTTP header name.`);
    return name;
  };

  if (!isPlainObject(raw)) refuse('connection', 'must be an object.');
  const connection = raw as Plain;
  onlyKeys(connection, 'connection', ['configSchema', 'request']);

  // --- configSchema ------------------------------------------------------
  if (!isPlainObject(connection.configSchema)) {
    refuse('connection.configSchema', 'must be an object with a fields array.');
  }
  const configSchema = connection.configSchema as Plain;
  onlyKeys(configSchema, 'connection.configSchema', ['fields']);
  if (!Array.isArray(configSchema.fields)) {
    refuse('connection.configSchema.fields', 'must be an array.');
  }

  const fieldNames = new Set<string>();
  (configSchema.fields as unknown[]).forEach((entry, index) => {
    const path = `connection.configSchema.fields[${index}]`;
    if (!isPlainObject(entry)) refuse(path, 'must be an object.');
    const field = entry as Plain;
    onlyKeys(field, path, ['name', 'label', 'type', 'required', 'default', 'description']);

    const name = nonEmptyString(field.name, `${path}.name`);
    if (!CONFIG_FIELD_NAME_PATTERN.test(name)) {
      refuse(`${path}.name`, `("${name}") must be letters, digits and underscores, not starting with a digit.`);
    }
    if (fieldNames.has(name)) refuse(`${path}.name`, `("${name}") is declared twice.`);
    fieldNames.add(name);

    nonEmptyString(field.label, `${path}.label`);
    if (typeof field.type !== 'string' || !CONFIG_FIELD_TYPES.has(field.type)) {
      refuse(`${path}.type`, 'must be one of "string", "number" or "boolean".');
    }
    if (typeof field.required !== 'boolean') refuse(`${path}.required`, 'must be true or false.');
    if (field.default !== undefined && typeof field.default !== field.type) {
      refuse(`${path}.default`, `must be a ${String(field.type)}, matching the field's type.`);
    }
    if (field.description !== undefined && typeof field.description !== 'string') {
      refuse(`${path}.description`, 'must be a string.');
    }
  });

  // --- request -----------------------------------------------------------
  if (!isPlainObject(connection.request)) {
    refuse('connection.request', 'must be an object with apiBasePath, healthCheckPath and auth.');
  }
  const request = connection.request as Plain;
  onlyKeys(request, 'connection.request', ['apiBasePath', 'healthCheckPath', 'auth']);

  // Empty is allowed: a Connector whose Actions call absolute-from-root paths
  // on a per-Integration host has no base path of its own.
  if (typeof request.apiBasePath !== 'string') {
    refuse('connection.request.apiBasePath', 'must be a string (it may be empty).');
  }
  for (const match of (request.apiBasePath as string).matchAll(PLACEHOLDER_PATTERN)) {
    if (!fieldNames.has(match[1]!)) {
      refuse(
        'connection.request.apiBasePath',
        `templates {${match[1]}}, which is not a field of connection.configSchema.`,
      );
    }
  }

  const healthCheckPath = nonEmptyString(request.healthCheckPath, 'connection.request.healthCheckPath');
  if (!healthCheckPath.startsWith('/')) {
    refuse('connection.request.healthCheckPath', `("${healthCheckPath}") must start with "/".`);
  }

  // --- request.auth ------------------------------------------------------
  const authPath = 'connection.request.auth';
  if (!isPlainObject(request.auth)) refuse(authPath, 'must be an object with a type.');
  const auth = request.auth as Plain;

  switch (auth.type) {
    case 'pat':
      onlyKeys(auth, authPath, ['type', 'headerName', 'valuePrefix']);
      headerName(auth.headerName, `${authPath}.headerName`);
      if (auth.valuePrefix !== undefined && typeof auth.valuePrefix !== 'string') {
        refuse(`${authPath}.valuePrefix`, 'must be a string.');
      }
      break;

    case 'multi-header': {
      onlyKeys(auth, authPath, ['type', 'secretHeader', 'staticHeadersFromConfig']);
      headerName(auth.secretHeader, `${authPath}.secretHeader`);
      const staticPath = `${authPath}.staticHeadersFromConfig`;
      if (!isPlainObject(auth.staticHeadersFromConfig)) {
        refuse(staticPath, 'must be an object mapping header names to config field names.');
      }
      for (const [header, fieldName] of Object.entries(auth.staticHeadersFromConfig as Plain)) {
        if (!HEADER_NAME_PATTERN.test(header)) {
          refuse(staticPath, `names the header "${header}", which is not a valid HTTP header name.`);
        }
        if (typeof fieldName !== 'string' || !fieldNames.has(fieldName)) {
          refuse(
            `${staticPath}.${header}`,
            `must name a field of connection.configSchema; ${JSON.stringify(fieldName)} is not one.`,
          );
        }
      }
      break;
    }

    case 'oauth2':
      // Scope only. The sign-in, the token exchange and the refresh all go
      // through this Instance's own Microsoft registration, so a URL or a
      // tenant here would be something environment-specific shipped in a
      // signed file — ADR-0014 §2 as amended 2026-10-01.
      onlyKeys(
        auth,
        authPath,
        ['type', 'scope'],
        ' — oauth2 takes scope only; this Instance’s Microsoft registration supplies the rest',
      );
      nonEmptyString(auth.scope, `${authPath}.scope`);
      break;

    default:
      refuse(
        `${authPath}.type`,
        `(${JSON.stringify(auth.type)}) must be one of ${CONNECTION_AUTH_TYPES.slice(0, -1)
          .map((type) => JSON.stringify(type))
          .join(', ')} or ${JSON.stringify(CONNECTION_AUTH_TYPES.at(-1))}.`,
      );
  }

  return raw as ConnectorConnection;
}
