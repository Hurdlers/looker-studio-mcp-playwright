import { describe, expect, it } from 'vitest';
import { planAnalysisRegions } from '../../../src/features/component-templates/analysis-regions.js';
import { planPageOutline, type OutlineDimension } from '../../../src/features/component-templates/page-outline.js';

const dim = (field: string, values: number, truncated = false): OutlineDimension => ({ field: `_${field}_`, name: field, values, truncated });
const base = { data_source: 'ds1', date: '_day_', date_name: 'day', date_range: '2026-01-01..2026-01-07', days: 7,
  metrics: [{ field: '_value_', aggregation: 'sum', label: 'Value' }], dimensions: [] as OutlineDimension[] };
const kinds = (region: { items: Array<{ template_id: string }> }) => region.items.map(item => item.template_id);

describe('page outline from chosen metrics and breakdowns', () => {
  it('uses only the given metrics and adds no comparison or average line by itself', () => {
    const { page } = planPageOutline({ ...base, metrics: [...base.metrics, { field: '_cost_', aggregation: 'sum', label: 'Cost' }] });
    expect(page.regions).toHaveLength(1);
    expect(kinds(page.regions[0])).toEqual(['common-kpi', 'common-kpi', 'common-time-trend']);
    expect(page.regions[0].items[0].common_options).toBeUndefined();
    expect(page.regions[0].items[2].common_options).toEqual({ show_values: true });
    expect(page.regions[0].items.map((item: { bindings: { metric: { field: string } } }) => item.bindings.metric.field)).toEqual(['_value_', '_cost_', '_value_']);
    expect(page.controls).toEqual({ data_source: 'ds1', date_range: '2026-01-01..2026-01-07', date_range_dimension: '_day_' });
  });
  it('passes an explicit comparison and average line through', () => {
    const { page } = planPageOutline({ ...base, comparison: 'Previous period', comparison_label: '이전 대비', average_line: true });
    expect(page.regions[0].items[0].common_options).toEqual({ comparison: 'Previous period', comparison_label: '이전 대비' });
    // A comparison stays on the KPIs unless the trend is asked to carry it too.
    expect(page.regions[0].items[1].common_options).toEqual({ show_values: true, average_line: true });
    const compared = planPageOutline({ ...base, comparison: 'Previous period', average_line: true, include: { trend_comparison: true } });
    expect(compared.page.regions[0].items[1].common_options).toEqual({ show_values: false, average_line: true, comparison: 'Previous period' });
  });
  it('picks the chart form from the number of values', () => {
    const { page, notes, regions } = planPageOutline({ ...base, dimensions: [dim('device', 3), dim('channel', 9), dim('source', 47), dim('brand', 1), dim('city', 500, true)] });
    const by = Object.fromEntries(page.regions.map((region: { key: string }) => [region.key, region]));
    expect(kinds(by.by_1)).toEqual(['common-radial-share', 'common-category-bars', 'common-detail-table']);
    expect(by.by_1.items[1].common_options).toEqual({ stack: 'percent' });
    expect(kinds(by.by_2)).toEqual(['common-category-bars', 'common-detail-table']);
    expect(by.by_2.items[0]).toMatchObject({ common_options: { orientation: 'horizontal', show_values: true }, height: 100 + 33 * 9, sort_by: 'Value', sort_ascending: false });
    expect(kinds(by.by_3)).toEqual(['common-detail-table']);
    expect(by.by_4).toBeUndefined();
    expect(kinds(by.by_5)).toEqual(['common-detail-table']);
    expect(notes.join(' ')).toContain('brand');
    expect(regions.map(r => r.key)).toEqual(['overview', 'by_1', 'by_2', 'by_3', 'by_5']);
    expect(page.controls.dimensions).toEqual([{ field: '_device_', label: 'device' }, { field: '_channel_', label: 'channel' }]);
  });
  it('drops the daily stack for long periods and turns value labels off', () => {
    const { page } = planPageOutline({ ...base, days: 30, dimensions: [dim('device', 3)] });
    expect(page.regions[0].items.at(-1).common_options).toEqual({ show_values: false });
    expect(kinds(page.regions[1])).toEqual(['common-radial-share', 'common-detail-table']);
  });
  it('splits many metrics into a KPI region and a trend region', () => {
    const metrics = Array.from({ length: 6 }, (_, i) => ({ field: `_m${i}_`, aggregation: 'sum', label: `M${i}` }));
    const { page } = planPageOutline({ ...base, metrics });
    expect(page.regions.map((region: { key: string }) => region.key)).toEqual(['overview', 'trend']);
    expect(page.regions[0].items).toHaveLength(6);
  });
  it('sizes a cross table to its rows and refuses wide column sets', () => {
    const { page, notes } = planPageOutline({ ...base, cross: [{ row: dim('channel', 12), column: dim('device', 3) }, { row: dim('device', 3), column: dim('source', 47) }] });
    const cross = page.regions.find((region: { key: string }) => region.key === 'cross_1');
    expect(cross.title).toBe('channel와 device별 Value');
    expect(planPageOutline({ ...base, cross: [{ row: dim('채널 그룹', 5), column: dim('기기', 3) }] }).page.regions[1].title).toBe('채널 그룹과 기기별 Value');
    expect(cross.items[0]).toMatchObject({ template_id: 'common-pivot-table', height: 100 + 33 * 13, common_options: { heatmap: true } });
    expect(page.regions.some((region: { key: string }) => region.key === 'cross_2')).toBe(false);
    expect(notes.join(' ')).toContain('열 값이 47개');
  });
  it('keeps a small cross table at the minimum chart height', () => {
    const { page } = planPageOutline({ ...base, cross: [{ row: dim('category', 3), column: dim('channel', 2) }] });
    expect(page.regions[1].items[0].height).toBe(240);
    expect(() => planAnalysisRegions({ regions: page.regions, width: 1452, left: 24, top: 150, gap: 16 })).not.toThrow();
  });
  it('produces regions the page layout accepts', () => {
    const { page } = planPageOutline({ ...base, metrics: [...base.metrics, { field: '_cost_', aggregation: 'sum', label: 'Cost' }], dimensions: [dim('device', 3), dim('channel', 9), dim('source', 47)], cross: [{ row: dim('channel', 9), column: dim('device', 3) }] });
    const plan = planAnalysisRegions({ regions: page.regions, width: 1452, left: 24, top: 150, gap: 16 });
    expect(plan.regions).toHaveLength(page.regions.length);
    expect(new Set(plan.regions.flatMap(region => region.items.map(item => item.key))).size).toBe(page.regions.flatMap((region: { items: unknown[] }) => region.items).length);
  });
});

