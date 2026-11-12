import { describe, expect, it } from 'vitest';

import { GuardedRap } from '../src/core/guard.js';
import type { Rap } from '../src/looker/rap.js';

const OWNED = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
function setup() {
  const sent: Array<{ endpoint: string; body: unknown }> = [];
  const raw: Rap = {
    call: async (endpoint, body) => { sent.push({ endpoint, body }); return {} as never; },
    callMany: async requests => { sent.push(...requests.map(({ endpoint, body }) => ({ endpoint, body }))); return requests.map(() => ({ ok: true, value: {} as never })); },
  };
  return { sent, rap: new GuardedRap(raw, { endpoints: new Set(['getReport', 'updatePrefetch']), canWrite: id => id === OWNED }) };
}

describe('report data refresh write guard', () => {
  it('permits only an owned report timestamp refresh', async () => {
    const f = setup(), body = { prefetchConfig: { reportId: OWNED }, fieldMask: 'TIMESTAMP' };
    await f.rap.call('updatePrefetch', body);
    expect(f.sent).toEqual([{ endpoint: 'updatePrefetch', body }]);
  });

  it.each([
    {},
    { reportId: OWNED, fieldMask: 'TIMESTAMP' },
    { prefetchConfig: { reportId: OTHER }, fieldMask: 'TIMESTAMP' },
    { reportId: OWNED, prefetchConfig: { reportId: OTHER }, fieldMask: 'TIMESTAMP' },
    { prefetchConfig: { reportId: OWNED } },
    { prefetchConfig: { reportId: OWNED }, fieldMask: '*' },
    { prefetchConfig: { reportId: OWNED }, fieldMask: 'TIMESTAMP,CONFIG' },
    { prefetchConfig: { reportId: OWNED }, fieldMask: ['TIMESTAMP'] },
  ])('refuses missing, unrelated or broader cache write targets: %j', async body => {
    const f = setup();
    await expect(f.rap.call('updatePrefetch', body)).rejects.toMatchObject({ code: 'refused' });
    expect(f.sent).toEqual([]);
  });

  it('rejects a batch containing an unrelated cache write before sending any request', async () => {
    const f = setup();
    await expect(f.rap.callMany([
      { endpoint: 'getReport', body: { reportId: OWNED } },
      { endpoint: 'updatePrefetch', body: { prefetchConfig: { reportId: OTHER }, fieldMask: 'TIMESTAMP' } },
    ])).rejects.toMatchObject({ code: 'refused' });
    expect(f.sent).toEqual([]);
  });
});
