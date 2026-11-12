import { describe, expect, it } from 'vitest';

import { API, bqContext } from './helpers.js';

const DRY_SELECT: [number, unknown] = [200, { statementType: 'SELECT', totalBytesProcessed: '100' }];
const done = (extra: Record<string, unknown> = {}): [number, unknown] => [
  200,
  { jobComplete: true, schema: { fields: [{ name: 'x', type: 'INTEGER' }] }, rows: [{ f: [{ v: '1' }] }], totalRows: '1', totalBytesProcessed: '0', cacheHit: false, ...extra },
];
const queryPosts = (sent: Array<{ method: string; body?: Record<string, any> }>) => sent.filter((s) => s.method === 'POST' && s.body?.dryRun === false);

describe('bq_query_run', () => {
  it('bq.query.run: sends the query without a location and asks again at the job location until done', async () => {
    const { run, sent } = bqContext([
      DRY_SELECT,
      [200, { jobComplete: false, jobReference: { jobId: 'j1', location: 'asia-northeast3' } }],
      done({ totalBytesProcessed: '14432' }),
    ]);
    const out = await run('bq_query_run', { project_id: 'example-project', sql: 'SELECT 1 AS x' });
    const [post] = queryPosts(sent);
    expect(post).toEqual({
      method: 'POST',
      url: `${API}/projects/example-project/queries`,
      body: { query: 'SELECT 1 AS x', useLegacySql: false, maxResults: 500, maximumBytesBilled: '1000000000', timeoutMs: 30000, dryRun: false },
    });
    expect(post!.body).not.toHaveProperty('location');
    const poll = sent.find((s) => s.method === 'GET')!;
    expect(poll.url).toMatch(new RegExp(`^${API}/projects/example-project/queries/j1\\?.*location=asia-northeast3`));
    expect(out).toContain('| x |\n|---|\n| 1 |');
    expect(out).toContain('rows 1 / 1 · scanned 14.1 KB · cache miss');
  });

  it('bq.query.run: typed cells, escaped pipes and line breaks, no rows, and retries after 429', async () => {
    const fields = [
      { name: 'n', type: 'INTEGER' },
      { name: 't', type: 'TIMESTAMP' },
      { name: 's', type: 'STRING' },
    ];
    const { run } = bqContext([
      [429, {}],
      [429, {}],
      DRY_SELECT,
      [200, { jobComplete: true, schema: { fields }, rows: [{ f: [{ v: '9007199254740993' }, { v: '1.7E9' }, { v: 'a|b\nc' }] }], totalRows: '1', totalBytesProcessed: '10' }],
    ]);
    const out = await run('bq_query_run', { project_id: 'example-project', sql: 'SELECT n, t, s FROM d.t' });
    expect(out).toContain('| 9007199254740993 | 2023-11-14T22:13:20.000Z | a\\|b<br>c |');

    const empty = bqContext([DRY_SELECT, [200, { jobComplete: true, schema: { fields }, totalRows: '0', totalBytesProcessed: '0' }]]);
    const none = await empty.run('bq_query_run', { project_id: 'example-project', sql: 'SELECT n, t, s FROM d.t WHERE FALSE' });
    expect(none).toContain('The query returned no rows.');
    expect(none).toContain('rows 0 / 0');
  });

  it('bq.query.max_rows: above the configured limit it is lowered and the answer says so; 0 and 10001 are schema errors', async () => {
    const { run, sent } = bqContext([DRY_SELECT, done({ totalRows: '20' })]);
    const out = await run('bq_query_run', { project_id: 'example-project', sql: 'SELECT 1 AS x', max_rows: 2000 });
    expect(queryPosts(sent)[0]!.body!.maxResults).toBe(500);
    expect(out).toContain('max_rows 2000 was lowered to 500');
    expect(out).toContain('Truncated: only 1 of 20 rows');
    expect(out).toMatch(/LIMIT/);

    for (const max_rows of [0, 10001]) {
      const bad = bqContext([]);
      await expect(bad.run('bq_query_run', { project_id: 'example-project', sql: 'SELECT 1', max_rows })).rejects.toMatchObject({ code: 'invalid' });
      expect(bad.sent).toHaveLength(0);
    }
  });

  it('bq.query.dry_run: only a dry run is sent and the answer is the byte estimate, no table', async () => {
    const { run, sent } = bqContext([[200, { statementType: 'SELECT', totalBytesProcessed: '12345' }]]);
    const out = await run('bq_query_run', { project_id: 'example-project', sql: 'SELECT 1 AS x', dry_run: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ dryRun: true });
    expect(sent.filter((s) => s.method === 'GET')).toHaveLength(0);
    expect(out).toContain('valid');
    expect(out).toContain('12.1 KB');
    expect(out).not.toContain('|');
  });
});
