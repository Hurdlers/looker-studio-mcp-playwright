import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { commonChartArgs, type CommonInput } from '../../../src/features/component-templates/common.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const policy = { design_rules: 'team-v1' as const };
const metric = { field: 'value', aggregation: 'avg' as const, label: '평균 값' };
const base = { report_id: ORIGINAL, data_source: 'ds1', date_range: '2026-11-01..2026-11-03' };
const recipes: CommonInput[] = [
  { ...base, template_id: 'common-kpi', bindings: { metric, date: 'day' } },
  { ...base, template_id: 'common-time-trend', bindings: { metric, date: 'day' } },
  { ...base, template_id: 'common-detail-table', bindings: { metric, date: 'day', dimension: 'category' } },
];
function setup() {
  const f = fake();
  f.original.shareable.name = '[looker-studio-mcp-lab-1] style policy';
  return f;
}
const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
function semantics(args: Record<string, unknown>) {
  const { style: _style, position: _position, ...data } = args;
  return data;
}
function expectPolicy(value: Json) {
  expect(value).toMatchObject({ name: 'team-v1', version: 1 });
  for (const key of ['applied', 'overridden', 'warnings']) {
    expect(Array.isArray(value[key])).toBe(true);
    expect(value[key].every((item: unknown) => typeof item === 'string')).toBe(true);
  }
}

describe('opt-in team style rules', () => {
  it('retains the legacy compact defaults when the policy is absent', () => {
    const trend = commonChartArgs({ ...recipes[1]!, common_options: { density: 'compact' } });
    expect(trend.args.style).toMatchObject({ 'Show data labels': false, 'Show points': false });
    const table = commonChartArgs({ ...recipes[2]!, common_options: { density: 'compact' } });
    expect(table.args.style).not.toMatchObject({ 'Metric column type': 'Bar' });
    expect(commonChartArgs(recipes[0]!).args.style).not.toHaveProperty('Decimal precision');
    for (const recipe of recipes) {
      expect(commonChartArgs(recipe)).toEqual(commonChartArgs({ ...recipe, common_options: {} }));
    }
  });

  it('defaults the opted-in trend to points and values while explicit false wins', () => {
    const defaults = commonChartArgs({ ...recipes[1]!, common_options: { ...policy, density: 'compact' } });
    expect(defaults.args.style).toMatchObject({ 'Show data labels': true, 'Show points': true });
    const explicit = commonChartArgs({ ...recipes[1]!, common_options: { ...policy, density: 'compact', show_values: false } });
    expect(explicit.args.style).toMatchObject({ 'Show data labels': false, 'Show points': false });
  });

  it('defaults the opted-in table to visible value bars while explicit false wins', () => {
    const defaults = commonChartArgs({ ...recipes[2]!, common_options: policy });
    expect(defaults.args.style).toMatchObject({ 'Metric column type': 'Bar', 'Show metric value': true });
    const explicit = commonChartArgs({ ...recipes[2]!, common_options: { ...policy, data_bars: false } });
    expect(explicit.args.style).toMatchObject({ 'Metric column type': 'Number' });
  });

  it.each(recipes)('preserves fields, avg aggregation and dates for $template_id', recipe => {
    const before = structuredClone(recipe);
    const legacy = commonChartArgs(recipe).args;
    const styled = commonChartArgs({ ...recipe, common_options: policy }).args;
    expect(semantics(styled)).toEqual(semantics(legacy));
    expect(styled.metrics).toEqual([{ ...metric }]);
    expect(styled).not.toHaveProperty('reference_lines');
    expect(styled).not.toHaveProperty('comparison');
    expect(styled).not.toHaveProperty('filters');
    expect(recipe).toEqual(before);
  });

  it('preserves explicitly requested analytical options and precision', () => {
    for (const [index, options] of [
      [0, { comparison: 'Previous period', decimal_precision: 2 }],
      [1, { average_line: true }],
      [2, { percent_of_total: true }],
    ] as const) {
      const legacy = commonChartArgs({ ...recipes[index]!, common_options: options }).args;
      const styled = commonChartArgs({ ...recipes[index]!, common_options: { ...options, ...policy } }).args;
      expect(semantics(styled)).toEqual(semantics(legacy));
      if (index === 0) expect(styled.style).toHaveProperty('Decimal precision', 2);
    }
  });

  it('keeps project-theme inheritance without adding fixed colors or font families', () => {
    for (const recipe of recipes) {
      const legacy = commonChartArgs(recipe).args.style as Json;
      const styled = commonChartArgs({ ...recipe, common_options: policy }).args;
      expect(styled.project_theme).toBe(true);
      for (const [key, value] of Object.entries(styled.style as Json)) {
        if (/color|font family/i.test(key)) expect(value).toEqual(legacy[key]);
      }
    }
  });

  it('reports the same applied rules in preview and save, with zero then one page write', async () => {
    const f = setup(), before = structuredClone(f.original);
    const args = { ...recipes[1]!, common_options: { ...policy, show_values: false } };
    const preview = parsed(await f.run('component_template_add', { ...args, preview: true }));
    expectPolicy(preview.design_rules);
    expect(preview.design_rules.overridden.length).toBeGreaterThan(0);
    expect(f.original).toEqual(before);
    expect(f.writes()).toEqual([]);
    const saved = parsed(await f.run('component_template_add', args));
    expect(saved.design_rules).toEqual(preview.design_rules);
    expect(saved.saved).toBe(true);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint === 'updateReport')).toEqual([]);
  });

  it('rejects unsupported chart families without any write', async () => {
    const f = setup(), before = structuredClone(f.original);
    await expect(f.run('component_template_add', {
      ...recipes[2]!, template_id: 'common-category-bars', common_options: policy,
    })).rejects.toThrow();
    expect(f.original).toEqual(before);
    expect(f.writes()).toEqual([]);
  });

  it('propagates child rule results through page preview and saves the whole page once', async () => {
    const f = setup(), before = structuredClone(f.original);
    const items = recipes.map(({ report_id: _report, ...recipe }, index) => ({
      ...recipe, key: `chart-${index}`, common_options: policy,
    }));
    const args = { report_id: ORIGINAL, page: 'p1', width: 1200, columns: 2, items };
    const preview = parsed(await f.run('component_page_add', { ...args, preview: true }));
    expect(preview.items).toHaveLength(3);
    for (const item of preview.items) expectPolicy(item.design_rules);
    expect(f.original).toEqual(before);
    expect(f.writes()).toEqual([]);
    const saved = parsed(await f.run('component_page_add', args));
    expect(saved.items.map((item: Json) => item.design_rules)).toEqual(preview.items.map((item: Json) => item.design_rules));
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint === 'updateReport')).toEqual([]);
  });
});
