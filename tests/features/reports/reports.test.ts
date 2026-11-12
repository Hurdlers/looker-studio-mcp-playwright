import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { BLANK_TEMPLATE } from '../../../src/core/create.js';
import { connectorConfig } from '../../../src/core/datasource.js';
import { COPIED, COPY_SOURCE, CREATED, fake, ORIGINAL, REUSABLE, SOURCE, SQL, TABLE } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

describe('report listing', () => {
  it('report.list reads every report in one request and handles an empty list', async () => {
    const f = fake();
    f.reports[CREATED] = { ...structuredClone(f.original), shareable: { id: CREATED, name: 'Second' } };
    f.reports[COPIED] = { ...structuredClone(f.original), shareable: { id: COPIED, name: 'Third' } };
    const result = resultText(await f.run('report_list', {}));
    expect(result.split('\n')).toHaveLength(3);
    for (const [id, report] of Object.entries(f.reports)) {
      expect(result).toContain(report.shareable.name);
      expect(result).toContain(`${id} | https://lookerstudio.google.com/reporting/${id}`);
    }
    expect(f.sent('getShareableList')).toHaveLength(1);
    expect(f.sent('getShareableList')[0]!.body).toMatchObject({ type: [0], trashed: false, titleContains: '' });
    for (const id of Object.keys(f.reports)) delete f.reports[id];
    expect(resultText(await f.run('report_list', {}))).toBe('This account has no reports yet.');
  });

  it('report.list.name_filter matches locally without case sensitivity', async () => {
    const f = fake();
    f.original.shareable.name = 'Analytics Weekly';
    f.reports[CREATED] = { ...structuredClone(f.original), shareable: { id: CREATED, name: 'analytics daily' } };
    f.reports[COPIED] = { ...structuredClone(f.original), shareable: { id: COPIED, name: 'Ads' } };
    expect(resultText(await f.run('report_list', { query: 'ANALYTICS' })).split('\n')).toHaveLength(2);
    expect(f.sent('getShareableList')[0]!.body.titleContains).toBe('');
    expect(resultText(await f.run('report_list', { query: 'zzz' }))).toMatch(/No.*zzz/);
    expect(resultText(await f.run('report_list', { query: ' ' })).split('\n')).toHaveLength(3);
  });
});

