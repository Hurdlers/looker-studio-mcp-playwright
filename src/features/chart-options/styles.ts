import type { StyleLabel, StyleTable } from '../../core/style.js';
import { PROPERTIES } from './common.js';

type ChartLabel = StyleLabel & { hex?: true };
const ROW_COUNTS = [1, 5, 10, 20, 25, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 10000, 25000, 50000];

function card(base: string): ChartLabel[] {
  const path = `${base}.backgroundAndBorderProperty`;
  return [
    { label: 'Background', kind: 'color', path: `${path}.background` },
    { label: 'Opacity', kind: 'percent', path: `${path}.opacity`, min: 0, max: 1 },
    { label: 'Border color', kind: 'text', path: `${path}.border.color`, hex: true },
    { label: 'Border weight', kind: 'select', path: `${path}.border.size`, options: { None: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 } },
    { label: 'Border style', kind: 'select', path: `${path}.border.style`, options: { Solid: 0, Dashed: 1, Dotted: 2, Double: 3 } },
    { label: 'Border radius', kind: 'number', path: `${path}.border.radius`, min: 0, max: 100 },
    { label: 'Add border shadow', kind: 'toggle', path: `${path}.boxShadow` },
  ];
}
function legend(base: string): StyleLabel[] {
  const path = `${base}.legendProperty`;
  return [
    { label: 'Display legend', auto: true, kind: 'toggle', path: `${path}.showLegend` },
    { label: 'Legend position', auto: true, kind: 'select', path: `${path}.legendPosition`, options: { None: 0, Bottom: 1, Top: 2, Left: 3, Right: 4 } },
    { label: 'Legend alignment', auto: true, kind: 'select', path: `${path}.legendAlignment`, options: { Start: 0, Center: 1, End: 2 } },
    { label: 'Align legend with grid', auto: true, kind: 'toggle', path: `${path}.alignToGrid` },
    { label: 'Max lines', auto: true, kind: 'number', path: `${path}.legendMaxLines`, min: 1 },
    { label: 'Legend font size', auto: true, kind: 'number', path: `${path}.legendFontSize`, min: 1 },
    { label: 'Legend font family', auto: true, kind: 'text', path: `${path}.legendFontFamily` },
    { label: 'Legend font color', auto: true, kind: 'color', path: `${path}.legendColor` },
  ];
}
function axes(base: string): StyleLabel[] {
  const path = `${base}.axisAndGridProperty`;
  return [
    { label: 'Show axes', kind: 'toggle', path: `${path}.showAxis` },
    ...['hAxisProperty', 'leftVAxisProperty', 'rightVAxisProperty'].flatMap((axis): StyleLabel[] => [
      { label: 'Show axis title', kind: 'toggle', path: `${path}.${axis}.showAxisTitle` },
      { label: 'Show axis labels', kind: 'toggle', path: `${path}.${axis}.showAxisLabels` },
      { label: 'Show axis line', kind: 'toggle', path: `${path}.${axis}.showAxisLine` },
      { label: 'Axis label font family', auto: true, kind: 'text', path: `${path}.${axis}.axisLabelsFont` },
      { label: 'Bold axis labels', auto: true, kind: 'toggle', path: `${path}.${axis}.axisLabelsBold` },
      { label: 'Italic axis labels', auto: true, kind: 'toggle', path: `${path}.${axis}.axisLabelsItalic` },
      { label: 'Axis label rotation', auto: true, kind: 'number', path: `${path}.${axis}.axisLabelsRotation`, min: 0, max: 90 },
      { label: 'Axis min', kind: 'number', path: `${path}.${axis}.axisViewWindowMin` },
      { label: 'Axis max', kind: 'number', path: `${path}.${axis}.axisViewWindowMax` },
      { label: 'Log scale', kind: 'toggle', path: `${path}.${axis}.axisLogScale` },
    ]),
    { label: 'Axis font size', auto: true, kind: 'number', path: `${path}.axisFontSize`, min: 1 },
    { label: 'Data label font size', auto: true, kind: 'number', path: `${path}.labelFontSize`, min: -1, max: 20000 },
    { label: 'Axis color', kind: 'color', path: `${path}.axisColor` },
    { label: 'Axis line color', kind: 'color', path: `${path}.axisLineColor` },
    { label: 'Grid color', kind: 'color', path: `${path}.gridColor`, auto: true },
    { label: 'Show X-axis gridlines', kind: 'toggle', path: `${path}.showHGridLine` },
    { label: 'Show left Y-axis gridlines', kind: 'toggle', path: `${path}.showLeftVGridLine` },
    { label: 'Show right Y-axis gridlines', kind: 'toggle', path: `${path}.showRightVGridLine` },
  ];
}

