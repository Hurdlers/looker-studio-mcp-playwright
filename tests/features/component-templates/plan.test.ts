import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { column, fake, ORIGINAL, SOURCE, type Json } from '../spec/fake.js';

function setup(options: Parameters<typeof fake>[0] = {}) {
  const f = fake(options);
  f.original.shareable.name = '[looker-studio-mcp-lab-1] intent planning';
  return f;
}
const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
const metric = { field: 'value', aggregation: 'sum' };
const base = { report_id: ORIGINAL, purpose: 'trend', bindings: { metric, date: 'day' } };
const boundField = (value: string | Json) => typeof value === 'string' ? value : value.field;

function alternate(f: ReturnType<typeof fake>) {
  const source = structuredClone(f.sources[SOURCE]!);
  source.name = 'Alternate'; source.block.datasourceId = 'alternate-source'; source.block.datasourceBlock.name = 'Alternate';
  f.sources['alternate-source'] = source;
  f.original.report.resource!.datasourceAlias!.push({ datasourceId: 'alternate-source', alias: 'alternate' });
}

describe('component planning from an explicit analysis purpose', () => {
  it('reports the required larger canvas without resizing the page during planning', async () => {
    const f = setup();
    f.original.report.attributeConfig = { reportAttribute: { width: 1200, height: 400 } };
    const before = structuredClone(f.original);
    const out = parsed(await f.run('component_template_plan', { ...base, position: { left: 24, top: 600 }, size: { width: 720, height: 360 } }));
    expect(out.status).toBe('ready');
    expect(out.preview.canvas).toEqual({ width: 1200, height: 984 });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });
  it.each([
    ['trend', 'common-time-trend'], ['comparison', 'common-category-bars'],
    ['share', 'common-radial-share'], ['kpi', 'common-kpi'],
    ['detail', 'common-detail-table'], ['relationship', 'common-xy-scatter'],
    ['overview', 'common-overview-section'], ['cross_tab', 'common-pivot-table'],
  ])('recommends %s without inventing missing fields', async (purpose, template_id) => {
    const f = setup();
    const out = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose }));
    expect(out.recommendation).toMatchObject({ template_id, reason: expect.any(String) });
    expect(out.status).toBe('needs_input');
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.execution).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it.each([
    ['trend', { metric, date: 'day' }],
    ['comparison', { metric, dimension: 'category' }],
    ['share', { metric, dimension: 'category' }],
    ['kpi', { metric }],
    ['detail', { metric, dimension: 'category' }],
    ['relationship', { dimension: 'category', x_metric: metric, y_metric: metric }],
    ['overview', { metric, date: 'day', dimension: 'category' }],
    ['cross_tab', { metric, row: 'category', column: 'day' }],
  ])('validates complete %s roles using the public creation path', async (purpose, bindings) => {
    const f = setup({ snapshots: true }), before = structuredClone(f.original);
    const out = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose, bindings }));
    expect(out.status).toBe('ready'); expect(out.issues).toEqual([]);
    expect(out.validation).toBe('public_tool_preflight');
    expect(out.execution.tool).toBe('component_template_add');
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('produces a field-ID-bound, executable trend plan without writes or snapshots', async () => {
    const f = setup({ snapshots: true }), before = structuredClone(f.original);
    const out = parsed(await f.run('component_template_plan', { ...base, date_range: '2026-11-01..2026-11-03', texts: { title: 'Revenue trend' } }));
    expect(out.status).toBe('ready'); expect(out.issues).toEqual([]);
    expect(out.execution).toMatchObject({ tool: 'component_template_add', arguments: { template_id: 'common-time-trend', bindings: { metric: { field: '_value_', aggregation: 'sum' } }, date_range: '2026-11-01..2026-11-03' } });
    expect(boundField(out.execution.arguments.bindings.date)).toBe('_day_');
    expect(out.execution.arguments.preview).not.toBe(true);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run(out.execution.tool, out.execution.arguments);
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
    const chart = (await f.exportSpec()).spec.pages[0].components[0];
    expect(chart.type).toBe('time_series');
    expect(chart.metrics).toEqual([{ field: 'value', aggregation: 'sum' }]);
    expect(chart.date_range).toBe('2026-11-01..2026-11-03');
  });

  it('requires a deliberate metric aggregation rather than silently choosing the source default', async () => {
    const f = setup();
    const out = parsed(await f.run('component_template_plan', { ...base, bindings: { metric: 'value', date: 'day' } }));
    expect(out.status).toBe('needs_input'); expect(out.execution).toBeUndefined();
    expect(out.issues.some((issue: Json) => issue.role === 'metric')).toBe(true);
    expect(f.writes()).toEqual([]);
  });

  it('keeps Auto aggregation omitted and refuses aggregating it again', async () => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push({ ...column('_total_', 'total', 33), defaultAggregationType: 7, textFormula: 'SUM(value)' });
    const ready = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose: 'kpi', bindings: { metric: 'total' } }));
    expect(ready.status).toBe('ready');
    expect(boundField(ready.execution.arguments.bindings.metric)).toBe('_total_');
    expect(ready.execution.arguments.bindings.metric.aggregation).toBeUndefined();
    expect(JSON.stringify(ready.fields)).not.toContain('SUM(value)');
    // Native formulas can also be passthrough column expressions; their
    // presence alone does not establish that a field is user-calculated.
    expect(ready.fields.every((field: Json) => !('calculated' in field))).toBe(true);
    const blocked = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose: 'kpi', bindings: { metric: { field: 'total', aggregation: 'sum' } } }));
    expect(blocked.status).not.toBe('ready'); expect(blocked.execution).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it('rejects ambiguous display names but accepts the exact field ID', async () => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_other_value_', 'value', 33));
    const ambiguous = parsed(await f.run('component_template_plan', base));
    expect(ambiguous.status).toBe('needs_input'); expect(ambiguous.execution).toBeUndefined();
    expect(ambiguous.issues.some((issue: Json) => issue.role === 'metric' && issue.candidates?.length === 2)).toBe(true);
    const exact = parsed(await f.run('component_template_plan', { ...base, bindings: { ...base.bindings, metric: { field: '_other_value_', aggregation: 'sum' } } }));
    expect(exact.status).toBe('ready');
    expect(exact.execution.arguments.bindings.metric.field).toBe('_other_value_');
    expect(f.writes()).toEqual([]);
  });

  it('asks which source to use when more than one source is connected', async () => {
    const f = setup(); alternate(f);
    const missing = parsed(await f.run('component_template_plan', base));
    expect(missing.status).toBe('needs_input'); expect(missing.execution).toBeUndefined();
    const selected = parsed(await f.run('component_template_plan', { ...base, data_source: 'Alternate' }));
    expect(selected.status).toBe('ready');
    expect(selected.execution.arguments.data_source).toBe('alternate-source');
    expect(f.writes()).toEqual([]);
  });

  it('refuses an incompatible template override, role type and date range before writes', async () => {
    const f = setup();
    for (const args of [
      { ...base, template_id: 'common-kpi' },
      { ...base, bindings: { metric, date: 'category' } },
      { ...base, bindings: { metric: { field: 'category', aggregation: 'sum' }, date: 'day' } },
      { ...base, date_range: 'not a date interval' },
    ]) {
      const out = parsed(await f.run('component_template_plan', args));
      expect(out.status).not.toBe('ready'); expect(out.execution).toBeUndefined();
      expect(out.issues.length).toBeGreaterThan(0);
    }
    expect(f.writes()).toEqual([]);
  });

  it('keeps the share-table recommendation tied to an actual percent-of-total column', async () => {
    const f = setup();
    const args = { report_id: ORIGINAL, purpose: 'share', template_id: 'common-detail-table', bindings: { metric, dimension: 'category' } };
    const out = parsed(await f.run('component_template_plan', args));
    expect(out.status).toBe('ready');
    expect(out.execution.arguments.common_options).toMatchObject({ percent_of_total: true });
    const invalid = parsed(await f.run('component_template_plan', { ...args, common_options: { percent_of_total: false } }));
    expect(invalid.status).toBe('invalid'); expect(invalid.execution).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it('rejects conflicting update targets without making a plan or writing', async () => {
    const f = setup();
    const out = parsed(await f.run('component_template_plan', { ...base, target: { component_id: 'chart-id', group_id: 'group-id' } }));
    expect(out.status).toBe('invalid'); expect(out.execution).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it('marks execution unavailable inside an existing dry-run context', async () => {
    const f = setup();
    f.ctx.dryRun = true;
    const out = parsed(await f.run('component_template_plan', base));
    expect(out.status).toBe('ready'); expect(out.execution_available).toBe(false);
    expect(f.writes()).toEqual([]);
  });

  it('preflights an explicit update target without changing it and returns an executable update', async () => {
    const f = setup();
    const made = parsed(await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric }, position: { left: 40, top: 80 } }));
    const before = structuredClone(f.original); f.clear();
    const out = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose: 'kpi', bindings: { metric: { field: 'value', aggregation: 'avg' } }, target: { component_id: made.component_ids[0] }, texts: { title: 'Average value' } }));
    expect(out.status).toBe('ready');
    expect(out.execution).toMatchObject({ tool: 'component_template_update', arguments: { component_id: made.component_ids[0] } });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run(out.execution.tool, out.execution.arguments);
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
    expect(f.original.page[0]!.page.componentConfig![0]!.componentId).toBe(made.component_ids[0]);
    expect((await f.exportSpec()).spec.pages[0].components[0].metrics).toEqual([{ field: 'value', aggregation: 'avg' }]);
    f.clear();
    const invalid = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose: 'kpi', bindings: { metric }, target: { component_id: 'not-present' } }));
    expect(invalid.status).not.toBe('ready'); expect(invalid.execution).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it('remains a usable read-only planner when write tools are not registered', async () => {
    const f = setup({ snapshots: true });
    f.ctx.config.writesEnabled = false;
    f.ctx.tools = new Map([...f.ctx.tools].filter(([, tool]) => !tool.write));
    const out = parsed(await f.run('component_template_plan', base));
    expect(out.status).toBe('ready');
    expect(out.execution.tool).toBe('component_template_add');
    expect(out.execution_available).toBe(false);
    expect(f.writes()).toEqual([]);
  });
});
