import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

function metricsBySlot(component: Json) {
  return Object.fromEntries(component.propertyConfig.componentProperty.metrics.labeledConcepts.map((slot: Json) => [
    slot.key,
    slot.value.conceptNames.map((name: string) => {
      const concept = component.conceptDefs.find((entry: Json) => entry.name === name);
      return {
        data: concept.queryTimeTransformation.dataTransformation,
        display: concept.queryTimeTransformation.displayTransformation,
        result: concept.resultTransformation,
      };
    }),
  ]));
}

describe('scatter metric specification preservation', () => {
  it.each([['scatter', 2], ['scatter', 3], ['bubble', 3]] as const)('preserves %s with %i metric slots through export and apply', async (type, count) => {
    const f = fake();
    const metrics = [
      { field: 'value', aggregation: 'sum', label: 'Amount' },
      { field: 'value', aggregation: 'count_distinct', label: 'Distinct values', calculation: 'percent_of_total', relative_to_base: true, bypass_filters: true },
      { field: 'value', aggregation: 'avg', label: 'Average value' },
    ].slice(0, count);
    const added = await f.add('chart_add', { type, dimensions: ['category'], metrics });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const before = structuredClone(original);
    const exported = await f.exportSpec({ style: 'none' });
    const chart = exported.spec.pages[0].components[0];
    expect(chart.metrics).toEqual(metrics);
    expect(chart.fields).toBeUndefined();
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    expect(metricsBySlot(restored)).toEqual(metricsBySlot(original));
    expect(original).toEqual(before);
  });
});
