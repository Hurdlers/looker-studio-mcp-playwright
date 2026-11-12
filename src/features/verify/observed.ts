import type { Rap, RapOutcome, RapRequest } from '../../looker/rap.js';
import type { Json } from './common.js';

// Keep the useful parts of the requests checkPage already makes, so error
// cards and details need no second query or data-source read.
export function observeRap(base: Rap) {
  const replies = new Map<string, Json>();
  const sources = new Map<string, Json>();
  const timedOut = new Set<string>();
  const remember = (request: RapRequest, result: RapOutcome<unknown> | undefined): void => {
    const body = request.body as Json;
    const id = body.dataRequest?.[0]?.requestContext?.reportContext?.componentId as string | undefined;
    if (result?.ok && result.value && typeof result.value === 'object') {
      if (request.endpoint === 'batchedDataV2' && id) {
        replies.set(id, result.value as Json);
        timedOut.delete(id);
      }
      if (request.endpoint === 'getBlockDatasource') sources.set(String(body.datasourceId), result.value as Json);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown, timeoutMs?: number, mode?: RapRequest['mode']): Promise<T> => {
      const value = await base.call<T>(endpoint, body, timeoutMs, mode);
      remember({ endpoint, body }, { ok: true, value });
      return value;
    },
    callMany: async <T>(requests: RapRequest[], options?: { concurrency?: number; timeoutMs?: number }): Promise<RapOutcome<T>[]> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const pending = base.callMany<T>(requests, options);
        const outcomes = options?.timeoutMs === undefined ? await pending : await Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('The chart request timed out.'), { code: 'timeout' })), options.timeoutMs); }),
        ]);
        requests.forEach((request, index) => remember(request, outcomes[index]));
        return outcomes;
      } catch (err) {
        if ((err as { code?: unknown })?.code === 'timeout')
          for (const request of requests) {
            const id = (request.body as Json).dataRequest?.[0]?.requestContext?.reportContext?.componentId;
            if (id) timedOut.add(String(id));
          }
        throw err;
      } finally { if (timer) clearTimeout(timer); }
    },
  };
  return { rap, replies, sources, timedOut };
}

export type Observed = ReturnType<typeof observeRap>;
