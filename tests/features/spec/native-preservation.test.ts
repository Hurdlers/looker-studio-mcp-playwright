import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, SOURCE, type Json } from './fake.js';

const native = JSON.parse(readFileSync(new URL('../../../fixtures/spec/native-roundtrip.json', import.meta.url), 'utf8'));
function setup() {
  const columns = native.connector_fields.flatMap((field: Json) => [field, { ...field, columnType: 1, field: field.mutableVersion, immutableVersion: field.field, createdBy: 1 }]);
  // The recreated source must expose the count used by the native control.
  columns.push({ field: { ns: 't0', name: 'datastudio_record_count_system_field_id_98323387' }, outputName: 'Record Count', columnType: 1, dataType: 3, defaultAggregationType: 7 });
  const f = fake({ columns, formulaResponse: () => ({ column: { ...native.source_fields[3], field: { name: 'validated' } } }) });
  f.sources[SOURCE]!.block.datasourceBlock.fields = structuredClone(native.source_fields);
  f.sources[SOURCE]!.block.blocks[0].fields = structuredClone(native.connector_fields);
  f.original.page[0]!.page.componentConfig = structuredClone(native.components).map((component: Json) => ({ ...component, ...(component.type === 'arrow' ? {} : { datasourceId: SOURCE }) }));
  return f;
}
const props = (component: Json) => component.propertyConfig.componentProperty;
const concept = (component: Json, key: string) => component.conceptDefs.find((entry: Json) => entry.name === key);

