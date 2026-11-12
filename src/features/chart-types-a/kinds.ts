import { blankTemplate, setSlot, template } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import type { ChartKind } from '../../core/extensions.js';

type Json = Record<string, any>;

interface Definition {
  key: string;
  type: string;
  preset: string;
  title: string;
  dimensions?: [number, number];
  metrics?: [number, number];
  date?: boolean;
  configure?(component: Json, spec: Json): void;
}

const p = (c: Json): Json => c.propertyConfig.componentProperty;
const DATE_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 36, 37, 38, 39, 40]);

function tableColumns(c: Json, key: string, colType: number, count: number): void {
  const prop = (p(c)[key] ??= {});
  const previous: Json[] = prop.tableMetricProperty ?? [];
  prop.tableMetricProperty = Array.from({ length: Math.max(count, previous.length) }, (_, i) => ({ ...previous[i], colType }));
}

function series(c: Json, kind: (index: number) => number): void {
  const prop = (p(c).comboChartProperty ??= {});
  const previous: Json[] = prop.seriesProperty ?? [];
  prop.seriesProperty = Array.from({ length: 20 }, (_, i) => ({ ...previous[i], seriesType: kind(i) }));
}

function bar(orientation: number, stacked = false, percent = false): NonNullable<Definition['configure']> {
  return (c, spec) => {
    Object.assign(p(c).barChartProperty, { orientation, showStack: stacked, show100Stack: percent });
    if (breakdownOf(spec)) p(c).row = 1000;
  };
}

function area(stacked: boolean, percent = false): NonNullable<Definition['configure']> {
  return (c) => Object.assign(p(c).areaChartProperty, { showStack: stacked, show100Stack: percent });
}

function pivot(colType: number): NonNullable<Definition['configure']> {
  return (c, spec) => {
    setSlot(c, 'dimensions', 'primary', spec.concepts.dimensions);
    const config = (p(c).pivotTableProperty.pivotDisplayConfig ??= {});
    config.row = spec.concepts.dimensions.map((d: Json) => ({ sort: [{ sortColumn: d.name, sortDir: 0 }] }));
    config.col = [];
    config.hierarchy = [];
    tableColumns(c, 'pivotTableProperty', colType, spec.metrics.length);
  };
}

function breakdownOf(spec: Json): boolean {
  return spec.breakdown !== undefined || Object.entries(spec.fields ?? {}).some(([title, refs]) =>
    /^(breakdown|breakdown dimension)$/i.test(title.trim()) && (refs as string[]).length > 0,
  );
}

