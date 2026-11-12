import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { place, RECORD_COUNT, resolveField } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import type { Extensions, UpdateTarget } from '../../core/extensions.js';
import { toMapValue } from '../../core/mapvalue.js';
import { listPages, pageArg, pageSize, resolvePage } from '../../core/page.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { buttonInput, applyButton } from './button.js';
import { checkField, controlBox, controlSource, fieldRequired, invalid, KINDS, makeControl, metricAllowed, positionInput, prop, putField, putFields, putMetric, reportIdOf, type ControlKind, type Json } from './model.js';

const SHARED = ['filters', 'date_range', 'date_range_dimension', 'comparison', 'style', 'labels', 'series', 'sorts', 'value_colors', 'reference_lines', 'reference_bands', 'conditional_formats'];
const CHART_ONLY = ['series', 'value_colors', 'reference_lines', 'reference_bands', 'conditional_formats'];

function input(ext: Extensions) {
  const shared = ext.updaterInput(SHARED);
  if (shared.labels) shared.labels = shared.labels.describe('drop_down·fixed_size_list의 필드·측정값 표시 이름. 소스 필드 이름이나 id를 새 표시 이름에 연결합니다. 매개변수 컨트롤에는 지원하지 않습니다.');
  if (shared.sorts) shared.sorts = shared.sorts.describe('drop_down·fixed_size_list의 정렬 기준 하나. 소스 필드 이름·id 또는 Record Count와 ascending을 지정해 기존 정렬을 바꿉니다. 두 개 이상은 거부하며 []는 정렬을 비웁니다. 매개변수 컨트롤에는 지원하지 않습니다.');
  return {
    ...shared,
    report_id: z.string().describe('리포트 id 또는 Looker Studio URL.'),
    kind: z.enum(KINDS).describe('컨트롤 종류. data_control은 BigQuery 미지원이므로 저장 전에 거부합니다.'),
    page: pageArg.optional().describe('페이지 id, 이름 또는 1부터 센 번호. 생략하면 첫 페이지.'),
    field: z.string().min(1).optional().describe('거를 필드 이름 또는 id. drop_down은 매개변수 이름이나 id도 받습니다. 디멘션 컨트롤은 fields의 Dimension 목록도 받을 수 있습니다.'),
    metric: z.string().min(1).optional().describe('목록 옆에 보일 측정값. drop_down·fixed_size_list에만 씁니다. 생략하면 소스에 실제 Record Count가 있을 때만 사용하고, 없으면 측정값 없이 만듭니다.'),
    data_source: z.string().min(1).optional().describe('리포트 소스의 이름, 별칭 또는 id. 생략하면 페이지에서 가장 많이 쓰는 소스를 고릅니다.'),
    fields: z.record(z.string(), z.array(z.string())).optional().describe('Setup 칸 제목별 필드 목록. Dimension, Control field 또는 Metric.'),
    button: buttonInput.optional(),
    position: positionInput.optional(),
  };
}

