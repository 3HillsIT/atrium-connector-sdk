// A stand-in for the ctx atrium hands a handler: it records each call the
// handler sends and answers with what the system would.

import type { AtriumClient, AtriumResponse } from '@3hillsit/atrium-connector-sdk';

export interface SentCall {
  method: string;
  path: string;
  body?: unknown;
}

export function stubCtx(answer: AtriumResponse): { ctx: AtriumClient; calls: SentCall[] } {
  const calls: SentCall[] = [];
  const ctx: AtriumClient = {
    async request(method, path, opts) {
      calls.push(opts?.body === undefined ? { method, path } : { method, path, body: opts.body });
      return answer;
    },
  };
  return { ctx, calls };
}
