import { describe, expect, it } from 'vitest';

import { fromMapValue } from '../../../src/core/mapvalue.js';
import { runTool } from '../../../src/core/tool.js';
import { parseDuration } from '../../../src/features/chart-options/dates.js';
import { filterDefinition } from '../../../src/features/chart-options/filters.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';
import { definition, expectInvalid, harness, invalidAdd, properties as p, ref, REPORT, sortableBehavior, type Json } from './helpers.js';

const eq = (field = 'platform', value = 'ios') => ({ field, condition: 'equals', values: [value] });
const filter = (name = 'f-ios', field = 'platform', value = 'ios') => ({ name, ...eq(field, value) });
const clauses = [[eq('platform', 'android'), eq('platform', 'web')], [{ field: 'uses', condition: 'gt', values: ['5'] }]];
const columns = [
  { id: '_platform_', name: 'platform', dataType: 0, semanticType: 32, aggregation: 0, kind: 'dimension' as const },
  { id: '_uses_', name: 'uses', dataType: 5, semanticType: 33, aggregation: 6, kind: 'metric' as const },
];

describe('chart filters, periods and sorting', () => {
  it('chart.filter.condition: saves a report filter before attaching its key to the new chart', async () => {
    const h = harness();
    const { component } = await h.add('table', { filters: [filter()] });
    const entries = (h.doc.report.resource as Json).filter.entry;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ value: { name: 'f-ios', datasourceId: 'ds-1', version: 3, filterDefinition: { filterExpression: {
      include: true, conceptType: 0, filterConditionType: 'EQ', stringValues: ['ios'], numberValues: [], queryTimeTransformation: { dataTransformation: { sourceFieldName: '_platform_' } },
    } } } });
    expect(p(component).filters).toEqual([entries[0].key]);
    expect(h.writes().map((call) => call.endpoint)).toEqual(['updateReport', 'updatePage']);
  });
  const codes: Array<[string, string]> = [['equals', 'EQ'], ['=', 'EQ'], ['Equal to (=)', 'EQ'], ['contains', 'PT'], ['starts_with', 'BW'], ['regexp_match', 'RM'], ['regexp_contains', 'RC'], ['in', 'IN'], ['is_null', 'NU'], ['gt', 'GT'], ['>', 'GT'], ['gte', 'GTE'], ['>=', 'GTE'], ['lt', 'LT'], ['<', 'LT'], ['lte', 'LTE'], ['<=', 'LTE'], ['between', 'BT'], ['Between', 'BT']];
  for (const [condition, code] of codes)
    it(`chart.filter.condition: resolves ${condition} to ${code} with the correct value shape`, () => {
      const numeric = ['GT', 'GTE', 'LT', 'LTE', 'BT'].includes(code);
      const values = code === 'NU' ? [] : code === 'BT' ? ['15', '30'] : code === 'IN' ? ['android', 'web'] : numeric ? ['15'] : ['ios'];
      const expression = filterDefinition({ name: 'f', field: numeric ? 'uses' : 'platform', condition, values, exclude: true }, columns).filterExpression;
      expect(expression).toMatchObject({ filterConditionType: code, include: false, numberValues: numeric ? values.map(Number) : [], stringValues: numeric ? [] : values });
    });
  it('chart.filter.condition: rejects values for null and an incomplete field condition before saving', async () => {
    await invalidAdd('table', { filters: [{ name: 'f', field: 'platform', condition: 'is_null', values: ['x'] }] });
    await invalidAdd('table', { filters: [{ name: 'f', field: 'platform' }] });
  });
  it('chart.filter.clauses: compiles AND groups containing OR alternatives', async () => {
    const h = harness();
    await h.add('table', { filters: [{ name: 'f-multi', clauses }] });
    const definition = (h.doc.report.resource as Json).filter.entry[0].value.filterDefinition;
    expect(definition.and.filterDefinitions).toHaveLength(2);
    expect(definition.and.filterDefinitions[0].or.filterDefinitions.map((item: Json) => item.filterExpression.stringValues)).toEqual([['android'], ['web']]);
    expect(definition.and.filterDefinitions[1]).toMatchObject({ filterExpression: { filterConditionType: 'GT', numberValues: [5] } });
  });
  it('chart.filter.clauses: collapses singleton groups and rejects empty or mixed groups', async () => {
    expect(filterDefinition({ name: 'f', clauses: [[eq()]] }, columns)).toHaveProperty('filterExpression');
    expect(filterDefinition({ name: 'f', clauses: [[eq(), eq('platform', 'web')]] }, columns)).toHaveProperty('or');
    await invalidAdd('table', { filters: [{ name: 'f', field: 'platform', clauses }] });
    await invalidAdd('table', { filters: [{ name: 'f', clauses: [[]] }] });
    await invalidAdd('table', { filters: [{ name: 'f', clauses: [[{ field: '', condition: 'equals', values: ['x'] }]] }] });
  });
  it('chart.filter.reuse: reuses a same-source filter without saving the report and warns about ignored conditions', async () => {
    const h = harness();
    (h.doc.report.resource as Json).filter = { entry: [{ key: 'filterabc', value: { name: 'f-ios', datasourceId: 'ds-1' } }] };
    const { component, text } = await h.add('table', { filters: [filter('f-ios', 'platform', 'web')] });
    expect(p(component).filters).toEqual(['filterabc']);
    expect(h.writes().map((call) => call.endpoint)).toEqual(['updatePage']);
    expect(text).toMatch(/reused/);
  });
  it('chart.filter.reuse: reports known names when a named filter is absent', async () => {
    const h = harness();
    (h.doc.report.resource as Json).filter = { entry: [{ key: 'filterabc', value: { name: 'f-ios', datasourceId: 'ds-1' } }] };
    await expect(h.add('table', { filters: [{ name: 'none' }] })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('f-ios') });
    expect(h.writes()).toEqual([]);
  });
  const ranges: Array<[string, Json]> = [
    ['Last 7 days', { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 }],
    ['last 28 DAYS', { startOffsetUnit: 3, startOffset: 28, endOffsetUnit: 3, endOffset: 1 }],
    ['This month to date', { startOffsetUnit: 6, startOffset: 0, endOffsetUnit: 3, endOffset: 1 }],
    ['Last week (starts Monday)', { startOffsetUnit: 5, startOffset: 1, endOffsetUnit: 5, endOffset: 1 }],
    ['Yesterday', { startOffsetUnit: 3, startOffset: 1, endOffsetUnit: 3, endOffset: 1 }],
  ];
  for (const [range, expected] of ranges)
    it(`chart.date_range.preset: saves ${range} and a source date dimension`, async () => {
      const h = harness();
      const { component } = await h.add('scorecard', { date_range: range });
      expect(p(component).dateDuration).toEqual(expected);
      expect(p(component).dateRangeDimension).toBe(definition(component, '_day_').name);
    });
  it('chart.date_range.preset: automatic removes the duration and unknown presets fail without writes', async () => {
    const h = harness();
    const { component } = await h.add('scorecard', { date_range: 'Auto date range' });
    expect(p(component)).not.toHaveProperty('dateDuration');
    for (const date_range of ['Last 8 days', '']) await invalidAdd('scorecard', { date_range });
    expect(() => parseDuration('Last 8 days')).toThrow(/Last 28 days/);
  });
  it('chart.date_range.fixed: saves compact anchors without offsets', async () => {
    const h = harness();
    const { component } = await h.add('scorecard', { date_range: '2026-10-01..2026-10-15' });
    expect(p(component).dateDuration).toEqual({ startAnchor: '20261001', endAnchor: '20261015' });
  });
  it('chart.date_range.fixed: rejects nonexistent, reversed and malformed dates without saving', async () => {
    for (const date_range of ['2026-10-15..2026-10-01', '2026-02-30..2026-03-01', '2026-10-01', '2026/10/01..2026/10/02']) await invalidAdd('scorecard', { date_range });
  });
  it('chart.comparison: compiles supported ranges and rejects other choices without saving', async () => {
    for (const [comparison, unit] of [['Previous period', 9], ['previous year', 8]] as const) {
      const h = harness();
      const { component } = await h.add('scorecard', { comparison });
      expect(p(component).compareDateDuration).toEqual({ anchorType: 1, config: { startOffsetUnit: unit, startOffset: 1, endOffsetUnit: unit, endOffset: 1 } });
    }
    const h = harness();
    const { component } = await h.add('scorecard', { comparison: 'None' });
    expect(p(component)).not.toHaveProperty('compareDateDuration');
    await invalidAdd('scorecard', { comparison: 'Last month' });
  });
  it('chart.sort.primary: sorts by an existing metric or introduces an undisplayed date field', async () => {
    for (const ascending of [false, true]) {
      const h = harness();
      const { component } = await h.add('table', { sort_by: 'uses', sort_ascending: ascending });
      expect(p(component).sort).toEqual([{ sortColumn: definition(component, '_uses_').name, sortDir: ascending ? 0 : 1 }]);
    }
    const h = harness();
    const { component } = await h.add('table', { sort_by: 'day' });
    expect(p(component).sort).toEqual([{ sortColumn: definition(component, '_day_').name, sortDir: 1 }]);
  });
  it('chart.sort.primary: ascending alone preserves sort and dimension scorecards accept a metric sort', async () => {
    const h = harness();
    const { component } = await h.add('table', { sort_ascending: true });
    expect(p(component).sort).toEqual([]);
    const score = await h.add('scorecard_dimension', { sort_by: 'uses', sort_ascending: true });
    expect(p(score.component).sort).toEqual([{ sortColumn: definition(score.component, '_uses_').name, sortDir: 0 }]);
  });
  it('chart.sort.pivot_row: writes only the first pivot row sort and retains the default row sort when omitted', async () => {
    const h = harness();
    const { component } = await h.add('pivot_table', { sort_by: 'uses', sort_ascending: true });
    expect(p(component).pivotTableProperty.pivotDisplayConfig.row[0].sort).toEqual([{ sortColumn: definition(component, '_uses_').name, sortDir: 0 }]);
    expect(p(component).sort).toEqual([]);
    const base = await h.add('pivot_table');
    expect(p(base.component).pivotTableProperty.pivotDisplayConfig.row[0].sort[0].sortColumn).toBe(definition(base.component, '_platform_').name);
  });
  it('chart.sort.secondary: appends table sorts, warns for single-sort charts and enforces ten sorts', async () => {
    const h = harness();
    const { component } = await h.add('table', { sort_by: 'uses', sorts: [{ field: 'platform', ascending: true }] });
    expect(p(component).sort).toEqual([{ sortColumn: definition(component, '_uses_').name, sortDir: 1 }, { sortColumn: definition(component, '_platform_').name, sortDir: 0 }]);
    const bar = await h.add('column', { sort_by: 'uses', sorts: [{ field: 'platform' }] });
    expect(p(bar.component).sort).toHaveLength(1);
    expect(bar.text).toMatch(/one sort/);
    await invalidAdd('table', { sort_by: 'uses', sorts: Array.from({ length: 10 }, () => ({ field: 'platform' })) });
  });
});

