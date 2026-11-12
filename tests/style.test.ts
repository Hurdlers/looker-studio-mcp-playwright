import { describe, expect, it } from 'vitest';

import { applyStyle, getPath, labelsFor, planStyle, readStyle, setPath, type StyleLabel, type StyleTable } from '../src/core/style.js';

// A made-up table in the shape groups supply.
const BAR: StyleLabel[] = [
  { label: 'Show data labels', kind: 'toggle', path: 'barChartProperty.showDataLabel' },
  { label: 'Bar color', kind: 'color', path: 'barChartProperty.seriesProperty[0].seriesColor' },
  { label: 'Show axis title', kind: 'toggle', path: 'barChartProperty.xAxis.showTitle' },
  { label: 'Show axis title', kind: 'toggle', path: 'barChartProperty.yAxis.showTitle' },
  { label: 'Hide legend', kind: 'toggle', path: 'barChartProperty.legendProperty.show', invert: true },
  { label: 'Legend position', kind: 'select', path: 'barChartProperty.legendProperty.position', options: { Top: 1, Bottom: 2, Right: 3 } },
  { label: 'Bar width', kind: 'percent', path: 'barChartProperty.barWidth' },
  { label: 'Font size', kind: 'number', path: 'barChartProperty.fontSize', min: 6, max: 96 },
];
const DROPDOWN: StyleLabel[] = [
  { label: 'Drop-down', kind: 'radio', path: 'dimensionFilterProperty.expandable', value: true },
  { label: 'Fixed-size', kind: 'radio', path: 'dimensionFilterProperty.expandable', value: false },
];
const COMMON: StyleLabel[] = [
  { label: 'Background', kind: 'color', path: 'backgroundAndBorderProperty.background' },
  { label: 'Component name', kind: 'text', path: 'attributeConfig.componentAttribute.alias', root: true },
];
const TABLES: StyleTable[] = [
  { type: 'simple-barchart', labels: BAR },
  { type: 'simple-barchart', preset: 'horizontal', labels: BAR.slice(0, 2) },
  { type: 'dimension-filter', labels: DROPDOWN },
  { type: '*', labels: COMMON },
];

const bar = () => ({ type: 'simple-barchart', propertyConfig: { componentProperty: { barChartProperty: { showDataLabel: false, keep: 1 } } } });