describe('outline extras and several metrics', () => {
  const two = { ...base, metrics: [...base.metrics, { field: '_cost_', aggregation: 'sum', label: 'Cost' }], dimensions: [dim('device', 3)] };
  it('puts the other metrics in the breakdown table and says which charts use the first metric', () => {
    const { page, notes } = planPageOutline({ ...two, comparison: 'Previous period' });
    const table = page.regions[1].items.at(-1);
    expect(table.bindings).toMatchObject({ metric: { field: '_value_' }, metric_2: { field: '_cost_', label: 'Cost', aggregation: 'sum' }, dimension: '_device_' });
    expect(page.regions[0].items.at(-1).texts.title).toBe('Value 추이');
    expect(notes.join(' ')).toContain('첫 지표(Value)만');
    expect(notes.join(' ')).toContain('비교 기간 선');
    expect(notes.join(' ')).toContain('include');
    expect(page.regions[1].items[1].field_formats).toEqual([{ field: '_day_', kind: 'dimension', display_format: 'M.d' }]);
  });
  it('leaves out each presentation extra when switched off', () => {
    const { page, notes } = planPageOutline({ ...two, include: { share_column: false, daily_share: false, filters: false } });
    expect(kinds(page.regions[1])).toEqual(['common-radial-share', 'common-detail-table']);
    expect(page.regions[1].items.at(-1).common_options).toEqual({ data_bars: true, visible_rows: 5 });
    expect(page.controls.dimensions).toBeUndefined();
    expect(notes.join(' ')).not.toContain('include');
  });
});

