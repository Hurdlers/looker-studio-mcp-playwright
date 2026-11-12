import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native KPI styles survive specification recreation', () => {
  it('preserves label visibility, typography, delta colors, alignment and padding instead of taking the creation defaults', async () => {
    const f = fake();
    expect((await f.add('chart_add', { type: 'scorecard', metrics: [{ field: 'value' }] })).isError).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const kpi = original.propertyConfig.componentProperty.kpiMetricProperty;
    Object.assign(kpi, { fontFamily: 'Roboto', fontSize: 30, fontColor: { color: '#FFFFFF', opacity: 1 },
      positiveDeltaColor: { color: '#00B26D', opacity: 1 }, negativeDeltaColor: { color: '#F56A6D', opacity: 1 },
      hideMetric: true, metricAlignment: 2, textAlignment: 2, compareAlignment: 2,
      lineHeight: 48, paddingTop: 48, paddingLeft: 0, paddingRight: 0, compareLabel: 'Prior period' });
    delete kpi.hideCompare;
    const before = structuredClone(kpi);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({
      'Font family': 'Roboto', 'Font size': 30, 'Font color': '#FFFFFF', 'Hide metric name': true,
      'Hide comparison label': true, 'Metric label alignment': 'Center', 'Value alignment': 'Center',
      'Comparison alignment': 'Center', 'Line height': 48, 'Top padding': 48, 'Left padding': 0, 'Right padding': 0,
      'Positive change color': '#00B26D', 'Negative change color': '#F56A6D',
    });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.kpiMetricProperty;
    expect(restored).toMatchObject({ ...before, hideCompare: true });
    expect(kpi).toEqual(before);
  });

  it('keeps explicit false visibility, fractional geometry and automatic line height', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'scorecard', metrics: [{ field: 'value' }] });
    expect(added.isError).not.toBe(true);
    const kpi = (f.original.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.kpiMetricProperty;
    Object.assign(kpi, { hideMetric: false, hideCompare: false, fontSize: 30.5, lineHeight: -1, paddingTop: 16.25, paddingLeft: 0, paddingRight: 2.5,
      metricAlignment: 1, textAlignment: 3, compareAlignment: 2 });
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject({ 'Hide metric name': false, 'Hide comparison label': false,
      'Font size': 30.5, 'Line height': -1, 'Top padding': 16.25, 'Left padding': 0, 'Right padding': 2.5,
      'Metric label alignment': 'Left', 'Value alignment': 'Right', 'Comparison alignment': 'Center' });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    expect((f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.kpiMetricProperty)
      .toMatchObject({ hideMetric: false, hideCompare: false, fontSize: 30.5, lineHeight: -1, paddingTop: 16.25, paddingLeft: 0, paddingRight: 2.5 });
  });
});
