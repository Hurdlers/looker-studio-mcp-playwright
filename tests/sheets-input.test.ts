import { describe, expect, it } from 'vitest';

import { parseSheetsInput } from '../src/connectors/sheets-input.js';

const sheet = 'example_sheet_id';
describe('Google Sheets input', () => {
  it('extracts a file id and gid zero while retaining false options and an A1 range', () => {
    expect(parseSheetsInput({ spreadsheet: `https://docs.google.com/spreadsheets/d/${sheet}/edit#gid=0`, use_first_row_as_headers: false, include_hidden_and_filtered_cells: false, range: ' b2:d20 ' }))
      .toEqual({ spreadsheetId: sheet, worksheetId: '0', hasHeader: false, includeHiddenAndFiltered: false, range: 'B2:D20' });
  });

  it('takes an exact tab name without guessing the first worksheet', () => {
    expect(parseSheetsInput({ spreadsheet: sheet, worksheet: ' Sales ' })).toEqual({ spreadsheetId: sheet, worksheet: 'Sales', hasHeader: true, includeHiddenAndFiltered: true });
    expect(() => parseSheetsInput({ spreadsheet: sheet })).toThrow('Choose a worksheet');
    expect(() => parseSheetsInput({ spreadsheet: sheet, worksheet: ' ' })).toThrow('nonempty');
  });

  it('accepts an explicit numeric gid and normalizes leading zeroes', () => {
    expect(parseSheetsInput({ spreadsheet: sheet, worksheet_id: 0 }).worksheetId).toBe('0');
    expect(parseSheetsInput({ spreadsheet: sheet, worksheet_id: '000123' }).worksheetId).toBe('123');
    for (const worksheet_id of [-1, 1.5, 'tab', '']) expect(() => parseSheetsInput({ spreadsheet: sheet, worksheet_id })).toThrow('worksheet gid');
  });

  it('refuses conflicting tab ids rather than connecting another worksheet', () => {
    expect(() => parseSheetsInput({ spreadsheet: `https://docs.google.com/spreadsheets/d/${sheet}/edit#gid=0`, worksheet_id: 1 })).toThrow('does not match');
    expect(() => parseSheetsInput({ spreadsheet: `https://docs.google.com/spreadsheets/d/${sheet}/edit?gid=1#gid=0` })).toThrow('conflicting');
  });

  it('refuses foreign service URLs and ranges that point to another tab', () => {
    for (const spreadsheet of ['https://example.com/spreadsheets/d/example/edit', 'https://docs.google.com/spreadsheets/d/e/published/edit', 'bad id'])
      expect(() => parseSheetsInput({ spreadsheet, worksheet_id: 0 })).toThrow();
    for (const range of ['Other!A1:D4', 'A0:D4', '', 'A1;DELETE']) expect(() => parseSheetsInput({ spreadsheet: sheet, worksheet_id: 0, range })).toThrow('A1 range');
  });

  it('refuses BigQuery, SQL, consent and database inputs for Sheets', () => {
    for (const input of [{ project_id: 'example' }, { sql: 'SELECT 1' }, { viewer_email_param: false }, { date_range_params: false }, { host: 'db.example' }])
      expect(() => parseSheetsInput({ spreadsheet: sheet, worksheet_id: 0, ...input })).toThrow('do not apply');
  });

  it('keeps link creation pure by requiring a gid without tab lookup', () => {
    expect(() => parseSheetsInput({ spreadsheet: sheet, worksheet: 'Sales' }, true)).toThrow('tab name alone');
    expect(parseSheetsInput({ spreadsheet: sheet, worksheet_id: '0' }, true).worksheetId).toBe('0');
  });
});