export const controlAdd = defineTool({
  name: 'control_add', title: 'Add a control',
  description: 'Adds a filter, date picker, dimension selector or button to one report page. Use field for the filtered dimension, fields for named Setup slots, and button for navigation or a report action; component_update changes existing buttons and styles. ' +
    'A drop_down can also select a data source parameter by name or id. Input and field checks finish before saving. data_control is refused because BigQuery cannot be switched with that control. ' +
    'For drop_down and fixed_size_list, labels changes displayed field and metric names, and sorts replaces the whole list order; parameter controls accept neither option. ' +
    'Style keys use editor labels; unknown labels are reported as Not applied. Colors use #RRGGBB or {color, opacity}; percentages use "80%" or numbers (above 1 as percent, 0–1 already divided). ' +
    'Control comparison periods and chart-only settings are refused. Returns component_id and an undo revision when available; use report_render to inspect it.',
  input, write: true,
  run: async (ctx, inputArgs) => {
    const a = inputArgs as unknown as Json;
    const kind = a.kind as ControlKind;
    validate(a, kind);
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, a.page);
    const work = structuredClone(doc);
    const page = work.page.find((p) => p.pageId === pageId)!;
    const component = makeControl(kind);
    const target: UpdateTarget = { component, doc: work, page };
    const notes: string[] = [];
    const needSource = !['date_range', 'data_control'].includes(kind) && (kind !== 'button' || a.field !== undefined || a.metric !== undefined || a.fields !== undefined || a.data_source !== undefined || (a.filters?.length ?? 0) > 0);
    if (needSource) {
      const source = await controlSource(ctx, doc, pageId, a.data_source);
      component.datasourceId = source.datasourceId;
      prop(component).dataset = { datasetType: 1, datasetId: source.datasourceId };
      if (a.field !== undefined) putField(component, kind, resolveField(source.fields, a.field));
      if (metricAllowed(kind)) {
        const metric = a.metric !== undefined ? resolveField(source.fields, a.metric) : source.fields.find(field => field.id === RECORD_COUNT);
        if (metric) putMetric(component, metric);
      }
      if (a.fields !== undefined) putFields(component, kind, a.fields, source.fields);
      if (fieldRequired(kind) && !prop(component).dimensionFilterProperty?.controlParameter && !prop(component).dimensions?.labeledConcepts?.find((slot: Json) => slot.key === 'primary')?.value?.conceptNames?.length)
        throw invalid(`${kind} needs field, or a field in the corresponding fields slot.`);
      // Recheck the final slot after fields replaced field.
      if (kind === 'preset_filter') {
        const name = prop(component).dimensions.labeledConcepts.find((slot: Json) => slot.key === 'primary').value.conceptNames[0];
        const id = component.conceptDefs.find((c: Json) => c.name === name).queryTimeTransformation.dataTransformation.sourceFieldName;
        checkField(kind, resolveField(source.fields, id));
      }
    }
    for (const key of ['labels', 'sorts']) if (a[key] !== undefined) {
      if (prop(component).dimensionFilterProperty?.controlParameter) throw invalid(`${key} is unavailable for parameter controls. Leave it out or use a field-based list control.`);
      const updater = ctx.ext.updater(key);
      if (!updater) throw invalid(`The ${key} extension is unavailable.`);
      note(notes, await updater.apply(target, a[key], ctx));
    }
    if (kind === 'fixed_size_list' || kind === 'slider') {
      const name = prop(component).dimensions.labeledConcepts.find((slot: Json) => slot.key === 'primary').value.conceptNames[0];
      const concept = component.conceptDefs.find((c: Json) => c.name === name);
      component.behavior = toMapValue({ onSelect: [{ action: 'lego-dimension-filter', isControl: true, init: { dConcept: concept } }] });
    }
    if (a.button !== undefined) note(notes, applyButton(component, work, a.button));
    if (a.date_range !== undefined) await applyDateRange(ctx, target, kind, a.date_range);
    if (a.date_range_dimension !== undefined) {
      const updater = ctx.ext.updater('date_range_dimension');
      if (!updater) throw invalid('The date_range_dimension extension is unavailable.');
      note(notes, await updater.apply(target, a.date_range_dimension, ctx));
    }
    if ((a.filters?.length ?? 0) > 0) {
      const updater = ctx.ext.updater('filters');
      if (!updater) throw invalid('The filters extension is unavailable.');
      const entries: Json[] = (work.report.resource as Json | undefined)?.filter?.entry ?? [];
      for (const spec of a.filters as Json[]) if (spec.field === undefined && spec.condition === undefined && spec.clauses === undefined && !entries.some((e) => e.value.name === spec.name && e.value.datasourceId === component.datasourceId))
        throw invalid(`No filter "${spec.name}" for this data source. Give field and condition to create it.`);
      note(notes, await updater.apply(target, a.filters, ctx));
    }
    if (a.style !== undefined) {
      const updater = ctx.ext.updater('style');
      if (!updater) throw invalid('The style extension is unavailable.');
      note(notes, await updater.apply(target, a.style, ctx));
    }
    const box = controlBox(work, pageId, kind, a.position);
    place(component, box);
    const size = pageSize(work, pageId);
    if (box.left + box.width > size.width || box.top + box.height > size.height) notes.push('Warning: the control extends beyond the page. Enlarge the page or adjust position to see it all.');
    const id = String(component.componentId);
    const savePage = (fresh: { page: Json }) => {
      const list = (fresh.page.componentConfig ??= []) as Json[];
      if (!list.some((c) => c.componentId === id)) list.push(structuredClone(component));
    };
    const newFilters: Json[] = ((work.report.resource as Json | undefined)?.filter?.entry ?? []).filter((entry: Json) => !((doc.report.resource as Json | undefined)?.filter?.entry ?? []).some((old: Json) => old.key === entry.key));
    const touchesReport = !isDeepStrictEqual(work.report, doc.report);
    const result = touchesReport ? await ctx.session.editReportThenPage(reportId, pageId, {
      report: (fresh) => {
        const resource = (fresh.report.resource ??= {}) as Json;
        const filter = resource.filter ??= { entry: [] };
        for (const entry of newFilters) if (!filter.entry.some((old: Json) => old.key === entry.key)) filter.entry.push(structuredClone(entry));
      }, page: savePage,
    }, `add ${kind} control`) : await ctx.session.editPage(reportId, pageId, savePage, `add ${kind} control`);
    const name = listPages(doc).find((p) => p.pageId === pageId)?.name ?? pageId;
    return { ...text([`${ctx.dryRun ? 'Would add' : 'Added'} ${kind} ${id} on page "${name}" (${pageId}), at ${box.left},${box.top}, ${box.width}x${box.height}.`,
      `Report version ${result.version}.${result.snapshot ? ` To undo, restore revision ${result.snapshot}.` : ''}`, ...notes].join('\n')),
      audit: { reportId, version: result.version, ...(result.snapshot ? { snapshot: result.snapshot } : {}), detail: `${kind} ${id}` } };
  },
});

