import { describe, expect, it } from 'vitest';

import { blankTemplate, template } from '../../../src/core/components.js';
import { prepareProjectPresentation, projectThemeUpdater } from '../../../src/features/component-templates/presentation.js';

describe('project theme presentation', () => {
  it('releases fixture series colors and grid without changing data, rules or layout', () => {
    const chart = blankTemplate(template('simple-linechart'));
    const p = chart.propertyConfig.componentProperty;
    p.dimensions = { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['day'] } }] };
    p.filters = ['paid-orders'];
    p.lineChartProperty.chartDisplayProperty = { chartAreaWidth: 420, chartAreaHeight: 180, chartBackground: { color: '#fff' } };
    p.lineChartProperty.axisAndGridProperty.leftVAxisProperty = { axisLogScale: true, axisViewWindowMin: 1, axisLabelsFont: 'Roboto' };
    p.lineChartProperty.referenceLineProperty = [{ referenceLineNumberValue: 100, referenceLineColor: { color: '#ff0000' } }];
    p.lineChartProperty.coordinatedColoring = 3;
    p.lineChartProperty.axisAndGridProperty.gridColor = { color: '#cccccc' };
    const before = structuredClone(chart);
    const result = prepareProjectPresentation(chart);
    const q = result.propertyConfig.componentProperty.lineChartProperty;

    expect(q.seriesProperty.every((s: Record<string, unknown>) => !('seriesColor' in s))).toBe(true);
    expect(q.axisAndGridProperty.gridColor).toBeUndefined();
    expect(q.chartDisplayProperty).toEqual({ chartAreaWidth: 420, chartAreaHeight: 180 });
    expect(q.axisAndGridProperty.leftVAxisProperty).toEqual({ axisLogScale: true, axisViewWindowMin: 1 });
    expect(q.referenceLineProperty).toEqual(p.lineChartProperty.referenceLineProperty);
    expect(q.coordinatedColoring).toBe(3);
    expect(q.seriesProperty[0].seriesCumulative).toBe(false);
    expect(result.propertyConfig.componentProperty.dimensions).toEqual(p.dimensions);
    expect(result.propertyConfig.componentProperty.filters).toEqual(p.filters);
    expect(chart).toEqual(before);
    expect(projectThemeUpdater.read?.(chart, {} as never)).toBeUndefined();
    expect(projectThemeUpdater.read?.(result, {} as never)).toBe(true);
    p.lineChartProperty.axisAndGridProperty.gridColor = { color: 'transparent', opacity: 0 };
    expect(prepareProjectPresentation(chart).propertyConfig.componentProperty.lineChartProperty.axisAndGridProperty.gridColor).toEqual({ color: 'transparent', opacity: 0 });
  });

  it('lets table headings and body follow the theme while preserving semantic cell colors and formats', () => {
    const chart = blankTemplate(template('simple-table'));
    const p = chart.propertyConfig.componentProperty.tableProperty;
    p.tableMetricProperty = [
      { colType: 2, colColor: { color: '#000' }, compactNumbers: false, colAlignment: 3 },
      { colType: 1, colColor: { color: '#f00' }, compactNumbers: true },
    ];
    p.columnsWidth = [120, 160, 100];
    p.fontFamily = 'Roboto';
    p.fontSize = 14;
    p.oddRowColor = { color: '#fff' };
    const before = structuredClone(chart);
    const q = prepareProjectPresentation(chart).propertyConfig.componentProperty.tableProperty;
    expect(q.headerColor).toBeUndefined();
    expect(q.headerFontColor).toBeUndefined();
    expect(q.oddRowColor).toBeUndefined();
    expect(q.fontFamily).toBeUndefined();
    expect(q.fontSize).toBe(14);
    expect(q.columnsWidth).toEqual([120, 160, 100]);
    expect(q.tableMetricProperty).toEqual([
      { colType: 2, compactNumbers: false, colAlignment: 3 },
      { colType: 1, colColor: { color: '#f00' }, compactNumbers: true },
    ]);
    expect(chart).toEqual(before);
  });

  it('retains KPI precision, comparison colors and sizing while releasing ordinary typography', () => {
    const chart = blankTemplate(template('kpi-metric'));
    const p = chart.propertyConfig.componentProperty.kpiMetricProperty;
    Object.assign(p, { fontColor: { color: '#222' }, fontFamily: 'Roboto', primaryDecimalPrecision: 2,
      positiveDeltaColor: { color: '#0f0' }, negativeDeltaColor: { color: '#f00' },
      backgroundAndBorderProperty: { background: { color: '#fff' } } });
    const q = prepareProjectPresentation(chart).propertyConfig.componentProperty.kpiMetricProperty;
    expect(q.fontColor).toBeUndefined();
    expect(q.backgroundAndBorderProperty).toBeUndefined();
    expect(q.positiveDeltaColor).toEqual({ color: '#0f0' });
    expect(q.negativeDeltaColor).toEqual({ color: '#f00' });
    expect(q.primaryDecimalPrecision).toBe(2);
    expect(q.fontSize).toBe(p.fontSize);
    expect(q.paddingLeft).toBe(p.paddingLeft);
  });

  it('refuses unrelated component types instead of clearing their appearance', () => {
    expect(() => prepareProjectPresentation({ type: 'button' })).toThrow(/only for supported common chart/);
  });
});
