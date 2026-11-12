import { describe, expect, it } from 'vitest';

import { toMapValue } from '../../../src/core/mapvalue.js';
import { resultText } from '../../../src/core/tool.js';
import { themeContent } from '../../../src/features/theme/theme.js';
import { CREATED, fake, type Json } from './fake.js';

describe('line rendering defaults inherited from the native theme', () => {
  it.each(['auto', 2, 0])('preserves theme line weight %s, axis line color, grid defaults and explicit label layout', async (weight) => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const report = f.original.report as Json;
    ((report.propertyConfig ??= {}).reportProperty ??= {}).themeConfig = 'native-test-theme';
    report.resource.theme = { value: [toMapValue({ id: 'native-test-theme', content: {
      version: 1, themeLineWeight: weight, themeAxisLineColor: { color: '#B8B8B8', opacity: 1 }, themeShowHGridLine: false, isModernTheme: weight === 'auto',
    } })] };
    const line = (f.original.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.lineChartProperty;
    line.legendProperty = { alignToGrid: weight === 'auto' };
    line.axisAndGridProperty.labelFontSize = -1;
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.theme.settings).toMatchObject({ 'Line weight': weight === 'auto' ? 'Auto' : weight === 0 ? 'None' : '2',
      'Axis line color': '#B8B8B8', 'Show X-axis gridlines': false, 'Modern chart styling': weight === 'auto' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({ 'Align legend with grid': weight === 'auto', 'Data label font size': -1 });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    expect(themeContent(f.reports[CREATED]!)).toMatchObject({ themeLineWeight: weight, themeAxisLineColor: { color: '#B8B8B8', opacity: 1 }, themeShowHGridLine: false, isModernTheme: weight === 'auto' });
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.lineChartProperty;
    expect(restored.legendProperty.alignToGrid).toBe(weight === 'auto');
    expect(restored.axisAndGridProperty.labelFontSize).toBe(-1);
    expect(restored.seriesProperty[0].seriesLineWeight).toBeUndefined();
  });

  it('does not invent modern rendering mode when the original theme has no such setting', async () => {
    const f = fake();
    const report = f.original.report as Json;
    ((report.propertyConfig ??= {}).reportProperty ??= {}).themeConfig = 'unspecified-theme';
    report.resource.theme = { value: [toMapValue({ id: 'unspecified-theme', content: { version: 1 } })] };
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.theme.settings ?? {}).not.toHaveProperty('Modern chart styling');
  });
});
