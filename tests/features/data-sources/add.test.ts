import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { bigquery, context, DATASET, looker, PROJECT, R1, sent, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

const newColumns = () => [
  { columnType: 1, mutableVersion: 1, outputName: 'device_category', dataType: 0, field: { ns: 't0', name: '_device_category_' } },
  { columnType: 1, mutableVersion: 1, outputName: 'sessions', dataType: 5, defaultAggregationType: 6, field: { ns: 't0', name: '_sessions_' } },
];

const ADD_ORDER = ['getFirstPartyAccessToken', 'getColumns', 'createBlockDatasource', 'publishDatasource', 'claimDatasourceForReport', 'getReport', 'updateReport'];
const SQL = `SELECT device_category, SUM(sessions) AS sessions FROM \`${PROJECT}.${DATASET}.${TABLE}\` GROUP BY 1`;

function setup(opts: { dryRun?: boolean; billingProject?: string | null; reply?: Parameters<typeof bigquery>[0]; consentRefused?: boolean } = {}) {
  const f = looker({ columns: newColumns, consentRefused: opts.consentRefused === true });
  const bq = bigquery(opts.reply);
  const ctx = context(f.rap, { ...opts, fetch: bq.fetch });
  const add = async (args: Record<string, unknown>) => resultText(await runTool(ctx, 'datasource_add', { report_id: R1, ...args }));
  return { ...f, bq, add };
}

describe('datasource_add', () => {
  it('preserves datasource_add whitespace SQL and default-name behavior', async () => {
    const table = setup();
    await table.add({ dataset_id: DATASET, table_id: TABLE, sql: '   ', source_name: '   ' });
    expect(table.bq.sent).toEqual([]);
    expect(table.calls.find((call) => call.endpoint === 'createBlockDatasource')!.body.name).toBe(TABLE);

    const query = setup();
    const sql = `  ${SQL}  `;
    await query.add({ sql, source_name: '   ' });
    expect(query.bq.sent[0]!.body.query).toBe(sql);
    expect(query.calls.find((call) => call.endpoint === 'createBlockDatasource')!.body.name).toBe('Custom query');
  });

  it('datasource.add.bigquery.table: connects a table in the default project, six calls in order, alias and id in the answer, no token', async () => {
    const s = setup();
    const out = await s.add({ dataset_id: DATASET, table_id: TABLE });
    expect(sent(s.calls)).toEqual(ADD_ORDER);
    expect(s.calls[1]!.body.connectorBlockConfig.connectorConfig.bigQueryConnectorConfig).toMatchObject({ projectId: PROJECT, datasetId: DATASET, tableId: TABLE });
    expect(s.report.report.resource!.datasourceAlias!.at(-1)).toEqual({ datasourceId: 'new-1', alias: 'ds3' });
    expect(out).toContain('ds3');
    expect(out).toContain('new-1');
    expect(out).not.toContain('ya29');
    expect(s.bq.sent).toEqual([]);
  });

  it('datasource.add.bigquery.table: refuses mixed or missing inputs before any call, and stops short of creating in a dry run', async () => {
    const cases: Array<[Record<string, unknown>, { billingProject?: string | null }?]> = [
      [{ sql: SQL, table_id: TABLE }],
      [{ connector: 'bigquery', dataset_id: DATASET, table_id: TABLE, spreadsheet: 'https://docs.google.com/spreadsheets/d/1AbC' }],
      [{ dataset_id: DATASET, table_id: TABLE }, { billingProject: null }],
    ];
    for (const [args, opts] of cases) {
      const s = setup(opts);
      await expect(s.add(args)).rejects.toMatchObject({ code: 'invalid' });
      expect(s.calls).toEqual([]);
      expect(s.bq.sent).toEqual([]);
    }
    const dry = setup({ dryRun: true });
    const out = await dry.add({ dataset_id: DATASET, table_id: TABLE });
    expect(sent(dry.calls)).toContain('getColumns');
    expect(sent(dry.calls)).not.toContain('createBlockDatasource');
    expect(sent(dry.calls)).not.toContain('updateReport');
    expect(out).toMatch(/Dry run .*createBlockDatasource/);
  });

  it('datasource.add.bigquery.custom_query: dry-runs the SQL in the billing project first, then sends it as the connector query', async () => {
    const s = setup();
    await s.add({ sql: SQL, project_id: PROJECT });
    expect(s.bq.sent[0]).toEqual({
      url: `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`,
      body: { query: SQL, useLegacySql: false, dryRun: true },
    });
    expect(sent(s.calls)).toEqual(ADD_ORDER);
    expect(s.calls[1]!.body.connectorBlockConfig.connectorConfig).toMatchObject({
      datasourceType: 2,
      sql: SQL,
      bigQueryConnectorConfig: { projectId: PROJECT, billingProjectId: PROJECT, sqlType: 2 },
    });
  });

  it('datasource.add.bigquery.custom_query: refuses non-SELECT, several statements and queries BigQuery rejects, sending nothing to Looker', async () => {
    for (const sql of ['DELETE FROM t WHERE true', 'SELECT 1; SELECT 2']) {
      const s = setup();
      await expect(s.add({ sql })).rejects.toMatchObject({ code: 'invalid' });
      expect(s.bq.sent).toEqual([]);
      expect(s.calls).toEqual([]);
    }
    const s = setup({ reply: () => [400, { error: { message: 'Unrecognized name: foo at [1:8]' } }] });
    await expect(s.add({ sql: 'SELECT foo FROM t' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Unrecognized name: foo') });
    expect(s.bq.sent).toHaveLength(1);
    expect(s.calls).toEqual([]);
  });

  it('datasource.add.name: names a custom query or a table source', async () => {
    const s = setup();
    const out = await s.add({ sql: SQL, source_name: 'TA by device' });
    const create = s.calls.find((c) => c.endpoint === 'createBlockDatasource')!.body;
    expect(create.name).toBe('TA by device');
    expect(create.datasource.datasourceBlock.name).toBe('TA by device');
    // The list already shows the name: no second rename.
    expect(sent(s.calls)).not.toContain('renameDatasource');
    expect(out).toContain('"TA by device"');
    const t = setup();
    const tableResult = await t.add({ dataset_id: DATASET, table_id: TABLE, source_name: 'Table alias' });
    expect(tableResult).toContain('Table alias');
  });

  it('datasource.add.bigquery.date_range_params: dry-runs with sample dates and switches the date parameters on', async () => {
    const sql = `SELECT @DS_START_DATE AS start_date, COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\` WHERE @DS_END_DATE IS NOT NULL`;
    const s = setup();
    await s.add({ sql, date_range_params: true });
    const dry = s.bq.sent[0]!.body;
    expect(dry).toMatchObject({ query: sql, dryRun: true, useLegacySql: false, parameterMode: 'NAMED' });
    expect(dry.queryParameters).toEqual([
      { name: 'DS_START_DATE', parameterType: { type: 'STRING' }, parameterValue: { value: '20240101' } },
      { name: 'DS_END_DATE', parameterType: { type: 'STRING' }, parameterValue: { value: '20240101' } },
    ]);
    for (const endpoint of ['getColumns', 'createBlockDatasource']) {
      const body = s.calls.find((c) => c.endpoint === endpoint)!.body;
      const config = endpoint === 'getColumns' ? body.connectorBlockConfig.connectorConfig : body.datasource.blocks[0].connectorBlockConfig.connectorConfig;
      const params = config.parameterConfiguration.parameters as Json[];
      expect(params.map((p) => p.key)).toEqual(['DS_START_DATE', 'DS_END_DATE']);
      for (const p of params) {
        expect(p.value.parametersModifiedByRoles[0].value.dataType).toBe(5);
        expect(p.value.parameterDisplayConfiguration.displayType).toBe(6);
      }
    }
  });

  it('datasource.add.bigquery.date_range_params: refuses the parameters without the option, and the option without sql', async () => {
    const sql = `SELECT @DS_START_DATE AS start_date, COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\` WHERE @DS_END_DATE IS NOT NULL`;
    const s = setup();
    await expect(s.add({ sql })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('date_range_params') });
    await expect(s.add({ dataset_id: DATASET, table_id: TABLE, date_range_params: true })).rejects.toMatchObject({ code: 'invalid' });
    expect(s.calls).toEqual([]);
    expect(s.bq.sent).toEqual([]);
  });

  it('datasource.add.bigquery.viewer_email_param: switches the email parameter on, then consents for the signed-in account', async () => {
    const sql = `SELECT @DS_USER_EMAIL AS viewer, COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\``;
    const s = setup();
    const out = await s.add({ sql, viewer_email_param: true });
    expect(s.bq.sent[0]!.body.queryParameters).toEqual([{ name: 'DS_USER_EMAIL', parameterType: { type: 'STRING' }, parameterValue: { value: 'viewer@example.com' } }]);
    const params = s.calls.find((c) => c.endpoint === 'getColumns')!.body.connectorBlockConfig.connectorConfig.parameterConfiguration.parameters as Json[];
    expect(params.map((p) => p.key)).toEqual(['DS_USER_EMAIL']);
    expect(params[0]!.value.parametersModifiedByRoles[0].value.dataType).toBe(1);
    expect(params[0]!.value.parameterDisplayConfiguration.displayType).toBe(1);
    const check = s.calls.find((c) => c.endpoint === 'checkConsent')!;
    expect(check.body).toEqual({ parameter: { datasourceId: 'new-1', consentTypes: [1] } });
    expect(s.calls.find((c) => c.endpoint === 'grantConsent')!.body).toEqual({ parameter: { consent: [{ consentType: 1, approval: 1 }], datasourceId: 'new-1' } });
    expect(sent(s.calls).indexOf('checkConsent')).toBeGreaterThan(sent(s.calls).indexOf('updateReport'));
    expect(out).toMatch(/Consented/);
  });

  it('datasource.add.bigquery.viewer_email_param: a failed consent still answers with the added alias and id, and says the viewer must click Allow', async () => {
    const sql = `SELECT @DS_USER_EMAIL AS viewer, COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\``;
    const s = setup({ consentRefused: true });
    const out = await s.add({ sql, viewer_email_param: true });
    expect(sent(s.calls)).toContain('updateReport');
    expect(sent(s.calls)).toContain('grantConsent');
    expect(out).toContain('ds3');
    expect(out).toContain('new-1');
    expect(out).toMatch(/Consent NOT given/);
    expect(out).toMatch(/Allow/);
    expect(out).not.toMatch(/^Consented/m);
  });

  it('datasource.add.bigquery.viewer_email_param: refuses the email parameter without the option, and the option without sql', async () => {
    const sql = `SELECT @DS_USER_EMAIL AS viewer, COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.${TABLE}\``;
    const s = setup();
    await expect(s.add({ sql })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('viewer_email_param') });
    await expect(s.add({ dataset_id: DATASET, table_id: TABLE, viewer_email_param: true })).rejects.toMatchObject({ code: 'invalid' });
    expect(s.calls).toEqual([]);
    expect(s.bq.sent).toEqual([]);
  });

  it('datasource.connector.reject: PostgreSQL and MySQL are refused with the reason, nothing sent', async () => {
    for (const connector of ['postgresql', 'mysql']) {
      const s = setup();
      await expect(s.add({ connector, dataset_id: DATASET, table_id: TABLE })).rejects.toMatchObject({
        code: 'invalid',
        message: expect.stringContaining('not supported'),
      });
      expect(s.calls).toEqual([]);
      expect(s.bq.sent).toEqual([]);
    }
  });
});


describe('Google Sheets data source addition', () => {
  it('adds a selected worksheet without a billing project and preserves the requested options', async () => {
    const s = setup({ billingProject: null });
    const call = s.rap.call.bind(s.rap);
    vi.spyOn(s.rap, 'call').mockImplementation(async (endpoint, body, timeout, mode) => {
      if (endpoint === 'getAccountTree') {
        s.calls.push({ endpoint, body: structuredClone(body) as Json });
        return { accountTree: { googleSheetsAccountTree: { worksheets: [{ gid: '0', title: 'Sales' }] } } };
      }
      return call(endpoint, body, timeout, mode);
    });
    const text = await s.add({ connector: 'google_sheets', spreadsheet: 'example_sheet_id', worksheet_id: 0, range: 'A1:B4', include_hidden_and_filtered_cells: false });
    expect(text).toContain('Google Sheets example_sheet_id, worksheet Sales, range A1:B4');
    expect(s.bq.sent).toEqual([]);
    expect(s.calls.filter((call) => call.endpoint === 'getAccountTree')[0]!.body.googleSheetsOptions).toEqual({ type: 1, connectorConfig: { key: 'example_sheet_id' } });
    expect(s.calls.filter((call) => call.endpoint === 'createBlockDatasource')[0]!.body.datasource.blocks[0].connectorBlockConfig.connectorConfig)
      .toEqual({ datasourceType: 8, useDatetimeType: true, sheetsConfig: { key: 'example_sheet_id', sheetId: '0', hasHeader: true, includeHiddenCells: false, includeFilteredCells: false, range: 'A1:B4' } });
  });

  it('rejects mixed BigQuery inputs and missing tabs before any request', async () => {
    for (const input of [{ dataset_id: DATASET }, { sql: 'SELECT 1' }, { viewer_email_param: false }, {}]) {
      const s = setup();
      await expect(s.add({ connector: 'google_sheets', spreadsheet: 'example_sheet_id', ...input })).rejects.toThrow();
      expect(s.calls).toEqual([]);
      expect(s.bq.sent).toEqual([]);
    }
  });
});