describe('style labels', () => {
  it('writes labels to their JSON paths and lists the ones it does not know', () => {
    const c = bar();
    const plan = applyStyle(c, labelsFor(TABLES, 'simple-barchart'), {
      'show data labels': true,
      'Bar color': '#7C4DFF',
      'Show axis title#2': true,
      'Hide legend': true,
      'Legend position': 'bottom',
      'Bar width': '80%',
      'Font size': 14,
      Background: '#abc',
      'Component name': 'Sessions by device',
      'No such label': 1,
    });
    expect(plan.notApplied).toEqual(['No such label']);
    expect((c as Record<string, any>).attributeConfig.componentAttribute.alias).toBe('Sessions by device');
    expect(c.propertyConfig.componentProperty).toEqual({
      barChartProperty: {
        showDataLabel: true,
        keep: 1,
        seriesProperty: [{ seriesColor: { color: '#7C4DFF', opacity: 1 } }],
        yAxis: { showTitle: true },
        legendProperty: { show: false, position: 2 },
        barWidth: 0.8,
        fontSize: 14,
      },
      backgroundAndBorderProperty: { background: { color: '#AABBCC', opacity: 1 } },
    });
  });

  it('refuses a bad value before writing anything', () => {
    const labels = labelsFor(TABLES, 'simple-barchart');
    expect(() => planStyle(labels, { 'Bar color': '#12' })).toThrow(/Bar color.*color like/);
    expect(() => planStyle(labels, { 'Legend position': 'Diagonal' })).toThrow(/"Top", "Bottom", "Right"/);
    expect(() => planStyle(labels, { 'Font size': 200 })).toThrow(/6 to 96/);
    expect(() => planStyle(labels, { 'Show data labels': 'yes' })).toThrow(/true or false/);
    const c = bar();
    expect(() => applyStyle(c, labels, { 'Show data labels': true, 'Bar width': 'wide' })).toThrow();
    expect(c).toEqual(bar());
  });

  it('takes percentages with their %, numbers above 1 as percentages, and 0 to 1 as already divided', () => {
    const labels = labelsFor(TABLES, 'simple-barchart');
    const width = (v: unknown) => planStyle(labels, { 'Bar width': v }).writes[0]!.value;
    expect([width('1%'), width('80%'), width(80), width(0.8), width(1)]).toEqual([0.01, 0.8, 0.8, 0.8, 1]);
    // "1" could be 1% or 100%.
    expect(() => width('1')).toThrow(/with the %/);
  });

  it('checks a color given as an object', () => {
    const labels = labelsFor(TABLES, 'simple-barchart');
    const color = (v: unknown) => planStyle(labels, { 'Bar color': v }).writes[0]!.value;
    expect(color({ color: '#abc', opacity: 0.4 })).toEqual({ color: '#AABBCC', opacity: 0.4 });
    expect(color({ color: '#123456' })).toEqual({ color: '#123456', opacity: 1 });
    expect(() => color({ color: '#123456', opacity: 2 })).toThrow(/opacity from 0 to 1/);
    expect(() => color({ color: 'red' })).toThrow(/color like/);
    expect(() => color({ color: '#123456', alpha: 1 })).toThrow(/color like/);
  });

  it('picks a radio option by its own label', () => {
    const c = { propertyConfig: { componentProperty: {} } };
    applyStyle(c, labelsFor(TABLES, 'dimension-filter'), { 'Fixed-size': true });
    expect(c.propertyConfig.componentProperty).toEqual({ dimensionFilterProperty: { expandable: false } });
    expect(readStyle(c, labelsFor(TABLES, 'dimension-filter'))).toEqual({ 'Fixed-size': true });
  });

  it("uses a preset's own table instead of the type's, then the common labels", () => {
    expect(labelsFor(TABLES, 'simple-barchart', 'horizontal').map((l) => l.label)).toEqual(['Show data labels', 'Bar color', 'Background', 'Component name']);
    expect(labelsFor(TABLES, 'simple-barchart', 'other')).toHaveLength(BAR.length + COMMON.length);
  });

  it('reads a component back into the labels that would make it, for inspect and export', () => {
    const c = bar();
    const labels = labelsFor(TABLES, 'simple-barchart');
    const style = { 'Show data labels': true, 'Bar color': '#7C4DFF', 'Show axis title#2': true, 'Hide legend': true, 'Legend position': 'Bottom', 'Bar width': '80%' };
    applyStyle(c, labels, style);
    expect(readStyle(c, labels)).toEqual(style);
    setPath(c, 'propertyConfig.componentProperty.backgroundAndBorderProperty.background', { color: '#000000', opacity: 0.5 });
    expect(readStyle(c, labels).Background).toEqual({ color: '#000000', opacity: 0.5 });
  });

  it('reads and writes dotted paths with array items', () => {
    const o: Record<string, unknown> = {};
    setPath(o, 'a.b[2].c', 1);
    expect(o).toEqual({ a: { b: [{}, {}, { c: 1 }] } });
    expect(getPath(o, 'a.b[2].c')).toBe(1);
    expect(getPath(o, 'a.x.y')).toBeUndefined();
  });
});


describe('native numeric style preservation', () => {
  const labels: StyleLabel[] = [
    { label: 'Column widths', kind: 'number-array', path: 'tableProperty.columnsWidth', min: Number.MIN_VALUE },
    { label: 'Decimal precision', kind: 'number', path: 'kpiMetricProperty.primaryDecimalPrecision', min: 0, max: 20, integer: true },
  ];
  it('preserves fractional widths without sharing mutable arrays', () => {
    const widths = [32.6959, 452.174];
    const c = {};
    applyStyle(c, labels, { 'Column widths': widths, 'Decimal precision': 0 });
    widths[0] = 999;
    const read = readStyle(c, labels);
    expect(read).toEqual({ 'Column widths': [32.6959, 452.174], 'Decimal precision': 0 });
    (read['Column widths'] as number[])[0] = 888;
    expect(readStyle(c, labels)['Column widths']).toEqual([32.6959, 452.174]);
  });
  it.each([[], [0], [-1], [Infinity], [NaN], ['10'], '10'])('refuses invalid widths %j', value => {
    expect(() => planStyle(labels, { 'Column widths': value })).toThrow();
  });
  it('refuses fractional precision', () => {
    expect(() => planStyle(labels, { 'Decimal precision': 1.5 })).toThrow();
  });
});
