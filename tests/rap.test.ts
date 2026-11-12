import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { RapClient, RapError, rapInPage, type RapRequest } from '../src/looker/rap.js';

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; credentials: string };
}

type Reply = { status: number; text: string } | Error;

function page(reply: (url: string, body: unknown) => Reply, pathname = '/u/1/navigation/reporting') {
  const calls: FetchCall[] = [];
  let active = 0;
  let maxActive = 0;
  const ctx = {
    location: { pathname },
    document: { cookie: 'A=1; RAP_XSRF_TOKEN=tok%3A123; B=2' },
    fetch: async (url: string, init: FetchCall['init']) => {
      calls.push({ url, init });
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      const r = reply(url, JSON.parse(init.body));
      if (r instanceof Error) throw r;
      return { ok: r.status < 400, status: r.status, text: async () => r.text };
    },
    setTimeout,
    JSON,
  };
  return { ctx, calls, maxActive: () => maxActive };
}

async function inPage(ctx: object, requests: RapRequest[], concurrency = 6): Promise<unknown> {
  return runInNewContext(`(${rapInPage.toString()})(${JSON.stringify({ requests, concurrency })})`, ctx);
}

describe('rapInPage', () => {
  it('posts JSON with the XSRF token to the account of the current page', async () => {
    const { ctx, calls } = page(() => ({ status: 200, text: ")]}'\n{\"a\":1}" }));

    const res = await inPage(ctx, [{ endpoint: 'getReport', body: { reportId: 'r1' } }]);

    expect(res).toEqual([{ status: 200, json: { a: 1 } }]);
    expect(calls[0]?.url).toBe('/u/1/getReport?hl=en');
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-rap-xsrf-token': 'tok:123' },
    });
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ reportId: 'r1' });
  });

  it('defaults to account 0 and accepts bodies without the guard prefix', async () => {
    const { ctx, calls } = page(() => ({ status: 200, text: '{"b":2}' }), '/navigation/reporting');

    expect(await inPage(ctx, [{ endpoint: 'getSchema', body: {} }])).toEqual([{ status: 200, json: { b: 2 } }]);
    expect(calls[0]?.url).toBe('/u/0/getSchema?hl=en');
  });

  it('keeps going when one request fails', async () => {
    const { ctx } = page((url) =>
      url.includes('bad') ? { status: 403, text: 'Forbidden' } : url.includes('boom') ? new Error('offline') : { status: 200, text: '{}' },
    );

    expect(
      await inPage(ctx, [
        { endpoint: 'bad', body: {} },
        { endpoint: 'ok', body: {} },
        { endpoint: 'boom', body: {} },
      ]),
    ).toEqual([
      { status: 403, error: 'Forbidden' },
      { status: 200, json: {} },
      { status: 0, error: 'offline' },
    ]);
  });

  it('runs at most `concurrency` requests at once, in order', async () => {
    const { ctx, maxActive } = page((_u, body) => ({ status: 200, text: JSON.stringify(body) }));
    const requests = Array.from({ length: 10 }, (_, i) => ({ endpoint: 'x', body: { i } }));

    const res = (await inPage(ctx, requests, 3)) as Array<{ json: { i: number } }>;

    expect(res.map((r) => r.json.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maxActive()).toBe(3);
  });
});

