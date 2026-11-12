import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native breakdown bar display survives specification recreation', () => {
  it('preserves percentage labels and positional colors beyond the single metric slot', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'stacked_100_column', dimensions: ['day'], metrics: [{ field: 'value' }], breakdown: 'category' });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const bar = original.propertyConfig.componentProperty.barChartProperty;
    bar.coordinatedColoring = 2;
    bar.showDataLabel = true;
    bar.dataLabelStyle = 1;
    bar.seriesProperty[0].seriesColor = { color: '#E99D60', opacity: 1 };
    bar.seriesProperty[1].seriesColor = { color: '#4CAF50', opacity: 1 };
    bar.seriesProperty[19].seriesColor = { color: '#713355', opacity: 0.4 };
    const before = structuredClone(original);
    const exported = await f.exportSpec({ style: 'all' });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.barChartProperty;
    expect(restored.coordinatedColoring).toBe(2);
    expect(restored.dataLabelStyle).toBe(1);
    expect(restored.seriesProperty[0].seriesColor).toEqual(bar.seriesProperty[0].seriesColor);
    expect(restored.seriesProperty[1].seriesColor).toEqual(bar.seriesProperty[1].seriesColor);
    expect(restored.seriesProperty[19].seriesColor).toEqual(bar.seriesProperty[19].seriesColor);
    expect(exported.spec.pages[0].components[0].style).toMatchObject({ 'Color by': 'Bar order', 'Show data labels as': 'Percentage', 'Bar color#2': '#4CAF50' });
    expect(exported.spec.pages[0].components[0].metrics).toHaveLength(1);
    expect(original).toEqual(before);
  });

  it.each([['Single color', 1], ['Bar order', 2], ['Dimension values', 3]] as const)('accepts %s and numeric label mode without changing the metric', async (mode, native) => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'column', dimensions: ['category'], metrics: [{ field: 'value' }], style: { 'Color by': mode, 'Show data labels as': 'Number', 'Bar color#2': '#112233' } });
    expect(added.isError, resultText(added)).not.toBe(true);
    const bar = (f.original.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.barChartProperty;
    expect(bar.coordinatedColoring).toBe(native);
    expect(bar.dataLabelStyle).toBe(0);
    expect(bar.seriesProperty[1].seriesColor).toEqual({ color: '#112233', opacity: 1 });
  });
});
