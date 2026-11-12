import { describe, expect, it, vi } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { chartProperty } from '../../../src/features/chart-options/common.js';
import { column, fake, ORIGINAL, SOURCE, type Json } from '../spec/fake.js';

const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
function setup(options: Parameters<typeof fake>[0] = {}) {
  const f = fake(options);
  f.original.shareable.name = '[looker-studio-mcp-lab-1] metric patches';
  f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_orders_', 'orders', 33));
  return f;
}
const chart = { report_id: ORIGINAL, template_id: 'common-kpi', data_source: SOURCE,
  bindings: { metric: { field: 'value', aggregation: 'sum', label: 'Selected value' }, date: 'day' },
  texts: { title: 'Keep this title' }, date_range: '2026-11-01..2026-11-03',
  position: { left: 40, top: 60 }, size: { width: 360, height: 200 } };
const section = { report_id: ORIGINAL, template_id: 'common-overview-section', data_source: SOURCE,
  bindings: { metric: { field: 'value', aggregation: 'sum', label: 'Selected value' }, date: 'day', dimension: 'category' },
  texts: { title: 'Keep section title', description: 'Keep description' }, date_range: '2026-11-01..2026-11-03',
  position: { left: 24, top: 24 }, size: { width: 1200, height: 900 } };
const page = (f: ReturnType<typeof fake>) => f.original.page[0]!;
const components = (f: ReturnType<typeof fake>) => page(f).page.componentConfig! as Json[];
const props = (c: Json) => c.propertyConfig.componentProperty;
function metricDefinitions(c: Json): Json[] {
  const names = new Set((props(c)?.metrics?.labeledConcepts ?? []).flatMap((slot: Json) => slot.value?.conceptNames ?? []));
  return (c.conceptDefs ?? []).filter((entry: Json) => names.has(entry.name));
}
const change = { from: 'value', to: 'orders' };
async function expectBlocked(f: ReturnType<typeof fake>, args: Json) {
  let output: Json;
  try { output = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, ...args })); }
  catch (error) { expect(error).toBeInstanceOf(Error); return; }
  expect(output.saved).toBe(false);
  expect(output.issues?.length ?? 0).toBeGreaterThan(0);
}

