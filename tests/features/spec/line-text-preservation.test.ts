import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native line text and grid styles survive specification recreation', () => {
  it('preserves explicitly selected fonts, false bold/italic values and hidden gridlines', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value' }, { field: 'value', aggregation: 'avg' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const chart = f.original.page[0]!.page.componentConfig![0] as Json;
    const line = chart.propertyConfig.componentProperty.lineChartProperty;
    line.legendProperty = { ...(line.legendProperty ?? {}), legendFontFamily: 'Roboto' };
    Object.assign(line.axisAndGridProperty, {
      hAxisProperty: { axisLabelsFont: 'Roboto', axisLabelsBold: false, axisLabelsItalic: false },
      leftVAxisProperty: { axisLabelsFont: 'Arial', axisLabelsBold: true, axisLabelsItalic: false },
      rightVAxisProperty: { axisLabelsFont: 'Roboto', axisLabelsBold: false, axisLabelsItalic: true },
      showHGridLine: false, showLeftVGridLine: false, showRightVGridLine: false,
    });
    line.seriesProperty[0].labelStyleProperty = { labelsFontFamily: 'Roboto' };
    line.seriesProperty[1].labelStyleProperty = { labelsFontFamily: 'Arial' };
    const before = structuredClone(line);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({
      'Legend font family': 'Roboto',
      'Axis label font family': 'Roboto', 'Axis label font family#2': 'Arial', 'Axis label font family#3': 'Roboto',
      'Bold axis labels': false, 'Bold axis labels#2': true, 'Bold axis labels#3': false,
      'Italic axis labels': false, 'Italic axis labels#2': false, 'Italic axis labels#3': true,
      'Data label font family': 'Roboto', 'Data label font family#2': 'Arial',
      'Show X-axis gridlines': false, 'Show left Y-axis gridlines': false, 'Show right Y-axis gridlines': false,
    });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.lineChartProperty;
    expect(restored.legendProperty.legendFontFamily).toBe('Roboto');
    expect(restored.axisAndGridProperty).toMatchObject(before.axisAndGridProperty);
    expect(restored.seriesProperty[0].labelStyleProperty.labelsFontFamily).toBe('Roboto');
    expect(restored.seriesProperty[1].labelStyleProperty.labelsFontFamily).toBe('Arial');
    expect(line).toEqual(before);
  });
});
