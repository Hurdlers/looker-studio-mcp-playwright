import { describe, expect, it } from 'vitest';

import { exportComponent } from '../../../src/features/spec/components.js';
import { definition, expectInvalid, harness, properties as p, type Json } from './helpers.js';

describe('native chart settings survive reproduction', () => {
  it('exports active zero and metric lines without turning empty native slots into lines', async () => {
    const h = harness();
    const { component } = await h.add('column');
    p(component).barChartProperty.referenceLineProperty = [
      {}, { referenceLineAxis: 0 },
      { referenceLineType: 0, referenceLineNumberValue: 0 },
      { referenceLineType: 1, referenceLineCalculation: 0 },
    ];
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.reference_lines).toEqual([
      { value: 0, type: 'Constant value', axis: 'Left Y-axis', weight: 'Auto' },
      { type: 'Metric', metric: 'uses', calculation: 'Average', axis: 'Left Y-axis', weight: 'Auto' },
    ]);
  });

  it('clears saved reference lines with an explicit empty list and still appends nonempty lists', async () => {
    const h = harness();
    await h.add('column', { reference_lines: [{ value: 0, label: 'Zero' }] });
    await h.update({ reference_lines: [{ value: 12, label: 'Target' }] });
    expect(p(h.last()).barChartProperty.referenceLineProperty.map((line: Json) => line.referenceLineNumberValue)).toEqual([0, 12]);
    await h.update({ reference_lines: [] });
    expect(p(h.last()).barChartProperty.referenceLineProperty).toEqual([]);
    const exported = await exportComponent(h.ctx, h.last(), { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported).not.toHaveProperty('reference_lines');
  });

  it('lets a column chart fill its requested outer width without a fixed template plot width', async () => {
    const h = harness();
    const { component } = await h.add('column', { position: { left: 10, top: 20, width: 940, height: 300 } });
    expect(component.attributeConfig.componentAttribute.width).toBe(940);
    expect(p(component).barChartProperty.chartDisplayProperty ?? {}).not.toHaveProperty('chartAreaWidth');
  });

  it('recreates native scorecard precision and its comparison label through the all-style export', async () => {
    const h = harness();
    const { component } = await h.add('scorecard', { comparison: 'Previous period' });
    Object.assign(p(component).kpiMetricProperty, { primaryDecimalPrecision: 0, compareLabel: '이전 기간과 비교' });
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.style).toMatchObject({ 'Decimal precision': 0, 'Comparison label': '이전 기간과 비교' });
    const { component: copy } = await h.add('scorecard', exported);
    expect(p(copy).kpiMetricProperty).toMatchObject({ primaryDecimalPrecision: 0, compareLabel: '이전 기간과 비교' });
  });

  it('recreates explicit native plot dimensions without rounding fractional pixels', async () => {
    const h = harness();
    const { component } = await h.add('column');
    p(component).barChartProperty.chartDisplayProperty = { chartAreaWidth: 640.5, chartAreaHeight: 155.25 };
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.style).toMatchObject({ 'Chart area width': 640.5, 'Chart area height': 155.25 });
    const { component: copy } = await h.add('column', exported);
    expect(p(copy).barChartProperty.chartDisplayProperty).toEqual({ chartAreaWidth: 640.5, chartAreaHeight: 155.25 });
  });

  it('recreates native column widths without replacing them with the template widths', async () => {
    const h = harness();
    const { component } = await h.add('table');
    p(component).tableProperty.columnsWidth = [41.25, 172.5, 386.25];
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.style?.['Column widths']).toEqual([41.25, 172.5, 386.25]);
    const { component: copy } = await h.add('table', exported);
    expect(p(copy).tableProperty.columnsWidth).toEqual([41.25, 172.5, 386.25]);
  });

  it('binds an explicit second date field even when the chart range stays automatic', async () => {
    const h = harness();
    const { component } = await h.add('scorecard', { date_range_dimension: 'other_day', date_range: 'Auto date range' });
    expect(p(component).dateRangeDimension).toBeTypeOf('string');
    expect(p(component).dateRangeDimension).toBe(definition(component, '_other_day_').name);
    expect(p(component)).not.toHaveProperty('dateDuration');
    expect(h.ctx.ext.updater('date_range_dimension')!.read!(component, h.doc)).toBe('_other_day_');
  });

  it('sorts by a dimension label supplied in the same creation call', async () => {
    const h = harness();
    const { component } = await h.add('table', { labels: { platform: 'Device' }, sort_by: 'Device', sort_ascending: true });
    expect(p(component).sort).toEqual([{ sortColumn: definition(component, '_platform_').name, sortDir: 0 }]);
  });

  it('does not force axes or legend off when the native source leaves them unspecified', async () => {
    const h = harness();
    const { component } = await h.add('column');
    delete p(component).barChartProperty.axisAndGridProperty.showAxis;
    delete p(component).barChartProperty.legendProperty.showLegend;
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    const { component: copy } = await h.add('column', exported);
    expect(p(copy).barChartProperty.axisAndGridProperty).not.toHaveProperty('showAxis');
    expect(p(copy).barChartProperty.legendProperty).not.toHaveProperty('showLegend');
  });

  it('leaves new table columns automatic instead of pinning them to the captured template widths', async () => {
    const h = harness();
    const { component } = await h.add('table', { position: { width: 1200, height: 300 } });
    expect(p(component).tableProperty).not.toHaveProperty('columnsWidth');
  });

  it('starts combo charts without a reference line captured from another chart', async () => {
    const h = harness();
    const { component } = await h.add('combo');
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported).not.toHaveProperty('reference_lines');
  });

  it('keeps a native metric reference line bound to the second metric and its calculation', async () => {
    const h = harness();
    const { component } = await h.add('combo');
    p(component).comboChartProperty.referenceLineProperty = [{
      referenceLineType: 1, referenceLineMetric: definition(component, '_errors_').name, referenceLineCalculation: 4, referenceLineWeight: 1,
    }];
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.reference_lines).toEqual([{ type: 'Metric', metric: 'errors', calculation: 'Max', axis: 'Left Y-axis', weight: 1 }]);
    const { component: copy } = await h.add('combo', exported);
    expect(p(copy).comboChartProperty.referenceLineProperty[0]).toMatchObject({
      referenceLineType: 1, referenceLineMetric: definition(copy, '_errors_').name, referenceLineCalculation: 4, referenceLineWeight: 1,
    });
  });

  it('removes both the date field and explicit duration with None after applying the range', async () => {
    const h = harness();
    await h.add('scorecard', { date_range: 'Last 7 days', date_range_dimension: 'other_day' });
    await h.update({ date_range: 'Last 30 days', date_range_dimension: 'None' });
    expect(p(h.last())).not.toHaveProperty('dateRangeDimension');
    expect(p(h.last())).not.toHaveProperty('dateDuration');
  });

  it('refuses missing or non-date fields and malformed style values before saving', async () => {
    const cases: Array<[string, Json]> = [
      ['column', { date_range_dimension: 'platform' }], ['column', { date_range_dimension: 'missing' }],
      ['scorecard', { style: { 'Decimal precision': 1.5 } }], ['scorecard', { style: { 'Decimal precision': 21 } }],
      ['column', { style: { 'Chart area width': -5 } }], ['table', { style: { 'Column widths': [0, 100] } }],
    ];
    for (const [kind, extra] of cases) {
      const h = harness();
      await expectInvalid(() => h.add(kind, extra));
      expect(h.writes()).toEqual([]);
    }
  });

  it('keeps a percentile metric line and reports unsupported native parameter lines as a loss', async () => {
    const h = harness();
    const { component } = await h.add('combo', { reference_lines: [{ type: 'Metric', metric: 'errors', calculation: 'Percentile', percentile: 80 }] });
    const exported = await exportComponent(h.ctx, component, { doc: h.doc, sources: [], notes: [] }, 'all', new Set());
    expect(exported.reference_lines[0]).toMatchObject({ type: 'Metric', metric: 'errors', calculation: 'Percentile', percentile: 80 });
    p(component).comboChartProperty.referenceLineProperty = [{ referenceLineType: 2, referenceLineParameter: 'threshold' }];
    const state = { doc: h.doc, sources: [], notes: [] as string[] };
    const lost = await exportComponent(h.ctx, component, state, 'all', new Set());
    expect(lost.reference_lines).toBeUndefined();
    expect(state.notes.some((note) => /parameter/i.test(note))).toBe(true);
  });
});
