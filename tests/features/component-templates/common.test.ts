import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] common review'; return f; }
const base = { report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' as const } } };
const parsed = (value: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(value));
const prop = (c: Json) => c.propertyConfig.componentProperty;

describe('common component structures', () => {
  it('discovers common structures without a library and keeps verification distinct', async () => {
    const f = setup();
    const list = parsed(await f.run('component_template_list', { verified_only: false, query: 'common-' }));
    expect(list.templates).toHaveLength(12);
    expect(list.templates.every((t: Json) => t.validation === 'supported_pending_review')).toBe(true);
    expect(parsed(await f.run('component_template_list', {})).templates).toEqual([]);
    expect(parsed(await f.run('component_template_inspect', { template_id: 'common-time-trend' })).roles.map((r: Json) => r.key)).toEqual(['date', 'metric']);
    expect(f.calls).toEqual([]);
  });
  it('uses the existing field and aggregation path while preserving the report theme', async () => {
    const f = setup(); f.original.report.propertyConfig = { reportProperty: { themeConfig: 'my-project-theme' } };
    const out = parsed(await f.run('component_template_add', { ...base, size: { width: 420, height: 180 }, texts: { title: '순매출' } }));
    expect(out).toMatchObject({ saved: true, component_count: 1, size: { width: 420, height: 180 }, validation: 'supported_pending_review' });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.type).toBe('kpi-metric');
    expect(prop(c).kpiMetricProperty.hideMetric).toBe(true);
    expect(commonChartArgs({ ...base }).args.style).not.toHaveProperty('Decimal precision');
    expect(commonChartArgs({ ...base, common_options: { decimal_precision: 0 } }).args.style).toHaveProperty('Decimal precision', 0);
    expect(c.conceptDefs.some((d: Json) => d.queryTimeTransformation?.dataTransformation?.sourceFieldName === '_value_')).toBe(true);
    expect((f.original.report.propertyConfig as Json).reportProperty.themeConfig).toBe('my-project-theme');
  });
  it('adds a time trend with an explicit date and average of displayed values', async () => {
    const f = setup();
    await f.run('component_template_add', { ...base, template_id: 'common-time-trend', bindings: { ...base.bindings, date: 'day' }, date_range: '2026-11-01..2026-11-03', common_options: { average_line: true } });
    const c = f.original.page[0]!.page.componentConfig![0] as Json, p = prop(c);
    expect(c.type).toBe('simple-linechart');
    expect(p.dateDuration).toMatchObject({ startAnchor: '20261101', endAnchor: '20261103' });
    expect(p.lineChartProperty.referenceLineProperty[0]).toMatchObject({ referenceLineType: 1 });
    const date = c.conceptDefs.find((d: Json) => d.name === p.dateRangeDimension);
    expect(date.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
  });
  it('builds value and share columns from one metric without losing current filters', async () => {
    const f = setup();
    await f.run('component_template_add', { ...base, template_id: 'common-detail-table', bindings: { ...base.bindings, dimension: 'category' }, common_options: { percent_of_total: true } });
    const c = f.original.page[0]!.page.componentConfig![0] as Json, names = prop(c).metrics.labeledConcepts[0].value.conceptNames;
    expect(names).toHaveLength(2);
    const concepts = names.map((name: string) => c.conceptDefs.find((d: Json) => d.name === name));
    expect(concepts.every((d: Json) => d.queryTimeTransformation.dataTransformation.sourceFieldName === '_value_')).toBe(true);
    expect(JSON.stringify(concepts[0])).not.toEqual(JSON.stringify(concepts[1]));
    expect(parsed(await f.run('component_template_inspect', { template_id: 'common-detail-table' })).supported_options).toEqual(['percent_of_total', 'data_bars', 'comparison', 'density', 'surface', 'visible_rows', 'presentation', 'design_rules']);
  });
  it('preview validates without a write and rejects invalid fields and roles before saves', async () => {
    const f = setup();
    expect(parsed(await f.run('component_template_add', { ...base, preview: true }))).toMatchObject({ saved: false, preview: true, component_count: 1 });
    expect(f.writes()).toEqual([]);
    await expect(f.run('component_template_add', { ...base, bindings: { metric: 'missing' } })).rejects.toThrow(/missing/i);
    await expect(f.run('component_template_add', { ...base, bindings: { metric: 'value', ignored: 'category' } })).rejects.toThrow(/Unknown role/);
    expect(f.writes()).toEqual([]);
  });
  it('works on a report with any name and rejects unsupported input instead of ignoring it', async () => {
    const f = setup(); f.original.shareable.name = 'Customer report';
    expect((await f.run('component_template_add', base)).isError).toBeFalsy();
    expect(f.writes().length).toBeGreaterThan(0);
    expect(() => commonChartArgs({ ...base, common_options: { average_line: true } })).toThrow(/does not apply/);
    expect(() => commonChartArgs({ ...base, date_range: 'Last 7 days' })).toThrow(/date role/);
    expect(() => commonChartArgs({ ...base, common_options: { comparison: 'Previous period' } })).toThrow(/date role/);
    expect(() => commonChartArgs({ ...base, texts: { ignored: 'bad' } })).toThrow(/Unknown common text/);
    await expect(f.run('component_template_add', { ...base, template_id: 'saved-design', size: { width: 300, height: 200 } })).rejects.toThrow(/only to built-in/);
  });
});