describe('report creation', () => {
  it('preserves report_create strict blank input checks, SQL trimming and inferred source name', async () => {
    const blankSql = fake();
    await expect(blankSql.run('report_create', { name: 'New', ...TABLE, sql: '   ' })).rejects.toThrow('sql cannot be empty');
    expect(blankSql.calls).toEqual([]);
    const blankName = fake();
    await expect(blankName.run('report_create', { name: 'New', ...TABLE, source_name: '   ' })).rejects.toThrow('source_name cannot be empty');
    expect(blankName.calls).toEqual([]);
    const query = fake();
    await query.run('report_create', { name: 'New', sql: `  ${SQL}  ` });
    expect(query.bqCalls[0]!.query).toBe(SQL);
    expect(query.sent('createBlockDatasource')[0]!.body.name).toBe(TABLE.table_id);
  });

  it('report.create trims the name and uses the blank template', async () => {
    const f = fake();
    const answer = resultText(await f.run('report_create', { name: '  Weekly  ', ...TABLE }));
    expect(f.sent('createTempReport')[0]!.body).toMatchObject({ reportTitle: 'Weekly', templateId: BLANK_TEMPLATE });
    expect(f.sent('persistTempReport')[0]!.body).toMatchObject({ reportName: 'Weekly', templateId: BLANK_TEMPLATE });
    expect(answer).toContain(CREATED);
    expect(answer).not.toContain('fake-token');
  });

  it('report.create rejects blank names before any request', async () => {
    const f = fake();
    await expect(f.run('report_create', { name: '  ', ...TABLE })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    { dataset_id: 'dataset', table_id: 'table' },
    { project_id: 'project', table_id: 'table' },
    { ...TABLE, sql: SQL },
    { ...TABLE, spreadsheet: 'sheet-id' },
  ])('report.create.source.bigquery_table refuses invalid connection %j', async (source) => {
    const f = fake({ noProject: true });
    await expect(f.run('report_create', { name: 'New', ...source })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.create.source.bigquery_table connects the given table and uses its name', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', ...TABLE });
    expect(f.sent('getColumns')[0]!.body.connectorBlockConfig.connectorConfig).toEqual(connectorConfig({ projectId: TABLE.project_id, datasetId: TABLE.dataset_id, tableId: TABLE.table_id }));
    expect(f.sent('createBlockDatasource')[0]!.body.name).toBe(TABLE.table_id);
  });

  it('report.create.source.custom_query trims sql and derives the default source name', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', project_id: TABLE.project_id, sql: ` ${SQL} ` });
    expect(f.sent('getColumns')[0]!.body.connectorBlockConfig.connectorConfig).toMatchObject({ sql: SQL, bigQueryConnectorConfig: { billingProjectId: TABLE.project_id } });
    expect(f.sent('createBlockDatasource')[0]!.body.name).toBe(TABLE.table_id);
  });

  it.each(['DELETE FROM table WHERE true', 'SELECT 1; SELECT 2'])('report.create.source.sql_check refuses nonselect or multiple statements', async (sql) => {
    const f = fake();
    await expect(f.run('report_create', { name: 'New', sql })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
    expect(f.bqCalls).toHaveLength(0);
  });

  it('report.create.source.sql_check surfaces BigQuery errors before creating a report', async () => {
    const f = fake({ sqlError: true });
    await expect(f.run('report_create', { name: 'New', sql: SQL })).rejects.toThrow('Unrecognized name: missing_column');
    expect(f.sent('createTempReport')).toHaveLength(0);
  });

  it('report.create.source.sql_check supplies typed parameter stand-ins', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', sql: 'SELECT @DS_START_DATE <= @DS_END_DATE AS date_check', date_range_params: true });
    expect(f.bqCalls[0]!.queryParameters.map((p: any) => [p.name, p.parameterType.type])).toEqual([['DS_START_DATE', 'STRING'], ['DS_END_DATE', 'STRING']]);
  });

  it('report.create.source.name sets the query source name in both creation locations', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', sql: SQL, source_name: 'Query traffic' });
    expect(f.sent('createBlockDatasource')[0]!.body).toMatchObject({ name: 'Query traffic', datasource: { datasourceBlock: { name: 'Query traffic' } } });
  });

  it('report.create.source.name preserves explicit table source names', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', ...TABLE, source_name: 'Named table' });
    expect(f.sent('createBlockDatasource')[0]!.body).toMatchObject({ name: 'Named table', datasource: { datasourceBlock: { name: 'Named table' } } });
  });

  it('report.create.source.date_range_params refuses missing flags and flags without sql', async () => {
    const f = fake();
    await expect(f.run('report_create', { name: 'New', sql: 'SELECT @DS_START_DATE <= @DS_END_DATE' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.run('report_create', { name: 'New', ...TABLE, date_range_params: true })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.create.source.viewer_email_param refuses email without its option', async () => {
    const f = fake();
    await expect(f.run('report_create', { name: 'New', sql: 'SELECT @DS_USER_EMAIL AS viewer' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.create.source.viewer_email_param records the option and requests account consent', async () => {
    const f = fake();
    await f.run('report_create', { name: 'New', sql: 'SELECT @DS_USER_EMAIL AS viewer', viewer_email_param: true });
    const config = f.sent('createBlockDatasource')[0]!.body.datasource.blocks[0].connectorBlockConfig.connectorConfig;
    expect(config.parameterConfiguration.parameters.map((p: any) => p.key)).toEqual(['DS_USER_EMAIL']);
    expect(f.sent('grantConsent')[0]!.body.parameter.consent).toEqual([{ consentType: 1, approval: 1 }]);
  });

  it('report.create.source.viewer_email_param reports failed consent without hiding the created report', async () => {
    const f = fake({ consentFails: true });
    const answer = resultText(await f.run('report_create', { name: 'New', sql: 'SELECT @DS_USER_EMAIL', viewer_email_param: true }));
    expect(answer).toContain(CREATED);
    expect(answer).toContain('consent was not granted');
  });

  it.each(['postgresql', 'mysql'])('report.create.source.bigquery_table rejects connector %s before requests', async (connector) => {
    const f = fake();
    await expect(f.run('report_create', { name: 'New', connector })).rejects.toThrow('BigQuery');
    expect(f.calls).toHaveLength(0);
  });

  it('report.create supports the shared dry run without creating anything', async () => {
    const f = fake({ dryRun: true });
    expect(resultText(await f.run('report_create', { name: 'New', ...TABLE }))).toContain('nothing was saved');
    expect(f.sent('createTempReport')).toHaveLength(0);
    expect(Object.keys(f.reports)).toEqual([ORIGINAL]);
  });
});

describe('report copying', () => {
  it('report.copy includes all source ids in the form and renames the new id', async () => {
    const f = fake();
    f.original.page.push({ pageId: 'p2', version: '1', page: { componentConfig: [{ datasourceId: 'second-source' }] } });
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy' });
    expect(f.sent('copyReport')[0]).toMatchObject({ mode: 'form', body: { datasourceMap: JSON.stringify({ [SOURCE]: SOURCE, 'second-source': 'second-source' }), region: 'global' } });
    expect(f.sent('updateReport').some((call) => call.body.reportId === COPIED && call.body.reportName === 'Copy')).toBe(true);
    expect(f.original.shareable.name).toBe('Lab A');
  });

  it('report.copy refuses duplicate originals before requests', async () => {
    const f = fake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', ...TABLE }, { original: 'ds1', ...TABLE }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.copy.source.reusable replaces a named source in datasourceMap', async () => {
    const f = fake();
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: TABLE.table_id, reusable: 'Reusable traffic' }] });
    expect(JSON.parse(f.sent('copyReport')[0]!.body.datasourceMap)).toEqual({ [SOURCE]: REUSABLE });
    expect(f.reports[COPIED]!.report.resource!.datasourceAlias).toEqual([{ alias: 'ds1', datasourceId: REUSABLE }]);
  });

  it.each([{ table_id: 'other' }, { project_id: 'other' }])('report.copy.source.reusable refuses mixed reusable connection %j', async (extra) => {
    const f = fake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', reusable: 'Reusable traffic', ...extra }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.copy.source.reusable lists available names for a missing reusable source', async () => {
    const f = fake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', reusable: 'Missing' }] })).rejects.toThrow('Reusable traffic');
    expect(f.sent('copyReport')).toHaveLength(0);
  });

  it('report.copy.source.bigquery_table reconnects the copied source, removes sql and renames it', async () => {
    const f = fake();
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig.sql = SQL;
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', ...TABLE }] });
    const draft = f.sent('publishDatasource')[0]!.body.draft;
    expect(draft.datasourceId).toBe(COPY_SOURCE);
    expect(draft.blocks[0].connectorBlockConfig.connectorConfig.sql).toBeUndefined();
    expect(draft.blocks[0].connectorBlockConfig.connectorConfig.bigQueryConnectorConfig.tableId).toBe(TABLE.table_id);
    expect(draft.datasourceBlock.name).toBe(TABLE.table_id);
    expect(f.sent('renameDatasource')[0]!.body).toEqual({ datasourceId: COPY_SOURCE, title: TABLE.table_id });
    expect(f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig.sql).toBe(SQL);
  });

  it('report.copy.source.bigquery_table refuses reconnecting a reusable original', async () => {
    const f = fake();
    f.sources[SOURCE]!.reportId = '';
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', ...TABLE }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.sent('copyReport')).toHaveLength(0);
  });

  it.each([undefined, false, true])('preserves BigQuery date mode %s when reconnecting copied table or SQL sources', async (dateMode) => {
    for (const replacement of [TABLE, { sql: SQL }]) {
      const f = fake();
      const original = f.sources[SOURCE]!.block;
      const originalConfig = original.blocks[0].connectorBlockConfig.connectorConfig;
      if (dateMode !== undefined) originalConfig.useDatetimeType = dateMode;
      original.datasourceBlock.fields[0].outputSemanticInfo = { semanticConfig: [{ semanticType: 33 }] };
      const before = structuredClone(original);
      await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', ...replacement }] });
      const draft = f.sent('publishDatasource')[0]!.body.draft;
      const reconnectedConfig = draft.blocks[0].connectorBlockConfig.connectorConfig;
      const columnsConfig = f.sent('getColumns').at(-1)!.body.connectorBlockConfig.connectorConfig;
      for (const config of [reconnectedConfig, columnsConfig]) {
        if (dateMode === undefined) expect(config).not.toHaveProperty('useDatetimeType');
        else expect(config.useDatetimeType).toBe(dateMode);
      }
      expect(draft.datasourceBlock.fields).toEqual(before.datasourceBlock.fields);
      expect(f.sources[SOURCE]!.block).toEqual(before);
    }
  });

  it('report.copy.source.custom_query fails a rejected query before copying', async () => {
    const f = fake({ sqlError: true });
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', sql: SQL }] })).rejects.toThrow('Unrecognized name');
    expect(f.sent('copyReport')).toHaveLength(0);
  });

  it.each([undefined, 'Named query'])('report.copy.source.custom_query stores sql and renames only when requested (%s)', async (sourceName) => {
    const f = fake();
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', sql: SQL, ...(sourceName ? { source_name: sourceName } : {}) }] });
    const draft = f.sent('publishDatasource')[0]!.body.draft;
    expect(draft.blocks[0].connectorBlockConfig.connectorConfig.sql).toBe(SQL);
    expect(draft.blocks[0].connectorBlockConfig.connectorConfig.bigQueryConnectorConfig.tableId).toBeUndefined();
    if (sourceName) {
      expect(f.sent('renameDatasource')[0]!.body).toEqual({ datasourceId: COPY_SOURCE, title: sourceName });
      expect(f.calls.findIndex((call) => call.endpoint === 'renameDatasource')).toBeGreaterThan(f.calls.findIndex((call) => call.endpoint === 'publishDatasource'));
    } else expect(f.sent('renameDatasource')).toHaveLength(0);
    expect(f.sources[SOURCE]!.name).toBe(TABLE.table_id);
  });

  it('report.copy.source.query_params requires options before copying', async () => {
    const f = fake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', sql: 'SELECT @DS_START_DATE' }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.sent('copyReport')).toHaveLength(0);
  });

  it('report.copy.source.query_params writes both connector date parameters', async () => {
    const f = fake();
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', sql: 'SELECT @DS_START_DATE <= @DS_END_DATE', date_range_params: true }] });
    const config = f.sent('publishDatasource')[0]!.body.draft.blocks[0].connectorBlockConfig.connectorConfig;
    expect(config.parameterConfiguration.parameters.map((p: any) => p.key)).toEqual(['DS_START_DATE', 'DS_END_DATE']);
  });

  it.each(['mysql', 'postgresql'])('datasource.connector.reject / report.copy.source.other_connectors refuses %s before requests', async (connector) => {
    const f = fake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Copy', data_sources: [{ original: 'ds1', connector }] })).rejects.toThrow('BigQuery');
    expect(f.calls).toHaveLength(0);
  });
});

describe('report title and trash', () => {
  it('report.rename trims the name and sends only the title update', async () => {
    const f = fake();
    await f.run('report_rename', { report_id: ORIGINAL, name: ' New name ' });
    expect(f.sent('updateReport')[0]!.body).toEqual({ reportId: ORIGINAL, reportName: 'New name' });
  });

  it('report.rename refuses blank names before any request', async () => {
    const f = fake();
    await expect(f.run('report_rename', { report_id: ORIGINAL, name: ' ' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });

  it('report.delete compares case exactly and uses trash rather than permanent deletion', async () => {
    const f = fake();
    await expect(f.run('report_delete', { report_id: ORIGINAL, confirm_name: 'lab a' })).rejects.toThrow('Lab A');
    expect(f.sent('updateRemovedState')).toHaveLength(0);
    await f.run('report_delete', { report_id: ORIGINAL, confirm_name: 'Lab A' });
    expect(f.sent('updateRemovedState')).toEqual([{ endpoint: 'updateRemovedState', body: { id: ORIGINAL, removed: true, type: 0 } }]);
    expect(f.sent('deleteShareable')).toHaveLength(0);
  });
});
