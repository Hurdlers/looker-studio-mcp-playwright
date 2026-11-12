import { z } from 'zod';

import { LookerError } from '../core/errors.js';
import type { SheetsSource } from './types.js';

export const sheetsInput = {
  spreadsheet: z.string().optional().describe('Google Sheets spreadsheet URL or file id.'),
  worksheet: z.string().optional().describe('Worksheet tab name. Give this or worksheet_id; a URL containing gid also selects a tab.'),
  worksheet_id: z.union([z.string(), z.number().int().nonnegative()]).optional().describe('Worksheet gid, including 0. Must match gid in the spreadsheet URL when both are given.'),
  use_first_row_as_headers: z.boolean().optional().describe('Use the first row as field names. Defaults to true.'),
  include_hidden_and_filtered_cells: z.boolean().optional().describe('Include hidden and filtered cells. Defaults to true.'),
  range: z.string().optional().describe('Optional A1 cell range within the selected tab, for example A1:D20 or A:D.'),
};

export const SHEETS_FIELDS = Object.keys(sheetsInput) as Array<keyof typeof sheetsInput>;
export const DATABASE_FIELDS = ['host', 'port', 'database', 'user', 'password', 'ssl'] as const;
const INAPPLICABLE = ['project_id', 'dataset_id', 'table_id', 'sql', 'date_range_params', 'viewer_email_param', ...DATABASE_FIELDS] as const;

type Input = Partial<Record<keyof typeof sheetsInput | (typeof INAPPLICABLE)[number], unknown>>;
const invalid = (message: string): never => { throw new LookerError('invalid', message); };

function gid(value: unknown, label: string): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) invalid(`${label} must be a nonnegative integer worksheet gid, such as 0.`);
  return BigInt(text).toString();
}

// Parse only the caller's connection input. Access and tab-name resolution
// belong to the connector, so invalid input fails before report creation.
export function parseSheetsInput(input: Input, linking = false): SheetsSource {
  const foreign = INAPPLICABLE.filter((key) => input[key] !== undefined);
  if (foreign.length) invalid(`${foreign.join(', ')} do not apply to Google Sheets: leave them out.`);
  const raw = typeof input.spreadsheet === 'string' ? input.spreadsheet.trim() : '';
  if (!raw) invalid('Google Sheets needs spreadsheet: give its URL or file id.');
  let spreadsheetId = raw;
  let urlGid: string | undefined;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try { url = new URL(raw); } catch { return invalid('The spreadsheet URL is invalid.'); }
    const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
    if (url.hostname !== 'docs.google.com' || !match || /^\/spreadsheets\/d\/e\//.test(url.pathname))
      invalid('Use a Google Sheets URL containing /spreadsheets/d/<file id>, or give its file id.');
    spreadsheetId = match![1]!;
    const hashGid = new URLSearchParams(url.hash.slice(1)).get('gid');
    const queryGid = url.searchParams.get('gid');
    if (hashGid !== null) urlGid = gid(hashGid, 'URL gid');
    if (queryGid !== null) {
      const query = gid(queryGid, 'URL gid');
      if (urlGid !== undefined && urlGid !== query) invalid('The spreadsheet URL contains conflicting worksheet gids.');
      urlGid = query;
    }
  } else if (!/^[A-Za-z0-9_-]+$/.test(raw)) invalid('Use a Google Sheets URL or a file id containing letters, numbers, underscores and hyphens.');
  const explicit = input.worksheet_id === undefined ? undefined : gid(input.worksheet_id, 'worksheet_id');
  if (explicit !== undefined && urlGid !== undefined && explicit !== urlGid)
    invalid('worksheet_id does not match the gid in spreadsheet: choose one worksheet.');
  const worksheetId = explicit ?? urlGid;
  const worksheet = typeof input.worksheet === 'string' ? input.worksheet.trim() : undefined;
  if (input.worksheet !== undefined && !worksheet) invalid('worksheet must be a nonempty tab name.');
  if (worksheetId === undefined && !worksheet) invalid('Choose a worksheet with worksheet_id, worksheet, or a spreadsheet URL containing gid.');
  if (linking && worksheetId === undefined) invalid('A creation link needs worksheet_id or a spreadsheet URL containing gid; a tab name alone is not enough.');
  const range = typeof input.range === 'string' ? input.range.trim().toUpperCase() : undefined;
  if (input.range !== undefined && (!range || !/^\$?[A-Z]+(?:\$?[1-9]\d*)?(?::\$?[A-Z]+(?:\$?[1-9]\d*)?)?$/.test(range)))
    invalid('range must be an A1 range within the selected worksheet, such as A1:D20 or A:D.');
  for (const key of ['use_first_row_as_headers', 'include_hidden_and_filtered_cells'] as const)
    if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid(`${key} must be true or false.`);
  return {
    spreadsheetId,
    ...(worksheetId === undefined ? {} : { worksheetId }),
    ...(worksheet === undefined ? {} : { worksheet }),
    hasHeader: input.use_first_row_as_headers !== false,
    includeHiddenAndFiltered: input.include_hidden_and_filtered_cells !== false,
    ...(range === undefined ? {} : { range }),
  };
}