function note(notes: string[], value: void | string): void { if (value) notes.push(value); }

function validate(a: Json, kind: ControlKind): void {
  if (kind === 'data_control') throw new LookerError('refused', 'BigQuery does not support data controls. No control was created; use a direct BigQuery data source instead.');
  for (const key of CHART_ONLY) if (a[key] !== undefined) throw invalid(`${key} is a chart-only setting; use chart_add or component_update on a chart.`);
  for (const key of ['labels', 'sorts']) if (a[key] !== undefined && !metricAllowed(kind)) throw invalid(`${key} is supported only by drop_down and fixed_size_list controls.`);
  if (a.date_range_dimension !== undefined && !metricAllowed(kind)) throw invalid('date_range_dimension needs a field-based drop_down or fixed_size_list control with a data source.');
  if (a.comparison !== undefined && String(a.comparison).toLowerCase() !== 'none') throw invalid('Controls have no comparison period. Set comparison on a chart with chart_add or component_update.');
  if (a.button !== undefined && kind !== 'button') throw invalid('button settings are available only for kind button.');
  if (a.metric !== undefined && !metricAllowed(kind)) throw invalid(`${kind} has no Metric slot.`);
  if (['date_range', 'data_control'].includes(kind) && ['field', 'metric', 'data_source', 'fields', 'filters'].some((key) => a[key] !== undefined)) throw invalid(`${kind} has no data source or field/filter slots.`);
  if (['data_control', 'dimension_control'].includes(kind) && a.date_range !== undefined) throw invalid(`${kind} has no default date range slot.`);
  if (fieldRequired(kind) && a.field === undefined && a.fields === undefined) throw invalid(`${kind} needs field or a populated fields slot.`);
}

// The chart extension owns date parsing. A temporary, date-ready component
// lets controls use that parser without inventing a date dimension: control
// defaults are stored as duration (or picker behavior), not a chart field.
async function applyDateRange(ctx: ToolContext, target: UpdateTarget, kind: ControlKind, input: string): Promise<void> {
  const updater = ctx.ext.updater('date_range');
  if (!updater) throw invalid('The date_range extension is unavailable.');
  const temp: Json = { type: 'simple-table', propertyConfig: { componentProperty: { dateRangeDimension: 'control-duration-only' } } };
  await updater.apply({ ...target, component: temp }, input, ctx);
  const duration = prop(temp).dateDuration;
  if (kind === 'date_range') target.component.behavior = toMapValue({ onSelect: [{ action: 'lego-change-date-range', isControl: true, init: duration ? { dateRange: duration } : {} }] }, target.component.behavior);
  else if (duration) prop(target.component).dateDuration = duration;
  else delete prop(target.component).dateDuration;
}