describe('series, references and conditional formatting', () => {
  it('chart.series.type: changes only the selected series and warns about an absent metric', async () => {
    const h = harness();
    const { component } = await h.add('combo', { series: [{ metric: 'errors', type: 'line' }, { metric: 'uses', type: 'bars' }] });
    expect(p(component).comboChartProperty.seriesProperty[0].seriesType).toBe(1);
    expect(p(component).comboChartProperty.seriesProperty[1].seriesType).toBe(0);
    const unknown = await h.add('combo', { series: [{ metric: 'nope', type: 'line' }] });
    expect(unknown.text).toMatch(/No series named/);
  });
  it('chart.series.type: resolves labels before series and refuses empty names', async () => {
    const h = harness();
    const { component } = await h.add('combo', { labels: { errors: 'Errors' }, series: [{ metric: 'Errors', type: 'line' }] });
    expect(p(component).comboChartProperty.seriesProperty[1].seriesType).toBe(0);
    await invalidAdd('combo', { series: [{ metric: '', type: 'line' }] });
  });
  it('chart.series.axis: sets the selected right axis and warns for unsupported chart types', async () => {
    const h = harness();
    const { component } = await h.add('combo', { series: [{ metric: 'errors', axis: 'right' }] });
    expect(p(component).comboChartProperty.seriesProperty[1].seriesAxisIndex).toBe(1);
    const pie = await h.add('pie', { series: [{ metric: 'uses', axis: 'right' }] });
    expect(pie.text).toMatch(/Warning/);
  });
  it('chart.series.color: replaces color references with an explicit color and rejects malformed colors', async () => {
    const h = harness();
    const { component } = await h.add('combo', { series: [{ metric: 'uses', color: '#7C4DFF' }] });
    expect(p(component).comboChartProperty.seriesProperty[0].seriesColor).toEqual({ color: '#7C4DFF', opacity: 1 });
    await invalidAdd('combo', { series: [{ metric: 'uses', color: '#7C4DF' }] });
  });
  it('chart.value_colors: saves a report-wide mapping before enabling dimension-value coloring', async () => {
    const h = harness();
    const { component } = await h.add('pie', { value_colors: { android: '#3DDC84' } });
    expect((h.doc.report.resource as Json).colorMappingList.colorMappingConfig[0].colorMapping).toEqual([{ key: { value: 'android' }, color: '#3DDC84', colorType: { color: '#3DDC84', opacity: 1 } }]);
    expect(p(component).pieChartProperty.coordinatedColoring).toBe(3);
    expect(h.writes().map((call) => call.endpoint)).toEqual(['updateReport', 'updatePage']);
    await h.update({ value_colors: { android: '#FF6D00' } });
    expect((h.doc.report.resource as Json).colorMappingList.colorMappingConfig[0].colorMapping).toHaveLength(1);
  });
  it('chart.value_colors: refuses invalid colors and chart types without dimension coloring', async () => {
    await invalidAdd('pie', { value_colors: { android: '#3DDC8' } });
    await invalidAdd('table', { value_colors: { android: '#3DDC84' } });
  });
  it('chart.reference_line.constant: appends a line with the editor defaults and explicit left axis', async () => {
    const h = harness();
    const { component } = await h.add('column', { reference_lines: [{ value: 30, label: 'Target', color: '#FF0000' }] });
    expect(p(component).barChartProperty.referenceLineProperty.at(-1)).toEqual({ referenceLineType: 0, referenceLineNumberValue: 30, referenceLineLabel: 'Target', referenceLineShowLabel: true, referenceLineShowValueInLabel: false, referenceLineColor: { color: '#FF0000', opacity: 1 }, referenceLineAxis: 0, referenceLineWeight: 2, referenceLineStyle: 0 });
  });
  it('chart.reference_line.constant: supports alternate axes and refuses unsupported charts and an eleventh line', async () => {
    const h = harness();
    const combo = await h.add('combo', { reference_lines: [{ value: 30, axis: 'Right Y-axis' }] });
    expect(p(combo.component).comboChartProperty.referenceLineProperty.at(-1).referenceLineAxis).toBe(1);
    const scatter = await h.add('scatter', { metrics: [{ field: 'uses' }, { field: 'errors' }], reference_lines: [{ value: 15, axis: 'X-axis' }] });
    expect(p(scatter.component).scatterChartProperty.referenceLineProperty.at(-1).referenceLineAxis).toBe(2);
    await invalidAdd('table', { reference_lines: [{ value: 30 }] });
    await invalidAdd('column', { reference_lines: Array.from({ length: 11 }, () => ({ value: 30 })) });
  });
  it('chart.reference_line.type: initializes constant and metric-average lines and refuses unbound parameters', async () => {
    const h = harness();
    const { component } = await h.add('combo', { reference_lines: [{ value: 1, type: 'Constant value' }, { value: 1, type: 'metric' }] });
    const lines = p(component).comboChartProperty.referenceLineProperty;
    expect(lines.map((line: Json) => line.referenceLineType)).toEqual([0, 1]);
    expect(lines[1]).toMatchObject({ referenceLineMetric: definition(component, '_uses_').name, referenceLineCalculation: 0 });
    await invalidAdd('combo', { reference_lines: [{ value: 1, type: 'Median line' }] });
    await invalidAdd('combo', { reference_lines: [{ type: 'Parameter', value: 1 }] });
  });
  it('chart.reference_band: stores numeric bounds and a fill color and refuses reversed bounds', async () => {
    const h = harness();
    const { component } = await h.add('column', { reference_bands: [{ from: 15, to: 30, label: 'Normal', color: '#FFF59D' }] });
    expect(p(component).barChartProperty.referenceBandProperty.at(-1)).toMatchObject({ referenceLineTypeBandStart: 0, referenceLineNumberValueBandStart: 15, referenceLineTypeBandEnd: 0, referenceLineNumberValueBandEnd: 30, referenceBandLabel: 'Normal', referenceBandShowLabel: true, referenceBandFillColor: { color: '#FFF59D', opacity: 1 }, referenceBandAxis: 0 });
    await invalidAdd('column', { reference_bands: [{ from: 30, to: 15 }] });
  });
  it('chart.conditional_format.rules: appends a chart condition without changing other charts', async () => {
    const h = harness();
    h.doc.page[0]!.chartCondition = [{ chartId: 'other', conditionalFormat: { rule: [{ keep: true }] } }];
    const { component } = await h.add('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]], background_color: '#FFCDD2' }] });
    const conditions = h.doc.page[0]!.chartCondition as Json[];
    expect(conditions[0]).toEqual({ chartId: 'other', conditionalFormat: { rule: [{ keep: true }] } });
    expect(conditions[1]).toMatchObject({ chartId: component.componentId, conditionalFormat: { rule: [{
      scope: 'row',
      conditionDefinition: { and: { conditionDefinition: [{ or: { conditionDefinition: [{ matchCondition: { type: 3, value: { numberValue: [15] } } }] } }] } },
      format: { single: { property: [{ key: 'background-color', value: { colorValue: { color: '#FFCDD2', opacity: 1 } } }] } },
    }] } });
  });
  it('chart.conditional_format.rules: accepts comparison aliases and rejects missing colors or unknown conditions', async () => {
    for (const [condition, code] of [['not_equals', 2], ['Greater than (>)', 3], ['lte', 6]] as const) {
      const h = harness();
      await h.add('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition, value: '15' }]], font_color: '#D50000' }] });
      const rule = (h.doc.page[0]!.chartCondition as Json[])[0]!.conditionalFormat.rule[0];
      expect(rule.conditionDefinition.and.conditionDefinition[0].or.conditionDefinition[0].matchCondition.type).toBe(code);
    }
    await invalidAdd('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]] }] });
    await invalidAdd('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition: 'nope', value: '15' }]], font_color: '#D50000' }] });
  });
  it('chart.conditional_format.apply_to: targets rows, cells and the default while rejecting unknown columns', async () => {
    for (const apply_to of ['Entire row', 'uses', undefined]) {
      const h = harness();
      const { component } = await h.add('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]], font_color: '#D50000', ...(apply_to ? { apply_to } : {}) }] });
      const steps = (h.doc.page[0]!.chartCondition as Json[])[0]!.conditionalFormat.rule[0].target.target.step;
      expect(steps[0].string).toBe(apply_to === 'uses' ? 'cell' : 'row');
      if (apply_to === 'uses') expect(steps[1].field.name).toBe(definition(component, '_uses_').name);
    }
    await invalidAdd('table', { conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]], font_color: '#D50000', apply_to: 'nope' }] });
  });
});

describe('labels, styles and updates', () => {
  it('chart.labels: replaces both dimension and metric labels after metrics labels and rejects absent fields', async () => {
    const h = harness();
    const { component } = await h.add('table', { metrics: [{ field: 'uses', label: 'U' }], labels: { platform: 'Platform', uses: 'Total uses' } });
    expect(definition(component, '_platform_').queryTimeTransformation.displayTransformation.displayName).toBe('Platform');
    expect(definition(component, '_uses_').queryTimeTransformation.displayTransformation.displayName).toBe('Total uses');
    await invalidAdd('table', { labels: { day: 'Day' } });
  });
  it('chart.style.settings: applies chart labels case-insensitively and reports unsupported labels', async () => {
    const h = harness();
    const { component, text } = await h.add('column', { style: { 'Show data labels': true, 'bar color': '#7C4DFF', 'No such label': 1 } });
    expect(p(component).barChartProperty.showDataLabel).toBe(true);
    expect(p(component).barChartProperty.seriesProperty[0].seriesColor).toEqual({ color: '#7C4DFF', opacity: 1 });
    expect(text).toMatch(/Not applied: No such label/);
  });
  it('chart.style.settings: rejects invalid colors and dropdown values without writes', async () => {
    await invalidAdd('column', { style: { 'Bar color': '#12' } });
    await invalidAdd('column', { style: { 'Legend position': 'No position' } });
  });
  it('chart.style.legend: hides the legend and clears its position, or chooses a supported position', async () => {
    const h = harness();
    const { component } = await h.add('combo', { style: { 'Display legend': false } });
    expect(p(component).comboChartProperty.legendProperty.showLegend).toBe(false);
    expect(p(component).comboChartProperty.legendProperty).not.toHaveProperty('legendPosition');
    await h.update({ style: { 'Legend position': 'Top' } });
    expect(p(h.last()).comboChartProperty.legendProperty.legendPosition).toBe(2);
  });
  it('chart.style.axes: resolves repeated labels to the second axis and reports unavailable repetitions', async () => {
    const h = harness();
    const { component, text } = await h.add('combo', { style: { 'Show axis title#2': true, 'Show axis title#9': true } });
    expect(p(component).comboChartProperty.axisAndGridProperty.leftVAxisProperty.showAxisTitle).toBe(true);
    expect(text).toMatch(/Not applied: Show axis title#9/);
    const labels = styleTables.find((table) => table.type === 'simple-combochart')!.labels.filter((label) => label.label === 'Show axis title');
    expect(labels[1]!.path).toBe('comboChartProperty.axisAndGridProperty.leftVAxisProperty.showAxisTitle');
  });
  it('chart.style.data_labels: writes chart-level bar labels and first-series line labels', async () => {
    const h = harness();
    const bar = await h.add('column', { style: { 'Show data labels': true } });
    expect(p(bar.component).barChartProperty.showDataLabel).toBe(true);
    const line = await h.add('time_series', { style: { 'Show data labels': true } });
    expect(p(line.component).lineChartProperty.seriesProperty[0].seriesShowDataLabel).toBe(true);
  });
  it('chart.style.table_rows: toggles row numbers and totals, accepts known row counts and rejects others', async () => {
    const h = harness();
    const { component } = await h.add('table', { style: { 'Row numbers': true, 'Show summary row': true, 'Rows per page': 1 } });
    expect(p(component).tableProperty).toMatchObject({ showRowNum: true, showTotals: true });
    expect(p(component).row).toBe(1);
    await invalidAdd('table', { style: { 'Rows per page': 7 } });
  });
  it('chart.style.colors: replaces series and header colors with explicit colors', async () => {
    const h = harness();
    const bar = await h.add('column', { style: { 'Bar color': '#7C4DFF' } });
    expect(p(bar.component).barChartProperty.seriesProperty[0].seriesColor).toEqual({ color: '#7C4DFF', opacity: 1 });
    const table = await h.add('table', { style: { 'Header background color': '#FFEB3B' } });
    expect(p(table.component).tableProperty.headerColor).toEqual({ color: '#FFEB3B', opacity: 1 });
  });
  it('chart.style.card: sets the background, border, corner radius and shadow', async () => {
    const h = harness();
    const { component } = await h.add('table', { style: { Background: '#1E1E1E', 'Border color': '#333333', 'Border radius': 12, 'Add border shadow': true } });
    expect(p(component).tableProperty.backgroundAndBorderProperty).toMatchObject({ background: { color: '#1E1E1E', opacity: 1 }, border: { color: '#333333', radius: 12 }, boxShadow: true });
  });
  it('chart.update.chart_type: changes the chart style block while retaining data and other components', async () => {
    const h = harness();
    const { component } = await h.add('column', { sort_by: 'uses' });
    const id = component.componentId;
    p(component).filters = ['filterA'];
    const original = structuredClone(component);
    const other = (await h.add('scorecard')).component;
    const unchanged = structuredClone(other);
    await h.update({ chart_type: 'table' }, id);
    const changed = h.components().find((entry) => entry.componentId === id)!;
    expect(changed).toMatchObject({ type: 'simple-table', preset: 'default', componentId: id, attributeConfig: original.attributeConfig, conceptDefs: original.conceptDefs });
    expect(p(changed)).toHaveProperty('tableProperty');
    expect(p(changed)).not.toHaveProperty('barChartProperty');
    for (const key of ['dataset', 'dimensions', 'metrics', 'sort', 'filters']) expect(p(changed)[key]).toEqual(p(original)[key]);
    expect(h.components().find((entry) => entry.componentId === other.componentId)).toEqual(unchanged);
  });
  it('chart.update.chart_type: missing components and empty changes never save', async () => {
    const h = harness();
    await h.add(); h.clear();
    await expect(h.update({ chart_type: 'table' }, 'cd-missing')).rejects.toMatchObject({ code: 'not_found' });
    await expect(h.update({})).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Nothing to change') });
    expect(h.writes()).toEqual([]);
  });
  it('chart.update.fields: replaces slots, keeps reused concept IDs and removes unused concepts', async () => {
    const h = harness();
    const { component } = await h.add();
    const platform = definition(component, '_platform_').name;
    await h.update({ fields: { Dimension: ['day', 'platform'], Metric: ['errors'] } });
    expect(ref(h.last(), 'dimensions', 'primary')).toEqual([definition(h.last(), '_day_').name, platform]);
    expect(ref(h.last(), 'metrics', 'primary')).toEqual([definition(h.last(), '_errors_').name]);
    expect(definition(h.last(), '_uses_')).toBeUndefined();
  });
  it('chart.update.fields: maintains breakdown configuration and rejects unknown inputs and fields without saving', async () => {
    const h = harness();
    await h.add('column', { dimensions: ['day'] });
    await h.update({ fields: { 'Breakdown dimension': ['platform'] } });
    expect(ref(h.last(), 'dimensions', 'breakdown')).toEqual([definition(h.last(), '_platform_').name]);
    expect(p(h.last()).breakdownConfig).toHaveLength(1);
    h.clear();
    await expectInvalid(() => h.update({ fields: { 'No slot': ['day'] } }));
    await expectInvalid(() => h.update({ fields: { Dimension: ['missing'] } }));
    expect(h.writes()).toEqual([]);
  });
  it('chart.update.labels: resolves old and new display names and reports absent labels', async () => {
    const h = harness();
    await h.add();
    await h.update({ labels: { uses: 'Total uses' } });
    expect(definition(h.last(), '_uses_').queryTimeTransformation.displayTransformation.displayName).toBe('Total uses');
    await h.update({ labels: { 'Total uses': 'Uses' } });
    expect(definition(h.last(), '_uses_').queryTimeTransformation.displayTransformation.displayName).toBe('Uses');
    h.clear();
    await expect(h.update({ labels: { nope: 'X' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(h.writes()).toEqual([]);
  });
  it('chart.update.labels: applies new names before selecting series', async () => {
    const h = harness();
    await h.add('combo');
    const text = await h.update({ labels: { errors: 'Errors' }, series: [{ metric: 'Errors', type: 'line' }] });
    expect(p(h.last()).comboChartProperty.seriesProperty[1].seriesType).toBe(0);
    expect(text).not.toMatch(/Warning/);
  });
  it('chart.update.setup: disables cross-filtering without losing other actions and reports unavailable labels', async () => {
    const h = harness();
    const { component } = await h.add('column');
    component.behavior = sortableBehavior();
    const original = fromMapValue(component.behavior) as Json;
    const text = await h.update({ setup: { 'Cross-filtering': false, 'No such': 1 } });
    const behavior = fromMapValue(h.last().behavior) as Json;
    expect(behavior.onSelect).toBeUndefined();
    expect(behavior.onSort).toEqual(original.onSort);
    expect(text).toMatch(/Not applied: No such/);
    h.clear();
    await expect(h.update({ setup: { Dimension: 'day' } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('fields') });
    expect(h.writes()).toEqual([]);
  });
  it('chart.update.style: changes only the chosen chart and refuses bad dropdown values without saving', async () => {
    const h = harness();
    await h.add('column');
    const id = h.last().componentId;
    await h.add('scorecard');
    const other = structuredClone(h.last());
    await h.update({ style: { 'Show data labels': true } }, id);
    expect(p(h.components()[0]!).barChartProperty.showDataLabel).toBe(true);
    expect(h.last()).toEqual(other);
    h.clear();
    await expectInvalid(() => h.update({ style: { 'Legend position': 'Bad' } }, id));
    expect(h.writes()).toEqual([]);
  });
  it('chart.update.filters: appends a filter once and reuses it without another report save', async () => {
    const h = harness();
    const { component } = await h.add(); p(component).filters = ['filterA'];
    await h.update({ filters: [filter('f-web', 'platform', 'web')] });
    expect(p(h.last()).filters).toHaveLength(2);
    expect(p(h.last()).filters[0]).toBe('filterA');
    h.clear();
    await h.update({ filters: [filter('f-web', 'platform', 'web')] });
    expect(p(h.last()).filters).toHaveLength(2);
    expect(h.writes().map((call) => call.endpoint)).toEqual(['updatePage']);
  });
  it('chart.update.date_range: sets presets and fixed dates, restores automatic, and refuses invalid ranges', async () => {
    const h = harness();
    await h.add('scorecard');
    await h.update({ date_range: 'Last 28 days' });
    expect(p(h.last()).dateDuration.startOffset).toBe(28);
    await h.update({ date_range: '2026-10-01..2026-10-15' });
    expect(p(h.last()).dateDuration).toEqual({ startAnchor: '20261001', endAnchor: '20261015' });
    await h.update({ date_range: 'Auto date range' });
    expect(p(h.last())).not.toHaveProperty('dateDuration');
    h.clear(); await expectInvalid(() => h.update({ date_range: 'Bad' })); expect(h.writes()).toEqual([]);
  });
  it('chart.update.comparison: sets or removes comparison and refuses types without comparison', async () => {
    const h = harness();
    await h.add('scorecard');
    await h.update({ comparison: 'Previous year' });
    expect(p(h.last()).compareDateDuration).toEqual({ anchorType: 1, config: { startOffsetUnit: 8, startOffset: 1, endOffsetUnit: 8, endOffset: 1 } });
    await h.update({ comparison: 'None' });
    expect(p(h.last())).not.toHaveProperty('compareDateDuration');
    await h.add('pie'); h.clear();
    await expectInvalid(() => h.update({ comparison: 'Previous period' })); expect(h.writes()).toEqual([]);
  });
  it('chart.update.series: changes the second series in place and warns for missing metrics', async () => {
    const h = harness();
    await h.add('combo');
    const first = structuredClone(p(h.last()).comboChartProperty.seriesProperty[0]);
    await h.update({ series: [{ metric: 'errors', type: 'line', axis: 'right', color: '#FF6D00' }] });
    expect(p(h.last()).comboChartProperty.seriesProperty[1]).toMatchObject({ seriesType: 0, seriesAxisIndex: 1, seriesColor: { color: '#FF6D00', opacity: 1 } });
    expect(p(h.last()).comboChartProperty.seriesProperty[0]).toEqual(first);
    const before = structuredClone(h.last());
    const text = await h.update({ series: [{ metric: 'nope', type: 'line' }] });
    expect(text).toMatch(/Warning/); expect(h.last()).toEqual(before);
  });
  it('chart.update.value_colors: updates an existing mapping and adds a new value without duplicates', async () => {
    const h = harness();
    await h.add('pie', { value_colors: { android: '#3DDC84' } });
    await h.update({ value_colors: { android: '#FF6D00', ios: '#0A84FF' } });
    const colors = (h.doc.report.resource as Json).colorMappingList.colorMappingConfig[0].colorMapping;
    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatchObject({ key: { value: 'android' }, color: '#FF6D00' });
    expect(p(h.last()).pieChartProperty.coordinatedColoring).toBe(3);
  });
  it('chart.update.sorts: appends table sorts, preserves a bar sort and rejects an eleventh table sort', async () => {
    const h = harness();
    await h.add('table', { sort_by: 'uses' });
    await h.update({ sorts: [{ field: 'platform', ascending: true }] });
    expect(p(h.last()).sort).toEqual([{ sortColumn: definition(h.last(), '_uses_').name, sortDir: 1 }, { sortColumn: definition(h.last(), '_platform_').name, sortDir: 0 }]);
    const bar = (await h.add('column', { sort_by: 'uses' })).component;
    const original = structuredClone(p(bar).sort);
    expect(await h.update({ sorts: [{ field: 'platform' }] })).toMatch(/Warning/);
    expect(p(h.last()).sort).toEqual(original);
    await h.add('table', { sort_by: 'uses', sorts: Array.from({ length: 9 }, () => ({ field: 'platform' })) });
    h.clear(); await expectInvalid(() => h.update({ sorts: [{ field: 'day' }] })); expect(h.writes()).toEqual([]);
  });
  it('chart.update.reference_lines: appends lines without overwriting the previous one and enforces ten', async () => {
    const h = harness();
    await h.add('column', { reference_lines: [{ value: 15, label: 'Low' }] });
    const original = structuredClone(p(h.last()).barChartProperty.referenceLineProperty[0]);
    await h.update({ reference_lines: [{ value: 30, label: 'Target' }] });
    expect(p(h.last()).barChartProperty.referenceLineProperty).toHaveLength(2);
    expect(p(h.last()).barChartProperty.referenceLineProperty[0]).toEqual(original);
    expect(p(h.last()).barChartProperty.referenceLineProperty[1]).toMatchObject({ referenceLineType: 0, referenceLineNumberValue: 30, referenceLineLabel: 'Target', referenceLineAxis: 0 });
    h.clear(); await expectInvalid(() => h.update({ reference_lines: Array.from({ length: 9 }, () => ({ value: 30 })) })); expect(h.writes()).toEqual([]);
  });
  it('chart.update.reference_bands: appends a band and refuses reversed limits without saving', async () => {
    const h = harness();
    await h.add('column');
    await h.update({ reference_bands: [{ from: 15, to: 30, color: '#FFF59D' }] });
    expect(p(h.last()).barChartProperty.referenceBandProperty.at(-1)).toMatchObject({ referenceLineNumberValueBandStart: 15, referenceLineNumberValueBandEnd: 30, referenceBandAxis: 0, referenceBandFillColor: { color: '#FFF59D', opacity: 1 } });
    h.clear(); await expectInvalid(() => h.update({ reference_bands: [{ from: 30, to: 15 }] })); expect(h.writes()).toEqual([]);
  });
  it('chart.update.conditional_formats: appends a single-color rule after an existing scale rule', async () => {
    const h = harness();
    const { component } = await h.add();
    h.doc.page[0]!.chartCondition = [{ chartId: component.componentId, conditionalFormat: { rule: [{ format: { scale: { keep: true } } }] } }];
    await h.update({ conditional_formats: [{ rules: [[{ field: 'uses', condition: 'lt', value: '15' }]], font_color: '#D50000' }] });
    const rules = (h.doc.page[0]!.chartCondition as Json[])[0]!.conditionalFormat.rule;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ format: { scale: { keep: true } } });
    expect(rules[1].conditionDefinition.and.conditionDefinition[0].or.conditionDefinition[0].matchCondition).toMatchObject({ type: 5, value: { numberValue: [15] } });
    expect(rules[1].format.single.property[0].key).toBe('color');
    h.clear(); await expectInvalid(() => h.update({ conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]] }] })); expect(h.writes()).toEqual([]);
  });
  it('saves conditional formatting at report level for a report-level component', async () => {
    const h = harness();
    const { component } = await h.add();
    h.doc.report.componentConfig = [component]; h.doc.page[0]!.page.componentConfig = [];
    await h.update({ conditional_formats: [{ rules: [[{ field: 'uses', condition: 'gt', value: '15' }]], font_color: '#D50000' }] }, component.componentId);
    expect((h.doc.chartCondition as Json[])[0]!.chartId).toBe(component.componentId);
    expect(h.doc.page[0]!.chartCondition).toEqual([]);
  });
});
