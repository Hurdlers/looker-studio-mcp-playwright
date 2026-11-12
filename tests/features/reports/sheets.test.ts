import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { COPIED, COPY_SOURCE, fake, ORIGINAL, SOURCE } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const SHEET = 'example_sheet_id';
const connection = { connector: 'google_sheets', spreadsheet: SHEET, worksheet: 'Sales' };
function sheetsFake(tabs = [{ gid: '0', title: 'Sales' }], emptyColumns = false) {
  const f = fake({ noProject: true });
  const call = f.ctx.rap.call.bind(f.ctx.rap);
  vi.spyOn(f.ctx.rap, 'call').mockImplementation(async (endpoint, body, timeout, mode) => {
    if (endpoint === 'getAccountTree') {
      f.calls.push({ endpoint, body: structuredClone(body) as Record<string, any> });
      return { accountTree: { googleSheetsAccountTree: { worksheets: tabs } } };
    }
    if (endpoint === 'getColumns' && emptyColumns) {
      f.calls.push({ endpoint, body: structuredClone(body) as Record<string, any> });
      return { columns: [] };
    }
    return call(endpoint, body, timeout, mode);
  });
  return f;
}

describe('Google Sheets report connections', () => {
  it('resolves only the requested spreadsheet before creating a report, with no BigQuery credentials', async () => {
    const f = sheetsFake();
    const text = resultText(await f.run('report_create', { name: 'Sheet report', ...connection, range: 'A1:D20', use_first_row_as_headers: false, include_hidden_and_filtered_cells: false }));
    expect(text).toContain('Connected ds1 "Sales"');
    expect(f.bqCalls).toEqual([]);
    expect(f.sent('getAccountTree')).toHaveLength(1);
    expect(f.sent('getAccountTree')[0]!.body).toMatchObject({ datasourceType: 8, googleSheetsOptions: { type: 1, connectorConfig: { key: SHEET } } });
    expect(f.calls.findIndex((c) => c.endpoint === 'getAccountTree')).toBeLessThan(f.calls.findIndex((c) => c.endpoint === 'createTempReport'));
    expect(f.sent('createBlockDatasource')[0]!.body.datasource.blocks[0].connectorBlockConfig.connectorConfig).toEqual({ datasourceType: 8, useDatetimeType: true, sheetsConfig: { key: SHEET, sheetId: '0', hasHeader: false, includeHiddenCells: false, includeFilteredCells: false, range: 'A1:D20' } });
    expect(f.sent('getColumns')[0]!.body.isBigQueryConnection).toBe(false);
  });

  it('fails an inaccessible sheet or mismatched tab before creating a report', async () => {
    for (const tabs of [[], [{ gid: '1', title: 'Other' }]]) {
      const f = sheetsFake(tabs);
      await expect(f.run('report_create', { name: 'No orphan', ...connection })).rejects.toThrow();
      expect(f.sent('createTempReport')).toEqual([]);
      expect(f.sent('createBlockDatasource')).toEqual([]);
      expect(f.bqCalls).toEqual([]);
    }
  });

  it('refuses a range without usable columns before creating a blank report', async () => {
    const f = sheetsFake([{ gid: '0', title: 'Sales' }], true);
    await expect(f.run('report_create', { name: 'No empty report', ...connection, range: 'Z1:Z2' })).rejects.toThrow('no usable columns');
    expect(f.sent('createTempReport')).toEqual([]);
    expect(f.sent('createBlockDatasource')).toEqual([]);
  });

  it('reconnects a copied Sheets source while retaining the original source', async () => {
    const f = sheetsFake();
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = { datasourceType: 8, sheetsConfig: { key: 'original_sheet', sheetId: '0', hasHeader: true, includeHiddenCells: true, includeFilteredCells: true } };
    const original = structuredClone(f.sources);
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Sheet copy', data_sources: [{ original: 'ds1', ...connection }] });
    const config = f.sources[COPY_SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig;
    expect(config).toMatchObject({ datasourceType: 8, sheetsConfig: { key: SHEET, sheetId: '0' } });
    expect(f.sources[COPY_SOURCE]!.reportId).toBe(COPIED);
    for (const [id, source] of Object.entries(original)) expect(f.sources[id]).toEqual(source);
    expect(f.bqCalls).toEqual([]);
  });

  it('refuses a cross-connector copy before creating a report whose chart fields would break', async () => {
    const f = sheetsFake();
    await expect(f.run('report_copy', { report_id: ORIGINAL, name: 'Unsafe copy', data_sources: [{ original: 'ds1', ...connection }] })).rejects.toThrow('same connector type');
    expect(f.sent('copyReport')).toEqual([]);
    expect(f.sent('publishDatasource')).toEqual([]);
  });

  it('builds a Sheets creation link without accessing browser or BigQuery', async () => {
    const f = sheetsFake();
    const url = new URL(resultText(await f.run('report_link_build', { report_name: 'Sheet link', sources: [{ ...connection, worksheet_id: '0', use_first_row_as_headers: false, range: 'A:C' }] })));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ 'ds.connector': 'googleSheets', 'ds.spreadsheetId': SHEET, 'ds.worksheetId': '0', 'ds.hasHeader': 'false', 'ds.range': 'A:C' });
    expect(f.calls).toEqual([]);
    expect(f.bqCalls).toEqual([]);
  });
});