const definitions: Definition[] = [
  ...(['table', 'table_bars', 'table_heatmap'] as const).map((key, i) => ({
    key, type: 'simple-table', preset: ['default', 'bar', 'heatmap'][i]!,
    title: ['Table', 'Table with bars', 'Table with heatmap'][i]!,
    dimensions: [1, 100] as [number, number],
    configure: (c: Json, s: Json) => tableColumns(c, 'tableProperty', [2, 0, 1][i]!, s.metrics.length),
  })),
  { key: 'scorecard', type: 'kpi-metric', preset: 'default', title: 'Scorecard', dimensions: [0, 0], metrics: [1, 1] },
  { key: 'scorecard_compact', type: 'kpi-metric', preset: 'compact-numbers', title: 'Scorecard with compact numbers', dimensions: [0, 0], metrics: [1, 1],
    configure: (c) => { p(c).kpiMetricProperty.compactNumbers = true; } },
  { key: 'scorecard_dimension', type: 'kpi-metric', preset: 'dimension-mode', title: 'Scorecard with dimension', dimensions: [1, 1], metrics: [0, 0] },
  { key: 'time_series', type: 'simple-linechart', preset: 'default', title: 'Time series chart', date: true },
  { key: 'smoothed_time_series', type: 'simple-linechart', preset: 'smoothed', title: 'Smoothed time series chart', date: true,
    configure: (c) => { p(c).lineChartProperty.smoothCurve = true; } },
  { key: 'column', type: 'simple-barchart', preset: 'default', title: 'Column chart', configure: bar(0) },
  { key: 'stacked_column', type: 'simple-barchart', preset: 'horizontal-stacked', title: 'Stacked column chart', configure: bar(0, true) },
  { key: 'stacked_100_column', type: 'simple-barchart', preset: 'horizontal-stacked-100', title: '100% stacked column chart', configure: bar(0, true, true) },
  { key: 'bar', type: 'simple-barchart', preset: 'vertical', title: 'Bar chart', configure: bar(1) },
  { key: 'stacked_bar', type: 'simple-barchart', preset: 'vertical-stacked', title: 'Stacked bar chart', configure: bar(1, true) },
  { key: 'stacked_100_bar', type: 'simple-barchart', preset: 'vertical-stacked-100', title: '100% stacked bar chart', configure: bar(1, true, true) },
  { key: 'pie', type: 'simple-piechart', preset: 'default', title: 'Pie chart', metrics: [1, 1] },
  { key: 'donut', type: 'simple-piechart', preset: 'donut', title: 'Donut chart', metrics: [1, 1],
    configure: (c) => { p(c).pieChartProperty.pieHole = 0.55; } },
  { key: 'line', type: 'simple-combochart', preset: 'line', title: 'Line chart', configure: (c, s) => { series(c, () => 0); if (breakdownOf(s)) p(c).row = 1000; } },
  { key: 'smoothed_line', type: 'simple-combochart', preset: 'smoothed', title: 'Smoothed line chart',
    configure: (c, s) => { series(c, () => 0); p(c).comboChartProperty.smoothCurve = true; if (breakdownOf(s)) p(c).row = 1000; } },
  { key: 'area', type: 'simple-areachart', preset: 'horizontal', title: 'Area chart', date: true, metrics: [1, 1], configure: area(false) },
  { key: 'stacked_area', type: 'simple-areachart', preset: 'default', title: 'Stacked area chart', date: true, metrics: [1, 1], configure: area(true) },
  { key: 'stacked_100_area', type: 'simple-areachart', preset: 'horizontal-stacked-100', title: '100% stacked area chart', date: true, metrics: [1, 1], configure: area(true, true) },
  { key: 'combo', type: 'simple-combochart', preset: 'default', title: 'Combo chart',
    configure: (c, s) => { series(c, (i) => i === 0 ? 1 : 0); if (breakdownOf(s)) p(c).row = 1000; } },
  { key: 'stacked_combo', type: 'simple-combochart', preset: 'line-combo-stacked', title: 'Stacked combo chart',
    configure: (c, s) => { p(c).comboChartProperty.showStack = true; if (breakdownOf(s)) p(c).row = 1000; } },
  { key: 'pivot_table', type: 'pivot-table', preset: 'default', title: 'Pivot table', dimensions: [1, 12], configure: pivot(2) },
  { key: 'pivot_bars', type: 'pivot-table', preset: 'bar', title: 'Pivot table with bars', dimensions: [1, 12], configure: pivot(0) },
  { key: 'pivot_heatmap', type: 'pivot-table', preset: 'heatmap', title: 'Pivot table with heatmap', dimensions: [1, 12], configure: pivot(1) },
  { key: 'scatter', type: 'simple-scatterchart', preset: 'default', title: 'Scatter chart', metrics: [2, 3],
    configure: (c, s) => { ['x_metric', 'y_metric', 'bubble_size'].forEach((key, i) => setSlot(c, 'metrics', key, s.concepts.metrics[i] ? [s.concepts.metrics[i]] : [])); } },
];

function count(key: string, field: string, value: number, range: [number, number]): void {
  if (value < range[0] || value > range[1])
    throw new LookerError('invalid', `${key} needs ${range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`} ${field}; received ${value}. Adjust the fields before adding the chart.`);
}

export const chartKinds: ChartKind[] = definitions.map((d) => ({
  key: d.key, type: d.type, preset: d.preset, title: d.title,
  build: (spec) => {
    count(d.key, 'dimensions', spec.dimensions.length, d.dimensions ?? [1, 1]);
    count(d.key, 'metrics', spec.metrics.length, d.metrics ?? [1, 20]);
    if (d.date && !spec.fields_of.dimensions.every((f: Json) => DATE_TYPES.has(f.semanticType)))
      throw new LookerError('invalid', `${d.key} requires a date dimension. Choose a field whose type is Date or Date & Time.`);
    if (breakdownOf(spec) && ['simple-barchart', 'simple-combochart', 'simple-linechart'].includes(d.type) && spec.metrics.length !== 1)
      throw new LookerError('invalid', `${d.key} accepts one metric when a breakdown dimension is used. Remove the extra metrics or the breakdown.`);
    if (d.type === 'pivot-table') {
      const columns = Object.entries(spec.fields ?? {}).find(([name]) => name.trim().toLowerCase() === 'column dimension')?.[1] as string[] | undefined;
      count(d.key, 'row and column dimensions', spec.dimensions.length + (columns?.length ?? 0), [1, 12]);
    }
    const c = blankTemplate(template(d.type, d.preset));
    c.type = d.type;
    c.preset = d.preset;
    d.configure?.(c, spec);
    return c;
  },
}));
