import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, ORIGINAL, SOURCE, column, fake, properties, type Json } from './fake.js';

async function nativeChart() {
  const day = column('_day_', 'day', 2);
  day.outputSemanticInfo.semanticConfig[0].dateTimeOptions = { useNativeDateTime: true };
  const rate = column('_value_', 'value', 14); rate.defaultAggregationType = 6;
  const columns = [column('_category_', 'category'), rate, day];
  const f = fake({ columns });
  f.sources[SOURCE]!.block.datasourceBlock.fields = structuredClone(columns);
  const added = await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value', label: 'Rate' }] });
  expect(added.isError, resultText(added)).toBeFalsy();
  const chart = f.reports[ORIGINAL]!.page[0]!.page.componentConfig![0] as Json;
  const dimension = chart.conceptDefs.find((c: Json) => c.name === properties(chart).dimensions.labeledConcepts[0].value.conceptNames[0]);
  const metric = chart.conceptDefs.find((c: Json) => c.name === properties(chart).metrics.labeledConcepts[0].value.conceptNames[0]);
  dimension.queryTimeTransformation.dataTransformation.transformationConfig = { transformationType: 3 };
  dimension.queryTimeTransformation.displayTransformation = { displayName: 'Month', displayFormat: 'y.MM', outputSemanticInfo: { semanticConfig: [{ semanticType: 3, dateTimeOptions: { useNativeDateTime: true } }] } };
  metric.queryTimeTransformation.displayTransformation.displayFormat = '0.00%';
  chart.conceptDefs.push({ name: 'date-filter', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_day_' } } });
  properties(chart).dateRangeDimension = 'date-filter';
  return { f, chart, dimension, metric };
}

describe('chart-level field formats survive specification recreation', () => {
  it('preserves monthly query grouping, date labels and percent precision without changing source fields', async () => {
    const { f } = await nativeChart();
    const sourceBefore = structuredClone(f.sources[SOURCE]);
    const { spec } = await f.exportSpec({ style: 'all' });
    expect(spec.pages[0].components[0].field_formats).toEqual([
      { field: 'Month', kind: 'dimension', date_granularity: 'Year Month', display_format: 'y.MM' },
      { field: 'Rate', kind: 'metric', display_format: '0.00%' },
    ]);
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).toBeFalsy();
    const after = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    const p = properties(after), defs = after.conceptDefs;
    const dimension = defs.find((c: Json) => c.name === p.dimensions.labeledConcepts[0].value.conceptNames[0]);
    const metric = defs.find((c: Json) => c.name === p.metrics.labeledConcepts[0].value.conceptNames[0]);
    expect(dimension.queryTimeTransformation.dataTransformation.transformationConfig).toEqual({ transformationType: 3 });
    expect(dimension.queryTimeTransformation.displayTransformation).toMatchObject({ displayFormat: 'y.MM', outputSemanticInfo: { semanticConfig: [{ semanticType: 3, dateTimeOptions: { useNativeDateTime: true } }] } });
    expect(metric.queryTimeTransformation.displayTransformation.displayFormat).toBe('0.00%');
    const range = defs.find((c: Json) => c.name === p.dateRangeDimension);
    expect(range.queryTimeTransformation.dataTransformation.transformationConfig).toBeUndefined();
    expect(f.sources[SOURCE]).toEqual(sourceBefore);
  });

  it('clears a chart override without changing its date filter, source or another chart', async () => {
    const { f, chart } = await nativeChart();
    await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value' }] });
    const other = structuredClone(f.reports[ORIGINAL]!.page[0]!.page.componentConfig![1]);
    const source = structuredClone(f.sources[SOURCE]);
    const range = structuredClone(chart.conceptDefs.find((entry: Json) => entry.name === 'date-filter'));
    const updated = await f.add('component_update', { component_id: chart.componentId, field_formats: [
      { field: 'Month', kind: 'dimension', date_granularity: 'Auto' },
      { field: 'Rate', kind: 'metric', display_format: null },
    ] });
    expect(updated.isError, resultText(updated)).toBeFalsy();
    const after = f.reports[ORIGINAL]!.page[0]!.page.componentConfig![0] as Json;
    expect(after.conceptDefs.find((entry: Json) => entry.name === 'date-filter')).toEqual(range);
    expect(after.conceptDefs[0].queryTimeTransformation.dataTransformation.transformationConfig).toBeUndefined();
    expect(after.conceptDefs[0].queryTimeTransformation.displayTransformation).toMatchObject({ outputSemanticInfo: { semanticConfig: [{ semanticType: 2 }] } });
    expect(after.conceptDefs[0].queryTimeTransformation.displayTransformation.displayFormat).toBeUndefined();
    expect(after.conceptDefs[1].queryTimeTransformation.displayTransformation.displayFormat).toBeUndefined();
    expect(f.reports[ORIGINAL]!.page[0]!.page.componentConfig![1]).toEqual(other);
    expect(f.sources[SOURCE]).toEqual(source);
  });

  it.each([
    [{ field: 'missing', display_format: '0.00' }],
    [{ field: 'Rate', kind: 'metric', date_granularity: 'Year Month' }],
    [{ field: 'Month', date_granularity: 'Minute' }],
    [{ field: 'Rate', display_format: '0.0%' }, { field: 'Rate', display_format: '0.00%' }],
    [{ field: 'Rate', display_format: '' }],
    [{ field: 'Rate', display_format: '   ' }],
    [{ field: 'Rate', display_format: 'x'.repeat(129) }],
    [{ field: 'Month', date_granularity: 'Not a date unit' }],
  ])('refuses invalid references, grouping and patterns before saving: %j', async (...entries) => {
    const { f, chart } = await nativeChart(); f.clear();
    const before = structuredClone(chart);
    await expect(f.add('component_update', { component_id: chart.componentId, field_formats: entries })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.writes()).toEqual([]);
    expect(f.reports[ORIGINAL]!.page[0]!.page.componentConfig![0]).toEqual(before);
  });

  it('refuses ambiguous labels before changing either metric', async () => {
    const { f, chart, metric } = await nativeChart();
    const duplicate = structuredClone(metric); duplicate.name = 'second-rate';
    chart.conceptDefs.push(duplicate);
    properties(chart).metrics.labeledConcepts[0].value.conceptNames.push(duplicate.name);
    f.clear();
    await expect(f.add('component_update', { component_id: chart.componentId, field_formats: [{ field: 'Rate', kind: 'metric', display_format: '0%' }] })).rejects.toThrow(/ambiguous/);
    expect(f.writes()).toEqual([]);
  });

  it('does not silently flatten unsupported native query transformations', async () => {
    const { f, dimension } = await nativeChart();
    dimension.queryTimeTransformation.dataTransformation.transformationConfig.transformationType = 17;
    const { spec, text } = await f.exportSpec({ style: 'all' });
    expect(spec.pages[0].components[0].component).toBe('other');
    expect(text).toMatch(/date transformation 17/);
  });
});