function labels(type: string, base: string): ChartLabel[] {
  const out: ChartLabel[] = [...card(base),
    { label: 'Show title', kind: 'toggle', path: `${base}.chartTitleProperty.chartTitleShowTitle` },
    { label: 'Title', kind: 'text', path: `${base}.chartTitleProperty.chartTitleText` },
    { label: 'Title font size', auto: true, kind: 'number', path: `${base}.chartTitleProperty.chartTitleFontSize`, min: 1, max: 1000 },
    { label: 'Title alignment', kind: 'select', path: `${base}.chartTitleProperty.chartTitleTextAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
  ];
  if (type === 'kpi-metric') out.push(
    { label: 'Decimal precision', kind: 'number', path: `${base}.primaryDecimalPrecision`, min: 0, max: 20, integer: true },
    { label: 'Comparison label', kind: 'text', path: `${base}.compareLabel` },
    { label: 'Font family', kind: 'text', path: `${base}.fontFamily` },
    { label: 'Font size', kind: 'number', path: `${base}.fontSize`, min: -1, max: 1000 },
    { label: 'Font color', kind: 'color', path: `${base}.fontColor` },
    { label: 'Positive change color', kind: 'color', path: `${base}.positiveDeltaColor` },
    { label: 'Negative change color', kind: 'color', path: `${base}.negativeDeltaColor` },
    { label: 'Hide metric name', kind: 'toggle', path: `${base}.hideMetric` },
    { label: 'Hide comparison label', kind: 'toggle', path: `${base}.hideCompare` },
    { label: 'Show progress', kind: 'toggle', path: `${base}.showProgress` },
    { label: 'Show target line label', kind: 'toggle', path: `${base}.showTargetLineLabel` },
    { label: 'Metric label alignment', kind: 'select', path: `${base}.metricAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
    { label: 'Value alignment', kind: 'select', path: `${base}.textAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
    { label: 'Comparison alignment', kind: 'select', path: `${base}.compareAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
    { label: 'Line height', kind: 'number', path: `${base}.lineHeight`, min: -1, max: 20000 },
    { label: 'Top padding', kind: 'number', path: `${base}.paddingTop`, min: 0, max: 20000 },
    { label: 'Left padding', kind: 'number', path: `${base}.paddingLeft`, min: 0, max: 20000 },
    { label: 'Right padding', kind: 'number', path: `${base}.paddingRight`, min: 0, max: 20000 },
  );
  if (['simple-barchart', 'simple-combochart', 'simple-linechart'].includes(type)) out.push(
    { label: 'Chart area top', auto: true, kind: 'number', path: `${base}.chartDisplayProperty.chartAreaTop`, min: 0, max: 20000 },
    { label: 'Chart area left', auto: true, kind: 'number', path: `${base}.chartDisplayProperty.chartAreaLeft`, min: 0, max: 20000 },
    { label: 'Chart area width', auto: true, kind: 'number', path: `${base}.chartDisplayProperty.chartAreaWidth`, min: 1, max: 20000 },
    { label: 'Chart area height', auto: true, kind: 'number', path: `${base}.chartDisplayProperty.chartAreaHeight`, min: 1, max: 20000 },
  );
  if (['simple-linechart', 'simple-barchart', 'simple-combochart', 'simple-areachart', 'simple-piechart', 'simple-scatterchart', 'simple-treemap'].includes(type)) out.push(...legend(base));
  if (['simple-linechart', 'simple-barchart', 'simple-combochart', 'simple-areachart', 'simple-scatterchart', 'simple-histogram', 'simple-waterfall'].includes(type)) out.push(...axes(base));
  if (['simple-barchart', 'simple-areachart', 'simple-scatterchart', 'simple-waterfall'].includes(type)) out.push({ label: 'Show data labels', kind: 'toggle', path: `${base}.showDataLabel` });
  if (['simple-linechart', 'simple-combochart'].includes(type)) out.push(
    { label: 'Smooth curve', kind: 'toggle', path: `${base}.smoothCurve` },
  );
  if (['simple-linechart', 'simple-combochart'].includes(type))
    for (let index = 0; index < 20; index++) out.push(
      { label: 'Show data labels', kind: 'toggle', path: `${base}.seriesProperty[${index}].seriesShowDataLabel` },
      { label: 'Show points', kind: 'toggle', path: `${base}.seriesProperty[${index}].seriesShowPoints` },
      { label: 'Line style', kind: 'select', path: `${base}.seriesProperty[${index}].seriesLineStyle`, options: { Dashed: 0, Dotted: 1, Solid: 2, 'Dash-dot': 3, 'Long dash': 4, 'Long dash-dot': 5 } },
      { label: 'Line gradient', kind: 'toggle', path: `${base}.seriesProperty[${index}].seriesLineGradient` },
      { label: 'Data label font family', kind: 'text', path: `${base}.seriesProperty[${index}].labelStyleProperty.labelsFontFamily` },
      { label: 'Data label background color', kind: 'color', path: `${base}.seriesProperty[${index}].labelStyleProperty.labelsBackgroundColor` },
      { label: 'Data label background opacity', kind: 'percent', path: `${base}.seriesProperty[${index}].labelStyleProperty.labelsOpacity`, min: 0, max: 1 },
    );
  if (['simple-linechart', 'simple-combochart', 'simple-barchart', 'simple-areachart'].includes(type)) out.push(
    { label: 'Bar color', kind: 'color', path: `${base}.seriesProperty[0].seriesColor` },
    { label: 'Line color', kind: 'color', path: `${base}.seriesProperty[0].seriesColor` },
  );
  if (type === 'simple-barchart') {
    out.push(
      { label: 'Group bar width', auto: true, kind: 'number', path: `${base}.customBarSpacingProperty.groupBarWidth`, min: 0, max: 100 },
      { label: 'Color by', kind: 'select', path: `${base}.coordinatedColoring`, options: { 'Single color': 1, 'Bar order': 2, 'Dimension values': 3 } },
      { label: 'Show data labels as', kind: 'select', path: `${base}.dataLabelStyle`, options: { Number: 0, Percentage: 1 } },
    );
    // A breakdown produces multiple colored series from one metric. Their
    // positional palette is independent of the number of metric fields.
    for (let index = 1; index < 20; index++) out.push(
      { label: 'Bar color', kind: 'color', path: `${base}.seriesProperty[${index}].seriesColor` },
    );
  }
  if (type === 'simple-scatterchart') out.push({ label: 'Maximum bubble size', kind: 'percent', path: `${base}.maxPointSize`, min: 0.01, max: 1 });
  if (type === 'pivot-table') out.push(
    { label: 'Pivot row label widths', kind: 'number-array', path: `${base}.rowLabelWidth`, min: 0, max: 20000 },
    { label: 'Pivot total widths', kind: 'number-array', path: `${base}.grandTotalWidth`, min: 0, max: 20000 },
    { label: 'Body font size', auto: true, kind: 'number', path: `${base}.fontSize`, min: 1, max: 1000 },
    { label: 'Header font size', auto: true, kind: 'number', path: `${base}.headerFontSize`, min: 1, max: 1000 },
    { label: 'Header background color', kind: 'color', path: `${base}.headerColor` },
    { label: 'Header font color', kind: 'color', path: `${base}.headerFontColor` },
  );
  if (type === 'simple-table') out.push(
    { label: 'Column widths', kind: 'number-array', path: `${base}.columnsWidth`, min: 0, max: 20000 },
    { label: 'Body font size', auto: true, kind: 'number', path: `${base}.fontSize`, min: 1, max: 1000 },
    { label: 'Header font size', auto: true, kind: 'number', path: `${base}.headerFontSize`, min: 1, max: 1000 },
    { label: 'Data row height', auto: true, kind: 'number', path: `${base}.dataRowHeight`, min: 1, max: 20000 },
    { label: 'Header row height', auto: true, kind: 'number', path: `${base}.headerRowHeight`, min: 1, max: 20000 },
    { label: 'Row heights', auto: true, kind: 'number-array', path: `${base}.rowsHeight`, min: 1, max: 20000 },
    { label: 'Automatic row height', kind: 'toggle', path: `${base}.bodyAutoHeight` },
    { label: 'Rows per page', kind: 'select', path: 'row', options: Object.fromEntries(ROW_COUNTS.map((count) => [String(count), count])) },
    { label: 'Row numbers', kind: 'toggle', path: `${base}.showRowNum` },
    { label: 'Show summary row', kind: 'toggle', path: `${base}.showTotals` },
    { label: 'Show pagination', kind: 'toggle', path: `${base}.showPagination` },
    { label: 'Compact pagination', kind: 'toggle', path: `${base}.compactPagination` },
    { label: 'Header background color', kind: 'color', path: `${base}.headerColor` },
    { label: 'Header font color', kind: 'color', path: `${base}.headerFontColor` },
  );
  if (type === 'simple-table') {
    for (let index = 0; index < 100; index++) {
      const column = `${base}.tableMetricProperty[${index}]`;
      out.push(
        { label: 'Dimension column alignment', kind: 'select', path: `${base}.tableDimensionProperty[${index}].dimAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
        { label: 'Metric column alignment', kind: 'select', path: `${column}.colAlignment`, options: { Left: 1, Center: 2, Right: 3 } },
        { label: 'Metric column type', kind: 'select', path: `${column}.colType`, options: { Number: 2, Bar: 0, Heatmap: 1 } },
        { label: 'Show metric value', kind: 'toggle', path: `${column}.colShowNumber` },
        { label: 'Metric column color', kind: 'color', path: `${column}.colColor` },
      );
    }
  }
  return out;
}

export const styleTables: StyleTable[] = Object.entries(PROPERTIES).map(([type, base]) => ({ type, labels: labels(type, base) }));
