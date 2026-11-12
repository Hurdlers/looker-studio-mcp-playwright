import { resolveField } from '../../core/components.js';
import { resolveSource } from '../../core/datasource.js';
import { parseReportId } from '../../looker/view.js';
import { resultText, runTool, text, type ToolContext } from '../../core/tool.js';
import { COMMON_LAYOUTS } from './layout.js';
import { invalid } from './store.js';

type Json = Record<string, any>;
export interface OutlineMetric { field: string; aggregation?: string | undefined; label: string }
/** A breakdown the caller chose, with how many values it had in the period. */
export interface OutlineDimension { field: string; name: string; values: number; truncated: boolean }
export interface OutlineInput {
  data_source: string;
  date: string; date_name: string; date_range: string; days: number;
  metrics: OutlineMetric[];
  dimensions: OutlineDimension[];
  cross?: Array<{ row: OutlineDimension; column: OutlineDimension }> | undefined;
  comparison?: string | undefined; comparison_label?: string | undefined;
  average_line?: boolean | undefined;
  /** How the trend is drawn: its date grouping, and whether the second metric joins it as a line. */
  trend?: { by?: 'day' | 'week' | 'month' | undefined; with_second_metric?: boolean | undefined } | undefined;
  /** Presentation extras of the same metric. Each defaults to on; set false to leave it out. */
  include?: OutlineInclude | undefined;
}
/** Parts the outline adds around the chosen metrics. Each defaults to on. */
export interface OutlineInclude { kpi_progress?: boolean | undefined; overview?: boolean | undefined; share_column?: boolean | undefined; daily_share?: boolean | undefined; filters?: boolean | undefined;
  /** A comparison goes to the KPIs. These two put it in the trend and in the breakdown tables as well; both default to off. */
  trend_comparison?: boolean | undefined; table_comparison?: boolean | undefined }
export interface OutlineRegionNote { key: string; title: string; rule: string }

// Row heights of the report presentation: one line of a horizontal bar chart or
// a cross table. Used to give a chart the height its observed rows need.
const ROW = 33, FEW = 6, SOME = 12, CROSS_COLUMNS = 8, CROSS_ROWS = 20;

