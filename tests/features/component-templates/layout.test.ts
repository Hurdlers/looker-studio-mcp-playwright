import { describe, expect, it } from 'vitest';
import { applyStyle, labelsFor } from '../../../src/core/style.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';
import { planCommonLayout } from '../../../src/features/component-templates/layout.js';

describe('common chart layout policy', () => {
  it('fits captured plot coordinates into the requested box without changing data or axis scale', () => {
    const component = { type: 'simple-linechart', conceptDefs: [{ name: 'revenue' }], propertyConfig: { componentProperty: {
      dimensions: { retained: true },
      lineChartProperty: {
        chartDisplayProperty: { chartAreaWidth: 200, chartAreaHeight: 100, chartAreaLeft: 10, chartAreaTop: 5 },
        axisAndGridProperty: { leftVAxisProperty: { axisLogScale: true, axisViewWindowMax: 1000 } },
      },
    } } };
    const plan = planCommonLayout('time-trend', { width: 360, height: 240 });
    applyStyle(component, labelsFor(styleTables, component.type), plan.style);
    const plot = component.propertyConfig.componentProperty.lineChartProperty.chartDisplayProperty;
    expect(plot.chartAreaLeft + plot.chartAreaWidth).toBeLessThan(360);
    expect(plot.chartAreaTop + plot.chartAreaHeight).toBeLessThan(240);
    expect(plot.chartAreaWidth).toBeGreaterThan(200);
    expect(component.propertyConfig.componentProperty.lineChartProperty.axisAndGridProperty.leftVAxisProperty).toMatchObject({ axisLogScale: true, axisViewWindowMax: 1000 });
    expect(component.conceptDefs).toEqual([{ name: 'revenue' }]);
    expect(component.propertyConfig.componentProperty.dimensions).toEqual({ retained: true });
  });

  it('keeps every table column visible and fits widths including integer rounding', () => {
    const plan = planCommonLayout('detail-table', { width: 421, height: 240 }, { dimensionCount: 1, metricCount: 2 });
    const widths = plan.style['Column widths'] as number[];
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(419);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(80);
    expect(plan.style).toMatchObject({ 'Row numbers': false, 'Rows per page': '1', 'Show pagination': true, 'Compact pagination': true });
    const component = { type: 'simple-table', propertyConfig: { componentProperty: { tableProperty: {} } } };
    expect(() => applyStyle(component, labelsFor(styleTables, component.type), plan.style)).not.toThrow();
  });

  it('rejects areas that cannot fit requested columns instead of dropping data roles', () => {
    expect(() => planCommonLayout('detail-table', { width: 320, height: 240 }, { dimensionCount: 1, metricCount: 4 })).toThrow('at least 402px');
    expect(() => planCommonLayout('time-trend', { width: 100, height: 240 })).toThrow('width');
    expect(() => planCommonLayout('kpi', { width: 280, height: Number.NaN })).toThrow('height');
  });

  it('uses accepted native KPI layout settings without hardcoding color or font family', () => {
    const small = planCommonLayout('kpi', { width: 180, height: 100 });
    const large = planCommonLayout('kpi', { width: 500, height: 240 });
    expect(Number(small.style['Font size'])).toBeLessThan(Number(large.style['Font size']));
    expect(small.style).not.toHaveProperty('Font color');
    expect(small.style).not.toHaveProperty('Font family');
    const component = { type: 'kpi-metric', propertyConfig: { componentProperty: { kpiMetricProperty: {} } } };
    expect(() => applyStyle(component, labelsFor(styleTables, component.type), small.style)).not.toThrow();
  });
});

it('uses an opt-in compact presentation without hardcoding a customer palette', () => {
  const plain = planCommonLayout('time-trend', { width: 600, height: 280 }, { metricCount: 1 }, { density: 'compact', surface: 'plain' });
  expect(plain.style).toMatchObject({ 'Display legend': false, 'Show points': false, Background: 'transparent', 'Add border shadow': false });
  expect(planCommonLayout('time-trend', { width: 600, height: 280 }, { metricCount: 2 }, { density: 'compact' }).style['Display legend']).toBe(true);
  expect(planCommonLayout('time-trend', { width: 600, height: 280 }, { metricCount: 1, hasBreakdown: true }, { density: 'compact' }).style['Display legend']).toBe(true);
  expect(planCommonLayout('time-trend').style['Show points']).toBe(true);
  expect(JSON.stringify(plain.style)).not.toMatch(/#[0-9a-f]{6}/i);
});

it('plans displayed table rows and height together without hiding pagination', () => {
  const table = planCommonLayout('detail-table', undefined, {}, { density: 'compact', visibleRows: 5 });
  expect(table.height).toBe(204);
  expect(table.style).toMatchObject({ 'Rows per page': '5', 'Data row height': 28, 'Show pagination': true });
  expect(() => planCommonLayout('detail-table', { width: 600, height: 204 }, {}, { density: 'compact', visibleRows: 20 })).toThrow(/too small/);
  expect(() => planCommonLayout('kpi', undefined, {}, { visibleRows: 5 })).toThrow(/only/);
});

it('leaves room for a localized final date tick in a compact plot', () => {
  const plan = planCommonLayout('time-trend', { width: 552, height: 260 }, {}, { density: 'compact' });
  expect(552 - Number(plan.style['Chart area left']) - Number(plan.style['Chart area width'])).toBeGreaterThanOrEqual(48);
  expect(plan.style).not.toHaveProperty('X-axis max');
});
