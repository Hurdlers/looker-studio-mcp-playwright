import { describe, expect, it, vi } from 'vitest';

import { prepareSheetsSource, sheetsConnector } from '../src/connectors/sheets.js';
import type { ConnectorDeps, Json, SheetsSource } from '../src/connectors/types.js';
import { RapError, type Rap } from '../src/looker/rap.js';

const spreadsheetId = 'synthetic_spreadsheet_1234567890';
const token = 'fake-test-token';
function source(extra: Partial<Omit<SheetsSource, 'worksheetId'>> & { worksheetId?: string | undefined } = {}): SheetsSource {
  const worksheetId = 'worksheetId' in extra ? extra.worksheetId : '0';
  const { worksheetId: _ignored, ...rest } = extra;
  return { spreadsheetId, hasHeader: true, includeHiddenAndFiltered: true, ...rest, ...(worksheetId === undefined ? {} : { worksheetId }) };
}
const tree = (worksheets = [{ gid: '0', title: 'Sales' }, { gid: '7', title: 'Dates' }]): Json => ({
  accountTree: { googleSheetsAccountTree: { spreadsheets: [{ key: spreadsheetId, title: 'Synthetic sales' }], worksheets } },
});
function connection(answer: (endpoint: string, body: Json) => unknown = () => tree()) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: body as Json });
      if (endpoint === 'getFirstPartyAccessToken') return { accessToken: token } as T;
      return answer(endpoint, body as Json) as T;
    },
    callMany: async () => { throw new Error('No unscoped batch calls expected'); },
  };
  const run = vi.fn(async () => 'synthetic-project-number');
  const deps: ConnectorDeps = { rap, worker: { run } as ConnectorDeps['worker'] };
  return { calls, deps, run };
}

describe('Google Sheets connector configuration', () => {
  it('preserves gid zero, explicit false options, and a cell range in native settings', () => {
    const config = sheetsConnector.buildConfig(source({ hasHeader: false, includeHiddenAndFiltered: false, range: 'A1:C4' }));
    expect(config).toMatchObject({ datasourceType: 8, sheetsConfig: {
      key: spreadsheetId, sheetId: '0', hasHeader: false, includeHiddenCells: false, includeFilteredCells: false, range: 'A1:C4',
    } });
    expect(config).not.toHaveProperty('bigQueryConnectorConfig');
    expect(config).not.toHaveProperty('sql');
  });

  it('keeps native source detection strict', () => {
    expect(sheetsConnector.matches({ datasourceType: 8 })).toBe(true);
    expect(sheetsConnector.matches({ datasourceType: '8' })).toBe(false);
    expect(sheetsConnector.matches({ datasourceType: 2 })).toBe(false);
    expect(sheetsConnector.matches(undefined)).toBe(false);
  });

  it('does not expose a custom SQL capability', () => {
    expect('query' in sheetsConnector).toBe(false);
  });

  it('refuses unresolved tabs and custom query parameters before producing native settings', () => {
    expect(() => sheetsConnector.buildConfig(source({ worksheetId: undefined, worksheet: 'Sales' }))).toThrow('Resolve the worksheet');
    expect(() => sheetsConnector.buildConfig(source(), { dateRange: true })).toThrow('does not accept custom-query parameters');
    expect(() => sheetsConnector.buildConfig(source(), { viewerEmail: true })).toThrow('does not accept custom-query parameters');
  });

  it('retains gid zero and false options in creation links without using a BigQuery parameter', () => {
    expect(sheetsConnector.linkParams(source({ hasHeader: false, includeHiddenAndFiltered: false, range: 'A1:C4' }))).toEqual({
      connector: 'googleSheets', spreadsheetId, worksheetId: '0', hasHeader: 'false', includeHiddenCells: 'false', includeFilteredCells: 'false', range: 'A1:C4',
    });
    expect(() => sheetsConnector.linkParams(source({ worksheetId: undefined, worksheet: 'Sales' }))).toThrow('needs worksheet_id');
  });
});

