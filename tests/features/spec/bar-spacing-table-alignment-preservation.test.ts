import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('bar spacing and table alignment recreation', () => {
  it.each([undefined, 0, 80, 100])('preserves bar group width %s including theme inheritance', async (width) => {
    const f = fake();
    await f.add('chart_add', { type: 'stacked_100_column', dimensions: ['category'], metrics: [{ field: 'value' }] });
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const bar = original.propertyConfig.componentProperty.barChartProperty;
    if (width === undefined) delete bar.customBarSpacingProperty;
    else bar.customBarSpacingProperty = { groupBarWidth: width };
    const exported = await f.exportSpec({ style: 'all' });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.barChartProperty;
    expect(restored.customBarSpacingProperty?.groupBarWidth).toBe(width);
    expect(exported.spec.pages[0].components[0].style['Group bar width']).toBe(width ?? 'Auto');
  });

  it.each([['Left', 1], ['Center', 2], ['Right', 3]] as const)('preserves %s alignment only for active table columns', async (label, alignment) => {
    const f = fake();
    await f.add('chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }] });
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const table = original.propertyConfig.componentProperty.tableProperty;
    table.tableDimensionProperty = [{ dimAlignment: alignment }, { dimAlignment: 2 }];
    table.tableMetricProperty[0].colAlignment = alignment;
    table.tableMetricProperty[1].colAlignment = 2;
    const exported = await f.exportSpec({ style: 'all' });
    const style = exported.spec.pages[0].components[0].style;
    expect(style['Dimension column alignment']).toBe(label);
    expect(style['Metric column alignment']).toBe(label);
    expect(style['Dimension column alignment#2']).toBeUndefined();
    expect(style['Metric column alignment#2']).toBeUndefined();
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.tableProperty;
    expect(restored.tableDimensionProperty[0].dimAlignment).toBe(alignment);
    expect(restored.tableMetricProperty[0].colAlignment).toBe(alignment);
  });
});
