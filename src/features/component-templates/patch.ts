import { isDeepStrictEqual } from 'node:util';

import { resolveSource } from '../../core/datasource.js';
import { resolvePage } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { text, type ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { planMetricPatch, type MetricPatch } from './patch-metrics.js';
import { invalid } from './store.js';

type Json = Record<string, any>;
const METRIC_CHART_TYPES = new Set(['kpi-metric', 'simple-table', 'simple-barchart', 'simple-linechart', 'simple-areachart', 'simple-piechart', 'simple-combochart', 'pivot-table', 'simple-scatterchart']);
export interface TemplatePatchInput {
  report_id: string; page?: string | number | undefined;
  component_id?: string | undefined; group_id?: string | undefined;
  metrics: MetricPatch[]; preview?: boolean | undefined;
}
function target(doc: ReportDoc, input: TemplatePatchInput): { page: PageDoc; components: Json[] } {
  if (!!input.component_id === !!input.group_id) throw invalid('Give exactly one component_id or group_id.');
  const matches = doc.page.filter(p => input.group_id ? p.page.groupConfig?.some(g => g.groupId === input.group_id) : p.page.componentConfig?.some(c => c.componentId === input.component_id));
  if (matches.length !== 1) throw invalid('The target must identify exactly one page-local chart or group.');
  const page = matches[0]!;
  if (input.page !== undefined && resolvePage(doc, input.page) !== page.pageId) throw invalid('The target is not on the selected page.');
  const all = page.page.componentConfig ?? [], groups = (page.page.groupConfig ?? []) as Json[];
  if (new Set(groups.map(g => g.groupId)).size !== groups.length) throw invalid('Duplicate group IDs prevent a safe patch.');
  const group = input.group_id ? groups.find(g => g.groupId === input.group_id)! : undefined;
  const ids = group ? group.componentId : [input.component_id];
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw invalid('Invalid group membership.');
  if (new Set(all.map(c => c.componentId)).size !== all.length) throw invalid('Duplicate component IDs prevent a safe patch.');
  if (group && (group.childGroupId?.length || groups.some(g => g !== group && (g.childGroupId?.includes(group.groupId) || g.componentId?.some((id: string) => ids.includes(id))))))
    throw invalid('Nested or shared groups are not supported by partial metric updates.');
  if (group && (group.datasourceId || group.conceptDefs?.length)) throw invalid('Groups with their own bound data source or fields need a separate update plan.');
  const components = ids.map(id => {
    const component = all.find(c => c.componentId === id);
    if (!component) throw invalid(`Missing target member ${id}.`);
    return component as Json;
  });
  return { page, components };
}
function references(value: unknown, names: Set<string>): boolean {
  if (typeof value === 'string') return names.has(value);
  if (Array.isArray(value)) return value.some(v => references(v, names));
  return !!value && typeof value === 'object' && Object.entries(value).some(([k, v]) => names.has(k) || references(v, names));
}
function hasFixedReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFixedReference);
  if (!value || typeof value !== 'object') return false;
  const object = value as Json;
  if (object.referenceLineType !== 1 && (object.referenceLineNumberValue !== undefined || object.referenceLineDateValue !== undefined || object.referenceLineParameter !== undefined)) return true;
  if (Array.isArray(object.referenceBandProperty) && object.referenceBandProperty.length) return true;
  return Object.values(object).some(hasFixedReference);
}
function dependencyIssues(doc: ReportDoc, page: PageDoc, component: Json, names: string[]) {
  if (!names.length) return [];
  const ids = new Set(names.flatMap(name => [name, `t0.${name}`]));
  const issues: Array<{ code: string; message: string; component_id: string }> = [];
  const issue = (message: string) => issues.push({ code: 'dependency_review_required', message, component_id: component.componentId });
  const sources = new Set<string>((component.conceptDefs ?? []).filter((d: Json) => names.includes(d.name)).map((d: Json) => String(d.queryTimeTransformation?.dataTransformation?.sourceFieldName)));
  const conditions = (page.chartCondition ?? []).filter(c => c.chartId === component.componentId);
  if (references(conditions, new Set([...ids, ...sources]))) issue('변경 지표를 사용하는 조건부 서식이 있습니다. 조건과 표시 의미를 먼저 확인하세요.');
  if (hasFixedReference(component.propertyConfig)) issue('상수 기준선·밴드의 기준값이 새 지표에 맞는지 먼저 확인하세요.');
  if (references(component.behavior, ids)) issue('변경 지표를 참조하는 상호작용 설정이 있습니다. 적용 대상을 먼저 확인하세요.');
  const property = component.propertyConfig?.componentProperty ?? {};
  if (references(property.filters, ids) || references(doc.report.resource?.filter, ids) || references(page.page.propertyConfig, ids)
    || references(doc.report.propertyConfig, ids) || references(page.page.groupConfig, ids)) issue('변경 지표 개념을 직접 참조하는 필터·범위 설정이 있습니다. 먼저 확인하세요.');
  for (const definition of component.conceptDefs ?? []) {
    if (names.includes(definition.name)) continue;
    const data = definition.queryTimeTransformation?.dataTransformation ?? {};
    if ([data.textFormula, data.frontendTextFormula].some(formula => typeof formula === 'string' && names.some(name => formula.includes(name))))
      issue('다른 계산식이 변경 지표 개념을 참조합니다. 계산식의 의미를 먼저 확인하세요.');
  }
  return issues;
}

