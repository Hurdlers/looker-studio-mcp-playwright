import { z } from 'zod';

import { adaptDataRequest, dataRequests } from '../../core/check.js';
import { componentId, fieldConcept, resolveField, setSlot } from '../../core/components.js';
import { resolveSource, type SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { metricConcept } from '../chart-core/chart-add.js';
import { AGGREGATIONS, type AggregationName, type Json } from '../chart-core/common.js';
import { DATE_TYPES, parseDuration } from '../chart-options/dates.js';
import { dataSourceInput, reportIdInput, reportIdOf } from './inputs.js';
import { queryRows } from './query-rows.js';

const field = z.string().trim().min(1);
function uniqueField(fields: SourceField[], ref: string): SourceField {
  const selected = resolveField(fields, ref), want = ref.toLowerCase();
  const exact = fields.filter(f => f.id === ref);
  const named = exact.length ? exact : fields.filter(f => f.name.toLowerCase() === want);
  const matches = named.length ? named : fields.filter(f => f.id.toLowerCase() === want || f.id.toLowerCase() === `_${want}_`);
  if (matches.length !== 1 || fields.filter(f => f.id === selected.id).length !== 1)
    throw new LookerError('invalid', `Field "${ref}" is ambiguous. Give a unique field ID.`);
  return selected;
}
export const datasourceQuery = defineTool({
  name: 'datasource_query',
  title: 'Read data source rows',
  description: 'Reads a bounded table of dimension and metric values from a connected report data source without saving a chart or changing the report. Use it to discover collected events and inspect KPI values before designing charts. Give an explicit fixed date range and date field; specify metric aggregation unless the field is Auto. Returns at most 500 rows, not automatic pagination. Report/page filters and viewer controls are not applied. 64-bit integer columns remain strings to preserve precision; missing totals and quality guarantees are not invented.',
  input: {
    report_id: reportIdInput,
    data_source: dataSourceInput,
    dimensions: z.array(field).max(9).default([]).describe('묶어서 볼 측정기준 이름 또는 ID. GA4 이벤트 탐색은 Event name을 지정합니다.'),
    metrics: z.array(z.object({ field: field.describe('측정항목 이름 또는 ID.'), aggregation: z.enum(Object.keys(AGGREGATIONS) as [AggregationName, ...AggregationName[]]).optional().describe('Auto 지표는 생략하고 나머지는 sum, count 등 집계를 명시합니다.') })).min(1).max(10).describe('조회할 측정항목과 집계. 업무상의 의미는 호출자가 확인합니다.'),
    date_range: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/).describe('조회할 고정 기간 YYYY-MM-DD..YYYY-MM-DD. 시작일과 종료일 포함.'),
    date_range_dimension: field.describe('기간을 적용할 Date 또는 Date & Time 필드 이름이나 ID.'),
    limit: z.number().int().min(1).max(500).default(100).describe('반환할 최대 행 수. 잘림 확인을 위해 서버에 한 행을 더 요청합니다. 자동 페이지 넘김은 없습니다.'),
  },
  write: false,
  run: async (ctx, a) => {
    const duration = parseDuration(a.date_range)!;
    const reportId = reportIdOf(a.report_id), doc = await ctx.session.load(reportId);
    const source = await resolveSource(ctx.rap, doc, a.data_source);
    const dimensions = a.dimensions.map(name => uniqueField(source.fields, name));
    if (dimensions.some(f => f.kind === 'metric')) throw new LookerError('invalid', 'A metric cannot be used as a dimension. Choose fields listed as dimensions.');
    if (new Set(dimensions.map(f => f.id)).size !== dimensions.length) throw new LookerError('invalid', 'Choose each dimension only once.');
    const metrics = a.metrics.map(m => {
      const f = uniqueField(source.fields, m.field);
      if (f.aggregation !== 7 && m.aggregation === undefined) throw new LookerError('invalid', `Specify aggregation for "${f.name}"; only Auto metrics omit it.`);
      return { field: f, concept: metricConcept(f, m.aggregation === undefined ? {} : { aggregation: m.aggregation }) };
    });
    const date = uniqueField(source.fields, a.date_range_dimension);
    if (date.semanticType === undefined || !DATE_TYPES.has(date.semanticType)) throw new LookerError('invalid', 'date_range_dimension must be a Date or Date & Time field.');
    const dims = dimensions.map(f => fieldConcept(f)), dateConcept = fieldConcept(date);
    const component: Json = { componentId: componentId(), type: 'simple-table', datasourceId: source.datasourceId, conceptDefs: [], propertyConfig: { componentProperty: {
      inheritFilters: false, dateDuration: duration, dateRangeDimension: dateConcept.name,
    } } };
    setSlot(component, 'dimensions', 'primary', dims);
    setSlot(component, 'metrics', 'primary', metrics.map(m => m.concept));
    component.conceptDefs.push(dateConcept);
    const pageId = doc.page[0]?.pageId;
    if (!pageId) throw new LookerError('invalid', 'This report has no page to use as a read context.');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/GMT';
    const page = { pageId, page: { componentConfig: [component] } };
    const isolated = { ...doc, page: [page], report: { componentConfig: [] } };
    const request = dataRequests(reportId, page, timezone, isolated)[0]!.request;
    const block = await ctx.rap.call<Json>('getBlockDatasource', { datasourceId: source.datasourceId });
    adaptDataRequest(request, block);
    request.datasetSpec.paginateInfo = { startRow: 1, rowsCount: a.limit + 1 };
    request.datasetSpec.includeRowsCount = true;
    const response = await ctx.rap.call<Json>('batchedDataV2', { dataRequest: [request] });
    const answer = response?.dataResponse?.[0];
    if (answer?.errorStatus) {
      const reason = answer.errorStatus.reasonStr;
      throw new LookerError('invalid', `Data query failed${typeof reason === 'string' && /^[A-Z_]+$/.test(reason) ? ` (${reason})` : ''}. Check source access, metric compatibility and date range; no report was changed.`);
    }
    const subset = answer?.dataSubset?.[0], table = subset?.dataset?.tableDataset;
    if (!table) throw new LookerError('format_changed', 'The source returned no table. No rows or completeness claims can be made.');
    const concepts = [...dims, ...metrics.map(m => m.concept)];
    const decoded = queryRows(table, concepts.map(c => c.name), a.limit);
    const quality: Json = { sampling: 'unknown', thresholding: 'unknown', freshness: 'unknown' };
    for (const key of ['responseTruncated', 'responseTruncatedOrdered', 'hasIncompleteData', 'hasNoncompliantData', 'badReaggregation']) {
      const value = answer[key] ?? subset[key] ?? subset.dataset?.[key];
      if (typeof value === 'boolean') quality[key] = value;
    }
    if (quality.responseTruncated === true || quality.responseTruncatedOrdered === true) decoded.truncated = true;
    return text(JSON.stringify({ data_source: { id: source.datasourceId, alias: source.alias, name: source.name },
      date_range: a.date_range, date_range_dimension: date.id, timezone,
      columns: [...dimensions.map(f => ({ id: f.id, name: f.name, role: 'dimension' })), ...metrics.map((m, i) => ({ id: m.field.id, name: m.field.name, role: 'metric', aggregation: a.metrics[i]!.aggregation ?? 'auto' }))],
      ...decoded, quality, notes: ['Rows are aggregated values, not raw events. No report, page or viewer filters are inherited.', 'Rows and totals belong to this dimension/metric combination. Adding metrics can change which dimension values the source returns; do not treat this as a universal dimension inventory.', 'Only the first result batch is returned. A null truncated value means completeness is unknown.', '64-bit integer columns are strings; other numeric columns may use numbers. Null means missing and differs from zero. Sampling, thresholding and freshness are not guaranteed.'],
    }, null, 2));
  },
});
