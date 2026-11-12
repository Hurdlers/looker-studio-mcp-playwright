import { describe, expect, it } from 'vitest';
import { commonChartArgs, type CommonInput } from '../../../src/features/component-templates/common.js';
import { fake, ORIGINAL } from '../spec/fake.js';

const metric = { field: 'value', aggregation: 'sum' as const, label: 'Value' };
const cases = [
  ['common-kpi', { metric }],
  ['common-time-trend', { metric, date: 'day' }],
  ['common-detail-table', { metric, dimension: 'category' }],
  ['common-category-bars', { metric, dimension: 'category' }],
  ['common-radial-share', { metric, dimension: 'category' }],
  ['common-area-trend', { metric, date: 'day' }],
  ['common-category-line', { metric, dimension: 'category' }],
  ['common-mixed-series', { metric, secondary_metric: { field: 'value', aggregation: 'avg' as const, label: 'Average' }, dimension: 'category' }],
  ['common-pivot-table', { metric, row: 'category', column: 'day' }],
  ['common-xy-scatter', { dimension: 'category', x_metric: metric, y_metric: { field: 'value', aggregation: 'avg' as const, label: 'Average' } }],
] satisfies Array<[string, CommonInput['bindings']]>;

describe('compact presentation across common chart families', () => {
  it.each(cases)('%s keeps data roles and preflights its native styles without writes', async (template_id, bindings) => {
    const base = { report_id: ORIGINAL, template_id, bindings };
    const legacy = commonChartArgs(base), compact = commonChartArgs({ ...base, common_options: { density: 'compact', surface: 'plain' } });
    for (const key of ['dimensions', 'metrics', 'breakdown', 'fields', 'series', 'date_range_dimension']) expect(compact.args[key]).toEqual(legacy.args[key]);
    const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] generic layout test';
    const before = structuredClone(f.original);
    const result = await f.run('component_template_add', { ...base, preview: true, common_options: { density: 'compact', surface: 'plain' } });
    expect(result.isError).not.toBe(true);
    expect(f.original).toEqual(before); expect(f.writes()).toHaveLength(0);
  });
});

it('reduces reference-line emphasis without changing its calculation', () => {
  const args = { report_id: ORIGINAL, template_id: 'common-time-trend', bindings: { metric, date: 'day' } };
  expect(commonChartArgs({ ...args, common_options: { average_line: true } }).args.reference_lines).toEqual([{ type: 'Metric', calculation: 'Average', weight: 'Auto' }]);
  expect(commonChartArgs({ ...args, common_options: { average_line: true, density: 'compact' } }).args.reference_lines).toEqual([{ type: 'Metric', calculation: 'Average', weight: 1 }]);
});


it('adds sparse-series labels and table bars without changing the selected data', async () => {
  for (const [template_id, bindings, option] of [
    ['common-time-trend', { metric, date: 'day' }, { show_values: true }],
    ['common-detail-table', { metric, dimension: 'category' }, { data_bars: true }],
  ] as const) {
    const base = { report_id: ORIGINAL, template_id, bindings };
    const original = commonChartArgs(base), labelled = commonChartArgs({ ...base, common_options: option });
    expect(labelled.args.metrics).toEqual(original.args.metrics);
    expect(labelled.args.dimensions).toEqual(original.args.dimensions);
    const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] visual reading test';
    await f.run('component_template_add', { ...base, preview: true, common_options: option });
    expect(f.writes()).toHaveLength(0);
  }
  expect(commonChartArgs({ report_id: ORIGINAL, template_id: 'common-detail-table', bindings: { metric, dimension: 'category' }, common_options: { data_bars: true } }).args.style).toMatchObject({ 'Metric column type': 'Bar', 'Show metric value': true });
});

// A long currency value at the final observation must have room outside the plot.
it.each(['compact', 'comfortable'] as const)('reserves label space without changing the date domain in %s', density => {
  const input = { report_id: ORIGINAL, template_id: 'common-time-trend', bindings: { metric, date: 'day' }, size: { width: 1152, height: 280 } };
  const base = commonChartArgs({ ...input, common_options: { density } });
  const labelled = commonChartArgs({ ...input, common_options: { density, show_values: true } });
  const style = labelled.args.style as Record<string, number>;
  expect(1152 - style['Chart area left']! - style['Chart area width']!).toBeGreaterThanOrEqual(84);
  expect(labelled.args.dimensions).toEqual(base.args.dimensions);
  expect(labelled.args.date_range).toEqual(base.args.date_range);
});

it('uses KPI emphasis and percentage column roles without altering metrics', async () => {
  const base = { report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric } };
  const primary = commonChartArgs({ ...base, common_options: { density: 'compact', emphasis: 'primary' } });
  const secondary = commonChartArgs({ ...base, common_options: { density: 'compact', emphasis: 'secondary' } });
  expect(primary.args.metrics).toEqual(secondary.args.metrics);
  expect((primary.args.style as Record<string, number>)['Font size']).toBeGreaterThan((secondary.args.style as Record<string, number>)['Font size']!);
  const table = commonChartArgs({ report_id: ORIGINAL, template_id: 'common-detail-table', bindings: { metric, dimension: 'category' }, size: { width: 552, height: 260 }, common_options: { density: 'compact', percent_of_total: true } });
  const widths = (table.args.style as Record<string, number[]>)['Column widths']!;
  expect(widths[1]).toBeGreaterThan(widths[2]!);
  expect(widths.reduce((a,b) => a+b,0)).toBe(550);
  const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] emphasis';
  const result = await f.run('component_template_add', { ...base, common_options: { emphasis: 'secondary' }, preview: true });
  expect(result.isError).not.toBe(true); expect(f.writes()).toHaveLength(0);
});