/** Change selected native metric concepts in place. No template recreation,
 * data-source rebinding, label inference or style defaults are involved. */
export async function patchTemplate(ctx: ToolContext, input: TemplatePatchInput) {
  const reportId = parseReportId(input.report_id), before = await ctx.session.load(reportId);
  const selected = target(before, input);
  // Filter controls carry an internal Record Count metric; they are not
  // analysis charts and must remain byte-for-byte unchanged in a group patch.
  const charts = selected.components.filter(c => c.type !== 'dimension-filter'
    && (c.propertyConfig?.componentProperty?.metrics?.labeledConcepts ?? []).some((slot: Json) => slot.value?.conceptNames?.length));
  if (!charts.length) throw invalid('The selected target has no metric-bearing charts.');
  if (charts.some(c => !METRIC_CHART_TYPES.has(c.type))) throw invalid('This metric-bearing chart type is not supported by partial template updates.');
  const sources = [...new Set(charts.map(c => c.datasourceId))];
  if (sources.length !== 1 || typeof sources[0] !== 'string') throw invalid('Partial metric updates need one shared data source. Select charts from the same source.');
  const source = await resolveSource(ctx.rap, before, sources[0]);
  const plans = charts.map(component => ({ before: component, plan: planMetricPatch(component, source.fields, input.metrics) }));
  const issues: Json[] = plans.flatMap(({ before: c, plan }) => [
    ...plan.issues.map(issue => ({ ...issue, component_id: c.componentId })),
    ...dependencyIssues(before, selected.page, c, plan.changed_concepts),
  ]);
  for (let index = 0; index < input.metrics.length; index++) if (!plans.some(p => p.plan.matched[index]))
    issues.push({ code: 'metric_not_found', message: `대상 차트에서 측정항목 ${input.metrics[index]!.from}을 찾지 못했습니다.` });
  const print = (data: unknown) => text(JSON.stringify(data, null, 2));
  const summary = { report_id: reportId, page_id: selected.page.pageId, ...(input.group_id ? { group_id: input.group_id } : {}),
    component_ids: charts.map(c => c.componentId), notes: [...new Set(plans.flatMap(p => p.plan.notes))] };
  if (issues.length) return print({ ...summary, status: issues.every(i => ['format_required', 'aggregation_required', 'dependency_review_required'].includes(i.code)) ? 'needs_input' : 'invalid', saved: false, issues });
  const changed = plans.filter(p => !isDeepStrictEqual(p.before, p.plan.component));
  if (input.preview || !changed.length) return print({ ...summary, status: changed.length ? 'ready' : 'unchanged', saved: false, preview: !!input.preview || !!ctx.dryRun, issues: [], changed_component_ids: changed.map(p => p.before.componentId) });
  const saved = await ctx.session.editPage(reportId, selected.page.pageId, (page, doc) => {
    if (!isDeepStrictEqual(before.report, doc.report) || !isDeepStrictEqual(selected.page.page, page.page) || !isDeepStrictEqual(selected.page.chartCondition, page.chartCondition))
      throw invalid('The page or report changed while preparing the patch. Read it and retry.');
    const changes = new Map(changed.map(p => [p.before.componentId, p.plan.component]));
    page.page.componentConfig = (page.page.componentConfig ?? []).map(c => changes.has(c.componentId) ? structuredClone(changes.get(c.componentId)!) : c);
  }, 'patch component metrics');
  return { ...print({ ...summary, status: ctx.dryRun ? 'ready' : 'applied', saved: !ctx.dryRun, preview: !!ctx.dryRun, issues: [],
    changed_component_ids: changed.map(p => p.before.componentId), version: saved.version, undo_revision: saved.snapshot }),
    audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: 'partial metric patch' } };
}