describe('partial metric changes with native settings preserved', () => {
  it('changes only the metric source reference and keeps title, range, labels, styles, filter and position', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    await f.run('component_update', { report_id: ORIGINAL, component_id: made.component_ids[0], filters: [{ name: 'Keep category A', field: 'category', condition: 'equals', values: ['A'] }] });
    const original = structuredClone(components(f)[0]!);
    const expected = structuredClone(original);
    for (const def of metricDefinitions(expected)) def.queryTimeTransformation.dataTransformation.sourceFieldName = '_orders_';
    const report = structuredClone(f.original.report), canvas = structuredClone(page(f).page.attributeConfig);
    f.clear();
    const result = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [change] }));
    expect(result.saved).toBe(true);
    expect(components(f)[0]).toEqual(expected);
    expect(f.original.report).toEqual(report); expect(page(f).page.attributeConfig).toEqual(canvas);
    expect(f.writes().filter(call => call.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().every(call => call.endpoint === 'updatePage')).toBe(true);
  });

  it('patches every matching section metric while leaving controls, group scope and the neighboring section unchanged', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', section));
    await f.run('component_template_add', { ...section, position: { left: 24, top: 1000 } });
    const targetGroup = page(f).page.groupConfig!.find(group => group.groupId === made.group_id)! as Json;
    targetGroup.propertyConfig.groupProperty.inheritFilters = false;
    for (const c of components(f).filter(c => made.component_ids.includes(c.componentId))) {
      for (const def of metricDefinitions(c)) if (def.resultTransformation?.analyticalFunction === 1) {
        def.resultTransformation.isRelativeToBase = true;
        def.resultTransformation.bypassCanvasFilters = true;
      }
    }
    const before = structuredClone(page(f).page);
    const controlsBefore = (before.componentConfig as Json[]).filter(c => made.component_ids.includes(c.componentId)
      && ['dimension-filter', 'simple-daterangepicker'].includes(c.type));
    expect(controlsBefore).toHaveLength(2);
    // A real source metric in a selector must still remain outside a chart patch.
    const selector = controlsBefore.find(c => c.type === 'dimension-filter')!;
    expect(metricDefinitions(selector)[0]!.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_value_');
    const expected = structuredClone(before);
    const chartTypes = new Set(['kpi-metric', 'simple-linechart', 'simple-table']);
    for (const c of expected.componentConfig as Json[]) if (made.component_ids.includes(c.componentId) && chartTypes.has(c.type)) {
      for (const def of metricDefinitions(c)) if (def.queryTimeTransformation.dataTransformation.sourceFieldName === '_value_')
        def.queryTimeTransformation.dataTransformation.sourceFieldName = '_orders_';
    }
    f.clear();
    const out = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, group_id: made.group_id, metrics: [change] }));
    expect(out.saved).toBe(true);
    expect(page(f).page).toEqual(expected);
    expect(components(f).filter(c => controlsBefore.some(control => control.componentId === c.componentId))).toEqual(controlsBefore);
    expect(out.changed_component_ids).toHaveLength(3);
    expect(page(f).page.groupConfig).toEqual(before.groupConfig);
    expect(f.writes().filter(call => call.endpoint === 'updatePage')).toHaveLength(1);
  });

  it('asks about incompatible units without saving, then uses source formatting while preserving the share calculation', async () => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push({ ...column('_money_', 'money', 12), dataType: 5, defaultAggregationType: 6 });
    const made = parsed(await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-detail-table',
      bindings: { dimension: 'category', metric: { field: 'money', aggregation: 'sum' } }, common_options: { percent_of_total: true } }));
    const c = components(f)[0]!, defs = metricDefinitions(c), share = defs.find(def => def.resultTransformation?.analyticalFunction === 1)!;
    share.queryTimeTransformation.displayTransformation.outputSemanticInfo = { semanticConfig: [{ semanticType: 14 }] };
    share.queryTimeTransformation.displayTransformation.displayFormat = '0.0%';
    const before = structuredClone(f.original), shareBefore = structuredClone(share), sourceBefore = structuredClone(f.sources);
    f.clear();
    const missing = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'money', to: 'orders' }] }));
    expect(missing.status).toBe('needs_input'); expect(missing.saved).toBe(false);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'money', to: 'orders', format: 'source' }] });
    const after = metricDefinitions(components(f)[0]!);
    expect(after.every(def => def.queryTimeTransformation.dataTransformation.sourceFieldName === '_orders_')).toBe(true);
    const percent = after.find(def => def.name === shareBefore.name)!;
    expect(percent.resultTransformation).toEqual(shareBefore.resultTransformation);
    expect(percent.queryTimeTransformation.displayTransformation).toEqual(shareBefore.queryTimeTransformation.displayTransformation);
    const raw = after.find(def => def.name !== shareBefore.name)!;
    expect(raw.queryTimeTransformation.displayTransformation.outputSemanticInfo.semanticConfig[0].semanticType).toBe(33);
    expect(f.sources).toEqual(sourceBefore);
  });

  it('supports an explicit decision to keep an existing display format', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    const def = metricDefinitions(components(f)[0]!)[0]!;
    def.queryTimeTransformation.displayTransformation.displayFormat = '0.00';
    const display = structuredClone(def.queryTimeTransformation.displayTransformation);
    f.clear();
    await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ ...change, format: 'preserve' }] });
    expect(metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.displayTransformation).toEqual(display);
  });

  it('does not silently carry a monetary or percent pattern onto a different numeric metric', async () => {
    for (const pattern of ['₩#,##0', '0.0%']) {
      const f = setup(), made = parsed(await f.run('component_template_add', chart));
      metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.displayTransformation.displayFormat = pattern;
      const before = structuredClone(f.original); f.clear();
      const out = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [change] }));
      expect(out.status).toBe('needs_input');
      expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
      await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ ...change, format: 'source' }] });
      expect(metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.displayTransformation.displayFormat).toBeUndefined();
    }
  });

  it('previews without writes or snapshots and treats an unchanged binding as no-op', async () => {
    const f = setup({ snapshots: true }), made = parsed(await f.run('component_template_add', chart));
    const before = structuredClone(f.original); f.clear();
    const preview = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [change], preview: true }));
    expect(preview.saved).toBe(false); expect(preview.preview).toBe(true);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    const noop = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'value', to: 'value' }] }));
    expect(noop.saved).toBe(false);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('refuses unknown and ambiguous fields, unused replacements and conflicting replacements before saving', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_other_orders_', 'orders', 33));
    const before = structuredClone(f.original); f.clear();
    for (const metrics of [[{ from: 'value', to: 'missing' }], [change], [{ from: 'category', to: '_orders_' }], [
      { from: 'value', to: '_orders_' }, { from: 'value', to: '_other_orders_' },
    ]]) await expectBlocked(f, { component_id: made.component_ids[0], metrics });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: '_value_', to: '_orders_' }] });
    expect(metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_orders_');
  });

  it('does not sum an Auto metric again and requires aggregation when returning to a raw field', async () => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push({ ...column('_total_', 'total', 33), defaultAggregationType: 7, textFormula: 'SUM(value)' });
    const made = parsed(await f.run('component_template_add', chart));
    await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'value', to: 'total' }] });
    const data = metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.dataTransformation;
    expect(data.sourceFieldName).toBe('_total_'); expect(data.aggregation).toBeUndefined();
    const before = structuredClone(f.original); f.clear();
    await expectBlocked(f, { component_id: made.component_ids[0], metrics: [{ from: 'total', to: 'orders' }] });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'total', to: 'orders', aggregation: 'avg' }] });
    expect(metricDefinitions(components(f)[0]!)[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(1);
  });

  it('rejects conditional or metric-dependent filter references without altering native rules', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    const c = components(f)[0]!, metricId = metricDefinitions(c)[0]!.name;
    page(f).chartCondition = [{ chartId: c.componentId, conditions: [{ conceptName: metricId, value: 10 }] }];
    f.clear();
    await expectBlocked(f, { component_id: made.component_ids[0], metrics: [change] });
    expect(f.writes()).toEqual([]);
    page(f).chartCondition = [];
    props(c).filters = [{ conceptName: metricId, threshold: 10 }];
    const before = structuredClone(f.original);
    await expectBlocked(f, { component_id: made.component_ids[0], metrics: [change] });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('rejects nested or multiply owned group members and requires an exact target', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', section)); f.clear();
    await expectBlocked(f, { metrics: [change] });
    await expectBlocked(f, { component_id: made.component_ids[0], group_id: made.group_id, metrics: [change] });
    page(f).page.groupConfig!.push({ groupId: 'outer', childGroupId: [made.group_id], componentId: [] });
    await expectBlocked(f, { group_id: made.group_id, metrics: [change] });
    page(f).page.groupConfig!.pop();
    page(f).page.groupConfig!.push({ groupId: 'shared', componentId: [made.component_ids[0]], childGroupId: [] });
    await expectBlocked(f, { group_id: made.group_id, metrics: [change] });
    expect(f.writes()).toEqual([]);
  });

  it('refuses duplicate group IDs even when the groups have disjoint members', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', section));
    await f.run('component_template_add', { ...section, position: { left: 24, top: 1000 } });
    page(f).page.groupConfig![1]!.groupId = made.group_id;
    const before = structuredClone(f.original); f.clear();
    await expectBlocked(f, { group_id: made.group_id, metrics: [change] });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('refuses unsupported metric-bearing components and groups with their own bound source', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    components(f)[0]!.type = 'external-metric-display';
    const before = structuredClone(f.original); f.clear();
    await expectBlocked(f, { component_id: made.component_ids[0], metrics: [change] });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    const grouped = setup(), group = parsed(await grouped.run('component_template_add', section));
    page(grouped).page.groupConfig![0]!.datasourceId = SOURCE;
    grouped.clear();
    await expectBlocked(grouped, { group_id: group.group_id, metrics: [change] });
    expect(grouped.writes()).toEqual([]);
  });

  it('preserves a metric average line but asks about a constant threshold before replacing the metric', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', { ...chart, template_id: 'common-time-trend', size: { width: 720, height: 360 }, common_options: { average_line: true } }));
    const c = components(f)[0]!;
    const line = chartProperty(c).referenceLineProperty.find((entry: Json) => entry.referenceLineType === 1);
    expect(line).toBeDefined();
    line.referenceLineNumberValue = 0;
    const expected = structuredClone(c);
    for (const def of metricDefinitions(expected)) def.queryTimeTransformation.dataTransformation.sourceFieldName = '_orders_';
    f.clear();
    const applied = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [change] }));
    expect(applied.saved).toBe(true); expect(components(f)[0]).toEqual(expected);
    await f.run('component_update', { report_id: ORIGINAL, component_id: made.component_ids[0], reference_lines: [{ type: 'Constant value', value: 10 }] });
    const before = structuredClone(f.original); f.clear();
    const rejected = parsed(await f.run('component_template_patch', { report_id: ORIGINAL, component_id: made.component_ids[0], metrics: [{ from: 'orders', to: 'value' }] }));
    expect(rejected.status).toBe('needs_input');
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('does not overwrite a target changed during preparation', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', chart));
    const edit = f.ctx.session.editPage.bind(f.ctx.session);
    vi.spyOn(f.ctx.session, 'editPage').mockImplementation((report, pageId, mutate, reason) => edit(report, pageId, current => {
      (current.page.componentConfig![0]!.attributeConfig as Json).componentAttribute.left += 10;
      mutate(current, f.original);
    }, reason));
    f.clear();
    await expectBlocked(f, { component_id: made.component_ids[0], metrics: [change] });
    expect(f.writes()).toEqual([]);
  });
});
