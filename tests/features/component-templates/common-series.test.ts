import { describe, expect, it } from 'vitest';
import { planSeries } from '../../../src/features/component-templates/common-series.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const prop = (c: Json) => c.propertyConfig.componentProperty;

describe('common series plans', () => {
  it('delegates percent areas with breakdown without changing metric aggregation', async () => {
    const binding = { field: 'value', aggregation: 'sum' as const, label: '금액' };
    const plan = planSeries({ template_id: 'common-area-trend', bindings: { date: 'day', metric: binding, breakdown: 'category' }, options: { stack: 'percent' } })!;
    expect(plan.metrics).toEqual([binding]);
    const f = fake();
    await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.type).toBe('simple-areachart');
    expect(prop(c).areaChartProperty).toMatchObject({ showStack: true, show100Stack: true });
    expect(prop(c).dimensions.labeledConcepts.find((s: Json) => s.key === 'breakdown').value.conceptNames).toHaveLength(1);
    expect(binding).toEqual({ field: 'value', aggregation: 'sum', label: '금액' });
  });
  it('refuses missing stack series or unknown options rather than ignoring them', () => {
    const input = { template_id: 'common-area-trend', bindings: { date: 'day', metric: 'value' }, options: { stack: 'absolute' } };
    expect(() => planSeries(input)).toThrow(/breakdown/);
    expect(() => planSeries({ ...input, options: { stack: 'mystery' } })).toThrow(/stack/);
    expect(() => planSeries({ ...input, options: { secondary_axis: true } })).toThrow(/does not apply/);
  });
  it('uses a category line instead of a date-only chart and preserves Auto omission', async () => {
    const plan = planSeries({ template_id: 'common-category-line', bindings: { dimension: 'category', metric: 'value' }, options: {} })!;
    expect(plan.metrics[0]).not.toHaveProperty('aggregation');
    const f = fake();
    await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.type).toBe('simple-combochart');
    expect(prop(c).comboChartProperty.seriesProperty[0].seriesType).toBe(0);
  });
  it('preserves two different aggregates and directs only the second metric to the requested right axis', async () => {
    const bindings = { dimension: 'category', metric: { field: 'value', aggregation: 'sum' as const, label: '합계' }, secondary_metric: { field: 'value', aggregation: 'avg' as const, label: '평균' } };
    const plan = planSeries({ template_id: 'common-mixed-series', bindings, options: { secondary_axis: true } })!;
    const f = fake();
    await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(prop(c).comboChartProperty.seriesProperty.slice(0, 2)).toMatchObject([{ seriesType: 1, seriesAxisIndex: 0 }, { seriesType: 0, seriesAxisIndex: 1 }]);
    expect(plan.metrics).toEqual([bindings.metric, bindings.secondary_metric]);
    const ids = planSeries({ template_id: 'common-mixed-series', bindings: { dimension: '_category_', metric: '_value_', secondary_metric: { field: '_value_', aggregation: 'avg', label: '평균' } }, options: { secondary_axis: true } })!;
    expect(ids.metrics[0]?.label).toBe(ids.series?.[0]?.metric);
    expect(planSeries({ template_id: 'common-mixed-series', bindings, options: {} })!.series?.[1]?.axis).toBe('left');
  });
  it('requires disambiguated series labels and rejects non-boolean axis options', () => {
    const input = { template_id: 'common-mixed-series', bindings: { dimension: 'category', metric: 'value', secondary_metric: 'value' }, options: {} };
    expect(() => planSeries(input)).toThrow(/distinct display names/);
    expect(() => planSeries({ ...input, options: { secondary_axis: 'right' } })).toThrow(/true or false/);
    expect(planSeries({ template_id: 'common-kpi', bindings: {}, options: {} })).toBeUndefined();
  });
});
