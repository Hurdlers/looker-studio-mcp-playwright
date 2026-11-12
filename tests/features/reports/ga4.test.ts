import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { datasourceAdd } from '../../../src/features/data-sources/add.js';
import { RapError } from '../../../src/looker/rap.js';
import { COPIED, COPY_SOURCE, CREATED, ORIGINAL, SOURCE, fake } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const connection = { connector: 'ga4', account_id: '123456', property_id: '789012' };
function ga4Fake(options: { denied?: boolean; empty?: boolean; dryRun?: boolean } = {}) {
  const f = fake({ noProject: true, ...(options.dryRun ? { dryRun: true } : {}) });
  f.ctx.tools = new Map([...f.ctx.tools, [datasourceAdd.name, datasourceAdd]]);
  const adc = vi.spyOn(f.ctx.google, 'token'), project = vi.spyOn(f.ctx.google, 'projectId');
  const call = f.ctx.rap.call.bind(f.ctx.rap);
  vi.spyOn(f.ctx.rap, 'call').mockImplementation(async (endpoint, body, timeout, mode) => {
    if (endpoint === 'getColumns') {
      f.calls.push({ endpoint, body: structuredClone(body) as Record<string, any> });
      if (options.denied) throw new RapError(endpoint, 403, 'No property access');
      return { columns: options.empty ? [] : [{
        field: { name: 'activeUsers', ns: 't0' }, outputName: 'Active users', dataType: 5,
        defaultAggregationType: 7, columnType: 1, mutableVersion: 1,
      }] };
    }
    return call(endpoint, body, timeout, mode);
  });
  return { ...f, adc, project };
}

