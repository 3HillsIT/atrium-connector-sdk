// An example write Action: it creates something, so manifest.json says
// "write": true and every call of its Tools waits for approval. Replace it
// with one of your system's own writes.

import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

export const createItem = defineAction({
  id: 'create_item',
  description: 'Creates an item with a name and returns its id.',
  inputSchema: z.object({
    name: z.string().min(1),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
  }),
  httpMethods: ['POST'],
  async handler(ctx, input) {
    const res = await ctx.request('POST', '/items', { body: { name: input.name } });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`The system answered ${res.status} to the create: ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { id: string; name: string };
    return { id: body.id, name: body.name };
  },
});