/** Whether a name ends in a Korean final consonant, which picks the particle after it. */
function endsClosed(name: string): boolean {
  const code = name.trim().charCodeAt(name.trim().length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
}
const andParticle = (name: string) => endsClosed(name) ? '과' : '와';
const topicParticle = (name: string) => endsClosed(name) ? '은' : '는';

/** Arranges caller-chosen metrics and breakdowns into titled regions.
 * It decides chart forms from the number of values a breakdown has. It never
 * picks a metric, a breakdown, a comparison or a reference line on its own. */
export function planPageOutline(input: OutlineInput): { page: Json; regions: OutlineRegionNote[]; notes: string[] } {
  if (input.metrics.length < 1 || input.metrics.length > 8) throw invalid('Give 1 to 8 metrics.');
  if (input.dimensions.length > 6) throw invalid('Give at most 6 breakdown dimensions.');
  const first = input.metrics[0]!, date = input.date, source = input.data_source;
  const metric = (m: OutlineMetric) => ({ field: m.field, label: m.label, ...(m.aggregation ? { aggregation: m.aggregation } : {}) });
  const base = (key: string, template_id: string, bindings: Json, title = '') => ({ key, template_id, data_source: source, bindings: { ...bindings, date }, texts: { title } });
  const descending = { sort_by: first.label, sort_ascending: false };
  const overview = input.include?.overview !== false;
  // A period comparison belongs to the KPIs. A comparison line in the trend and change columns in tables are separate, explicit choices.
  const tableComparison = Boolean(input.comparison) && input.include?.table_comparison === true, trendComparison = Boolean(input.comparison) && input.include?.trend_comparison === true;
  // A compared table gets a change column for every value column, the share
  // included. Value, change and share-with-change crowd a table, so a compared table drops the share column.
  const shareColumn = input.include?.share_column !== false && !tableComparison;
  const dailyShare = input.include?.daily_share !== false, withFilters = input.include?.filters !== false;
  // A table shows every chosen metric: the first with its bar and share, up to three more as value columns.
  const extraColumns = Object.fromEntries(input.metrics.slice(1, 4).map((m, i) => [`metric_${i + 2}`, metric(m)]));
  const regions: Json[] = [], explained: OutlineRegionNote[] = [], notes: string[] = [];
  const add = (region: Json, rule: string) => { regions.push(region); explained.push({ key: region.key, title: region.title, rule }); };

  const kpis = input.metrics.map((m, i) => ({ ...base(`kpi_${i + 1}`, 'common-kpi', { metric: metric(m) }, m.label),
    ...(input.comparison ? { common_options: { comparison: input.comparison, ...(input.comparison_label ? { comparison_label: input.comparison_label } : {}), ...(input.include?.kpi_progress ? { progress: true } : {}) } } : {}) }));
  const by = input.trend?.by ?? 'day';
  const grouping = by === 'week' ? 'Year Week' : by === 'month' ? 'Year Month' : undefined;
  const points = Math.ceil(input.days / (by === 'week' ? 7 : by === 'month' ? 30 : 1)), unit = by === 'week' ? '주별' : by === 'month' ? '월별' : '';
  const second = input.trend?.with_second_metric ? input.metrics[1] : undefined;
  if (input.trend?.with_second_metric && !second) throw invalid('trend.with_second_metric needs a second metric.');
  const trendTitle = second ? `${unit ? `${unit} ` : ''}${first.label}${andParticle(first.label)} ${second.label}` : input.metrics.length > 1 || unit ? `${unit ? `${unit} ` : ''}${first.label} 추이` : '';
  // The first metric as bars and the second as a line on its own axis, over the same dates.
  const trend = second
    ? { ...base('trend', 'common-mixed-series', { metric: metric(first), secondary_metric: metric(second), dimension: date }, trendTitle), sort_by: date, sort_ascending: true,
        // Slanted week labels take height from the plot, so a weekly combo gets a taller box.
        ...(by === 'week' ? { height: 360 } : {}),
        common_options: { secondary_axis: true }, field_formats: [{ field: date, kind: 'dimension', ...(grouping ? { date_granularity: grouping } : { display_format: 'M.d' }) }] }
    : { ...base('trend', 'common-time-trend', { metric: metric(first) }, trendTitle), sort_by: date, sort_ascending: true,
        ...(grouping ? { field_formats: [{ field: date, kind: 'dimension', date_granularity: grouping }] } : {}),
        // Two lines of value labels run into each other, so a compared trend shows lines only.
        common_options: { show_values: points <= 14 && !trendComparison, ...(input.average_line ? { average_line: true } : {}), ...(trendComparison ? { comparison: input.comparison } : {}) } };
  if (second && (trendComparison || input.average_line)) notes.push('두 지표를 함께 그리는 복합 추이에는 기간 비교 선과 평균선을 넣지 않았습니다.');
  if (!overview) {
    if (!input.dimensions.length && !input.cross?.length) throw invalid('Nothing to outline: keep the overview or give a breakdown.');
  } else if (points < 2) {
    // One point is not a trend: show the values alone.
    add({ key: 'overview', kind: 'block', title: input.metrics.length === 1 ? `${first.label} 현황` : '주요 지표 현황', items: kpis }, `기간에 추이로 그릴 점이 하나뿐이라 지표만 묶었습니다.`);
  } else if (input.metrics.length <= 4) {
    add({ key: 'overview', kind: 'block', title: input.metrics.length === 1 ? `${first.label} 현황 추이` : `주요 지표 현황과 ${first.label} 추이`, items: [...kpis, trend] },
      `지표 ${input.metrics.length}개를 묶고 첫 지표의 ${unit || '날짜별'} 추이를 옆에 둡니다. ${second ? `${first.label}${topicParticle(first.label)} 막대, ${second.label}${topicParticle(second.label)} 오른쪽 축의 선으로 그립니다` : trendComparison ? '비교 기간 선과 값 라벨이 겹치므로 값 라벨을 끕니다' : `추이의 점이 약 ${points}개라 값 라벨을 ${points <= 14 ? '켭니다' : '끕니다'}`}.`);
  } else {
    add({ key: 'overview', kind: 'block', title: '주요 지표 현황', items: kpis }, `지표가 ${input.metrics.length}개라 지표 묶음과 추이를 나눕니다.`);
    add({ key: 'trend', kind: 'block', title: `${first.label} 추이`, items: [trend] }, '첫 지표의 날짜별 추이입니다.');
  }

  input.dimensions.forEach((dimension, index) => {
    const key = `by_${index + 1}`, count = `${dimension.values}${dimension.truncated ? '개 이상' : '개'}`;
    const table = (rows: number) => ({ ...base(`${key}_table`, 'common-detail-table', { metric: metric(first), dimension: dimension.field, ...extraColumns }), ...descending,
      common_options: { data_bars: true, visible_rows: rows, ...(shareColumn ? { percent_of_total: true, presentation: { share_display: 'heatmap' } } : {}), ...(tableComparison ? { comparison: input.comparison } : {}) } });
    if (dimension.values < 2 && !dimension.truncated) {
      notes.push(`${dimension.name}: 이 기간에 값이 ${count}라 비교할 대상이 없어 구역을 만들지 않았습니다.`);
    } else if (dimension.values <= FEW && !dimension.truncated) {
      const stack = dailyShare && input.days >= 2 && input.days <= 14;
      add({ key, kind: 'block', title: `${dimension.name}별 ${first.label} 비중`, items: [
        { ...base(`${key}_share`, 'common-radial-share', { metric: metric(first), dimension: dimension.field }), common_options: { donut: true } },
        ...(stack ? [{ ...base(`${key}_daily`, 'common-category-bars', { metric: metric(first), dimension: date, breakdown: dimension.field }), sort_by: date, sort_ascending: true,
          common_options: { stack: 'percent' }, field_formats: [{ field: date, kind: 'dimension', display_format: 'M.d' }] }] : []),
        table(5),
      ] }, `값이 ${count}로 적어 비중 도넛과 표를 씁니다.${stack ? ` 기간이 ${input.days}일이라 날짜별 100% 누적 막대를 더합니다.` : ''}`);
    } else if (dimension.values <= SOME && !dimension.truncated) {
      add({ key, kind: 'block', title: `${dimension.name}별 ${first.label}`, items: [
        { ...base(`${key}_bars`, 'common-category-bars', { metric: metric(first), dimension: dimension.field }), ...descending,
          common_options: { orientation: 'horizontal', show_values: true }, height: Math.max(280, 100 + ROW * Math.min(dimension.values, 10)) },
        table(10),
      ] }, `값이 ${count}라 도넛 대신 가로 순위 막대와 표를 씁니다.`);
    } else {
      add({ key, kind: 'block', title: `${dimension.name}별 ${first.label}`, items: [table(10)] }, `값이 ${count}로 많아 페이지를 넘기는 표만 씁니다.`);
    }
  });

  (input.cross ?? []).forEach((pair, index) => {
    const title = `${pair.row.name}${andParticle(pair.row.name)} ${pair.column.name}별 ${first.label}`;
    if (pair.column.values > CROSS_COLUMNS || pair.column.truncated) {
      notes.push(`${title}: 열 값이 ${pair.column.values}개라 교차표가 읽기 어려워 만들지 않았습니다. 값이 ${CROSS_COLUMNS}개 이하인 분류를 열로 지정하세요.`);
      return;
    }
    const rows = Math.min(pair.row.values, CROSS_ROWS);
    add({ key: `cross_${index + 1}`, kind: 'block', title, items: [
      { ...base(`cross_${index + 1}_pivot`, 'common-pivot-table', { metric: metric(first), row: pair.row.field, column: pair.column.field }), ...descending, common_options: { heatmap: true }, height: Math.max(COMMON_LAYOUTS['pivot-table'].minimum.height, 100 + ROW * (rows + 1)) },
    ] }, `행 ${pair.row.values}개, 열 ${pair.column.values}개의 열지도 교차표입니다. 행은 ${first.label}이 큰 순서로 놓고 높이를 행 ${rows}개에 맞췄습니다.`);
  });

  const filters = withFilters ? input.dimensions.filter(d => d.values >= 2 && d.values <= SOME && !d.truncated).slice(0, 2).map(d => ({ field: d.field, label: d.name })) : [];
  if (input.metrics.length > 1 && input.dimensions.length)
    notes.push(`분류별 도넛·막대·교차표는 첫 지표(${first.label})만 나눕니다. 나머지 지표는 분류별 표의 값 열로 들어갑니다${input.metrics.length > 4 ? '(표에는 넷째 지표까지)' : ''}. 다른 지표의 도넛이나 막대가 필요하면 그 지표를 첫 지표로 다시 요청하세요.`);
  if (input.comparison) notes.push(`기간 비교는 ${[overview ? 'KPI의 증감률' : '', overview && trendComparison && !second ? '추이의 비교 기간 선' : '', tableComparison ? '분류별 표의 증감 열' : ''].filter(Boolean).join(', ') || '넣을 KPI가 없어 어디에도 넣지 않았습니다'}${overview || tableComparison ? '에 넣었습니다' : ''}. 추이의 비교 기간 선은 include.trend_comparison, 표의 증감 열은 include.table_comparison을 true로 지정할 때만 넣습니다${tableComparison ? '(증감 열이 있는 표에는 비중 열을 넣지 않습니다)' : ''}.`);
  const extras = [shareColumn && input.dimensions.length ? '표의 전체 대비 비중 열' : '', dailyShare && explained.some(r => r.rule.includes('100% 누적')) ? '날짜별 100% 누적 막대' : '', filters.length ? `분류 필터 ${filters.length}개` : ''].filter(Boolean);
  if (extras.length) notes.push(`같은 지표를 다르게 보여주는 표현으로 ${extras.join(', ')}을(를) 넣었습니다. 원하지 않으면 include의 share_column, daily_share, filters를 false로 지정하세요.`);
  notes.push('수정할 때: bindings와 field_formats는 필드 ID, sort_by는 차트에 표시되는 지표 이름(label)을 씁니다.');
  notes.unshift('지표·분류·비교·평균선은 입력한 것만 사용했습니다. 차트 형태와 높이는 이 기간에 관측한 분류 값 개수로 정했습니다.');
  return { regions: explained, notes, page: { width: 1500, density: 'compact', fit_height: true, appearance: 'outlined-report',
    controls: { data_source: source, date_range: input.date_range, date_range_dimension: date, ...(filters.length ? { dimensions: filters } : {}) }, regions } };
}

export interface PageOutlineToolInput {
  report_id: string; data_source?: string | undefined; date: string; date_range: string;
  metrics: Array<{ field: string; aggregation?: string | undefined; label?: string | undefined }>;
  dimensions?: string[] | undefined;
  cross?: Array<{ row: string; column: string }> | undefined;
  comparison?: string | undefined; comparison_label?: string | undefined; average_line?: boolean | undefined;
  trend?: { by?: 'day' | 'week' | 'month' | undefined; with_second_metric?: boolean | undefined } | undefined;
  include?: OutlineInclude | undefined;
  /** Passed through to the page_add result so it can be used as is. */
  page?: string | number | undefined; header?: Record<string, unknown> | undefined; tabs?: Record<string, unknown> | undefined; design?: Record<string, unknown> | undefined;
  replace?: Record<string, unknown> | undefined;
}

/** Reads how many values each chosen breakdown has, then plans the regions. Saves nothing. */
export async function outlinePage(ctx: ToolContext, input: PageOutlineToolInput) {
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(input.date_range);
  if (!range) throw invalid('date_range must be a fixed period: YYYY-MM-DD..YYYY-MM-DD.');
  const days = Math.round((Date.parse(`${range[2]}T00:00:00Z`) - Date.parse(`${range[1]}T00:00:00Z`)) / 86_400_000) + 1;
  if (!(days >= 1)) throw invalid('date_range must start on or before its end.');
  const reportId = parseReportId(input.report_id), doc = await ctx.session.load(reportId);
  const source = await resolveSource(ctx.rap, doc, input.data_source);
  const date = resolveField(source.fields, input.date);
  const metrics = input.metrics.map(m => { const field = resolveField(source.fields, m.field); return { field: field.id, aggregation: m.aggregation, label: m.label?.trim() || field.name }; });
  if (new Set(metrics.map(m => m.label)).size !== metrics.length) throw invalid('Give each metric a different label.');
  const first = metrics[0]!;
  const profiles = new Map<string, OutlineDimension>();
  const profile = async (ref: string): Promise<OutlineDimension> => {
    const field = resolveField(source.fields, ref);
    const known = profiles.get(field.id);
    if (known) return known;
    const result = await runTool(ctx, 'datasource_query', { report_id: reportId, data_source: source.datasourceId, dimensions: [field.id],
      metrics: [{ field: first.field, ...(first.aggregation ? { aggregation: first.aggregation } : {}) }], date_range: input.date_range, date_range_dimension: date.id, limit: 500 });
    if (result.isError) throw invalid(`Could not read the values of "${field.name}": ${resultText(result).slice(0, 300)}`);
    const rows = JSON.parse(resultText(result)) as { returned_count: number; total_count?: number | null; truncated?: boolean | null };
    const entry = { field: field.id, name: field.name, values: rows.total_count ?? rows.returned_count, truncated: rows.truncated !== false };
    profiles.set(field.id, entry);
    return entry;
  };
  const dimensions: OutlineDimension[] = [];
  for (const ref of input.dimensions ?? []) dimensions.push(await profile(ref));
  if (new Set(dimensions.map(d => d.field)).size !== dimensions.length) throw invalid('Give each breakdown dimension once.');
  const cross: Array<{ row: OutlineDimension; column: OutlineDimension }> = [];
  for (const pair of input.cross ?? []) cross.push({ row: await profile(pair.row), column: await profile(pair.column) });
  const plan = planPageOutline({ data_source: source.alias, date: date.id, date_name: date.name, date_range: input.date_range, days,
    metrics, dimensions, cross, comparison: input.comparison, comparison_label: input.comparison_label, average_line: input.average_line, trend: input.trend, include: input.include });
  const used = new Set([date.id, ...metrics.map(m => m.field), ...profiles.keys()]);
  const unused = source.fields.filter(f => f.kind === 'dimension' && !used.has(f.id)).map(f => f.name).slice(0, 40);
  return text(JSON.stringify({ status: 'ready', saved: false, report_id: reportId, period_days: days,
    observed: [...profiles.values()].map(d => ({ dimension: d.name, values: d.values, complete: !d.truncated })),
    regions: plan.regions, notes: plan.notes, unused_dimensions: unused,
    next: 'page_add를 그대로 component_page_add의 입력으로 넘깁니다. page, header, tabs, design을 이 도구에 주면 page_add에 포함됩니다. preview: true를 더해 먼저 검사할 수 있습니다.',
    page_add: { report_id: reportId, ...(input.page === undefined ? {} : { page: input.page }), ...plan.page,
      ...(input.header ? { header: input.header } : {}), ...(input.tabs ? { tabs: input.tabs } : {}), ...(input.design ? { design: input.design } : {}), ...(input.replace ? { replace: input.replace } : {}) } }, null, 2));
}
