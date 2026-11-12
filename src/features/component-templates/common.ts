import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';

import { dryRunContext } from '../../core/dryrun.js';
import { boxOf, freeSpot, resolvePage } from '../../core/page.js';
import { LookerError } from '../../core/errors.js';
import { resultText, runTool, text, type ToolContext, type ToolResult } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import type { CommonBinding, CommonFamilyDefinition, FamilyChartPlan } from './common-contract.js';
import { categoryDefinitions, planCategory } from './common-category.js';
import { seriesDefinitions, planSeries } from './common-series.js';
import { advancedDefinitions, planAdvanced } from './common-advanced.js';
import { planCommonLayout, type CommonLayoutFamily } from './layout.js';
import { invalid } from './store.js';
import { fitPageCanvas } from './canvas.js';
import { planStylePolicy, supportsStylePolicy, type StylePolicySummary } from './style-policy.js';
import { planTablePresentation, tablePresentationInput, validateTablePresentation } from './table-presentation.js';
import { compositionTheme } from './theme-tokens.js';
import { expectedPageAfterAppearance, assertPageAnalysisPreserved } from './analysis-preservation.js';
import { describeOptionEffects } from './option-effects.js';
import type { CommonAnalysisInput } from './common-analysis-input.js';

export const commonOptionsInput = z.object({
  presentation: tablePresentationInput.optional().describe('상세 표의 순수 표현 선택. 머리글 및 이미 존재하는 비중 열만 꾸미며 필드·집계·계산은 유지합니다.'),
  design_rules: z.literal('team-v1').optional().describe('KPI·추이·상세 표의 확인된 표현 관계 규칙. 추이는 점/값, 표는 숫자가 보이는 막대를 기본 적용합니다. 명시 옵션이 우선하며 테마·필드·집계는 유지합니다.'),
  density: z.enum(['comfortable', 'compact']).optional().describe('compact는 글자 위계와 간격을 조정하고 한 계열의 불필요한 범례·점을 줄입니다. 기본은 기존 comfortable 표현입니다.'),
  surface: z.enum(['card', 'plain']).optional().describe('plain은 공통 영역 안에서 중복 카드 배경·테두리·그림자를 제거합니다.'),
  visible_rows: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(20), z.literal(25), z.literal(50), z.literal(100)]).optional().describe('공통 상세 표의 페이지당 표시 행 수. 데이터 조회·집계·필터는 변경하지 않습니다.'),
  show_values: z.boolean().optional().describe('시간 추이·범주 선에는 값 라벨과 점을, 범주 막대에는 값 라벨을 표시합니다. 100% 누적 막대는 조각 비중으로 표시합니다. 관측점이 적고 정확한 값을 읽어야 할 때 사용합니다. 막대 한 칸이 약 40px보다 좁거나 100% 누적에 아주 작은 조각이 있으면 라벨이 서로 겹치므로 켜지 않습니다.'),
  progress: z.boolean().optional().describe('KPI 아래에 비교 기간 값 대비 현재 값을 막대로 표시합니다. comparison을 지정했을 때만 쓸 수 있습니다.'),
  comparison_label: z.string().trim().min(1).max(40).optional().describe('KPI 비교 값 옆에 붙는 문구. 예: "이전 기간 대비". comparison을 지정했을 때만 적용합니다.'),
  emphasis: z.enum(['primary', 'secondary']).optional().describe('KPI의 주 지표와 보조 지표를 글자 크기로 구분합니다. 중요도는 호출자가 지정하며 값이나 집계는 바꾸지 않습니다.'),
  data_bars: z.boolean().optional().describe('공통 상세 표의 첫 지표를 숫자가 보이는 데이터 막대로 표현합니다. 값과 집계는 변경하지 않습니다.'),
  dimension_order: z.enum(['ascending', 'descending']).optional().describe('범주축 선의 측정기준 정렬 방향. 날짜 범주를 쓰면 날짜 필드의 오름차순을 명시할 수 있습니다. 생략 시 기존 정렬 유지.'),
  orientation: z.enum(['vertical', 'horizontal']).optional().describe('막대 방향.'),
  stack: z.enum(['none', 'absolute', 'percent']).optional().describe('막대·영역의 누적 방식. 누적에는 breakdown 역할이 필요합니다.'),
  donut: z.boolean().optional().describe('원형 구조를 도넛으로 표시합니다.'),
  secondary_axis: z.boolean().optional().describe('복합 계열의 둘째 지표를 오른쪽 축에 표시합니다.'),
  heatmap: z.boolean().optional().describe('피벗 값을 색상 강도로도 표현합니다.'),
  decimal_precision: z.number().int().min(0).max(20).optional().describe('공통 KPI의 표시 소수 자릿수. 생략하면 기존 숫자 형식을 유지합니다.'),
  average_line: z.boolean().optional().describe('공통 시간 추이에 표시된 날짜별 지표 값의 평균선을 추가합니다. 주문 한 건당 평균이 아닙니다.'),
  percent_of_total: z.boolean().optional().describe('공통 표에 같은 지표의 전체 대비 비중 열을 추가합니다. 현재 필터를 적용한 차트 합계가 분모입니다.'),
  comparison: z.enum(['Previous period', 'Previous year']).optional().describe('공통 KPI 비교 기간. date 역할과 명시 date_range가 필요합니다.'),
}).strict();
export interface CommonInput extends CommonAnalysisInput {
  report_id: string;
  template_id: string;
  page?: string | number | undefined;
  data_source?: string | undefined;
  bindings: Record<string, CommonBinding>;
  texts?: Record<string, string> | undefined;
  date_range?: string | undefined;
  position?: { left: number; top: number } | undefined;
  size?: { width: number; height: number } | undefined;
  common_options?: z.infer<typeof commonOptionsInput> | undefined;
  preview?: boolean | undefined;
}
const definitions: Array<CommonFamilyDefinition & { type?: string }> = [
  { template_id: 'common-kpi', family: 'kpi', name: '공통 지표 카드', purpose: '프로젝트 테마와 지정한 크기를 따르는 지표 및 선택적 기간 비교', type: 'scorecard', role_kinds: { metric: 'metric', date: 'date' }, required: ['metric'], optional: ['date'], options: ['comparison', 'decimal_precision', 'emphasis', 'comparison_label', 'progress'] },
  { template_id: 'common-time-trend', family: 'time-trend', name: '공통 시간 추이', purpose: '날짜별 지표와 선택적 날짜 값 평균선', type: 'time_series', role_kinds: { metric: 'metric', date: 'date' }, required: ['date', 'metric'], optional: [], options: ['average_line', 'show_values', 'comparison'] },
  { template_id: 'common-detail-table', family: 'detail-table', name: '공통 분류·지표 표', purpose: '분류별 지표와 선택적 전체 대비 비중', type: 'table', role_kinds: { metric: 'metric', date: 'date', dimension: 'dimension', metric_2: 'metric', metric_3: 'metric', metric_4: 'metric' }, required: ['dimension', 'metric'], optional: ['date', 'metric_2', 'metric_3', 'metric_4'], options: ['percent_of_total', 'data_bars', 'comparison'] },
  ...categoryDefinitions, ...seriesDefinitions, ...advancedDefinitions,
];
export function isCommonTemplate(id: string): boolean { return definitions.some(d => d.template_id === id); }
export function commonEntries(query = '') {
  const needle = query.trim().toLowerCase();
  return definitions.filter(d => `${d.template_id} ${d.family} ${d.name} ${d.purpose}`.toLowerCase().includes(needle)).map(d => {
    const supported = [...d.options, 'density', 'surface', ...(d.family === 'detail-table' ? ['visible_rows', 'presentation'] : []), ...(supportsStylePolicy(d.family) ? ['design_rules'] : [])];
    return {
      template_id: d.template_id, name: d.name, purpose: d.purpose, structure_family: d.family,
      implementation: 'built_in_common_structure', validation: 'supported_pending_review', addable: true,
      design_family: 'project_theme', sizing: 'explicit_container_size',
      roles: [...d.required, ...d.optional].map(key => ({ key, name: ({ date: '날짜', dimension: '분류', breakdown: '계열 구분', row: '행 분류', column: '열 분류', x_metric: 'X 지표', y_metric: 'Y 지표', size_metric: '크기 지표', secondary_metric: '보조 지표' } as Record<string, string>)[key] ?? '측정값', required: (d.required as readonly string[]).includes(key), kind: d.role_kinds[key], data_type: d.role_kinds[key] === 'date' ? 'Date or Date & Time' : d.role_kinds[key] === 'metric' ? 'Compatible with its explicit or source aggregation' : 'Dimension' })),
    supported_options: supported, option_effects: describeOptionEffects(supported),
    supported_analysis_inputs: ['sort_by', 'sort_ascending', 'field_formats'], appearance_profiles: ['outlined-report'],
    text_inputs: [{ key: 'title', required: false }],
      analytical_inputs: ['sort_by', 'sort_ascending', 'field_formats'],
      notes: ['보고서 테마와 지정한 크기를 따르는 공통 구조입니다. 저장된 디자인 라이브러리의 검증 상태와는 별개입니다.', '색상·글꼴은 보고서 테마를 따르고 크기는 size로 지정합니다. 계산·집계는 새 데이터의 의미에 맞춰 명시합니다.'],
    };
  });
}