describe('Google Sheets worksheet resolution', () => {
  it('asks only for the supplied spreadsheet and resolves an exact tab name', async () => {
    const c = connection();
    const input = source({ worksheetId: undefined, worksheet: 'Dates' });
    const result = await prepareSheetsSource(c.deps, input);
    expect(result).toMatchObject({ spreadsheetId, worksheetId: '7', worksheet: 'Dates' });
    expect(input.worksheetId).toBeUndefined();
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getAccountTree']);
    expect(c.calls[1]!.body).toMatchObject({ datasourceType: 8, googleSheetsOptions: { type: 1, connectorConfig: { key: spreadsheetId } }, googleAuthOAuthToken: token });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('retains the zero gid and checks a matching explicit tab name', async () => {
    const c = connection();
    const result = await prepareSheetsSource(c.deps, source({ worksheet: 'Sales' }));
    expect(result).toMatchObject({ worksheetId: '0', worksheet: 'Sales' });
  });

  it('refuses conflicting gid and tab name without creating or authorizing anything', async () => {
    const c = connection();
    await expect(prepareSheetsSource(c.deps, source({ worksheet: 'Dates' }))).rejects.toThrow();
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getAccountTree']);
  });

  it('refuses an unknown gid rather than silently choosing the first worksheet', async () => {
    const c = connection();
    await expect(prepareSheetsSource(c.deps, source({ worksheetId: '999' }))).rejects.toThrow();
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getAccountTree']);
  });

  it('matches worksheet names exactly instead of changing case', async () => {
    const c = connection();
    await expect(prepareSheetsSource(c.deps, source({ worksheetId: undefined, worksheet: 'sales' }))).rejects.toThrow();
  });

  it('does not turn a missing worksheet response into a usable source', async () => {
    const c = connection(() => tree([]));
    await expect(prepareSheetsSource(c.deps, source())).rejects.toThrow();
  });

  it('refuses ambiguous tab-name responses', async () => {
    const c = connection(() => tree([{ gid: '0', title: 'Sales' }, { gid: '7', title: 'Sales' }]));
    await expect(prepareSheetsSource(c.deps, source({ worksheetId: undefined, worksheet: 'Sales' }))).rejects.toThrow();
  });

  it('does not grant consent or write after access is denied', async () => {
    const c = connection(() => { throw new RapError('getAccountTree', 403, 'access denied'); });
    await expect(prepareSheetsSource(c.deps, source())).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('No authorization was granted') });
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getAccountTree']);
  });
});

describe('Google Sheets column loading', () => {
  it('requests native dates inside connectorConfig so Sheets does not fall back to legacy text inference', async () => {
    const c = connection(() => ({ columns: [{ columnType: 1, field: { name: 'day' }, dataType: 8,
      outputSemanticInfo: { semanticConfig: [{ semanticType: 2, dateTimeOptions: { useNativeDateTime: true } }] } }] }));
    const block = { alias: 't0', connectorConfig: sheetsConnector.buildConfig(source({ includeHiddenAndFiltered: false })) };
    const result = await sheetsConnector.loadColumns(c.deps, block);
    const sent = c.calls.find(call => call.endpoint === 'getColumns')!.body.connectorBlockConfig;
    expect(sent.connectorConfig.useDatetimeType).toBe(true);
    expect(sent.connectorConfig.sheetsConfig).toMatchObject({ includeHiddenCells: false, includeFilteredCells: false });
    expect(result.columns[0]!.dataType).toBe(8);
    expect(result.columns[0]!.outputSemanticInfo).toEqual({ semanticConfig: [{ semanticType: 2, dateTimeOptions: { useNativeDateTime: true } }] });
  });

  it('uses Sheets request flags and preserves numeric/date/percent field metadata', async () => {
    const columns = [
      { columnType: 1, mutableVersion: 1, field: { name: 'amount' }, dataType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] } },
      { columnType: 1, mutableVersion: 1, field: { name: 'day' }, dataType: 5, outputSemanticInfo: { semanticConfig: [{ semanticType: 2 }] } },
      { columnType: 1, mutableVersion: 1, field: { name: 'rate' }, dataType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 14 }] } },
    ];
    const c = connection(() => ({ columns }));
    const block = { alias: 't0', connectorConfig: sheetsConnector.buildConfig(source()), useDatetimeType: true };
    const result = await sheetsConnector.loadColumns(c.deps, block);
    expect(result.columns).toEqual(columns);
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns']);
    expect(c.calls[1]!.body).toMatchObject({ connectorBlockConfig: block, isBigQueryConnection: false, useThirdpartyAuth: false, googleAuthOAuthToken: token });
    expect(c.calls[1]!.body).not.toHaveProperty('bigQueryConnectorConfig');
  });

  it('refuses an empty column response before any write', async () => {
    const c = connection(() => ({}));
    await expect(sheetsConnector.loadColumns(c.deps, { connectorConfig: sheetsConnector.buildConfig(source()) })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('no usable columns') });
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns']);
  });

  it('does not create a source after the column request fails', async () => {
    const c = connection(() => { throw new RapError('getColumns', 403, 'permission denied'); });
    await expect(sheetsConnector.loadColumns(c.deps, { connectorConfig: sheetsConnector.buildConfig(source()) })).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('No authorization was granted') });
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns']);
  });
});