describe('native definitions survive public specification recreation', () => {
  it('preserves mixed metric bars and heatmaps and the native default row numbers', async () => {
    const f = setup();
    f.original.page[0]!.page.componentConfig = [f.original.page[0]!.page.componentConfig![0]!];
    const before = props(f.original.page[0]!.page.componentConfig![0] as Json).tableProperty;
    delete before.showRowNum;
    before.tableMetricProperty = [
      { colType: 0, colShowNumber: true, colColor: { color: '#123456', opacity: 1 } },
      { colType: 1, colShowNumber: false, colColor: { color: '#654321', opacity: 1 } },
      { colType: 2, colShowNumber: true, colColor: { color: '#ABCDEF', opacity: 1 } },
    ];
    const { spec } = await f.exportSpec({ style: 'all' });
    const style = spec.pages[0].components[0].style;
    expect(style).toMatchObject({
      'Row numbers': true,
      'Metric column type': 'Bar', 'Show metric value': true, 'Metric column color': '#123456',
      'Metric column type#2': 'Heatmap', 'Show metric value#2': false, 'Metric column color#2': '#654321',
    });
    expect(style).not.toHaveProperty('Metric column type#3');
    const result = await f.run('report_spec_apply', { spec }); expect(result.isError, resultText(result)).toBe(false);
    const after = props(f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).tableProperty;
    expect(after.showRowNum).toBe(true);
    expect(after.tableMetricProperty.slice(0, 2)).toMatchObject(before.tableMetricProperty.slice(0, 2));
  });

  it('preserves result calculations and their filter/base options', async () => {
    const { spec } = await setup().exportSpec({ style: 'all' });
    expect(spec.pages[0].components[0].metrics[1]).toMatchObject({ field: 'value', calculation: 'percent_of_total', relative_to_base: false, bypass_filters: true });
  });

  it('exports explicit date fields even when their range is automatic', async () => {
    const { spec } = await setup().exportSpec();
    expect(spec.pages[0].components[0].date_range_dimension).toBe('Day');
    expect(spec.pages[0].components[2].date_range_dimension).toBe('Day');
  });

  it('maps series calculation IDs to the names accepted by the creation tool', async () => {
    const { spec } = await setup().exportSpec();
    expect(spec.pages[0].components[1].series[0].metric).toBe('Total');
  });

  it('restores source aliases, numeric meaning and default aggregation before formulas and components', async () => {
    const { spec } = await setup().exportSpec();
    expect(spec.data_sources[0].field_overrides).toEqual([
      { field: 'category', name: 'Segment' },
      { field: 'value', type: 'Currency > EUR', aggregation: 'avg' },
      { field: 'day', name: 'Day' },
    ]);
  });

  it('exports the actual first-metric descending sort rather than assuming a creation default', async () => {
    const { spec } = await setup().exportSpec();
    expect(spec.pages[0].components[0]).toMatchObject({ sort_by: 'Amount', sort_ascending: false });
  });

  it('retains control display names and the complete native sort list', async () => {
    const { spec } = await setup().exportSpec();
    expect(spec.pages[0].components[2]).toMatchObject({ field: 'Segment', labels: { Segment: 'Choice' }, sorts: [{ field: 'Record Count', ascending: false }] });
  });

  it('marks unsupported nondefault result calculations instead of silently exporting their input amount', async () => {
    const f = setup(); (f.original.page[0]!.page.componentConfig![0] as Json).conceptDefs[2].resultTransformation.analyticalFunction = 3;
    const out = await f.exportSpec();
    expect(out.spec.pages[0].components[0].component).toBe('other');
    expect(out.text).toMatch(/analyticalFunction.*3/);
  });

  it('compares the newly saved native fields and concepts to the original definitions', async () => {
    const f = setup(), before = structuredClone(f.original.page[0]!.page.componentConfig);
    const { spec } = await f.exportSpec({ style: 'all' });
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).toBe(false);
    const doc = f.reports[CREATED]!, components = doc.page[0]!.page.componentConfig as Json[];
    const sourceId = doc.report.resource!.datasourceAlias![0]!.datasourceId;
    const fields = f.sources[sourceId]!.block.datasourceBlock.fields as Json[];
    expect(fields.find((field) => field.field.name === '_category_')!.outputName).toBe('Segment');
    expect(fields.find((field) => field.field.name === '_value_')).toMatchObject({ defaultAggregationType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'EUR' } }] } });
    const table = components[0]!, metrics = props(table).metrics.labeledConcepts[0].value.conceptNames;
    expect(concept(table, metrics[1]).resultTransformation).toEqual((before![0] as Json).conceptDefs[2].resultTransformation);
    expect(concept(table, props(table).dateRangeDimension).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
    expect(props(table).sort[0].sortDir).toBe(1);
    expect(concept(table, props(table).sort[0].sortColumn).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_value_');
    const total = fields.find((field) => field.outputName === 'Total')!;
    expect(total.field.name).not.toBe('calc_total');
    const combo = components[1]!;
    expect(concept(combo, props(combo).metrics.labeledConcepts[0].value.conceptNames[0]).queryTimeTransformation.dataTransformation.sourceFieldName).toBe(total.field.name);
    expect(props(combo).comboChartProperty.seriesProperty[0]).toMatchObject({ seriesType: 0, seriesAxisIndex: 1, seriesColor: { color: '#884499' } });
    const control = components[2]!;
    expect(concept(control, props(control).dimensions.labeledConcepts[0].value.conceptNames[0]).queryTimeTransformation.displayTransformation.displayName).toBe('Choice');
    expect(concept(control, props(control).sort[0].sortColumn).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('datastudio_record_count_system_field_id_98323387');
    expect(props(components[3]!).arrowProperty.terminals).toEqual((before![3] as Json).propertyConfig.componentProperty.arrowProperty.terminals);
  });

  it('keeps a sort on the percentage metric distinct from another metric of the same source field', async () => {
    const f = setup(); f.original.page[0]!.page.componentConfig = [f.original.page[0]!.page.componentConfig![0]!];
    props(f.original.page[0]!.page.componentConfig![0] as Json).sort = [{ sortColumn: 'qt_share', sortDir: 1 }];
    const { spec } = await f.exportSpec();
    expect(spec.pages[0].components[0].sort_by).toBe('Share');
    const applied = await f.run('report_spec_apply', { spec }); expect(applied.isError, resultText(applied)).toBe(false);
    const table = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    expect(concept(table, props(table).sort[0].sortColumn)).toMatchObject({ resultTransformation: { analyticalFunction: 1 } });
  });

  it('keeps a sort on a renamed dimension after applying its display label', async () => {
    const f = setup(); f.original.page[0]!.page.componentConfig = [f.original.page[0]!.page.componentConfig![0]!];
    const table = f.original.page[0]!.page.componentConfig![0] as Json;
    table.conceptDefs[0].queryTimeTransformation.displayTransformation.displayName = 'Choice';
    props(table).sort = [{ sortColumn: 'qt_segment', sortDir: 0 }];
    const { spec } = await f.exportSpec(); expect(spec.pages[0].components[0].sort_by).toBe('Choice');
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    const saved = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    expect(concept(saved, props(saved).sort[0].sortColumn).queryTimeTransformation.displayTransformation.displayName).toBe('Choice');
  });

  it('retains the exact unsupported updater reason and redacts credentials in loss notes', async () => {
    const f = setup(), reader = f.ctx.ext.updater.bind(f.ctx.ext);
    const token = ['ya29', 'dummy-test-token'].join('.');
    const stub = vi.spyOn(f.ctx.ext, 'updater').mockImplementation((key) => key === 'reference_lines'
      ? { ...reader(key)!, read: () => { throw new Error(`Parameter reference line is unsupported: ${token}`); } } : reader(key));
    try {
      const out = await f.exportSpec();
      expect(out.text).toContain('reference_lines could not be exported: Parameter reference line is unsupported: [redacted]');
      expect(out.text).not.toContain(token);
    } finally { stub.mockRestore(); }
  });

  it('binds a Metric reference line to the recreated calculated metric rather than its original ID', async () => {
    const f = setup(); f.original.page[0]!.page.componentConfig = [f.original.page[0]!.page.componentConfig![1]!];
    props(f.original.page[0]!.page.componentConfig![0] as Json).comboChartProperty.referenceLineProperty = [{ referenceLineType: 1, referenceLineMetric: 'qt_total', referenceLineCalculation: 0, referenceLineAxis: 1 }];
    const { spec } = await f.exportSpec();
    expect(spec.pages[0].components[0].reference_lines[0]).toMatchObject({ metric: 'Total', type: 'Metric', calculation: 'Average' });
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    const chart = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    const reference = props(chart).comboChartProperty.referenceLineProperty.find((line: Json) => line.referenceLineType === 1);
    const bound = concept(chart, reference.referenceLineMetric);
    expect(bound.queryTimeTransformation.displayTransformation.displayName).toBe('Total');
    expect(bound.queryTimeTransformation.dataTransformation.sourceFieldName).not.toBe('calc_total');
  });

  it.each([
    ['analyticalFunctionType', 7], ['aggregation', 10],
  ])('does not silently drop unsupported query-time %s %s', async (key, value) => {
    const f = setup(), table = f.original.page[0]!.page.componentConfig![0] as Json;
    table.conceptDefs[2].queryTimeTransformation.dataTransformation[key] = value;
    const out = await f.exportSpec();
    expect(out.spec.pages[0].components[0].component).toBe('other');
    expect(out.text).toContain(`dataTransformation.${key} ${value}`);
  });

  it('preserves an explicitly empty control sort instead of restoring the creation default', async () => {
    const f = setup(); f.original.page[0]!.page.componentConfig = [f.original.page[0]!.page.componentConfig![2]!];
    props(f.original.page[0]!.page.componentConfig![0] as Json).sort = [];
    const { spec } = await f.exportSpec(); expect(spec.pages[0].components[0].sorts).toEqual([]);
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    expect(props(f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).sort).toEqual([]);
  });

  it('marks unsupported native multiple control sorts instead of exporting an invalid creation input', async () => {
    const f = setup(), control = f.original.page[0]!.page.componentConfig![2] as Json;
    props(control).sort.push({ sortColumn: 'qt_choice', sortDir: 0 });
    const out = await f.exportSpec();
    expect(out.spec.pages[0].components[2].component).toBe('other');
    expect(out.text).toContain('2 control sorts');
  });

  it('reports exact unsupported reference-line display options while preserving the supported binding', async () => {
    const f = setup(), combo = f.original.page[0]!.page.componentConfig![1] as Json;
    props(combo).comboChartProperty.referenceLineProperty = [{ referenceLineType: 1, referenceLineMetric: 'qt_total', referenceLineCalculation: 0,
      referenceLineShowLabel: false, referenceLineShowValueInLabel: true, referenceLineStyle: 2, referenceLineColor: { color: '#112233', opacity: 0.4 } }];
    const out = await f.exportSpec();
    expect(out.spec.pages[0].components[1].reference_lines[0]).toMatchObject({ type: 'Metric', metric: 'Total' });
    for (const value of ['referenceLineShowLabel=false', 'referenceLineShowValueInLabel=true', 'referenceLineStyle=2', 'referenceLineColor.opacity=0.4']) expect(out.text).toContain(value);
  });

  it('exports control sort source names when dimension and metric share a display label', async () => {
    const f = setup(), control = f.original.page[0]!.page.componentConfig![2] as Json;
    f.original.page[0]!.page.componentConfig = [control];
    control.conceptDefs[1].queryTimeTransformation.displayTransformation = { displayName: 'Choice' };
    const { spec } = await f.exportSpec();
    expect(spec.pages[0].components[0].sorts).toEqual([{ field: 'Record Count', ascending: false }]);
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    const current = f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json;
    expect(concept(current, props(current).sort[0].sortColumn).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('datastudio_record_count_system_field_id_98323387');
  });
});
