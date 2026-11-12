import { describe, expect, it, vi } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { column, fake, ORIGINAL, TABLE, type Json } from '../spec/fake.js';

const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
const base = { report_id: ORIGINAL, purpose: 'trend', bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day' } };
const connection = { ...TABLE, source_name: 'New metrics' };
const calculated_field = { name: 'Adjusted value', formula: 'value * 2' };

function setup(options: Parameters<typeof fake>[0] = {}, empty = false) {
  const f = fake({ snapshots: true, ...options });
  f.original.shareable.name = '[looker-studio-mcp-lab-1] preparation planning';
  if (empty) f.original.report.resource!.datasourceAlias = [];
  const metadata = vi.spyOn(f.ctx.bigquery, 'getTable').mockResolvedValue({
    type: 'TABLE', schema: { fields: [
      { name: 'category', type: 'STRING', mode: 'NULLABLE' },
      { name: 'value', type: 'FLOAT', mode: 'NULLABLE' },
      { name: 'day', type: 'DATE', mode: 'NULLABLE' },
    ] },
  });
  return { ...f, metadata };
}

function expectNoChartCall(out: Json) {
  expect(out.execution).toBeUndefined();
  expect(JSON.stringify(out.continuation ?? {})).not.toMatch(/dry-run|calc_[a-f0-9]{10}/);
}

describe('staged data preparation for component plans', () => {
  it('rejects a missing destination page before any preparation even when adding', async () => {
    const f = setup();
    for (const prerequisite of [{ connection }, { calculated_field }]) {
      const out = parsed(await f.run('component_template_plan', { ...base, page: 'missing page', ...prerequisite }));
      expect(out.status).toBe('invalid');
      expect(out.preparation).toBeUndefined();
    }
    expect(f.metadata).not.toHaveBeenCalled();
    expect(f.sent('validateFormula')).toEqual([]);
    expect(f.writes()).toEqual([]);
  });
  it('rejects a target on another page before preparing a source or calculation', async () => {
    const f = setup();
    const made = parsed(await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' } } }));
    await f.run('page_add', { report_id: ORIGINAL, name: 'Other' });
    f.clear(); f.metadata.mockClear();
    for (const prerequisite of [{ connection }, { calculated_field }]) {
      const out = parsed(await f.run('component_template_plan', { ...base, purpose: 'kpi', page: 'Other', target: { component_id: made.component_ids[0] }, ...prerequisite }));
      expect(out.status).toBe('invalid');
      expect(out.preparation).toBeUndefined();
    }
    expect(f.metadata).not.toHaveBeenCalled();
    expect(f.sent('validateFormula')).toEqual([]);
    expect(f.writes()).toEqual([]);
  });
  it('inspects a selected table without adding a source or fetching a Looker access token', async () => {
    const f = setup({}, true), before = structuredClone(f.original), sources = structuredClone(f.sources);
    const out = parsed(await f.run('component_template_plan', { ...base, connection }));
    expect(out.status).toBe('needs_preparation');
    expect(out.preparation).toHaveLength(1);
    expect(out.preparation[0]).toMatchObject({ tool: 'datasource_add', arguments: { report_id: ORIGINAL, ...connection } });
    expect(out.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'value' }), expect.objectContaining({ name: 'day' })]));
    expect(out.continuation).toMatchObject({ tool: 'component_template_plan', arguments: { ...base, data_source: 'New metrics' } });
    expect(out.continuation.arguments.connection).toBeUndefined();
    expectNoChartCall(out);
    expect(f.metadata).toHaveBeenCalledWith(TABLE.project_id, TABLE.dataset_id, TABLE.table_id);
    expect(f.original).toEqual(before); expect(f.sources).toEqual(sources);
    expect(f.writes()).toEqual([]); expect(f.sent('getFirstPartyAccessToken')).toEqual([]);
  });

  it('adds the emitted source and replans against its actual source and field IDs', async () => {
    const f = setup({}, true);
    const prepared = parsed(await f.run('component_template_plan', { ...base, connection }));
    await f.run(prepared.preparation[0].tool, prepared.preparation[0].arguments);
    const sourceId = f.original.report.resource!.datasourceAlias![0]!.datasourceId;
    const before = structuredClone(f.original); f.clear();
    const ready = parsed(await f.run(prepared.continuation.tool, prepared.continuation.arguments));
    expect(ready.status).toBe('ready');
    expect(ready.execution.arguments.data_source).toBe(sourceId);
    expect(ready.execution.arguments.bindings.metric.field).toBe('_value_');
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run(ready.execution.tool, ready.execution.arguments);
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
  });

  it('checks a custom SELECT using BigQuery dry-run only and leaves field resolution for after connection', async () => {
    const f = setup({}, true);
    const sql = 'SELECT category, value, day FROM `example-project.example_data.metrics`';
    const out = parsed(await f.run('component_template_plan', { ...base, connection: { project_id: TABLE.project_id, sql, source_name: 'Query metrics' } }));
    expect(out.status).toBe('needs_preparation');
    expect(out.preparation[0]).toMatchObject({ tool: 'datasource_add', arguments: { sql, source_name: 'Query metrics' } });
    expect(f.bqCalls.length).toBeGreaterThan(0);
    expect(f.bqCalls.every(call => call.dryRun === true)).toBe(true);
    expect(f.metadata).not.toHaveBeenCalled();
    expectNoChartCall(out); expect(f.writes()).toEqual([]);
  });

  it.each([
    'DELETE FROM `example-project.example_data.metrics` WHERE TRUE',
    'SELECT 1; SELECT 2',
    'SELECT @DS_START_DATE',
    'SELECT @DS_USER_EMAIL',
  ])('refuses unsafe or parameterized source SQL before any source write: %s', async sql => {
    const f = setup({}, true);
    const out = parsed(await f.run('component_template_plan', { ...base, connection: { project_id: TABLE.project_id, sql } }));
    expect(out.status).toBe('invalid'); expect(out.preparation).toBeUndefined();
    expectNoChartCall(out); expect(f.writes()).toEqual([]);
    expect(f.sent('getFirstPartyAccessToken')).toEqual([]);
  });

  it('refuses a mixed source selector, duplicate source name, or contradictory connection shape', async () => {
    const f = setup();
    for (const args of [
      { ...base, connection, data_source: 'ds1' },
      { ...base, connection: { ...connection, source_name: 'Metrics' } },
      { ...base, connection: { ...connection, sql: 'SELECT 1' } },
    ]) {
      const out = parsed(await f.run('component_template_plan', args));
      expect(out.status).toBe('invalid'); expect(out.preparation).toBeUndefined();
      expectNoChartCall(out);
    }
    expect(f.writes()).toEqual([]);
  });

  it('rejects a source SQL dry-run that exceeds the configured scan bound', async () => {
    const f = setup({}, true);
    vi.spyOn(f.ctx.bigquery, 'dryRun').mockResolvedValue({ bytesProcessed: f.ctx.config.bigquery.maxBytesBilled + 1, statementType: 'SELECT' });
    const out = parsed(await f.run('component_template_plan', { ...base, connection: { project_id: TABLE.project_id, sql: 'SELECT 1' } }));
    expect(out.status).toBe('invalid'); expect(out.preparation).toBeUndefined();
    expectNoChartCall(out); expect(f.writes()).toEqual([]);
  });

  it('validates one calculation without publishing it and re-resolves its real ID after execution', async () => {
    const f = setup(), before = structuredClone(f.sources);
    const requested = { ...base, bindings: { ...base.bindings, metric: { field: calculated_field.name, aggregation: 'sum' } }, calculated_field };
    const out = parsed(await f.run('component_template_plan', requested));
    expect(out.status).toBe('needs_preparation');
    expect(out.preparation).toHaveLength(1);
    expect(out.preparation[0]).toMatchObject({ tool: 'calculated_field_add', arguments: { report_id: ORIGINAL, ...calculated_field } });
    expect(out.continuation.arguments.calculated_field).toBeUndefined();
    expect(out.continuation.arguments.bindings.metric.field).toBe(calculated_field.name);
    expect(f.sent('validateFormula').length).toBeGreaterThan(0);
    expectNoChartCall(out); expect(f.sources).toEqual(before); expect(f.writes()).toEqual([]);
    await f.run(out.preparation[0].tool, out.preparation[0].arguments);
    const actual = Object.values(f.sources).flatMap(source => source.block.datasourceBlock.fields).find(field => field.outputName === calculated_field.name)!;
    f.clear();
    const ready = parsed(await f.run(out.continuation.tool, out.continuation.arguments));
    expect(ready.status).toBe('ready');
    expect(ready.execution.arguments.bindings.metric.field).toBe(actual.field.name);
    expect(f.writes()).toEqual([]);
  });

  it('keeps connection and formula prerequisites ordered and defers formula validation until the source exists', async () => {
    const f = setup({}, true);
    const first = parsed(await f.run('component_template_plan', { ...base, connection, calculated_field, bindings: { ...base.bindings, metric: { field: calculated_field.name, aggregation: 'sum' } } }));
    expect(first.status).toBe('needs_preparation');
    expect(first.preparation.map((step: Json) => step.tool)).toEqual(['datasource_add']);
    expect(first.continuation.arguments.calculated_field).toEqual(calculated_field);
    expect(f.sent('validateFormula')).toEqual([]); expect(f.writes()).toEqual([]);
    await f.run(first.preparation[0].tool, first.preparation[0].arguments); f.clear();
    const second = parsed(await f.run(first.continuation.tool, first.continuation.arguments));
    expect(second.status).toBe('needs_preparation');
    expect(second.preparation.map((step: Json) => step.tool)).toEqual(['calculated_field_add']);
    expect(f.writes()).toEqual([]);
    await f.run(second.preparation[0].tool, second.preparation[0].arguments); f.clear();
    const final = parsed(await f.run(second.continuation.tool, second.continuation.arguments));
    expect(final.status).toBe('ready'); expect(f.writes()).toEqual([]);
  });

  it('lets the created aggregate formula determine Auto semantics on the next plan', async () => {
    const f = setup({ formulaResponse: () => {
      const aggregate = column('validated', 'validated', 33);
      delete aggregate.defaultAggregationType;
      return { column: { ...aggregate, conceptType: 1 } };
    } });
    const out = parsed(await f.run('component_template_plan', { report_id: ORIGINAL, purpose: 'kpi',
      bindings: { metric: 'Total value' }, calculated_field: { name: 'Total value', formula: 'SUM(value)' } }));
    expect(out.status).toBe('needs_preparation'); expect(f.writes()).toEqual([]);
    await f.run(out.preparation[0].tool, out.preparation[0].arguments); f.clear();
    const ready = parsed(await f.run(out.continuation.tool, out.continuation.arguments));
    expect(ready.status).toBe('ready');
    expect(ready.execution.arguments.bindings.metric.aggregation).toBeUndefined();
    expect(f.writes()).toEqual([]);
  });

  it('returns no preparation for duplicate calculation names or invalid formulas', async () => {
    const f = setup();
    const duplicate = parsed(await f.run('component_template_plan', { ...base, calculated_field: { name: 'value', formula: 'value * 2' } }));
    expect(duplicate.status).toBe('invalid'); expect(duplicate.preparation).toBeUndefined(); expectNoChartCall(duplicate);
    expect(f.writes()).toEqual([]);
    const invalid = setup({ formulaResponse: () => 'invalid formula' });
    const rejected = parsed(await invalid.run('component_template_plan', { ...base, calculated_field }));
    expect(rejected.status).toBe('invalid'); expect(rejected.preparation).toBeUndefined(); expectNoChartCall(rejected);
    expect(invalid.writes()).toEqual([]);
  });

  it('plans connection and calculation prerequisites while write tools are disabled', async () => {
    const f = setup();
    f.ctx.config.writesEnabled = false;
    f.ctx.tools = new Map([...f.ctx.tools].filter(([, tool]) => !tool.write));
    const source = parsed(await f.run('component_template_plan', { ...base, connection }));
    expect(source.status).toBe('needs_preparation');
    const calc = parsed(await f.run('component_template_plan', { ...base, calculated_field }));
    expect(calc.status).toBe('needs_preparation');
    expectNoChartCall(source); expectNoChartCall(calc);
    expect(f.writes()).toEqual([]); expect(f.sent('getFirstPartyAccessToken')).toEqual([]);
  });
});
