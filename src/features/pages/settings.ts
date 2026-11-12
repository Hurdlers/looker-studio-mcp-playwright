import { z } from 'zod';

import { fieldConcept, resolveField } from '../../core/components.js';
import { resolveSource, type ResolvedSource } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import { pageArg } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import { applyPlan, planStyle, type StyleLabel } from '../../core/style.js';
import { defineTool, text } from '../../core/tool.js';
import { DATE_PRESETS, parseDateRange } from './dates.js';
import { buildDefinition, filterEntries, filtersInput, newFilterKey, validateFilters } from './filters.js';
import { pageIdOf, reportIdInput, reportIdOf, saved, type Json } from './model.js';

const STYLE_LABELS: StyleLabel[] = [
  { label: 'Page background', kind: 'color', path: 'propertyConfig.pageProperty.backgroundColor', root: true },
  { label: 'Width (px)', kind: 'number', path: 'attributeConfig.pageAttribute.width', root: true, min: 1, max: 10000 },
  { label: 'Height (px)', kind: 'number', path: 'attributeConfig.pageAttribute.height', root: true, min: 1, max: 10000 },
];
const DATE_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 36, 37, 38, 39, 40, 45]);

function properties(doc: ReportDoc, pageId?: string): Json {
  const target = pageId ? doc.page.find((p) => p.pageId === pageId)!.page : doc.report;
  return ((target.propertyConfig ??= {})[pageId ? 'pageProperty' : 'reportProperty'] ??= {}) as Json;
}