export function commonChartArgs(input: CommonInput): { args: Record<string, unknown>; notes: string[]; design_rules?: StylePolicySummary } {
  const def = definitions.find(d => d.template_id === input.template_id);
  if (!def) throw invalid(`Unknown common template "${input.template_id}".`);
  const allowed = [...def.required, ...def.optional] as readonly string[];
  for (const key of Object.keys(input.bindings)) if (!allowed.includes(key)) throw invalid(`Unknown role "${key}". Roles: ${allowed.join(', ')}.`);
  for (const key of def.required) if (!input.bindings[key]) throw invalid(`Missing required role "${key}".`);
  const bound = (key: string) => { const value = input.bindings[key]; return typeof value === 'string' ? { field: value } : value; };
  for (const key of allowed) {
    const value = bound(key);
    if (!value) continue;
    if (!value.field.trim()) throw invalid(`Role "${key}" needs a nonempty field.`);
    if (def.role_kinds[key] !== 'metric' && (value.aggregation !== undefined || value.label !== undefined))
      throw invalid(`Role "${key}" accepts a field only; aggregation and label belong to metric roles.`);
  }
  for (const key of Object.keys(input.texts ?? {})) if (key !== 'title') throw invalid(`Unknown common text "${key}". Use title.`);
  const explicitOptions = input.common_options ?? {};
  if (input.sort_ascending !== undefined && input.sort_by === undefined)
    throw invalid('sort_ascending needs an explicit sort_by field.');
  if (explicitOptions.dimension_order !== undefined && (input.sort_by !== undefined || input.sort_ascending !== undefined))
    throw invalid('Choose either dimension_order or sort_by/sort_ascending; do not combine two sorting instructions.');
  validateTablePresentation(input.template_id, explicitOptions);
  if (explicitOptions.design_rules && !supportsStylePolicy(def.family)) throw invalid('design_rules supports common-kpi, common-time-trend and common-detail-table only.');
  const policy = planStylePolicy(def.family, explicitOptions);
  const options = { ...policy.defaults, ...explicitOptions };
  for (const key of Object.keys(options)) if (!(def.options as readonly string[]).includes(key) && !['density', 'surface', 'design_rules'].includes(key) && !(['visible_rows', 'presentation'].includes(key) && def.family === 'detail-table')) throw invalid(`Option "${key}" does not apply to ${def.template_id}.`);
  if (input.date_range && !bound('date')) throw invalid('date_range needs an explicit date role binding.');
  if (options.comparison && (!bound('date') || !input.date_range)) throw invalid('A comparison needs the date role and an explicit date_range.');
  if (options.progress && !options.comparison) throw invalid('progress needs a comparison: the bar shows the value against the comparison period.');
  const familyInput = { template_id: input.template_id, bindings: input.bindings,
    options: Object.fromEntries(Object.entries(options).filter(([key]) => (def.options as readonly string[]).includes(key))) };
  let chart: FamilyChartPlan | undefined = planCategory(familyInput) ?? planSeries(familyInput) ?? planAdvanced(familyInput);
  if (!chart) {
    const metric = bound('metric')!;
    const metrics: Array<Record<string, unknown>> = [{ ...metric }];
    if (options.percent_of_total) metrics.push({ ...metric, label: `${metric.label ?? metric.field} 비중`, calculation: 'percent_of_total', bypass_filters: false });
    // More value columns follow the first metric and its share, so the bar and share columns keep their positions.
    if (def.family === 'detail-table') for (const key of ['metric_2', 'metric_3', 'metric_4']) { const extra = bound(key); if (extra) metrics.push({ ...extra }); }
    chart = { type: def.type!, dimensions: def.family === 'time-trend' ? [bound('date')!.field] : def.family === 'detail-table' ? [bound('dimension')!.field] : [], metrics };
  }
  const layout = planCommonLayout(def.family as CommonLayoutFamily, input.size, { dimensionCount: chart.dimensions.length, metricCount: chart.metrics.length, hasBreakdown: Boolean(chart.breakdown), percentMetricIndexes: chart.metrics.flatMap((metric, index) => metric.calculation === 'percent_of_total' ? [index] : []) }, { density: options.density, surface: options.surface, visibleRows: options.visible_rows, showValues: options.show_values, emphasis: options.emphasis });
  // A week label is a long date range. The native renderer hides every label
  // when one does not fit its category slot, so slant them and give the freed
  // plot height to the axis. Grouping, values and the date range are unchanged.
  const weekAxis = ['category-line', 'mixed-series'].includes(def.family) && typeof layout.style['Chart area height'] === 'number'
    && input.field_formats?.some(entry => entry.date_granularity === 'Year Week' && entry.kind !== 'metric');
  if (weekAxis) {
    layout.style['Axis label rotation'] = 30;
    layout.style['Chart area height'] = (layout.style['Chart area height'] as number) - 84;
    // A slanted label ends under its bar and starts to the left of it; the first one needs room before the plot.
    if (typeof layout.style['Chart area left'] === 'number' && typeof layout.style['Chart area width'] === 'number' && (layout.style['Chart area width'] as number) > 400) {
      layout.style['Chart area left'] = (layout.style['Chart area left'] as number) + 88;
      layout.style['Chart area width'] = (layout.style['Chart area width'] as number) - 88;
    }
    layout.notes.push('주 단위 축 라벨은 길어서 기울여 표시합니다. 기본 렌더러가 긴 라벨의 끝을 줄임표로 자를 수 있으며 전체 범위는 툴팁에 표시됩니다.');
  }
  // A compared table gains a change column per metric that the planned widths
  // do not cover, which squeezes them. Let the renderer size its columns.
  if (def.family === 'detail-table' && options.comparison) {
    // Dimension, then each value column followed by its change column. The
    // change column holds a signed percentage and an arrow; spare width goes to the dimension.
    const values = chart.metrics.length, fixed = 150 + (values - 1) * 100 + values * 105, available = layout.width - 2;
    if (available >= 120 + fixed) layout.style['Column widths'] = [available - fixed, ...Array.from({ length: values }, (_, i) => [i === 0 ? 150 : 100, 105]).flat()];
    else delete layout.style['Column widths'];
  }
  // A visible title is drawn inside the chart box above the plot. Without
  // giving its height back, the bottom axis labels run into the axis origin.
  if (!(input.texts?.title !== undefined && !input.texts.title.trim()) && typeof layout.style['Chart area height'] === 'number' && typeof layout.style['Title font size'] === 'number')
    layout.style['Chart area height'] = (layout.style['Chart area height'] as number) - Math.round((layout.style['Title font size'] as number) * 1.6);
  // Horizontal bars put category names on the left axis, which needs more
  // room than numbers do. Without it the renderer cuts the names short.
  if (def.family === 'category-bars' && options.orientation === 'horizontal' && typeof layout.style['Chart area left'] === 'number') {
    const left = Math.max(layout.style['Chart area left'] as number, Math.min(180, Math.floor(layout.width * 0.28)));
    layout.style['Chart area left'] = left;
    layout.style['Chart area width'] = layout.width - left - 48;
  }
  return {
    ...(policy.summary ? { design_rules: policy.summary } : {}),
    args: { report_id: input.report_id, type: chart.type, ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.data_source ? { data_source: input.data_source } : {}),
      dimensions: chart.dimensions, metrics: chart.metrics,
      ...(chart.sort ? { sort_by: chart.sort.field, sort_ascending: chart.sort.ascending } : {}),
      ...(input.sort_by === undefined ? {} : { sort_by: input.sort_by, ...(input.sort_ascending === undefined ? {} : { sort_ascending: input.sort_ascending }) }),
      ...(input.field_formats === undefined ? {} : { field_formats: input.field_formats }),
      ...(chart.breakdown ? { breakdown: chart.breakdown } : {}),
      ...(chart.fields ? { fields: chart.fields } : {}),
      ...(chart.series ? { series: chart.series } : {}),
      ...(bound('date') ? { date_range_dimension: bound('date')!.field } : {}),
      ...(input.date_range ? { date_range: input.date_range } : {}),
      ...(input.texts?.title === undefined ? {} : { title: input.texts.title }),
      ...(options.comparison ? { comparison: options.comparison } : {}),
      ...(options.average_line ? { reference_lines: [{ type: 'Metric', calculation: 'Average', weight: options.density === 'compact' ? 1 : 'Auto' }] } : {}),
      project_theme: true, style: { ...layout.style, ...chart.style,
        ...(policy.summary && def.family === 'kpi' ? { 'Metric label alignment': layout.style['Value alignment'], 'Comparison alignment': layout.style['Value alignment'] } : {}),
        ...(options.show_values === undefined ? {} : { 'Show data labels': options.show_values, ...(def.family === 'category-bars' ? {} : { 'Show points': options.show_values }) }),
        // A 100% stack is read as shares, so its labels show the share of each segment.
        ...(def.family === 'category-bars' && options.stack === 'percent' && options.show_values ? { 'Show data labels as': 'Percentage' } : {}),
        ...(def.family === 'kpi' && options.comparison && options.comparison_label ? { 'Comparison label': options.comparison_label } : {}),
        // The bar compares the value with the comparison period's value.
        ...(def.family === 'kpi' && options.progress !== undefined ? { 'Show progress': options.progress, 'Show target line label': false } : {}),
        // The comparison period is drawn as a second line; the legend tells the two apart.
        ...(def.family === 'time-trend' && options.comparison ? { 'Display legend': true } : {}),
        ...(options.data_bars === undefined ? {} : { 'Metric column type': options.data_bars ? 'Bar' : 'Number', 'Show metric value': true }), ...(input.texts?.title !== undefined && !input.texts.title.trim() ? { 'Show title': false } : {}), ...(def.family === 'kpi' ? {
        'Hide metric name': Boolean(input.texts?.title?.trim()),
        'Hide comparison label': !options.comparison,
        ...(options.decimal_precision === undefined ? {} : { 'Decimal precision': options.decimal_precision }),
      } : {}) },
      position: { ...input.position, width: layout.width, height: layout.height },
    }, notes: [...layout.notes, ...(chart.notes ?? [])],
  };
}

