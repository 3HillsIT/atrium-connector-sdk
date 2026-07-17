// A fictional, minimal connector for "Acme" — exists purely as a working,
// readable reference for what authoring a real connector on top of
// @atrium/connector-sdk looks like. Not a real integration.

import { defineConnector, defineAction, z, CURRENT_CONNECTOR_API_VERSION } from '../src/index';

const listWidgets = defineAction({
  id: 'list-widgets',
  description: 'Lists widgets in the Acme workspace, optionally filtered by status.',
  inputSchema: z.object({
    status: z.enum(['active', 'archived']).optional(),
  }),
  outputSchema: z.object({
    widgets: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  httpMethods: ['GET'],
  handler: async (ctx, input) => {
    const query = input.status ? `?status=${input.status}` : '';
    const res = await ctx.request('GET', `/widgets${query}`);
    return res.body as { widgets: Array<{ id: string; name: string }> };
  },
});

const createWidget = defineAction({
  id: 'create-widget',
  description: 'Creates a new widget in the Acme workspace.',
  inputSchema: z.object({
    name: z.string().min(1),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
  }),
  httpMethods: ['POST'],
  handler: async (ctx, input) => {
    const res = await ctx.request('POST', '/widgets', { body: { name: input.name } });
    return res.body as { id: string; name: string };
  },
});

export const acmeConnector = defineConnector({
  id: 'acme',
  displayName: 'Acme',
  description: 'Manage widgets in an Acme workspace.',
  authTypes: ['pat'],
  configSchema: z.object({
    workspaceSlug: z.string().min(1),
  }),
  connectorApiVersion: CURRENT_CONNECTOR_API_VERSION,
  actions: [listWidgets, createWidget],
  // Acme's health-check endpoint needs a POST with a body, so the app's
  // generic GET-based connectivity check won't work here — this is exactly
  // the kind of case testConnection exists for.
  testConnection: async (ctx) => {
    const res = await ctx.request('POST', '/auth/verify', { body: {} });
    if (res.status !== 200) {
      return { ok: false, message: `Acme rejected the credential (status ${res.status})` };
    }
    return { ok: true };
  },
});
