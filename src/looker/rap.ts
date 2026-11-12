import type { WorkerTab } from '../browser/worker.js';

// Looker Studio's own front-end API ("RAP"): POST /u/<n>/<endpoint> with the
// RAP_XSRF_TOKEN cookie echoed in a header, answered with `)]}'` + JSON.
// Calling it from the worker tab reuses the user's session; no UI involved.

export interface RapRequest {
  endpoint: string;
  body: unknown;
  // How the request is sent and read. "json" (default): JSON both ways.
  // "text": JSON in, the answer as text (getPdf sends a bare base64 string).
  // "form": the body's fields urlencoded with the XSRF token as a field, as the
  // editor's dialogs post them; the result is the URL the answer redirected to
  // (copyReport lands on the new report).
  // "get": the body's fields as the query string of a GET with the XSRF
  // header, answered with JSON (getImageV2 refuses POST).
  mode?: 'json' | 'text' | 'form' | 'get';
}

export type RapResult = { status: number; json: unknown } | { status: number; error: string };

// Runs in the worker tab (serialized): keep it self-contained.
export const rapInPage = async (a: { requests: RapRequest[]; concurrency: number }): Promise<RapResult[]> => {
  type Json = Record<string, unknown> | undefined;
  const user = /\/u\/(\d+)\//.exec(location.pathname)?.[1] ?? '0';
  const xsrf = decodeURIComponent(/(?:^|; )RAP_XSRF_TOKEN=([^;]+)/.exec(document.cookie)?.[1] ?? '');
  const one = async (r: RapRequest): Promise<RapResult> => {
    try {
      if (r.mode === 'form') {
        const fields = new URLSearchParams({ xsrf, ...(r.body as Record<string, string>) });
        const res = await fetch(`/u/${user}/${r.endpoint}`, { method: 'POST', credentials: 'include', body: fields });
        if (!res.ok) return { status: res.status, error: (await res.text()).slice(0, 500) };
        return { status: res.status, json: { url: res.url } };
      }
      const res =
        r.mode === 'get'
          ? await fetch(`/u/${user}/${r.endpoint}?${new URLSearchParams(r.body as Record<string, string>)}`, {
              credentials: 'include',
              headers: { 'x-rap-xsrf-token': xsrf },
            })
          : await fetch(`/u/${user}/${r.endpoint}?hl=en`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json', 'x-rap-xsrf-token': xsrf },
              body: JSON.stringify(r.body),
            });
      const text = await res.text();
      if (!res.ok) return { status: res.status, error: text.slice(0, 500) };
      const unguarded = text.replace(/^\)\]\}'\s*/, '');
      if (r.mode === 'text') return { status: res.status, json: unguarded };
      // Some writes (renameDatasource) answer 200 with nothing: done, nothing to read.
      if (!unguarded.trim()) return { status: res.status, json: null };
      const json = JSON.parse(unguarded) as Json;
      return { status: res.status, json };
    } catch (e) {
      return { status: 0, error: String((e as Error)?.message ?? e) };
    }
  };
  const results: RapResult[] = new Array(a.requests.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < a.requests.length) {
      const i = next++;
      results[i] = await one(a.requests[i] as RapRequest);
    }
  };
  await Promise.all(Array.from({ length: Math.min(a.concurrency, a.requests.length) }, lane));
  return results;
};

export class RapError extends Error {
  override readonly name = 'RapError';

  constructor(
    readonly endpoint: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type RapOutcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export interface Rap {
  call<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number, mode?: RapRequest['mode']): Promise<T>;
  // One round trip to the tab; a failed request does not fail the others.
  callMany<T = unknown>(requests: RapRequest[], opts?: { concurrency?: number; timeoutMs?: number }): Promise<RapOutcome<T>[]>;
}

export interface RapClientOptions {
  // Retries of rate-limited (429) and failed (5xx, network) requests.
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Status codes worth another try: Looker Studio answers 429 to bursts.
export function isTransient(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export class RapClient implements Rap {
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly worker: Pick<WorkerTab, 'run'>,
    opts: RapClientOptions = {},
  ) {
    this.retries = opts.retries ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async call<T = unknown>(endpoint: string, body: unknown, timeoutMs = 60_000, mode?: RapRequest['mode']): Promise<T> {
    const [res] = await this.callMany<T>([{ endpoint, body, ...(mode ? { mode } : {}) }], { timeoutMs });
    if (!res?.ok)
      throw new RapError(endpoint, res?.status ?? 0, `${endpoint} returned HTTP ${res?.status}: ${res?.error}`);
    return res.value;
  }

  // Rate-limited requests are sent again, fewer at a time, after a pause that
  // doubles each round. The pause runs here: timers in a background tab are
  // throttled.
  async callMany<T = unknown>(
    requests: RapRequest[],
    opts: { concurrency?: number; timeoutMs?: number } = {},
  ): Promise<RapOutcome<T>[]> {
    const results: RapResult[] = new Array(requests.length);
    let pending = requests.map((_, i) => i);
    let concurrency = opts.concurrency ?? 6;
    for (let round = 0; pending.length; round++) {
      if (round) await this.sleep(1_000 * 2 ** (round - 1));
      const batch = await this.worker.run(
        rapInPage,
        { requests: pending.map((i) => requests[i] as RapRequest), concurrency },
        opts.timeoutMs ?? 60_000,
      );
      pending.forEach((i, k) => (results[i] = batch[k] as RapResult));
      if (round === this.retries) break;
      pending = pending.filter((i) => {
        const r = results[i] as RapResult;
        return 'error' in r && isTransient(r.status);
      });
      concurrency = Math.max(1, Math.floor(concurrency / 2));
    }
    return results.map((r) =>
      'error' in r ? { ok: false, status: r.status, error: r.error } : { ok: true, value: r.json as T },
    );
  }
}