export async function addCommonTemplate(ctx: ToolContext, input: CommonInput): Promise<ToolResult> {
  const planned = commonChartArgs(input);
  const execution = dryRunContext(ctx).ctx;
  const reportId = parseReportId(input.report_id), before = await execution.session.load(reportId);
  const pageId = resolvePage(before, input.page), original = before.page.find(p => p.pageId === pageId)!;
  const previous = new Set((original.page.componentConfig ?? []).map(c => c.componentId));
  const dimensions = planned.args.position as { width: number; height: number };
  const spot = input.position ?? freeSpot(before, pageId, dimensions, 24);
  // Compile through the registered chart tool, then save the chart and its
  // required page growth together. A canvas-limit error leaves no partial chart.
  const result = await runTool(execution, 'chart_add', { ...planned.args, page: pageId,
    position: { left: spot.left, top: spot.top, width: dimensions.width, height: dimensions.height } });
  if (result.isError) return result;
  if (/Not applied:/i.test(resultText(result))) throw invalid(`Common chart preflight failed: ${resultText(result)}`);
  let after = await execution.session.load(reportId);
  const presentation = planTablePresentation(input.template_id, compositionTheme(before), input.common_options);
  if (Object.keys(presentation).length) {
    const page = after.page.find(p => p.pageId === pageId)!;
    const created = (page.page.componentConfig ?? []).filter(c => !previous.has(c.componentId));
    if (created.length !== 1) throw invalid('A common chart must compile exactly one component.');
    const componentId = String(created[0]!.componentId);
    const expected = expectedPageAfterAppearance(page, componentId, presentation);
    const styled = await runTool(execution, 'component_update', { report_id: reportId, page: pageId, component_id: componentId, style: presentation });
    if (styled.isError || /Not applied:/i.test(resultText(styled))) throw invalid(`Common chart presentation failed: ${resultText(styled)}`);
    after = await execution.session.load(reportId);
    assertPageAnalysisPreserved(expected, after.page.find(p => p.pageId === pageId)!);
  }
  const compiled = after.page.find(p => p.pageId === pageId)!;
  const components = (compiled.page.componentConfig ?? []).filter(c => !previous.has(c.componentId));
  if (components.length !== 1) throw invalid('A common chart must compile exactly one component.');
  if (!isDeepStrictEqual(before.report, after.report) || !isDeepStrictEqual(before.chartCondition, after.chartCondition)) throw invalid('A common chart cannot change report-level settings.');
  for (const c of original.page.componentConfig ?? []) if (!isDeepStrictEqual(c, compiled.page.componentConfig?.find(x => x.componentId === c.componentId))) throw invalid('A common chart unexpectedly changed existing content.');
  const first = components[0]!, box = boxOf(first);
  const conditions = (compiled.chartCondition ?? []).filter(c => c.chartId === first.componentId);
  const canvas = fitPageCanvas(compiled, after, [box]);
  // This warning belongs to chart_add's original canvas, which is expanded in
  // the same save here. Keep other compiler warnings intact.
  const creation = resultText(result).split('\n').filter(line => !line.startsWith('Warning: The chart reaches past the page (')).join('\n');
  const summary = { template_id: input.template_id, report_id: reportId, page_id: pageId,
    validation: 'supported_pending_review', theme: 'project',
    component_ids: components.map(c => c.componentId), component_count: components.length,
    data_source: first.datasourceId ?? input.data_source,
    position: { left: box.left, top: box.top }, size: { width: box.width, height: box.height }, canvas,
    notes: planned.notes, creation, ...(planned.design_rules ? { design_rules: planned.design_rules } : {}),
  };
  if (input.preview) return text(JSON.stringify({ ...summary, saved: false, preview: true }, null, 2));
  const saved = await ctx.session.editPage(reportId, pageId, (page, doc) => {
    if (!isDeepStrictEqual(before.report, doc.report) || !isDeepStrictEqual(original.page, page.page) || !isDeepStrictEqual(original.chartCondition, page.chartCondition))
      throw invalid('The page or report changed while preparing the common chart. Read it and retry.');
    fitPageCanvas(page, doc, [box]);
    (page.page.componentConfig ??= []).push(structuredClone(first));
    if (conditions.length) page.chartCondition = [...(page.chartCondition ?? []), ...structuredClone(conditions)];
  }, `add common template ${input.template_id}`);
  if (!ctx.dryRun) {
    const restored = await ctx.session.load(reportId);
    const actual = restored.page.find(p => p.pageId === pageId)?.page.componentConfig?.find(c => c.componentId === first.componentId);
    if (!actual || actual.type !== first.type || (actual.preset ?? 'default') !== (first.preset ?? 'default'))
      throw new LookerError('format_changed', `The saved common chart ${first.componentId} is missing or has a different type. Inspect the report before retrying.`);
  }
  return { ...text(JSON.stringify({ ...summary, creation: ctx.dryRun ? creation : creation.replace(/^Would add /, 'Added '), saved: !ctx.dryRun, preview: !!ctx.dryRun, version: saved.version, undo_revision: saved.snapshot }, null, 2)),
    audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: `common template ${input.template_id}` } };
}
