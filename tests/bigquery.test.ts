import { describe, expect, it } from 'vitest';

import { BigQueryClient } from '../src/core/bigquery.js';
import { parseConfig } from '../src/config.js';

interface Sent {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

// Answers in order; each answer is [status, body].
function fakeFetch(answers: Array<[number, unknown]>) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ method: String(init.method), url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const [status, body] = answers.shift() ?? [500, {}];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const tokens = { token: async () => 'ya29.secret' };
const API = 'https://bigquery.googleapis.com/bigquery/v2';
const client = (answers: Array<[number, unknown]>, raw: Record<string, unknown> = {}) => {
  const f = fakeFetch(answers);
  return { bq: new BigQueryClient(tokens, parseConfig(raw, '/tmp').bigquery, { fetch: f.fetch, sleep: async () => undefined }), sent: f.sent };
};

describe('BigQueryClient', () => {
  it('follows page tokens when listing', async () => {
    const { bq, sent } = client([
      [200, { datasets: [{ datasetReference: { datasetId: 'a' }, location: 'US' }], nextPageToken: 't2' }],
      [200, { datasets: [{ datasetReference: { datasetId: 'b' }, location: 'asia-northeast3' }] }],
    ]);
    expect(await bq.listDatasets('my-proj')).toEqual([
      { id: 'a', location: 'US' },
      { id: 'b', location: 'asia-northeast3' },
    ]);
    expect(sent.map((s) => s.url)).toEqual([`${API}/projects/my-proj/datasets?all=false`, `${API}/projects/my-proj/datasets?all=false&pageToken=t2`]);
  });

  it('encodes table names with spaces', async () => {
    const { bq, sent } = client([[200, { type: 'TABLE', numRows: '42' }]]);
    expect((await bq.getTable('p', 'd', '4 Demo')).numRows).toBe('42');
    expect(sent[0]!.url).toBe(`${API}/projects/p/datasets/d/tables/4%20Demo`);
  });

  it('runs a query with the configured limits, without a location unless set, and waits for the job', async () => {
    const { bq, sent } = client([
      [200, { statementType: 'SELECT', totalBytesProcessed: '0' }],
      [200, { jobComplete: false, jobReference: { jobId: 'j1', location: 'asia-northeast3' } }],
      [
        200,
        {
          jobComplete: true,
          schema: { fields: [{ name: 'n', type: 'INTEGER' }, { name: 'r', type: 'RECORD', fields: [{ name: 'x', type: 'STRING' }] }, { name: 'tags', type: 'STRING', mode: 'REPEATED' }] },
          rows: [{ f: [{ v: '1' }, { v: { f: [{ v: 'a' }] } }, { v: [{ v: 't1' }, { v: 't2' }] }] }],
          totalRows: '20',
          totalBytesProcessed: '12345',
          cacheHit: false,
        },
      ],
    ]);
    const res = await bq.query('p', 'SELECT 1 AS x');
    expect(sent[0]!.body).toEqual({ query: 'SELECT 1 AS x', useLegacySql: false, dryRun: true });
    expect(sent[1]).toEqual({
      method: 'POST',
      url: `${API}/projects/p/queries`,
      body: { query: 'SELECT 1 AS x', useLegacySql: false, maxResults: 500, maximumBytesBilled: '1000000000', timeoutMs: 30000, dryRun: false },
    });
    expect(sent[2]!.url).toMatch(new RegExp(`^${API}/projects/p/queries/j1\\?maxResults=500&timeoutMs=\\d+&location=asia-northeast3$`));
    expect(res).toMatchObject({ rows: [{ n: '1', r: { x: 'a' }, tags: ['t1', 't2'] }], totalRows: 20, bytesProcessed: 12345, jobId: 'j1', location: 'asia-northeast3' });
  });

  it('sends the configured location and the dry-run flag', async () => {
    const { bq, sent } = client([[200, { totalBytesProcessed: '99', statementType: 'SELECT' }]], { location: 'asia-northeast3' });
    expect(await bq.dryRun('p', 'SELECT 1')).toEqual({ bytesProcessed: 99, statementType: 'SELECT' });
    expect(sent[0]!.body).toEqual({ query: 'SELECT 1', useLegacySql: false, dryRun: true, location: 'asia-northeast3' });
  });

  it('retries busy answers and turns errors into codes without the token', async () => {
    const { bq, sent } = client([
      [503, {}],
      [400, { error: { message: 'Unrecognized name: nope' } }],
      [404, { error: { message: 'Not found: Table p:d.t' } }],
      [200, { type: 'VIEW', labels: { created_by: 'looker-studio-mcp' } }],
      [204, null],
    ]);
    await expect(bq.dryRun('p', 'SELECT nope')).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Unrecognized name: nope') });
    await expect(bq.getTable('p', 'd', 't')).rejects.toMatchObject({ code: 'not_found' });
    await bq.deleteTable('p', 'd', 'v');
    expect(sent.map((s) => s.method)).toEqual(['POST', 'POST', 'GET', 'GET', 'DELETE']);
    expect(JSON.stringify(sent)).not.toContain('ya29');
  });

  it('retries a request that got no answer, then reports it as busy', async () => {
    let calls = 0;
    const down = (async () => {
      calls++;
      throw new TypeError('fetch failed');
    }) as typeof globalThis.fetch;
    const bq = new BigQueryClient(tokens, undefined, { fetch: down, sleep: async () => undefined, retries: 2 });
    await expect(bq.getTable('p', 'd', 't')).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining('could not reach BigQuery') });
    expect(calls).toBe(3);
  });

