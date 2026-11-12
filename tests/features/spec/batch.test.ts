import { afterEach, describe, expect, it, vi } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { BATCH_TOOLS } from '../../../src/features/spec/engine.js';
import { FEATURE_TOOLS } from '../../../src/features/registry.generated.js';
import { fake, ORIGINAL, specification } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

describe('report action batches', () => {
  it('spec.batch.run: executes in order, includes reads, uses one audit entry and shares a single snapshot', async () => {
    const f = fake({ snapshots: true });
    const result = await f.add('batch_apply', { actions: [{ tool: 'text_add', args: { text: 'A' } }, { tool: 'shape_add', args: { shape: 'rectangle' } }, { tool: 'page_list' }] });
    expect(resultText(result)).toContain('3 of 3 actions done');
    expect(f.original.page[0]!.page.componentConfig!.map((component) => component.type)).toEqual(['simple-description', 'generic-shape']);
    expect(f.sent('createNamedRevision')).toHaveLength(1); expect(f.audit.map((entry) => entry.tool)).toEqual(['batch_apply']);
  });

  it('spec.batch.run: rejects zero or over 200 actions before Rap and previews without writes', async () => {
    const f = fake();
    for (const actions of [[], Array.from({ length: 201 }, () => ({ tool: 'page_list' }))]) await expect(f.add('batch_apply', { actions })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toEqual([]);
    const dry = fake({ dryRun: true }); const result = await dry.add('batch_apply', { actions: [{ tool: 'text_add', args: { text: 'A' } }] });
    expect(resultText(result)).toContain('Planned 1 actions'); expect(dry.writes()).toEqual([]); expect(dry.original.page[0]!.page.componentConfig).toEqual([]);
  });

  it('spec.batch.tools: advertises exactly 33 registered permitted names and rejects deletions/legacy names', async () => {
    expect(BATCH_TOOLS).toHaveLength(33);
    for (const name of BATCH_TOOLS) expect(FEATURE_TOOLS.some((tool) => tool.name === name)).toBe(true);
    for (const tool of ['report_delete', 'add_chart']) {
      const f = fake(); await expect(f.add('batch_apply', { actions: [{ tool }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining(BATCH_TOOLS.join(', ')) }); expect(f.writes()).toEqual([]);
    }
  });

  it('spec.batch.validate: collects unknown tools and semantic chart rules while accepting the same report URL', async () => {
    const f = fake(); let message = '';
    try { await f.add('batch_apply', { actions: [{ tool: 'nope' }, { tool: 'chart_add', args: { type: 'bar', metrics: [] } }, { tool: 'text_add', args: { report_id: `https://lookerstudio.google.com/reporting/${ORIGINAL}`, text: 'A' } }] }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('1. nope'); expect(message).toContain('2. chart_add'); expect(message).not.toContain('3. text_add'); expect(f.writes()).toEqual([]);
  });

  it('spec.batch.validate: rejects another report, bad SQL and a missing chart field before any writes', async () => {
    const f = fake();
    await expect(f.add('batch_apply', { actions: [{ tool: 'text_add', args: { report_id: '22222222-2222-4222-8222-222222222222', text: 'A' } }] })).rejects.toMatchObject({ message: expect.stringContaining('remove report_id') });
    await expect(f.add('batch_apply', { actions: [{ tool: 'datasource_add', args: { project_id: 'example-project', sql: 'SELEC 1' } }] })).rejects.toMatchObject({ code: 'invalid' });
    f.clear(); await expect(f.add('batch_apply', { actions: [{ tool: 'text_add', args: { text: 'A' } }, { tool: 'chart_add', args: { type: 'scorecard', metrics: [{ field: 'ghost' }] } }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('ghost') });
    expect(f.writes()).toEqual([]); expect(f.original.page[0]!.page.componentConfig).toEqual([]);
    const bodies = f.sent('getReport').map((call) => JSON.stringify(call.body)); expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('spec.batch.validate: carries a newly calculated field into later chart validation', async () => {
    const f = fake(); const result = await f.add('batch_apply', { actions: [
      { tool: 'calculated_field_add', args: { name: 'Double', formula: 'value*2', data_source: 'Metrics' } },
      { tool: 'chart_add', args: { type: 'scorecard', metrics: [{ field: 'Double' }] } },
    ] });
    expect(result.isError, resultText(result)).toBe(false); expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
  });

  it('spec.batch.validate: carries a renamed source into later chart validation', async () => {
    const f = fake(); const result = await f.add('batch_apply', { actions: [
      { tool: 'datasource_update', args: { data_source: 'Metrics', name: 'Renamed' } },
      { tool: 'chart_add', args: { type: 'scorecard', data_source: 'Renamed', metrics: [{ field: 'value' }] } },
    ] });
    expect(result.isError, resultText(result)).toBe(false); expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
  });

  for (const continue_on_error of [false, true])
    it(`spec.batch.continue_on_error: reports id-based runtime failure and continuation=${continue_on_error}`, async () => {
      const f = fake(); const result = await f.add('batch_apply', { continue_on_error, actions: [{ tool: 'text_add', args: { text: 'A' } }, { tool: 'component_delete', args: { component_id: 'cd-nope' } }, { tool: 'text_add', args: { text: 'B' } }] });
      expect(result.isError).toBe(true); expect(f.original.page[0]!.page.componentConfig).toHaveLength(continue_on_error ? 2 : 1);
      expect(resultText(result)).toContain(continue_on_error ? '3. text_add: ok' : '3. text_add: skipped (after an error)');
      expect(f.sent('restoreRevision')).toHaveLength(0); expect(f.sent('updateRemovedState')).toHaveLength(0);
    });

  it('spec.batch.validate: cannot introduce deferred email input through actions, SQL or spec files', async () => {
    for (const args of [{ viewer_email_param: true }, { sql: 'SELECT @DS_USER_EMAIL', project_id: 'example-project' }]) {
      const f = fake(); await expect(f.add('batch_apply', { actions: [{ tool: 'datasource_add', args }] })).rejects.toMatchObject({ message: expect.stringContaining('deferred') }); expect(f.calls).toEqual([]);
    }
    const f = fake(); await expect(f.run('report_spec_apply', { spec: { ...specification(), data_sources: [{ name: 'Deferred', viewer_email_param: true }] } })).rejects.toMatchObject({ code: 'refused' }); expect(f.calls).toEqual([]);
  });
});
