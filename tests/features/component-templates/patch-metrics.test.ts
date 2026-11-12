import { describe, expect, it } from 'vitest';
import { fieldConcept } from '../../../src/core/components.js';
import type { SourceField } from '../../../src/core/datasource.js';
import { planMetricPatch } from '../../../src/features/component-templates/patch-metrics.js';

type Json = Record<string, any>;
const field = (id: string, semanticType = 33, aggregation = 6): SourceField => ({ id, name: id.slice(1, -1), dataType: 2, semanticType, aggregation });
const fields = [field('_sales_', 12), field('_orders_'), field('_other_'), field('_auto_', 33, 7)];
function chart(share = false): Json {
  const metric = fieldConcept(fields[0]!, { aggregation: 6, label: 'Custom label' });
  const defs = [metric];
  if (share) defs.push({ ...structuredClone(metric), name: 'share', id: 't0.share', resultTransformation: { analyticalFunction: 1, bypassCanvasFilters: false, isRelativeToBase: false } } as typeof metric);
  return { componentId: 'chart', type: 'simple-table', datasourceId: 'source', conceptDefs: defs,
    attributeConfig: { componentAttribute: { left: 24, top: 30, width: 600, height: 300 } },
    propertyConfig: { componentProperty: { metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: defs.map(d => d.name) } }] },
      sort: [{ sortColumn: metric.name, sortDir: 1 }], dateDuration: { startAnchor: '20261101', endAnchor: '20261103' }, tableProperty: { headerFontSize: 17 } } } };
}
describe('native metric patch planning', () => {
  it('changes only metric bindings and explicit source format while preserving labels, result shares and all other chart data', () => {
    const before = chart(true), saved = structuredClone(before);
    const result = planMetricPatch(before, fields, [{ from: 'sales', to: 'orders', format: 'source' }]);
    expect(result.issues).toEqual([]); expect(result.matched).toEqual([2]);
    expect(before).toEqual(saved);
    const expected = structuredClone(before);
    for (const c of expected.conceptDefs) c.queryTimeTransformation.dataTransformation.sourceFieldName = '_orders_';
    expected.conceptDefs[0].queryTimeTransformation.displayTransformation.outputSemanticInfo = { semanticConfig: [{ semanticType: 33 }] };
    expect(result.component).toEqual(expected);
  });
  it('asks about a currency-to-number change before mutating anything', () => {
    const before = chart();
    const result = planMetricPatch(before, fields, [{ from: 'sales', to: 'orders' }]);
    expect(result.issues[0]?.code).toBe('format_required');
    expect(result.component).toEqual(before); expect(result.changed_concepts).toEqual([]);
  });
  it('honors explicit preserve and leaves custom display patterns intact', () => {
    const before = chart(); before.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat = '₩#,##0';
    const result = planMetricPatch(before, fields, [{ from: 'sales', to: 'orders', format: 'preserve' }]);
    expect(result.issues).toEqual([]);
    expect(result.component.conceptDefs[0].queryTimeTransformation.displayTransformation).toEqual(before.conceptDefs[0].queryTimeTransformation.displayTransformation);
  });
  it.each(['₩#,##0', '$0.00', '0.0%', '0.00"개"', '[Red]0.0', '0.00EE'])('asks before moving meaning-bearing format %s between numeric fields', displayFormat => {
    const numericFields = fields.map(f => f.id === '_sales_' ? { ...f, semanticType: 33 } : f);
    const before = chart();
    const display = before.conceptDefs[0].queryTimeTransformation.displayTransformation;
    display.outputSemanticInfo = { semanticConfig: [{ semanticType: 33 }] };
    display.displayFormat = displayFormat;
    const blocked = planMetricPatch(before, numericFields, [{ from: 'sales', to: 'orders' }]);
    expect(blocked.issues[0]?.code).toBe('format_required');
    expect(blocked.component).toEqual(before);
    expect(blocked.changed_concepts).toEqual([]);
    const source = planMetricPatch(before, numericFields, [{ from: 'sales', to: 'orders', format: 'source' }]);
    expect(source.issues).toEqual([]);
    expect(source.component.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat).toBeUndefined();
    const preserved = planMetricPatch(before, numericFields, [{ from: 'sales', to: 'orders', format: 'preserve' }]);
    expect(preserved.issues).toEqual([]);
    expect(preserved.component.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat).toBe(displayFormat);
  });
  it.each(['0.00', '#,##0;(#,##0)', '0.00E+00'])('preserves plain numeric format %s without another choice', displayFormat => {
    const numericFields = fields.map(f => f.id === '_sales_' ? { ...f, semanticType: 33 } : f);
    const before = chart();
    const display = before.conceptDefs[0].queryTimeTransformation.displayTransformation;
    display.outputSemanticInfo = { semanticConfig: [{ semanticType: 33 }] };
    display.displayFormat = displayFormat;
    const result = planMetricPatch(before, numericFields, [{ from: 'sales', to: 'orders' }]);
    expect(result.issues).toEqual([]);
    expect(result.component.conceptDefs[0].queryTimeTransformation.displayTransformation).toEqual(display);
  });
  it('leaves an unchanged field and its explicit units alone', () => {
    const before = chart();
    before.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat = '₩#,##0';
    const result = planMetricPatch(before, fields, [{ from: 'sales', to: 'sales' }]);
    expect(result.issues).toEqual([]);
    expect(result.component).toEqual(before);
    expect(result.changed_concepts).toEqual([]);
  });
  it('does not ask again about a preserved format when an unchanged field is requested', () => {
    const preserved = planMetricPatch(chart(), fields, [{ from: 'sales', to: 'orders', format: 'preserve' }]);
    expect(preserved.issues).toEqual([]);
    const before = structuredClone(preserved.component);
    const noop = planMetricPatch(before, fields, [{ from: 'orders', to: 'orders' }]);
    expect(noop.issues).toEqual([]);
    expect(noop.matched).toEqual([1]);
    expect(noop.component).toEqual(before);
    expect(noop.changed_concepts).toEqual([]);
    expect(noop.notes).toEqual([]);
  });
  it('clears a raw metric pattern only on explicit source format and retains share formatting', () => {
    const before = chart(true);
    before.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat = '₩#,##0';
    before.conceptDefs[1].queryTimeTransformation.displayTransformation.displayFormat = '0.0%';
    const result = planMetricPatch(before, fields, [{ from: 'sales', to: 'orders', format: 'source' }]);
    expect(result.component.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat).toBeUndefined();
    expect(result.component.conceptDefs[1].queryTimeTransformation.displayTransformation.displayFormat).toBe('0.0%');
  });
  it('removes extra aggregation for Auto and requires explicit aggregation when leaving Auto', () => {
    const result = planMetricPatch(chart(), fields, [{ from: 'sales', to: 'auto', format: 'source' }]);
    expect(result.issues).toEqual([]);
    expect(result.component.conceptDefs[0].queryTimeTransformation.dataTransformation.aggregation).toBeUndefined();
    const back = planMetricPatch(result.component, fields, [{ from: 'auto', to: 'orders' }]);
    expect(back.issues[0]?.code).toBe('aggregation_required');
    const ready = planMetricPatch(result.component, fields, [{ from: 'auto', to: 'orders', aggregation: 'sum' }]);
    expect(ready.issues).toEqual([]);
  });
  it('refuses duplicate field names, duplicate replacement entries and metric/dimension shared concepts', () => {
    const c = chart();
    const duplicate = [...fields, { ...field('_duplicate_'), name: 'orders' }];
    expect(planMetricPatch(c, duplicate, [{ from: 'sales', to: 'orders' }]).issues[0]?.code).toBe('ambiguous_field');
    expect(planMetricPatch(c, fields, [{ from: 'sales', to: 'orders' }, { from: '_sales_', to: 'other' }]).issues.some(i => i.code === 'duplicate_replacement')).toBe(true);
    c.propertyConfig.componentProperty.dimensions = structuredClone(c.propertyConfig.componentProperty.metrics);
    expect(planMetricPatch(c, fields, [{ from: 'sales', to: 'orders', format: 'source' }]).issues[0]?.code).toBe('unsafe_concept');
  });
  it('rejects chart formulas and unsupported result calculations instead of dropping them', () => {
    const c = chart(); c.conceptDefs[0].queryTimeTransformation.dataTransformation.textFormula = 'sales * 2';
    expect(planMetricPatch(c, fields, [{ from: 'sales', to: 'orders', format: 'source' }]).issues[0]?.code).toBe('unsafe_concept');
    delete c.conceptDefs[0].queryTimeTransformation.dataTransformation.textFormula;
    c.conceptDefs[0].resultTransformation = { analyticalFunction: 8 };
    expect(planMetricPatch(c, fields, [{ from: 'sales', to: 'orders', format: 'source' }]).issues[0]?.code).toBe('unsafe_calculation');
  });
});
