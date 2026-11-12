import { z } from 'zod';

import { createReport } from '../../core/create.js';
import { addDataSource } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { listReports, reportUrl } from '../../looker/reports.js';
import { reportIdInput, reportIdOf } from '../data-sources/inputs.js';
import { reportCopy } from './copy.js';
import { reportLinkBuild } from './link.js';
import { checkQuery, consentNote, nameOf, planSource, sourceInput } from './source.js';

export const reportList = defineTool({
  name: 'report_list',
  title: 'List reports',
  description: 'Lists the reports this account can open, with their names, ids and viewing links. Use query to match part of a name regardless of case; an empty query lists everything.',
  input: { query: z.string().optional().describe('리포트 이름에 들어갈 검색어. 대소문자는 구분하지 않습니다.') },
  write: false,
  run: async (ctx, input) => {
    const query = input.query?.trim() ?? '';
    const all = await listReports(ctx.rap);
    const seen = new Set<string>();
    const reports = all.filter((r) => {
      const id = r.id.toLowerCase();
      if (seen.has(id) || !r.name.toLowerCase().includes(query.toLowerCase())) return false;
      seen.add(id);
      return true;
    });
    return text(reports.length
      ? reports.map((r) => `${r.name} | ${r.id.toLowerCase()} | ${reportUrl(r.id.toLowerCase())}`).join('\n')
      : query ? `No reports match "${query}".` : 'This account has no reports yet.');
  },
});

export const reportCreate = defineTool({
  name: 'report_create',
  title: 'Create a report',
  description: 'Makes a named report and connects a BigQuery table, view or custom query, a Google Sheets worksheet, or a GA4 property. For Sheets give connector google_sheets, spreadsheet, and a worksheet name or gid. For GA4 give connector ga4 with account_id and property_id; the signed-in account must already have property access and connector authorization. Give dataset_id with table_id, or sql for a query checked in BigQuery before creation; query parameters need their corresponding options and viewer email consent applies to the signed-in account only.',
  input: { name: z.string().describe('새 리포트 이름.'), ...sourceInput },
  write: true,
  run: async (ctx, input) => {
    const name = nameOf(input.name, 'Report name');
    const plan = await planSource(ctx, input);
    await checkQuery(ctx, plan);
    const made = await createReport(ctx.rap, name);
    try {
      const added = await addDataSource(ctx, made.reportId, plan.connection, { name: plan.name, params: plan.params });
      const note = await consentNote(ctx, added.datasourceId, plan.params);
      return { ...text([`Created "${name}" | ${made.reportId} | ${reportUrl(made.reportId)}`, `Connected ${added.alias} "${plan.name}" (${added.datasourceId}).`, ...(note ? [note] : [])].join('\n')), audit: { reportId: made.reportId } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Data source connection failed.';
      throw new LookerError(error instanceof LookerError ? error.code : 'invalid', `${message} The report was created: ${made.reportId} (${reportUrl(made.reportId)}). Connect a source with datasource_add or remove it with report_delete.`);
    }
  },
});

export const reportRename = defineTool({
  name: 'report_rename',
  title: 'Rename a report',
  description: 'Changes the title of an existing report. Use its id or viewing URL and a nonempty name; surrounding whitespace is removed.',
  input: { report_id: reportIdInput, name: z.string().describe('바꿀 리포트 이름.') },
  write: true,
  run: async (ctx, input) => {
    const name = nameOf(input.name, 'Report name');
    const reportId = reportIdOf(input.report_id);
    const saved = await ctx.session.renameReport(reportId, name);
    return { ...text(`Renamed ${reportId} to "${name}".`), audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}) } };
  },
});

export const reportDelete = defineTool({
  name: 'report_delete',
  title: 'Move a report to trash',
  description: 'Moves a report to the Looker Studio trash after checking its current title. confirm_name must match the title exactly, including case; this does not permanently erase the report.',
  input: { report_id: reportIdInput, confirm_name: z.string().describe('현재 리포트 이름을 대소문자까지 정확히 입력합니다.') },
  write: true,
  run: async (ctx, input) => {
    const reportId = reportIdOf(input.report_id);
    const doc = await ctx.session.load(reportId);
    if (input.confirm_name !== doc.shareable.name)
      throw new LookerError('invalid', `The report is named "${doc.shareable.name}": give that exact title as confirm_name to move it to trash.`);
    await ctx.rap.call('updateRemovedState', { id: reportId, removed: true, type: 0 });
    return { ...text(`Moved "${doc.shareable.name}" (${reportId}) to trash.`), audit: { reportId } };
  },
});

export const tools = [reportList, reportCreate, reportCopy, reportRename, reportDelete, reportLinkBuild];