describe('GA4 public source inputs', () => {
  it('preflights explicit GA4 IDs before creating a report without BigQuery or ADC', async () => {
    const f = ga4Fake();
    const out = resultText(await f.run('report_create', { name: 'GA4 report', ...connection, account_id: ' 123456 ', property_id: ' 789012 ' }));
    expect(out).toContain('Connected ds1 "Google Analytics 4"');
    expect(out).not.toContain('fake-token');
    expect(f.bqCalls).toEqual([]); expect(f.adc).not.toHaveBeenCalled(); expect(f.project).not.toHaveBeenCalled();
    expect(f.calls.findIndex(c => c.endpoint === 'getColumns')).toBeLessThan(f.calls.findIndex(c => c.endpoint === 'createTempReport'));
    expect(f.sent('createBlockDatasource')[0]!.body.datasource.blocks[0].connectorBlockConfig.connectorConfig).toEqual({
      datasourceType: 1, useDatetimeType: true,
      googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '789012', isEnhanced: true },
    });
    expect(f.sent('getColumns').every(c => c.body.isBigQueryConnection === false)).toBe(true);
    const sourceId = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    expect(f.sources[sourceId]!.block.datasourceBlock.fields[0].defaultAggregationType).toBe(7);
    expect(f.sent('getAccountTree')).toEqual([]);
    expect(f.sent('grantConsent')).toEqual([]);
  });

  it('adds a named GA4 source to an existing report using the shared lifecycle', async () => {
    const f = ga4Fake();
    const out = resultText(await f.run('datasource_add', { report_id: ORIGINAL, ...connection, source_name: ' GA4 metrics ' }));
    expect(out).toContain('Added ds2 "GA4 metrics"');
    expect(f.sent('createBlockDatasource')[0]!.body.name).toBe('GA4 metrics');
    expect(f.sent('publishDatasource')).toHaveLength(1);
    expect(f.sent('claimDatasourceForReport')).toHaveLength(1);
    expect(f.bqCalls).toEqual([]); expect(f.adc).not.toHaveBeenCalled(); expect(f.project).not.toHaveBeenCalled();
  });

  it.each([{ denied: true }, { empty: true }])('leaves no report or source behind when GA4 fields cannot be read: %j', async options => {
    for (const tool of ['report_create', 'datasource_add']) {
      const f = ga4Fake(options);
      await expect(f.run(tool, { ...connection, ...(tool === 'report_create' ? { name: 'Not created' } : { report_id: ORIGINAL }) })).rejects.toThrow();
      expect(f.sent('createTempReport')).toEqual([]); expect(f.sent('createBlockDatasource')).toEqual([]);
      expect(f.sent('publishDatasource')).toEqual([]); expect(f.sent('updateReport')).toEqual([]);
      expect(f.bqCalls).toEqual([]); expect(f.adc).not.toHaveBeenCalled();
    }
  });

  it('rejects missing, UA, measurement, numeric and zero IDs before any request', async () => {
    for (const input of [
      { ...connection, account_id: undefined }, { ...connection, property_id: undefined },
      { ...connection, property_id: 'UA-12345-1' }, { ...connection, property_id: 'G-ABC123' },
      { ...connection, property_id: 789012 }, { ...connection, property_id: '0' }, { ...connection, account_id: '00123' },
    ]) {
      const f = ga4Fake();
      await expect(f.run('report_create', { name: 'Invalid IDs', ...input })).rejects.toThrow();
      await expect(f.run('datasource_add', { report_id: ORIGINAL, ...input })).rejects.toThrow();
      expect(f.calls).toEqual([]); expect(f.bqCalls).toEqual([]);
    }
  });

  it.each([
    ['view_id', '123'], ['project_id', 'example-project'], ['dataset_id', 'example_data'], ['table_id', 'events'], ['sql', 'SELECT 1'],
    ['date_range_params', false], ['viewer_email_param', false], ['spreadsheet', 'sheet'], ['worksheet', 'Tab'], ['worksheet_id', '0'],
    ['range', 'A:C'], ['use_first_row_as_headers', false], ['include_hidden_and_filtered_cells', false],
    ['host', 'localhost'], ['port', 5432], ['database', 'analytics'], ['user', 'reader'], ['password', 'example-password'], ['ssl', false],
  ])('rejects foreign input %s on GA4 before any request', async (key, value) => {
    const f = ga4Fake();
    await expect(f.run('report_create', { name: 'Mixed inputs', ...connection, [key]: value })).rejects.toThrow();
    await expect(f.run('datasource_add', { report_id: ORIGINAL, ...connection, [key]: value })).rejects.toThrow();
    expect(f.calls).toEqual([]); expect(f.bqCalls).toEqual([]);
  });

  it('does not silently discard GA4 fields on other connectors', async () => {
    for (const input of [
      { dataset_id: 'example_data', table_id: 'metrics' },
      { connector: 'google_sheets', spreadsheet: 'example_sheet', worksheet_id: '0' },
    ]) for (const ga of [{ account_id: '123456' }, { property_id: '789012' }, { view_id: false }]) {
      const f = ga4Fake();
      await expect(f.run('report_create', { name: 'Wrong connector', ...input, ...ga })).rejects.toThrow();
      await expect(f.run('datasource_add', { report_id: ORIGINAL, ...input, ...ga })).rejects.toThrow();
      expect(f.calls).toEqual([]); expect(f.bqCalls).toEqual([]);
    }
  });

  it('builds a GA4 creation link without account enumeration or browser requests', async () => {
    const f = ga4Fake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'GA4 link', sources: [{ ...connection }] })));
    expect(url.searchParams.get('ds.connector')).toBe('googleAnalytics');
    expect(url.searchParams.get('ds.accountId')).toBe('123456');
    expect(url.searchParams.get('ds.propertyId')).toBe('789012');
    expect(url.searchParams.has('ds.viewId')).toBe(false);
    expect(f.calls).toEqual([]); expect(f.bqCalls).toEqual([]); expect(f.adc).not.toHaveBeenCalled();
  });

  it('reconnects a copied GA4 property without changing the original source', async () => {
    const f = ga4Fake();
    const originalConfig = { datasourceType: 1, useDatetimeType: true,
      googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '111222', isEnhanced: true } };
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = originalConfig;
    const original = structuredClone(f.sources[SOURCE]);
    await f.run('report_copy', { report_id: ORIGINAL, name: 'GA4 copy', data_sources: [{ original: 'ds1', ...connection }] });
    expect(f.sources[COPY_SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig).toEqual({
      datasourceType: 1, useDatetimeType: true,
      googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '789012', isEnhanced: true },
    });
    expect(f.sources[COPY_SOURCE]!.reportId).toBe(COPIED);
    expect(f.sources[SOURCE]).toEqual(original);
    expect(f.bqCalls).toEqual([]); expect(f.adc).not.toHaveBeenCalled();
  });

  it('refuses reconnecting unsupported GA4 segment settings before making a report copy', async () => {
    const f = ga4Fake();
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = { datasourceType: 1, useDatetimeType: true,
      googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '111222', isEnhanced: true, analyticsSegment: 'gaid::example' } };
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Not copied', data_sources: [{ original: 'ds1', ...connection }] })).rejects.toThrow();
    expect(f.sent('copyReport')).toEqual([]);
    expect(f.sent('publishDatasource')).toEqual([]);
    expect(f.bqCalls).toEqual([]);
  });

  it('validates fields but does not create a source during dry-run', async () => {
    const f = ga4Fake({ dryRun: true });
    await f.run('datasource_add', { report_id: ORIGINAL, ...connection });
    expect(f.sent('getColumns')).toHaveLength(1);
    expect(f.sent('createBlockDatasource')).toEqual([]); expect(f.sent('publishDatasource')).toEqual([]);
    expect(f.sent('updateReport')).toEqual([]); expect(f.bqCalls).toEqual([]);
  });
});