describe('RapClient', () => {
  function client(results: unknown[]): RapClient {
    return new RapClient({ run: async () => results } as never, { sleep: async () => undefined });
  }

  it('returns the parsed JSON', async () => {
    expect(await client([{ status: 200, json: { ok: true } }]).call('getReport', {})).toEqual({ ok: true });
  });

  it('throws RapError with endpoint and status', async () => {
    const err = await client([{ status: 403, error: 'Forbidden' }])
      .call('getReport', {})
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RapError);
    expect(err).toMatchObject({ endpoint: 'getReport', status: 403 });
    expect((err as Error).message).toContain('HTTP 403');
  });

  it('retries rate-limited requests with fewer at a time, then returns every result in order', async () => {
    const seen: Array<{ endpoints: string[]; concurrency: number }> = [];
    let attempts = 0;
    const rap = new RapClient(
      {
        run: async (_fn: unknown, a: { requests: RapRequest[]; concurrency: number }) => {
          seen.push({ endpoints: a.requests.map((r) => r.endpoint), concurrency: a.concurrency });
          attempts++;
          return a.requests.map((r) =>
            r.endpoint === 'busy' && attempts < 3 ? { status: 429, error: 'slow down' } : { status: 200, json: r.endpoint },
          );
        },
      } as never,
      { sleep: async () => undefined },
    );

    const res = await rap.callMany([
      { endpoint: 'a', body: {} },
      { endpoint: 'busy', body: {} },
    ]);

    expect(res).toEqual([
      { ok: true, value: 'a' },
      { ok: true, value: 'busy' },
    ]);
    expect(seen.map((s) => s.endpoints)).toEqual([['a', 'busy'], ['busy'], ['busy']]);
    expect(seen.map((s) => s.concurrency)).toEqual([6, 3, 1]);
  });

  it('gives up on rate limits after its retries, and never retries refusals', async () => {
    let runs = 0;
    const rap = new RapClient(
      {
        run: async (_fn: unknown, a: { requests: RapRequest[] }) => {
          runs++;
          return a.requests.map((r) => (r.endpoint === 'busy' ? { status: 429, error: 'slow down' } : { status: 403, error: 'no' }));
        },
      } as never,
      { sleep: async () => undefined, retries: 2 },
    );

    const res = await rap.callMany([
      { endpoint: 'busy', body: {} },
      { endpoint: 'denied', body: {} },
    ]);

    expect(res).toEqual([
      { ok: false, status: 429, error: 'slow down' },
      { ok: false, status: 403, error: 'no' },
    ]);
    expect(runs).toBe(3);
  });

  it('maps batch results to outcomes', async () => {
    const outcomes = await client([
      { status: 200, json: 1 },
      { status: 404, error: 'gone' },
    ]).callMany([
      { endpoint: 'a', body: {} },
      { endpoint: 'b', body: {} },
    ]);

    expect(outcomes).toEqual([
      { ok: true, value: 1 },
      { ok: false, status: 404, error: 'gone' },
    ]);
  });
});

describe('rapInPage modes', () => {
  it('returns the answer as text, without the guard prefix', async () => {
    const { ctx } = page(() => ({ status: 200, text: ")]}'\n\"JVBERi0=\"" }));

    expect(await inPage(ctx, [{ endpoint: 'getPdf', body: {}, mode: 'text' }])).toEqual([
      { status: 200, json: '"JVBERi0="' },
    ]);
  });

  it('posts forms with the XSRF token as a field and returns where the answer led', async () => {
    const sent: Array<{ url: string; body: string; headers?: unknown }> = [];
    const ctx = {
      location: { pathname: '/u/0/reporting/abc' },
      document: { cookie: 'RAP_XSRF_TOKEN=tok%3A1' },
      URLSearchParams,
      fetch: async (url: string, init: { body: URLSearchParams; headers?: unknown }) => {
        sent.push({ url, body: init.body.toString(), headers: init.headers });
        return { ok: true, status: 200, url: 'https://datastudio.google.com/reporting/new-id', text: async () => '' };
      },
      JSON,
    };

    const res = await inPage(ctx, [{ endpoint: 'copyReport', body: { reportId: 'r1', region: 'global' }, mode: 'form' }]);

    expect(res).toEqual([{ status: 200, json: { url: 'https://datastudio.google.com/reporting/new-id' } }]);
    expect(sent[0]?.url).toBe('/u/0/copyReport');
    expect(Object.fromEntries(new URLSearchParams(sent[0]!.body))).toEqual({ xsrf: 'tok:1', reportId: 'r1', region: 'global' });
    expect(sent[0]?.headers).toBeUndefined();
  });
});

describe('rapInPage answers and GET', () => {
  it('reads a 200 with an empty body as success with nothing in it', async () => {
    const { ctx } = page(() => ({ status: 200, text: '' }));

    expect(await inPage(ctx, [{ endpoint: 'renameDatasource', body: { datasourceId: 'd', title: 'T' } }])).toEqual([{ status: 200, json: null }]);
  });

  it('sends GET requests with the body as the query string and the XSRF header', async () => {
    const sent: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    const ctx = {
      location: { pathname: '/u/2/reporting/abc' },
      document: { cookie: 'RAP_XSRF_TOKEN=tok%3A9' },
      URLSearchParams,
      fetch: async (url: string, init: (typeof sent)[number]['init']) => {
        sent.push({ url, init });
        return { ok: true, status: 200, text: async () => ")]}'\n{\"payload\":\"iVBO\"}" };
      },
      JSON,
    };

    const res = await inPage(ctx, [{ endpoint: 'getImageV2', body: { reportId: 'r1', id: 'img 1' }, mode: 'get' }]);

    expect(res).toEqual([{ status: 200, json: { payload: 'iVBO' } }]);
    expect(sent[0]?.url).toBe('/u/2/getImageV2?reportId=r1&id=img+1');
    expect(sent[0]?.init.method).toBeUndefined();
    expect(sent[0]?.init.body).toBeUndefined();
    expect(sent[0]?.init.headers).toEqual({ 'x-rap-xsrf-token': 'tok:9' });
  });
});
