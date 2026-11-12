import { describe, expect, it } from 'vitest';
import { planAdvanced } from '../../../src/features/component-templates/common-advanced.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const pivot = { template_id: 'common-pivot-table', bindings: { row: 'category', column: 'day', metric: { field: 'value', aggregation: 'avg' as const, label: '평균값' } }, options: {} };
const scatter = { template_id: 'common-xy-scatter', bindings: {
  dimension: 'category', x_metric: { field: 'value', aggregation: 'sum' as const, label: '합계' },
  y_metric: { field: 'value', aggregation: 'avg' as const, label: '평균' },
}, options: {} };
function slotConcept(c: Json, slot: string) {
  const name = c.propertyConfig.componentProperty.metrics.labeledConcepts.find((s: Json) => s.key === slot).value.conceptNames[0];
  return c.conceptDefs.find((d: Json) => d.name === name).queryTimeTransformation;
}

describe('advanced common structures', () => {
  it('keeps row and column axes distinct while retaining metric aggregation in the existing pivot builder', async () => {
    const f = fake();
    await f.run('chart_add', { report_id: ORIGINAL, ...planAdvanced({ ...pivot, options: { heatmap: true } }) });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    const p = c.propertyConfig.componentProperty;
    const id = (entry: Json) => entry.sort[0].sortColumn;
    const field = (name: string) => c.conceptDefs.find((d: Json) => d.name === name).queryTimeTransformation.dataTransformation.sourceFieldName;
    expect(c.preset).toBe('heatmap');
    expect(p.pivotTableProperty.pivotDisplayConfig.row.map(id).map(field)).toEqual(['_category_']);
    expect(p.pivotTableProperty.pivotDisplayConfig.col.map(id).map(field)).toEqual(['_day_']);
    expect(slotConcept(c, 'primary')).toMatchObject({ dataTransformation: { aggregation: 1 }, displayTransformation: { displayName: '평균값' } });
    expect(p.pivotTableProperty.tableMetricProperty[0].colType).toBe(1);
  });

  it('preserves separate aggregations and labels even when all bubble roles bind the same field', async () => {
    const f = fake();
    const input = { ...scatter, bindings: { ...scatter.bindings, size_metric: { field: 'value', aggregation: 'count' as const, label: '건수' } } };
    const original = structuredClone(input);
    const plan = planAdvanced(input)!;
    expect(plan.type).toBe('bubble');
    expect(plan.fields).toBeUndefined();
    await f.run('chart_add', { report_id: ORIGINAL, ...plan });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    for (const [slot, aggregation, label] of [['x_metric', 6, '합계'], ['y_metric', 1, '평균'], ['bubble_size', 2, '건수']] as const) {
      expect(slotConcept(c, slot)).toMatchObject({ dataTransformation: { sourceFieldName: '_value_', aggregation }, displayTransformation: { displayName: label } });
    }
    expect(input).toEqual(original);
  });

  it('uses two metric slots for scatter and does not invent a size binding', async () => {
    const f = fake();
    await f.run('chart_add', { report_id: ORIGINAL, ...planAdvanced(scatter) });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.preset).toBe('default');
    const size = c.propertyConfig.componentProperty.metrics.labeledConcepts.find((s: Json) => s.key === 'bubble_size');
    expect(size?.value.conceptNames ?? []).toEqual([]);
    expect(slotConcept(c, 'x_metric').dataTransformation.aggregation).toBe(6);
    expect(slotConcept(c, 'y_metric').dataTransformation.aggregation).toBe(1);
  });

  it('rejects incomplete contracts and unrelated options before chart creation', () => {
    expect(planAdvanced({ template_id: 'other', bindings: {}, options: {} })).toBeUndefined();
    expect(() => planAdvanced({ ...pivot, bindings: { row: 'category', metric: 'value' } })).toThrow(/column/);
    expect(() => planAdvanced({ ...pivot, options: { heatmap: 'yes' } })).toThrow(/true or false/);
    expect(() => planAdvanced({ ...scatter, options: { heatmap: true } })).toThrow(/does not apply/);
    expect(() => planAdvanced({ ...scatter, bindings: { ...scatter.bindings, dimension: { field: 'category', aggregation: 'sum' } } })).toThrow(/field only/);
  });
});