describe('outline comparison in tables and overview switch', () => {
  const two = { ...base, dimensions: [dim('device', 3)], comparison: 'Previous period' };
  it('adds the comparison to breakdown tables only when asked', () => {
    expect(planPageOutline({ ...two, include: { table_comparison: true } }).page.regions[1].items.at(-1).common_options).toEqual({ data_bars: true, visible_rows: 5, comparison: 'Previous period' });
    const off = planPageOutline(two);
    expect(off.page.regions[1].items.at(-1).common_options.comparison).toBeUndefined();
    expect(off.page.regions[1].items.at(-1).common_options.percent_of_total).toBe(true);
    expect(planPageOutline({ ...base, dimensions: [dim('device', 3)] }).page.regions[1].items.at(-1).common_options.comparison).toBeUndefined();
  });
  it('can leave out the KPI and trend overview, but not everything', () => {
    const { page, regions } = planPageOutline({ ...two, include: { overview: false } });
    expect(regions.map(r => r.key)).toEqual(['by_1']);
    expect(page.regions).toHaveLength(1);
    expect(() => planPageOutline({ ...base, include: { overview: false } })).toThrow(/Nothing to outline/);
  });
});

describe('KPI progress bars', () => {
  it('are added only when asked and only with a comparison', () => {
    const withBar = planPageOutline({ ...base, comparison: 'Previous period', include: { kpi_progress: true } });
    expect(withBar.page.regions[0].items[0].common_options).toEqual({ comparison: 'Previous period', progress: true });
    expect(planPageOutline({ ...base, comparison: 'Previous period' }).page.regions[0].items[0].common_options.progress).toBeUndefined();
    expect(planPageOutline({ ...base, include: { kpi_progress: true } }).page.regions[0].items[0].common_options).toBeUndefined();
  });
});

describe('trend grouping and a second metric', () => {
  const long = { ...base, date_range: '2026-01-01..2026-03-31', days: 90, metrics: [...base.metrics, { field: '_cost_', aggregation: 'sum', label: 'Cost' }] };
  it('groups the trend by week or month and labels values when the points are few', () => {
    const weekly = planPageOutline({ ...long, trend: { by: 'week' } }).page.regions[0].items.at(-1);
    expect(weekly).toMatchObject({ template_id: 'common-time-trend', field_formats: [{ field: '_day_', kind: 'dimension', date_granularity: 'Year Week' }], common_options: { show_values: true } });
    expect(weekly.texts.title).toBe('주별 Value 추이');
    const monthly = planPageOutline({ ...long, trend: { by: 'month' } }).page.regions[0].items.at(-1);
    expect(monthly.field_formats[0].date_granularity).toBe('Year Month');
    expect(planPageOutline(long).page.regions[0].items.at(-1).field_formats).toBeUndefined();
    expect(planPageOutline(long).page.regions[0].items.at(-1).common_options).toEqual({ show_values: false });
  });
  it('draws the second metric as a line over the first only when asked', () => {
    const { page, notes } = planPageOutline({ ...long, trend: { by: 'week', with_second_metric: true }, comparison: 'Previous period', include: { trend_comparison: true } });
    const combo = page.regions[0].items.at(-1);
    expect(combo).toMatchObject({ template_id: 'common-mixed-series', common_options: { secondary_axis: true },
      bindings: { metric: { field: '_value_' }, secondary_metric: { field: '_cost_' }, dimension: '_day_', date: '_day_' },
      field_formats: [{ field: '_day_', kind: 'dimension', date_granularity: 'Year Week' }] });
    expect(notes.join(' ')).toContain('복합 추이');
    expect(() => planPageOutline({ ...base, trend: { with_second_metric: true } })).toThrow(/second metric/);
  });
});

describe('single-point periods', () => {
  it('shows the KPIs without a one-point trend', () => {
    const { page, regions } = planPageOutline({ ...base, date_range: '2026-01-01..2026-01-01', days: 1 });
    expect(kinds(page.regions[0])).toEqual(['common-kpi']);
    expect(regions[0]!.rule).toContain('하나뿐');
    expect(kinds(planPageOutline({ ...base, date_range: '2026-01-01..2026-01-05', days: 5, trend: { by: 'week' } }).page.regions[0])).toEqual(['common-kpi']);
  });
});
