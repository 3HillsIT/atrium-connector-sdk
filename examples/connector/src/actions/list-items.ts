// An example read Action: it sends GET only, so manifest.json leaves `write`
// out. Replace it with one of your system's own reads.

import { defineAction, z } from '@3hillsit/atrium-connector-sdk';

export const listItems = defineAction({
  id: 'list_items',
  description:
    "Lists the system's items, newest first, optionally only those with one status. Returns each item's id, name and status.",
  inputSchema: z.object({
    status: z.enum(['open', 'closed']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  outputSchema: z.object({
    items: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
  }),
  httpMethods: ['GET'],
  async handler(ctx, input) {
    const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
    if (input.status) query.set('status', input.status);

    const res = await ctx.request('GET', `/items?${query}`);
    if (res.status !== 200) {
      throw new Error(`The system answered ${res.status} to the list: ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { items: Array<{ id: string; name: string; status: string }> };
    return {
      items: body.items.map((item) => ({ id: item.id, name: item.name, status: item.status })),
    };
  },
});
