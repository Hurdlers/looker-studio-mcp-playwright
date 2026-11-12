import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, SQL, TABLE } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

describe('report creation links', () => {
  it('report.link makes the exact table creation parameters without RAP calls', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [TABLE] })));
    expect(url.origin + url.pathname).toBe('https://lookerstudio.google.com/reporting/create');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'c.mode': 'edit', 'r.reportName': 'Weekly', 'ds.connector': 'bigQuery', 'ds.type': 'TABLE', 'ds.projectId': TABLE.project_id, 'ds.datasetId': TABLE.dataset_id, 'ds.tableId': TABLE.table_id,
    });
    expect(f.calls).toHaveLength(0);
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('report.link.template accepts a report URL and extracts its id', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', template_report_id: `https://lookerstudio.google.com/reporting/${ORIGINAL}/page/abc`, sources: [TABLE] })));
    expect(url.searchParams.get('c.reportId')).toBe(ORIGINAL);
    await expect(f.run('report_link_build', { report_name: 'Weekly', template_report_id: 'not a report', sources: [TABLE] })).rejects.toMatchObject({ code: 'invalid' });
    const without = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [TABLE] })));
    expect(without.searchParams.has('c.reportId')).toBe(false);
  });

  it('report.link.source.bigquery_table requires a full table and uses the default project', async () => {
    const f = fake();
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ dataset_id: 'dataset' }] })).rejects.toMatchObject({ code: 'invalid' });
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [{ dataset_id: TABLE.dataset_id, table_id: TABLE.table_id }] })));
    expect(url.searchParams.get('ds.projectId')).toBe(TABLE.project_id);
  });

  it('report.link.source.custom_query trims sql and checks it in BigQuery', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: ' SELECT 1 ' }] })));
    expect(url.searchParams.get('ds.type')).toBe('CUSTOM_QUERY');
    expect(url.searchParams.get('ds.sql')).toBe('SELECT 1');
    expect(f.bqCalls[0]!.query).toBe('SELECT 1');
    expect(f.calls).toHaveLength(0);
  });

  it('report.link.source.custom_query returns BigQuery errors instead of a URL', async () => {
    const f = fake({ sqlError: true });
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: SQL }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Unrecognized name') });
  });

  it('report.link.source.custom_query directs parameterized queries to supported tools', async () => {
    const f = fake();
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: 'SELECT @DS_USER_EMAIL' }] })).rejects.toMatchObject({ message: expect.stringContaining('report_create') });
    try {
      await f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: 'SELECT @DS_USER_EMAIL' }] });
    } catch (error) {
      expect((error as Error).message).not.toContain('viewer_email_param: true');
    }
  });

  it('report.link.source.name favors name over source_name', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: SQL, name: 'A', source_name: 'B' }] })));
    expect(url.searchParams.get('ds.datasourceName')).toBe('A');
  });

  it('report.link.source.name allows table name but refuses table source_name', async () => {
    const f = fake();
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ ...TABLE, source_name: 'T' }] })).rejects.toMatchObject({ code: 'invalid' });
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [{ ...TABLE, name: 'T' }] })));
    expect(url.searchParams.get('ds.datasourceName')).toBe('T');
  });

  it('report.link.source.alias preserves two sources without a template', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', sources: [TABLE, { ...TABLE, table_id: 'other' }] })));
    expect(url.searchParams.get('ds.ds0.tableId')).toBe(TABLE.table_id);
    expect(url.searchParams.get('ds.ds1.tableId')).toBe('other');
    expect([...url.searchParams.keys()].some((key) => key.startsWith('ds.*.'))).toBe(false);
  });

  it('report.link.source.alias uses explicit template aliases and refuses duplicates', async () => {
    const f = fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Weekly', template_report_id: ORIGINAL, sources: [{ ...TABLE, alias: 'ds3' }] })));
    expect(url.searchParams.get('ds.ds3.connector')).toBe('bigQuery');
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ ...TABLE, alias: 'ds0' }, { ...TABLE, alias: 'ds0' }] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it.each(['date_range_params', 'viewer_email_param'])('report.link.source.query_params_refused directs %s to supported tools', async (option) => {
    const f = fake();
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ sql: SQL, [option]: true }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/report_create.*datasource_add/) });
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ ...TABLE, [option]: true }] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it.each(['postgresql', 'mysql'])('report.link.connector.database_refused rejects %s with a BigQuery explanation', async (connector) => {
    const f = fake();
    await expect(f.run('report_link_build', { report_name: 'Weekly', sources: [{ connector, host: 'localhost' }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/BigQuery.*report_create/) });
    expect(f.calls).toHaveLength(0);
  });
});
