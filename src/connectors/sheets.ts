import { LookerError } from '../core/errors.js';
import { RapError } from '../looker/rap.js';
import type { Column, ConnectorAdapter, ConnectorDeps, Json, SheetsSource } from './types.js';

function connectionError(error: unknown): never {
  if (error instanceof RapError && [401, 403].includes(error.status))
    throw new LookerError('refused', 'Google Sheets access was refused. The signed-in Looker Studio account must have access to the spreadsheet and authorize its Google Sheets connector in Looker Studio. No authorization was granted by this tool.');
  throw error;
}

// Resolve only the requested spreadsheet. Never enumerate the account's files.
export async function prepareSheetsSource(deps: ConnectorDeps, source: SheetsSource): Promise<SheetsSource> {
  try {
    const { accessToken } = await deps.rap.call<{ accessToken: string }>('getFirstPartyAccessToken', {});
    const result = await deps.rap.call<Json>('getAccountTree', {
      datasourceType: 8,
      googleSheetsOptions: { type: 1, connectorConfig: { key: source.spreadsheetId } },
      googleAuthOAuthToken: accessToken,
    });
    const tabs = result.accountTree?.googleSheetsAccountTree?.worksheets;
    if (!Array.isArray(tabs) || !tabs.length)
      throw new LookerError('not_found', 'The spreadsheet has no accessible worksheets. Check its ID, account access and Google Sheets connector authorization in Looker Studio.');
    const matches = tabs.filter((tab: Json) =>
      (source.worksheetId === undefined || String(tab.gid) === source.worksheetId) &&
      (source.worksheet === undefined || tab.title === source.worksheet));
    if (matches.length !== 1)
      throw new LookerError('invalid', 'The requested worksheet was not found, or worksheet and worksheet_id refer to different tabs. Give the exact tab name or its gid.');
    return { ...source, worksheetId: String(matches[0].gid), worksheet: matches[0].title };
  } catch (error) { return connectionError(error); }
}

export const sheetsConnector = {
  id: 'google_sheets', label: 'Google Sheets', oauthType: 1,
  listing: {
    id: 'google_sheets', supported: true, modes: ['worksheet', 'range'],
    create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list',
    note: 'The signed-in Looker Studio account needs spreadsheet access and Google Sheets connector authorization.',
  },
  matches: (config: Json | undefined) => config?.datasourceType === 8,
  defaultName: (source: SheetsSource) => source.worksheet || 'Spreadsheet',
  buildConfig(source: SheetsSource, params = {}) {
    if (Object.values(params).some(Boolean)) throw new LookerError('invalid', 'Google Sheets does not accept custom-query parameters.');
    if (source.worksheetId === undefined) throw new LookerError('invalid', 'Resolve the worksheet name or supply worksheet_id before connecting Google Sheets.');
    // The date mode belongs to connectorConfig, not connectorBlockConfig.
    // At the outer level Google drops it and dates use legacy text inference.
    return { datasourceType: 8, useDatetimeType: true, sheetsConfig: {
      key: source.spreadsheetId, sheetId: source.worksheetId,
      hasHeader: source.hasHeader, includeHiddenCells: source.includeHiddenAndFiltered,
      includeFilteredCells: source.includeHiddenAndFiltered,
      ...(source.range ? { range: source.range } : {}),
    } };
  },
  async loadColumns(deps: ConnectorDeps, connectorBlockConfig: Json) {
    try {
      const projectNumber = await deps.worker.run(
        () => (window as unknown as { preload?: { myDataStudioConfig?: { projectNumber?: string } } }).preload?.myDataStudioConfig?.projectNumber ?? '', null,
      );
      const { accessToken } = await deps.rap.call<{ accessToken: string }>('getFirstPartyAccessToken', {});
      const { columns = [] } = await deps.rap.call<{ columns?: Column[] }>('getColumns', {
        connectorBlockConfig, isBigQueryConnection: false, useThirdpartyAuth: false,
        projectNumber, googleAuthOAuthToken: accessToken,
      });
      if (!columns.some((column) => column.columnType === 1))
        throw new LookerError('invalid', 'Google Sheets returned no usable columns. Check the selected tab, range and header row before adding the source.');
      return { columns, projectNumber, accessToken };
    } catch (error) { return connectionError(error); }
  },
  linkParams(source: SheetsSource): Record<string, string> {
    if (source.worksheetId === undefined) throw new LookerError('invalid', 'A Google Sheets creation link needs worksheet_id or a spreadsheet URL containing gid.');
    return { connector: 'googleSheets', spreadsheetId: source.spreadsheetId, worksheetId: source.worksheetId,
      hasHeader: String(source.hasHeader), includeHiddenCells: String(source.includeHiddenAndFiltered),
      includeFilteredCells: String(source.includeHiddenAndFiltered), ...(source.range ? { range: source.range } : {}) };
  },
} satisfies ConnectorAdapter<SheetsSource, 'google_sheets'>;
