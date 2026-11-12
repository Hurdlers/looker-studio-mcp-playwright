import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { fake, ORIGINAL, SOURCE, type Json } from '../spec/fake.js';

const metric = { field: 'value', aggregation: 'sum' as const };
const base = { report_id: ORIGINAL, template_id: 'common-time-trend', bindings: { metric, date: 'day' }, date_range: 'Last 7 days' };
const weekly = [{ field: 'day', kind: 'dimension' as const, date_granularity: 'Year Week', display_format: 'YYYY-ww' }];
function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] analysis input fixture'; return f; }
async function parsed(f: ReturnType<typeof fake>, tool: string, args: Json) {
  const result = await f.run(tool, args); expect(result.isError, resultText(result)).toBeFalsy(); return JSON.parse(resultText(result));
}
const prop = (c: Json): Json => c.propertyConfig.componentProperty;
function concept(c: Json, name: string): Json { return c.conceptDefs.find((d: Json) => d.name === name); }
function displayedDate(c: Json): Json { return concept(c, prop(c).dimensions.labeledConcepts[0].value.conceptNames[0]); }
function assertGrainAndFilter(c: Json, grain: number, ascending: boolean) {
  const date = displayedDate(c), range = concept(c, prop(c).dateRangeDimension);
  expect(date.queryTimeTransformation.dataTransformation.transformationConfig).toEqual({ transformationType: grain });
  expect(range.name).not.toBe(date.name);
  expect(range.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
  expect(range.queryTimeTransformation.dataTransformation.transformationConfig).toBeUndefined();
  expect(prop(c).sort[0]).toMatchObject({ sortColumn: date.name, sortDir: ascending ? 0 : 1 });
}

describe('explicit analytical inputs on common structures', () => {
  it('keeps omitted inputs unchanged and refuses overlapping sorting instructions', () => {
    expect(commonChartArgs(base).args).not.toHaveProperty('sort_by');
    expect(commonChartArgs(base).args).not.toHaveProperty('field_formats');
    expect(commonChartArgs({ ...base, sort_by: 'day', sort_ascending: true, field_formats: weekly }).args).toMatchObject({
      sort_by: 'day', sort_ascending: true, field_formats: weekly,
    });
    expect(() => commonChartArgs({ ...base, sort_ascending: false })).toThrow(/needs an explicit sort_by/);
    const category = { ...base, template_id: 'common-category-line', bindings: { metric, dimension: 'category', date: 'day' },
      common_options: { dimension_order: 'ascending' as const } };
    expect(commonChartArgs(category).args).toMatchObject({ sort_by: 'category', sort_ascending: true });
    expect(() => commonChartArgs({ ...category, sort_by: 'category', sort_ascending: false })).toThrow(/two sorting instructions/);
  });
  it('creates a weekly trend once while retaining date-filter precision, source fields and explicit average', async () => {
    const f = setup(), source = structuredClone(f.sources[SOURCE]);
    const args = { ...base, sort_by: 'day', sort_ascending: true, field_formats: weekly, common_options: { average_line: true } };
    const preview = await parsed(f, 'component_template_add', { ...args, preview: true });
    expect(preview.saved).toBe(false); expect(f.writes()).toEqual([]);
    await parsed(f, 'component_template_add', args);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    assertGrainAndFilter(c, 4, true);
    expect(displayedDate(c).queryTimeTransformation.displayTransformation.displayFormat).toBe('YYYY-ww');
    expect(prop(c).lineChartProperty.referenceLineProperty).toHaveLength(1);
    expect(f.sources[SOURCE]).toEqual(source);
  });
  it('passes explicit ordering and formats through a write-free plan and a complete update', async () => {
    const f = setup();
    const request = { report_id: ORIGINAL, purpose: 'trend', bindings: base.bindings, date_range: base.date_range,
      sort_by: 'day', sort_ascending: true, field_formats: weekly };
    const plan = await parsed(f, 'component_template_plan', request);
    expect(plan.status).toBe('ready'); expect(f.writes()).toEqual([]);
    expect(plan.execution.arguments).toMatchObject({ sort_by: 'day', sort_ascending: true, field_formats: weekly });
    const created = await parsed(f, plan.execution.tool, plan.execution.arguments);
    f.clear();
    const next = await parsed(f, 'component_template_plan', { ...request, sort_ascending: false,
      field_formats: [{ field: 'day', kind: 'dimension', date_granularity: 'Year Month' }], target: { component_id: created.component_ids[0] } });
    expect(next.status).toBe('ready'); expect(next.execution.tool).toBe('component_template_update'); expect(f.writes()).toEqual([]);
    await parsed(f, next.execution.tool, next.execution.arguments);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.componentId).toBe(created.component_ids[0]); assertGrainAndFilter(c, 3, false);
  });
  it('keeps per-item grain and sort through page composition, controls inheritance and appearance', async () => {
    const f = setup(), source = structuredClone(f.sources[SOURCE]);
    const args = { report_id: ORIGINAL, width: 1500, density: 'compact', appearance: 'outlined-report',
      controls: { data_source: 'Metrics', date_range: 'Last 7 days', date_range_dimension: 'day' },
      regions: [{ key: 'details', kind: 'table-trend', title: 'Fixture analysis', items: [
        { key: 'table', template_id: 'common-detail-table', bindings: { metric, dimension: 'category', date: 'day' },
          sort_by: 'category', sort_ascending: false, field_formats: [{ field: 'value', kind: 'metric', display_format: '0.00' }] },
        { key: 'trend', template_id: 'common-time-trend', bindings: base.bindings,
          sort_by: 'day', sort_ascending: true, field_formats: weekly },
      ] }] };
    await parsed(f, 'component_page_add', { ...args, preview: true }); expect(f.writes()).toEqual([]);
    await parsed(f, 'component_page_add', args); expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const charts = f.original.page[0]!.page.componentConfig! as Json[];
    const trend = charts.find(c => c.type === 'simple-linechart')!, table = charts.find(c => c.type === 'simple-table')!;
    assertGrainAndFilter(trend, 4, true); expect(prop(trend).dateDuration).toBeUndefined();
    expect(prop(table).dateDuration).toBeUndefined();
    expect(concept(table, prop(table).sort[0].sortColumn).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_category_');
    expect(prop(table).sort[0].sortDir).toBe(1);
    expect(concept(table, prop(table).metrics.labeledConcepts[0].value.conceptNames[0]).queryTimeTransformation.displayTransformation.displayFormat).toBe('0.00');
    expect(f.sources[SOURCE]).toEqual(source);
  });
  it('can preflight formatted table presentation on a read-only server without exposing write execution', async () => {
    const f = setup(); f.ctx.config.writesEnabled = false;
    f.ctx.tools = new Map([...f.ctx.tools].filter(([, tool]) => !tool.write));
    const before = structuredClone(f.original);
    const plan = await parsed(f, 'component_template_plan', { report_id: ORIGINAL, purpose: 'detail',
      bindings: { metric: { ...metric, label: 'Count' }, dimension: 'category' },
      sort_by: 'category', sort_ascending: false,
      field_formats: [{ field: 'Count', kind: 'metric', display_format: '0.00' }],
      common_options: { percent_of_total: true, presentation: { share_display: 'heatmap' } } });
    expect(plan.status).toBe('ready'); expect(plan.execution_available).toBe(false);
    expect(plan.execution.arguments).toMatchObject({ sort_by: 'category', sort_ascending: false });
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
    expect(f.ctx.tools.has('component_update')).toBe(false);
  });
  it('rejects ambiguous source-ID sorting for two metric aggregations and accepts the intended label', async () => {
    const f = setup();
    const args = { report_id: ORIGINAL, template_id: 'common-mixed-series',
      bindings: { dimension: 'category', metric: { field: '_value_', aggregation: 'sum', label: 'Total' },
        secondary_metric: { field: '_value_', aggregation: 'avg', label: 'Average' } } };
    await expect(f.run('component_template_add', { ...args, sort_by: '_value_' })).rejects.toThrow(/ambiguous/);
    expect(f.writes()).toEqual([]);
    await parsed(f, 'component_template_add', { ...args, sort_by: 'Average', sort_ascending: true });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    const sorted = concept(c, prop(c).sort[0].sortColumn);
    expect(sorted.queryTimeTransformation.displayTransformation.displayName).toBe('Average');
    expect(sorted.queryTimeTransformation.dataTransformation.aggregation).toBe(1);
    expect(prop(c).sort[0].sortDir).toBe(0);
  });
  it('refuses a shared dimension/metric source ID while a unique metric label stays sortable', async () => {
    const f = setup();
    const args = { report_id: ORIGINAL, template_id: 'common-detail-table',
      bindings: { dimension: '_value_', metric: { field: '_value_', aggregation: 'sum', label: 'Total' } } };
    await expect(f.run('component_template_add', { ...args, sort_by: '_value_' })).rejects.toThrow(/ambiguous/);
    expect(f.writes()).toEqual([]);
    await parsed(f, 'component_template_add', { ...args, sort_by: 'Total' });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(concept(c, prop(c).sort[0].sortColumn).queryTimeTransformation.displayTransformation.displayName).toBe('Total');
  });
  it('sorts a weekly displayed date without confusing its separate raw date filter', async () => {
    const f = setup();
    const created = await parsed(f, 'component_template_add', { ...base, field_formats: weekly });
    const result = await f.run('component_update', { report_id: ORIGINAL, component_id: created.component_ids[0], sort_by: '_day_', sort_ascending: true });
    expect(result.isError, resultText(result)).toBeFalsy();
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    assertGrainAndFilter(c, 4, true);
  });
  it.each([
    { sort_by: 'missing' },
    { sort_ascending: true },
    { field_formats: [{ field: 'missing', date_granularity: 'Year Week' }] },
    { field_formats: [{ field: 'value', kind: 'metric', date_granularity: 'Year Week' }] },
  ])('refuses invalid analytical selections before writing %#', async extra => {
    const f = setup(), before = structuredClone(f.original);
    await expect(f.run('component_template_add', { ...base, ...extra })).rejects.toThrow();
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });
  it('refuses analytical overrides on compositions and saved recipes instead of ignoring them', async () => {
    const f = setup();
    for (const template_id of ['common-overview-section', 'common-navbar', 'saved-design']) {
      await expect(f.run('component_template_add', { ...base, template_id, sort_by: 'day', field_formats: weekly })).rejects.toThrow(/individual common charts|built-in common structures/);
    }
    expect(f.writes()).toEqual([]);
  });
});
