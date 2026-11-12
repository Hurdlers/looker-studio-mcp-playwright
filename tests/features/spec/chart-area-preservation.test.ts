import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { chartProperty } from '../../../src/features/chart-options/common.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native chart plot geometry survives specification recreation', () => {
  it.each(['time_series', 'column', 'combo'])('preserves explicit plot offsets and dimensions for %s', async (type) => {
    const f = fake();
    const added = await f.add('chart_add', { type, dimensions: ['day'], metrics: [{ field: 'value' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    chartProperty(original).chartDisplayProperty = { chartAreaTop: 55, chartAreaLeft: 68, chartAreaWidth: 570, chartAreaHeight: 180 };
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({
      'Chart area top': 55, 'Chart area left': 68, 'Chart area width': 570, 'Chart area height': 180,
    });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    expect(chartProperty(restored).chartDisplayProperty).toMatchObject(chartProperty(original).chartDisplayProperty);
  });

  it('accepts zero offsets rather than replacing them with automatic positioning', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value' }],
      style: { 'Chart area top': 0, 'Chart area left': 0, 'Chart area width': 570, 'Chart area height': 180 } });
    expect(added.isError, resultText(added)).not.toBe(true);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({ 'Chart area top': 0, 'Chart area left': 0 });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    expect(chartProperty(f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).chartDisplayProperty)
      .toMatchObject({ chartAreaTop: 0, chartAreaLeft: 0, chartAreaWidth: 570, chartAreaHeight: 180 });
  });
});
