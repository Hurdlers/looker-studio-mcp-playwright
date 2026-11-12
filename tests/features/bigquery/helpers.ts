import { tmpdir } from 'node:os';

import { BigQueryClient } from '../../../src/core/bigquery.js';
import { createContext } from '../../../src/core/context.js';
import { runTool, resultText, type ToolContext } from '../../../src/core/tool.js';
import { parseConfig } from '../../../src/config.js';
import type { Rap } from '../../../src/looker/rap.js';
import { tools } from '../../../src/features/bigquery/index.js';

export const API = 'https://bigquery.googleapis.com/bigquery/v2';

export interface Sent {
  method: string;
  url: string;
  body?: Record<string, any>;
}

// A context whose BigQuery answers come from a list, in order; each answer is
// [status, body]. Looker Studio is never called.
export function bqContext(
  answers: Array<[number, unknown]>,
  opts: { config?: Record<string, unknown>; adcProject?: string } = {},
): { ctx: ToolContext; sent: Sent[]; run: (name: string, args: Record<string, unknown>) => Promise<string> } {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ method: String(init.method), url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const [status, body] = answers.shift() ?? [500, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  const config = parseConfig({ writes_enabled: true, ...opts.config }, tmpdir());
  const google = { token: async () => 'token', projectId: async () => opts.adcProject, email: async () => undefined };
  const rap: Rap = {
    call: async () => {
      throw new Error('Looker Studio must not be called');
    },
    callMany: async () => {
      throw new Error('Looker Studio must not be called');
    },
  };
  const ctx = createContext({
    rap,
    config,
    google,
    bigquery: new BigQueryClient(google, config.bigquery, { fetch, sleep: async () => undefined }),
    tools,
  });
  return { ctx, sent, run: async (name, args) => resultText(await runTool(ctx, name, args)) };
}
