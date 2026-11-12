import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native line and axis appearance survives specification recreation', () => {
  it('preserves point visibility, solid/dashed styles, gradients and hidden axis lines including false and zero', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value' }, { field: 'value', aggregation: 'avg' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const chart = f.original.page[0]!.page.componentConfig![0] as Json;
    const line = chart.propertyConfig.componentProperty.lineChartProperty;
    line.smoothCurve = true;
    Object.assign(line.seriesProperty[0], { seriesShowPoints: false, seriesLineStyle: 0, seriesLineGradient: true });
    Object.assign(line.seriesProperty[1], { seriesShowPoints: true, seriesLineStyle: 2, seriesLineGradient: false });
    Object.assign(line.axisAndGridProperty, { hAxisProperty: { showAxisLine: true },
      leftVAxisProperty: { showAxisLine: false, axisViewWindowMin: 0 }, rightVAxisProperty: { showAxisLine: false },
      axisLineColor: { color: '#EEEFFF', opacity: 1 } });
    const before = structuredClone(line);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({
      'Show points': false, 'Show points#2': true, 'Line style': 'Dashed', 'Line style#2': 'Solid',
      'Line gradient': true, 'Line gradient#2': false, 'Show axis line': true, 'Show axis line#2': false,
      'Show axis line#3': false, 'Axis line color': '#EEEFFF', 'Axis min#2': 0,
      'Smooth curve': true,
    });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.lineChartProperty;
    expect(restored.smoothCurve).toBe(true);
    expect(restored.seriesProperty[0]).toMatchObject({ seriesShowPoints: false, seriesLineStyle: 0, seriesLineGradient: true });
    expect(restored.seriesProperty[1]).toMatchObject({ seriesShowPoints: true, seriesLineStyle: 2, seriesLineGradient: false });
    expect(restored.axisAndGridProperty).toMatchObject({ hAxisProperty: { showAxisLine: true },
      leftVAxisProperty: { showAxisLine: false, axisViewWindowMin: 0 }, rightVAxisProperty: { showAxisLine: false },
      axisLineColor: { color: '#EEEFFF', opacity: 1 } });
    expect(line).toEqual(before);
  });
});
