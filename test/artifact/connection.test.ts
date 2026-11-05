import { describe, test, expect } from 'bun:test';
import {
  ConnectorArtifactError,
  buildArtifactFixture,
  fixtureConnection,
  openArtifact,
  parseConnection,
  parseRequiredConnection,
} from '../../src/artifact';
import type { ConnectorConnection } from '../../src/artifact';

// The `connection` block's validator, as Add runs it inside openArtifact and
// a build runs it on the source manifest. In atrium these cases are driven
// through the admin API (connector-manifest-version.test.ts,
// connector-connection.test.ts); here they are the validator's own, plus one
// pass through openArtifact to show Add runs the same rule.

function refusalOf(run: () => unknown): ConnectorArtifactError {
  try {
    run();
  } catch (err) {
    if (err instanceof ConnectorArtifactError) return err;
    throw err;
  }
  throw new Error('expected the block to be refused, but it was accepted');
}

describe('each sign-in kind is accepted', () => {
  const accepted: { name: string; connection: ConnectorConnection }[] = [
    { name: 'pat', connection: fixtureConnection() },
    {
      name: 'pat with a value prefix',
      connection: fixtureConnection({
        auth: { type: 'pat', headerName: 'Authorization', valuePrefix: 'Bearer ' },
      }),
    },
    {
      name: 'multi-header',
      connection: fixtureConnection({
        fields: [
          { name: 'instanceUrl', label: 'Instance URL', type: 'string', required: true },
          { name: 'authMethod', label: 'Auth method', type: 'string', required: false, default: 'token' },
        ],
        auth: {
          type: 'multi-header',
          secretHeader: 'tokenId',
          staticHeadersFromConfig: { authMethod: 'authMethod' },
        },
      }),
    },
    {
      name: 'oauth2',
      connection: fixtureConnection({
        apiBasePath: 'https://dev.example.test/{organization}',
        fields: [{ name: 'organization', label: 'Organization', type: 'string', required: true }],
        auth: { type: 'oauth2', scope: 'api://fixture/.default' },
      }),
    },
  ];

  for (const { name, connection } of accepted) {
    test(`${name}: returned unchanged, and an Artifact carrying it opens`, async () => {
      expect(parseConnection(connection)).toBe(connection);
      const fixture = await buildArtifactFixture({ connection });
      const opened = await openArtifact(fixture.bytes, fixture.ring);
      expect(opened.manifest.connection).toEqual(connection);
    });
  }

  test('an empty apiBasePath is allowed', () => {
    expect(() => parseConnection(fixtureConnection({ apiBasePath: '' }))).not.toThrow();
  });
});

describe('a block it cannot accept is refused, naming the field', () => {
  test('none at all, where one is required', () => {
    const error = refusalOf(() => parseRequiredConnection(undefined));
    expect(error.code).toBe('manifest-invalid');
    expect(error.details.field).toBe('connection');
    expect(error.message).toContain('declares no connection block');
  });

  test('none at all, through openArtifact: Add requires it on version 3', async () => {
    const fixture = await buildArtifactFixture({ manifestVersion: 3, connection: null });
    const error = await openArtifact(fixture.bytes, fixture.ring).catch((err) => err);
    expect(error).toBeInstanceOf(ConnectorArtifactError);
    expect(error.code).toBe('manifest-invalid');
    expect(error.details.field).toBe('connection');
  });

  const valid = fixtureConnection();
  const malformed: { name: string; connection: unknown; field: string }[] = [
    { name: 'not an object', connection: 'pat', field: 'connection' },
    { name: 'an unknown top-level key', connection: { ...valid, provider: 'x' }, field: 'connection.provider' },
    { name: 'no configSchema', connection: { request: valid.request }, field: 'connection.configSchema' },
    {
      name: 'a config field of an unknown type',
      connection: {
        ...valid,
        configSchema: { fields: [{ name: 'instanceUrl', label: 'Instance URL', type: 'url', required: true }] },
      },
      field: 'connection.configSchema.fields[0].type',
    },
    {
      name: 'a config field declared twice',
      connection: {
        ...valid,
        configSchema: {
          fields: [
            { name: 'instanceUrl', label: 'Instance URL', type: 'string', required: true },
            { name: 'instanceUrl', label: 'Again', type: 'string', required: false },
          ],
        },
      },
      field: 'connection.configSchema.fields[1].name',
    },
    {
      name: 'a default of the wrong type',
      connection: {
        ...valid,
        configSchema: { fields: [{ name: 'port', label: 'Port', type: 'number', required: false, default: '80' }] },
      },
      field: 'connection.configSchema.fields[0].default',
    },
    {
      name: 'an apiBasePath templating a field that is not declared',
      connection: { ...valid, request: { ...valid.request, apiBasePath: 'https://x.test/{organization}' } },
      field: 'connection.request.apiBasePath',
    },
    {
      name: 'no healthCheckPath',
      connection: { ...valid, request: { apiBasePath: valid.request.apiBasePath, auth: valid.request.auth } },
      field: 'connection.request.healthCheckPath',
    },
    {
      name: 'a healthCheckPath not starting with "/"',
      connection: { ...valid, request: { ...valid.request, healthCheckPath: 'me' } },
      field: 'connection.request.healthCheckPath',
    },
    {
      name: 'an unknown auth type',
      connection: { ...valid, request: { ...valid.request, auth: { type: 'basic' } } },
      field: 'connection.request.auth.type',
    },
    {
      name: 'a pat auth with no header name',
      connection: { ...valid, request: { ...valid.request, auth: { type: 'pat' } } },
      field: 'connection.request.auth.headerName',
    },
    {
      name: 'a pat auth with a header name HTTP does not allow',
      connection: { ...valid, request: { ...valid.request, auth: { type: 'pat', headerName: 'X Token' } } },
      field: 'connection.request.auth.headerName',
    },
    {
      name: 'a pat auth with a misspelt optional key',
      connection: {
        ...valid,
        request: { ...valid.request, auth: { type: 'pat', headerName: 'X-Token', valueprefix: 'Bearer ' } },
      },
      field: 'connection.request.auth.valueprefix',
    },
    {
      name: 'an oauth2 auth carrying more than its scope',
      connection: {
        ...valid,
        request: {
          ...valid.request,
          auth: {
            type: 'oauth2',
            scope: 'api://fixture/.default',
            authorizeUrl: 'https://login.example.test/tenant/oauth2/v2.0/authorize',
          },
        },
      },
      field: 'connection.request.auth.authorizeUrl',
    },
    {
      name: 'an oauth2 auth with no scope',
      connection: { ...valid, request: { ...valid.request, auth: { type: 'oauth2' } } },
      field: 'connection.request.auth.scope',
    },
    {
      name: 'a multi-header auth whose static header names no config field',
      connection: {
        ...valid,
        request: {
          ...valid.request,
          auth: { type: 'multi-header', secretHeader: 'tokenId', staticHeadersFromConfig: { authMethod: 'authMethod' } },
        },
      },
      field: 'connection.request.auth.staticHeadersFromConfig.authMethod',
    },
  ];

  for (const { name, connection, field } of malformed) {
    test(name, () => {
      const error = refusalOf(() => parseConnection(connection));
      expect(error.code).toBe('manifest-invalid');
      expect(error.details.field).toBe(field);
      expect(error.message).toContain(field);
    });
  }

  test('the refusal names the document it was read from', () => {
    const error = refusalOf(() => parseConnection('pat', 'acme/manifest.json'));
    expect(error.message).toContain('acme/manifest.json');
  });
});
