import { describe, expect, it } from 'vitest';
import { applyStyle, labelsFor, readStyle } from '../../../src/core/style.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';
import { planReportAppearance } from '../../../src/features/component-templates/report-appearance.js';
import type { Json } from '../spec/fake.js';
const theme = { background: '#F1F2F3', text: '#123456', muted: '#456789', accent: '#ABCDEF', activeText: '#FFFFFF', series: '#2468AC', font: 'Tahoma' };
const cases = [
  ['common-kpi', 'kpi-metric', 'kpiMetricProperty'],
  ['common-time-trend', 'simple-linechart', 'lineChartProperty'],
  ['common-category-line', 'simple-combochart', 'comboChartProperty'],
  ['common-detail-table', 'simple-table', 'tableProperty'],
] as const;
describe('outlined report presentation profile', () => {
  it.each(cases)('applies only supported native style keys for %s and preserves data', (id, type, property) => {
    const data = { metrics: { kept: true }, dimensions: { kept: true }, row: 5, sort: [{ sortColumn: 'metric', sortDir: 1 }], dateDuration: { startAnchor: '20261101', endAnchor: '20261103' } };
    const component: Json = { type, datasourceId: 'source', conceptDefs: [{ name: 'metric', formula: 'unchanged' }], propertyConfig: { componentProperty: { ...structuredClone(data), [property]: {
      tableMetricProperty: [{ colType: 0 }, { colType: 1 }], seriesProperty: [{ seriesType: 0 }],
    } } } };
    const style = planReportAppearance(id, theme), labels = labelsFor(styleTables, type);
    if (type === 'simple-linechart' || type === 'simple-combochart') expect(style['Line gradient']).toBe(false);
    for (const key of Object.keys(style)) expect(labels.some(label => label.label === key.replace(/#\d+$/, ''))).toBe(true);
    applyStyle(component, labels, style);
    expect(readStyle(component, labels)).toMatchObject(type === 'kpi-metric' ? { 'Title font size': 14, 'Title alignment': 'Center' } : { 'Title font size': 18, 'Title alignment': 'Left' });
    const prop = component.propertyConfig.componentProperty;
    for (const [key,value] of Object.entries(data)) expect(prop[key]).toEqual(value);
    expect(component.datasourceId).toBe('source'); expect(component.conceptDefs).toEqual([{ name: 'metric', formula: 'unchanged' }]);
    expect(prop[property].tableMetricProperty.map((c: Json) => c.colType)).toEqual([0,1]);
    if (type === 'simple-table') expect(prop[property]).toMatchObject({ fontSize: 16, headerFontSize: 16, dataRowHeight: 32, headerRowHeight: 32, headerColor: { color: theme.text }, headerFontColor: { color: theme.background }, tableMetricProperty: [{ colType: 0, colColor: { color: theme.series }, colShowNumber: true }, { colType: 1, colColor: { color: theme.series } }] });
    if (type === 'simple-linechart' || type === 'simple-combochart') expect(prop[property]).toMatchObject({ axisAndGridProperty: { axisFontSize: 14, labelFontSize: 14, hAxisProperty: { axisLabelsFont: theme.font } }, legendProperty: { legendFontSize: 14, legendFontFamily: theme.font }, seriesProperty: [{ seriesColor: { color: theme.text }, labelStyleProperty: { labelsFontFamily: theme.font } }] });
    expect(style).not.toHaveProperty('Rows per page'); expect(style).not.toHaveProperty('Metric column type');
  });
  it('uses destination role colors and fonts for different themes without mutating them', () => {
    const other = { ...theme, background: '#101112', text: '#E1E2E3', accent: '#789ABC', font: 'Arial' }, before = structuredClone(other);
    for (const t of [theme, other]) {
      expect(planReportAppearance('common-kpi', t)).toMatchObject({ 'Font family': t.font, 'Font color': t.text });
      expect(planReportAppearance('common-category-line', t)).toMatchObject({ 'Line color': t.text, 'Legend font family': t.font, 'Axis label font family#2': t.font, 'Data label font family': t.font });
      expect(planReportAppearance('common-detail-table', t)).toMatchObject({ 'Header background color': t.text, 'Header font color': t.background, 'Metric column color': t.series, 'Metric column color#2': t.series });
    }
    expect(other).toEqual(before);
  });
  it('keeps KPI emphasis size decisions and shared alignment', () => {
    expect(planReportAppearance('common-kpi', theme)).toMatchObject({ 'Font size': 26, 'Value alignment': 'Center', 'Metric label alignment': 'Center', 'Comparison alignment': 'Center' });
    for (const width of [200, 400]) {
      const size = { width, height: 120 };
      expect(planReportAppearance('common-kpi', theme, {}, size)).toMatchObject({ 'Font size': width < 220 ? 20 : 26, 'Title font size': 14, 'Title alignment': 'Center' });
      for (const emphasis of ['primary', 'secondary'] as const) expect(planReportAppearance('common-kpi', theme, { emphasis }, size)).not.toHaveProperty('Font size');
    }
  });
  it('gives only the time-series profile an opaque theme-colored label box', () => {
    expect(planReportAppearance('common-time-trend', theme)).toMatchObject({ 'Data label background color': theme.background, 'Data label background opacity': 1 });
    expect(planReportAppearance('common-category-line', theme)).not.toHaveProperty('Data label background color');
    expect(planReportAppearance('common-category-line', theme)).not.toHaveProperty('Data label background opacity');
  });
  it('aligns axis legends without changing visibility or circular chart positioning', () => {
    for (const id of ['common-time-trend', 'common-category-line', 'common-category-bars', 'common-area-trend', 'common-mixed-series', 'common-xy-scatter']) {
      const style = planReportAppearance(id, theme);
      expect(style).toMatchObject({ 'Legend position': 'Top', 'Legend alignment': 'Start' });
      expect(style).not.toHaveProperty('Display legend');
    }
    const pie = planReportAppearance('common-radial-share', theme);
    expect(pie).not.toHaveProperty('Legend position');
    expect(pie).not.toHaveProperty('Legend alignment');
  });
  it('refuses unsupported templates instead of silently assigning another chart profile', () => {
    for (const id of ['common-overview-section', 'common-navbar', 'unknown']) expect(() => planReportAppearance(id, theme)).toThrow(/does not support/);
  });
});
