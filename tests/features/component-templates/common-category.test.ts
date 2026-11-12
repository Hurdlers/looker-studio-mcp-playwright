import { describe, expect, it } from 'vitest';
import { planCategory } from '../../../src/features/component-templates/common-category.js';
import type { FamilyPlanInput } from '../../../src/features/component-templates/common-contract.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const input = (options: Record<string, unknown> = {}): FamilyPlanInput => ({
  template_id: 'common-category-bars', bindings: { dimension: 'day', metric: { field: 'value', aggregation: 'sum', label: '매출' }, breakdown: 'category' }, options,
});

describe('common categorical chart plans', () => {
  it('uses native 100% stacking without applying percent-of-total to the underlying metric', async () => {
    const source = input({ orientation: 'horizontal', stack: 'percent' }), before = structuredClone(source);
    const plan = planCategory(source)!;
    expect(plan.type).toBe('stacked_100_bar');
    expect(plan.metrics).toEqual([{ field: 'value', aggregation: 'sum', label: '매출' }]);
    expect(plan.notes?.join(' ')).toContain('각 기본 범주');
    const f = fake(); await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const chart = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(chart.propertyConfig.componentProperty.barChartProperty).toMatchObject({ orientation: 1, showStack: true, show100Stack: true });
    expect(chart.conceptDefs.some((c: Json) => c.resultTransformation?.analyticalFunction === 1)).toBe(false);
    expect(source).toEqual(before);
  });

  it('keeps ordinary and absolute stacks distinct and rejects missing or irrelevant roles', () => {
    expect(planCategory(input())?.type).toBe('column');
    expect(planCategory(input({ stack: 'absolute' }))?.type).toBe('stacked_column');
    const missing = input({ stack: 'percent' }); delete missing.bindings.breakdown;
    expect(() => planCategory(missing)).toThrow(/breakdown/);
    expect(() => planCategory(input({ donut: true }))).toThrow(/does not apply/);
    expect(() => planCategory(input({ stack: 'yes' }))).toThrow(/stack/);
    expect(() => planCategory({ ...input(), bindings: { ...input().bindings, dimension: { field: 'day', aggregation: 'count' } } })).toThrow(/field only/);
  });

  it('changes only the native radial kind and retains Auto aggregation when no aggregation is supplied', async () => {
    const source: FamilyPlanInput = { template_id: 'common-radial-share', bindings: { dimension: 'category', metric: { field: 'value', label: '금액' } }, options: { donut: true } };
    const plan = planCategory(source)!;
    expect(plan.type).toBe('donut');
    expect(plan.metrics[0]).not.toHaveProperty('aggregation');
    const f = fake(); await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const chart = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(chart.type).toBe('simple-piechart');
    expect(chart.propertyConfig.componentProperty.pieChartProperty.pieHole).toBe(0.55);
    expect(planCategory({ ...source, options: { donut: false } })?.type).toBe('pie');
    expect(() => planCategory({ ...source, options: { donut: 'true' } })).toThrow(/true or false/);
    expect(() => planCategory({ ...source, bindings: { ...source.bindings, breakdown: 'day' } })).toThrow(/Unknown role/);
    expect(planCategory({ template_id: 'another-family', bindings: {}, options: {} })).toBeUndefined();
  });
});
