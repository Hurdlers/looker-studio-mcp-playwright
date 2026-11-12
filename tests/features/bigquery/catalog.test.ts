import { describe, expect, it } from 'vitest';

import { API, bqContext } from './helpers.js';

describe('bigquery catalog tools', () => {
  it('bq.dataset.list: follows nextPageToken and lists every dataset with its location', async () => {
    const { run, sent } = bqContext([
      [200, { datasets: [{ datasetReference: { datasetId: 'a' }, location: 'US' }], nextPageToken: 't2' }],
      [200, { datasets: [{ datasetReference: { datasetId: 'b' }, location: 'asia-northeast3' }] }],
    ]);
    const out = await run('bq_dataset_list', { project_id: 'example-project' });
    expect(sent.map((s) => s.url)).toEqual([
      `${API}/projects/example-project/datasets?all=false`,
      `${API}/projects/example-project/datasets?all=false&pageToken=t2`,
    ]);
    expect(out).toContain('a (US)');
    expect(out).toContain('b (asia-northeast3)');
  });

  it('bq.dataset.list: bad or missing project is invalid without a request; no datasets says so', async () => {
    const bad = bqContext([]);
    await expect(bad.run('bq_dataset_list', { project_id: 'Bad_Project' })).rejects.toMatchObject({ code: 'invalid' });
    expect(bad.sent).toHaveLength(0);

    const none = bqContext([]);
    await expect(none.run('bq_dataset_list', {})).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('project_id') });
    expect(none.sent).toHaveLength(0);

    const empty = bqContext([[200, {}]], { config: { billing_project: 'my-project' } });
    expect(await empty.run('bq_dataset_list', {})).toBe('No datasets in project my-project.');
    expect(empty.sent[0]!.url).toBe(`${API}/projects/my-project/datasets?all=false`);

    const adc = bqContext([[200, {}]], { adcProject: 'adc-project' });
    await adc.run('bq_dataset_list', {});
    expect(adc.sent[0]!.url).toBe(`${API}/projects/adc-project/datasets?all=false`);
  });

  it('bq.table.list: pages through 1000 at a time and names every kind', async () => {
    const { run, sent } = bqContext([
      [
        200,
        {
          tables: [
            { tableReference: { tableId: '4 Demo' }, type: 'TABLE' },
            { tableReference: { tableId: 'v' }, type: 'VIEW' },
            { tableReference: { tableId: 'mv' }, type: 'MATERIALIZED_VIEW' },
          ],
          nextPageToken: 'p2',
        },
      ],
      [200, { tables: [{ tableReference: { tableId: 'ext' }, type: 'EXTERNAL' }, { tableReference: { tableId: 'snap' }, type: 'SNAPSHOT' }] }],
    ]);
    const out = await run('bq_table_list', { project_id: 'example-project', dataset_id: 'analytics_123456' });
    const base = `${API}/projects/example-project/datasets/analytics_123456/tables?maxResults=1000`;
    expect(sent.map((s) => s.url)).toEqual([base, `${base}&pageToken=p2`]);
    for (const line of ['- 4 Demo (table)', '- v (view)', '- mv (materialized view)', '- ext (external)', '- snap (snapshot)']) expect(out).toContain(line);

    const empty = bqContext([[200, {}]]);
    expect(await empty.run('bq_table_list', { project_id: 'example-project', dataset_id: 'd' })).toBe('No tables in dataset example-project.d.');
  });

  it('bq.table.list: a bad dataset id is invalid without a request; the default project fills the URL', async () => {
    const bad = bqContext([]);
    await expect(bad.run('bq_table_list', { project_id: 'example-project', dataset_id: 'bad-id!' })).rejects.toMatchObject({ code: 'invalid' });
    expect(bad.sent).toHaveLength(0);

    const dflt = bqContext([[200, {}]], { config: { billing_project: 'billing-proj' } });
    await dflt.run('bq_table_list', { dataset_id: 'd1' });
    expect(dflt.sent[0]!.url).toBe(`${API}/projects/billing-proj/datasets/d1/tables?maxResults=1000`);
  });

  it('bq.table.describe: row count, modes only when not NULLABLE, RECORD sub-fields indented', async () => {
    const { run } = bqContext([
      [
        200,
        {
          type: 'TABLE',
          numRows: '42',
          schema: {
            fields: [
              { name: 'user', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'id', type: 'STRING', mode: 'REQUIRED', description: '사용자 id' }] },
              { name: 'n', type: 'INTEGER' },
            ],
          },
        },
      ],
    ]);
    const out = await run('bq_table_describe', { project_id: 'p-project', dataset_id: 'd', table_id: 't' });
    expect(out).toContain('`p-project.d.t` (table)');
    expect(out).toContain('Rows: 42');
    expect(out).toContain('\n- user RECORD REPEATED\n  - id STRING REQUIRED — 사용자 id\n- n INTEGER');
    expect(out).not.toMatch(/n INTEGER NULLABLE/);

    const bare = bqContext([[200, { type: 'TABLE', numRows: '0', schema: { fields: [] } }]]);
    expect(await bare.run('bq_table_describe', { project_id: 'p-project', dataset_id: 'd', table_id: 't' })).toContain('_none_');
  });

  it('bq.table.describe: "4 Demo" is accepted and URL-encoded; a view has no row count', async () => {
    const { run, sent } = bqContext([[200, { type: 'TABLE', numRows: '7', schema: { fields: [{ name: 'sessions', type: 'INTEGER' }] } }]]);
    await run('bq_table_describe', { project_id: 'example-project', dataset_id: 'analytics_123456', table_id: '4 Demo' });
    expect(sent[0]!.url.endsWith('/tables/4%20Demo')).toBe(true);

    const view = bqContext([[200, { type: 'VIEW', numRows: '0', view: { query: 'SELECT 1' }, schema: { fields: [] } }]]);
    const out = await view.run('bq_table_describe', { project_id: 'example-project', dataset_id: 'd', table_id: 'v' });
    expect(out).toContain('(view)');
    expect(out).not.toContain('Rows:');

    const bad = bqContext([]);
    await expect(bad.run('bq_table_describe', { project_id: 'example-project', dataset_id: 'd', table_id: 'a`b' })).rejects.toMatchObject({ code: 'invalid' });
    expect(bad.sent).toHaveLength(0);
  });

  it('bq.table.describe.view_sql: a view ends with its SQL in a sql code block', async () => {
    const { run } = bqContext([[200, { type: 'VIEW', view: { query: 'SELECT 1 AS x' }, schema: { fields: [{ name: 'x', type: 'INTEGER' }] } }]]);
    const out = await run('bq_table_describe', { project_id: 'example-project', dataset_id: 'd', table_id: 'v' });
    expect(out.endsWith('```sql\nSELECT 1 AS x\n```')).toBe(true);
  });

  it('bq.table.describe.view_sql: a materialized view shows its SQL too; a table has no code block', async () => {
    const mv = bqContext([[200, { type: 'MATERIALIZED_VIEW', materializedView: { query: 'SELECT 2 AS y' }, schema: { fields: [] } }]]);
    expect((await mv.run('bq_table_describe', { project_id: 'example-project', dataset_id: 'd', table_id: 'mv' })).endsWith('```sql\nSELECT 2 AS y\n```')).toBe(true);

    const table = bqContext([[200, { type: 'TABLE', numRows: '1', view: { query: 'SELECT 3' }, schema: { fields: [] } }]]);
    expect(await table.run('bq_table_describe', { project_id: 'example-project', dataset_id: 'd', table_id: 't' })).not.toContain('```');
  });
});