  it('refuses anything but SELECT in query, before it runs', async () => {
    for (const statementType of ['DELETE', 'CREATE_TABLE_AS_SELECT', 'DROP_TABLE', 'SCRIPT']) {
      const { bq, sent } = client([[200, { statementType }]]);
      await expect(bq.query('p', 'whatever')).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining(statementType) });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toMatchObject({ dryRun: true });
    }
  });

  it('deletes only views it made (labelled), never tables', async () => {
    for (const t of [{ type: 'TABLE', labels: { created_by: 'looker-studio-mcp' } }, { type: 'VIEW' }, { type: 'VIEW', labels: { created_by: 'someone' } }]) {
      const { bq, sent } = client([[200, t]]);
      await expect(bq.deleteTable('p', 'd', 'x')).rejects.toMatchObject({ code: 'refused' });
      expect(sent.map((s) => s.method)).toEqual(['GET']);
    }
  });

  it('fails a DDL job that failed, and caps its bytes billed', async () => {
    const { bq, sent } = client([
      [200, { jobComplete: true, jobReference: { jobId: 'j2' }, errors: [{ message: 'Already exists' }] }],
      [200, { status: { state: 'DONE', errorResult: { message: 'Already exists' } } }],
    ]);
    await expect(bq.ddl('p', 'CREATE VIEW x AS SELECT 1')).rejects.toThrow('BigQuery: Already exists');
    expect(sent[0]!.body).toMatchObject({ maximumBytesBilled: '1000000000' });
    expect(sent[1]!.url).toBe(`${API}/projects/p/jobs/j2`);
  });

  it('keeps warnings in errors from failing a job that worked', async () => {
    const { bq } = client([
      [200, { jobComplete: true, jobReference: { jobId: 'j3' }, errors: [{ message: 'Deprecated option' }] }],
      [200, { status: { state: 'DONE' } }],
    ]);
    expect(await bq.ddl('p', 'CREATE VIEW x AS SELECT 1')).toEqual({ jobId: 'j3' });
  });

  it('cancels a job that runs past the deadline', async () => {
    const { bq, sent } = client([
      [200, { jobComplete: false, jobReference: { jobId: 'j4', location: 'US' } }],
      [200, {}],
    ]);
    await expect(bq.ddl('p', 'CREATE TABLE t AS SELECT 1', { deadlineMs: 0 })).rejects.toMatchObject({ code: 'busy' });
    expect(sent[1]).toMatchObject({ method: 'POST', url: `${API}/projects/p/jobs/j4/cancel?location=US` });
  });
});

describe('config', () => {
  it('has BigQuery defaults and reads the optional keys', () => {
    expect(parseConfig({}, '/h')).toEqual({ home: '/h', writesEnabled: false, dryRun: false, browser: { headless: false }, bigquery: { maxRows: 500, maxBytesBilled: 1_000_000_000 } });
    expect(
      parseConfig({ writes_enabled: true, dry_run: true, billing_project: 'proj', location: 'asia-northeast3', max_rows: 50, max_bytes_billed: 5e9 }, '/h'),
    ).toEqual({ home: '/h', writesEnabled: true, dryRun: true, browser: { headless: false }, bigquery: { billingProject: 'proj', location: 'asia-northeast3', maxRows: 50, maxBytesBilled: 5e9 } });
    expect(parseConfig({ max_rows: -1, location: '' }, '/h').bigquery).toEqual({ maxRows: 500, maxBytesBilled: 1_000_000_000 });
  });
});