export const pageSettingsUpdate = defineTool({
  name: 'page_settings_update',
  title: 'Change page or report data settings',
  description: 'Sets the default data source, date field, date range and filters for one page or an entire report, and changes a page background or canvas size. Use it for settings inherited by charts; new filters are saved with rollback if the page save fails, while report scope ignores page-only styles.',
  input: {
    report_id: reportIdInput,
    page: pageArg.optional().describe('페이지 ID, 화면 이름 또는 1부터 센 번호. 생략하면 첫 페이지이며, scope가 report이면 무시합니다.'),
    scope: z.enum(['page', 'report']).default('page').describe('page는 한 페이지, report는 리포트 전체의 기본 설정을 바꿉니다.'),
    data_source: z.string().trim().min(1).optional().describe('기본으로 쓸 데이터 소스의 이름, 별칭(ds1) 또는 ID.'),
    date_range_dimension: z.string().trim().min(1).optional().describe('기간을 거르는 데 쓸 날짜 필드의 화면 이름 또는 ID.'),
    date_range: z.string().optional().describe(`기간 이름(${DATE_PRESETS.join(', ')}) 또는 YYYY-MM-DD..YYYY-MM-DD. 날짜 필드를 먼저 정하거나 함께 주세요.`),
    filters: filtersInput.optional(),
    style: z.record(z.string(), z.unknown()).optional().describe('페이지 스타일 표시 이름과 값: Page background는 #RRGGBB, Width (px)·Height (px)는 양의 정수입니다. 모르는 이름은 Not applied에 표시합니다.'),
  },
  write: true,
  run: async (ctx, a) => {
    const hasStyle = Object.keys(a.style ?? {}).length > 0;
    if (a.data_source === undefined && a.date_range_dimension === undefined && a.date_range === undefined && !a.filters?.length && !hasStyle)
      throw new LookerError('invalid', 'Give at least one of data_source, date_range_dimension, date_range, filters or style.');
    const duration = a.date_range !== undefined ? parseDateRange(a.date_range) : undefined;
    // Validate known page-style values before any network request.
    if (a.scope === 'page' && a.style)
      for (const [label, value] of Object.entries(a.style)) {
        if (typeof value === 'string' && value.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(value))
          throw new LookerError('invalid', `Style "${label}" needs a six-digit #RRGGBB color.`);
        if (/^(width|height) \(px\)$/i.test(label.trim()) && (!Number.isInteger(Number(value)) || Number(value) <= 0))
          throw new LookerError('invalid', `Style "${label}" needs a positive whole pixel size.`);
      }
    const style = a.scope === 'page' ? planStyle(STYLE_LABELS, a.style ?? {}) : undefined;
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = a.scope === 'page' ? pageIdOf(doc, a.page) : undefined;
    const prop = properties(doc, pageId);
    const notes = [...(style?.notApplied ?? []), ...(a.scope === 'report' && hasStyle ? ['style (only available for a page)'] : []), ...(a.scope === 'report' && a.page !== undefined ? ['page (ignored for report scope)'] : [])];
    if (a.date_range !== undefined && !a.date_range_dimension && !prop.dateRangeDimension)
      throw new LookerError('invalid', 'Set date_range_dimension before date_range, or give both in the same call.');

    const entries = filterEntries(doc);
    const newSpecs = (a.filters ?? []).filter((f) => !entries.some((e) => e.value?.name === f.name));
    validateFilters(newSpecs);
    const needsSource = a.data_source !== undefined || a.date_range_dimension !== undefined || newSpecs.some((f) => f.field || f.clauses);
    let source: ResolvedSource | undefined;
    if (needsSource) {
      const defaultId = prop.dataset?.datasetId ?? (!pageId ? undefined : (doc.report.propertyConfig as Json | undefined)?.reportProperty?.dataset?.datasetId);
      try {
        source = await resolveSource(ctx.rap, doc, a.data_source ?? defaultId);
      } catch (err) {
        if (err instanceof LookerError && err.code === 'not_found') throw new LookerError('invalid', err.message);
        throw err;
      }
    }
    const dateField = a.date_range_dimension !== undefined ? resolveField(source!.fields, a.date_range_dimension) : undefined;
    if (dateField && (dateField.semanticType === undefined || !DATE_TYPES.has(dateField.semanticType)))
      throw new LookerError('invalid', `Field "${dateField.name}" is not a date field. Choose a Date & Time field for date_range_dimension.`);
    const dateConcept = dateField ? fieldConcept(dateField) : undefined;

    const additions: Json[] = [];
    const keys: string[] = [];
    for (const filter of a.filters ?? []) {
      const found = [...entries, ...additions].find((e) => e.value?.name === filter.name && (!source || !e.value.datasourceId || e.value.datasourceId === source.datasourceId));
      if (found) {
        keys.push(found.key);
        if (filter.field !== undefined || filter.clauses !== undefined || filter.condition !== undefined || filter.values !== undefined)
          notes.push(`filters.${filter.name} conditions (reused the existing filter unchanged)`);
      } else {
        if (!filter.field && !filter.clauses)
          throw new LookerError('invalid', `No filter "${filter.name}". Available filters: ${entries.map((e) => e.value?.name).join(', ') || '(none)'}. Supply field and condition to create one.`);
        const entry = { key: newFilterKey(), value: { name: filter.name, datasourceId: source!.datasourceId, version: 3, filterDefinition: buildDefinition(filter, source!.fields) } };
        additions.push(entry);
        keys.push(entry.key);
      }
    }

    const applySettings = (fresh: ReportDoc): void => {
      const target = pageId ? fresh.page.find((p) => p.pageId === pageId)!.page : fresh.report;
      const p = properties(fresh, pageId);
      if (a.data_source !== undefined) p.dataset = { datasetType: 1, datasetId: source!.datasourceId };
      if (dateConcept) {
        // A page's date field belongs to its default source, including when
        // the source was inferred from a unique report source.
        p.dataset = { datasetType: 1, datasetId: source!.datasourceId };
        const before = p.dateRangeDimension;
        p.dateRangeDimension = dateConcept.name;
        target.conceptDefs = [...(target.conceptDefs ?? []).filter((d) => d.name !== before && d.name !== dateConcept.name), dateConcept];
      }
      if (a.date_range !== undefined) {
        if (duration) p.dateDuration = structuredClone(duration);
        else delete p.dateDuration;
      }
      if (keys.length) {
        // A concurrently created filter with this name takes precedence,
        // matching the add/reuse rule without leaving a dangling key.
        const current = filterEntries(fresh);
        const resolvedKeys = keys.map((key) => {
          const added = additions.find((entry) => entry.key === key);
          return added ? current.find((entry) => entry.value?.name === added.value.name && entry.value?.datasourceId === added.value.datasourceId)?.key ?? key : key;
        });
        p.filters = [...new Set([...(p.filters ?? []), ...resolvedKeys])];
      }
      if (style) applyPlan(target, style);
    };
    const addFilters = (fresh: ReportDoc): void => {
      const resource = (fresh.report.resource ??= {}) as Json;
      const list = ((resource.filter ??= {}).entry ??= []) as Json[];
      for (const entry of additions)
        if (!list.some((e) => e.key === entry.key || e.value?.name === entry.value.name && e.value?.datasourceId === entry.value.datasourceId)) list.push(structuredClone(entry));
    };
    const changedSettings = a.data_source !== undefined || a.date_range_dimension !== undefined || a.date_range !== undefined || keys.length > 0 || !!style?.writes.length;
    if (!changedSettings) return text(`No page settings changed.${notes.length ? `\nNot applied: ${notes.join('; ')}.` : ''}`);
    const res = pageId
      ? additions.length
        ? await ctx.session.editReportThenPage(reportId, pageId, { report: addFilters, page: (_page, fresh) => applySettings(fresh) }, 'page settings and filters')
        : await ctx.session.editPage(reportId, pageId, (_page, fresh) => applySettings(fresh), 'page settings')
      : await ctx.session.editReport(reportId, (fresh) => { addFilters(fresh); applySettings(fresh); }, 'report data settings');
    return saved(reportId, res, `Updated ${pageId ? `page ${pageId}` : 'report defaults'}.${notes.length ? `\nNot applied: ${notes.join('; ')}.` : ''}`);
  },
});
