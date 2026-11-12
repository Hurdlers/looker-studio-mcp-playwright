import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSpec, readState } from '../../../src/features/spec/model.js';
import { specToActions } from '../../../src/features/spec/plan.js';
import { column, fake, ORIGINAL, SOURCE, specification, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const planFresh = async (value: Json) => specToActions(await loadSpec({ spec: value }), undefined, { fresh: true, firstPageId: 'page-first' });

describe('specification plans', () => {
  it('spec.apply.order: creates sources/fields/blends before ordered pages and leaves report settings last', async () => {
    const plan = await planFresh({ ...specification(), theme: { preset: 'Constellation' }, data_sources: [{ ...TABLE, name: 'Metrics' }, { name: 'One', project_id: 'example-project', sql: 'SELECT 1 AS value' }],
      parameters: [{ name: 'Target' }], calculated_fields: [{ name: 'Double', formula: 'value*2' }], group_fields: [{ name: 'Groups', field: 'category', groups: [{ name: 'Selected', values: ['a'] }] }], bin_fields: [{ name: 'Bins', field: 'value', size: 5 }],
      blends: [{ name: 'Joined', tables: [], joins: [] }], report_settings: { data_source: 'Metrics' }, pages: [
        { name: 'Overview', components: [{ component: 'chart', type: 'table' }, { component: 'text', text: 'Title' }], settings: { data_source: 'Metrics' } },
        { name: 'Details', components: [{ component: 'shape', shape: 'rectangle' }], settings: { style: { 'Page background': '#FAFAFA' } } },
      ] });
    expect(plan.actions.map((action) => action.tool)).toEqual(['theme_update', 'datasource_add', 'parameter_add', 'calculated_field_add', 'group_field_add', 'bin_field_add', 'blend_create', 'page_rename', 'chart_add', 'text_add', 'page_settings_update', 'page_add', 'shape_add', 'page_settings_update', 'page_settings_update']);
    expect(plan.actions.at(-1)!.args!.scope).toBe('report');
  });

  it('spec.apply.data_sources: keeps custom names for tables and SQL while skipping an existing source', async () => {
    const f = fake(); const spec = await loadSpec({ spec: { ...specification(), data_sources: [{ ...TABLE, name: 'Metrics' }, { ...TABLE, name: 'Events' }, { name: 'One', project_id: 'example-project', sql: 'SELECT 1 AS value' }] } });
    const plan = specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false });
    expect(plan.actions.map((action) => action.tool)).toEqual(['datasource_add', 'datasource_add']);
    expect(plan.actions.map((action) => action.args!.source_name)).toEqual(['Events', 'One']);
  });

  it('spec.apply.theme: creates the theme first and preserves an existing theme unless explicitly enabled', async () => {
    const f = fake(), spec = await loadSpec({ spec: { ...specification(), theme: { preset: 'Constellation', canvas: { width: 1400, height: 1000 } } } });
    const state = await readState(f.ctx, ORIGINAL);
    expect(specToActions(spec, state, { fresh: false }).actions).toEqual([]);
    expect(specToActions(spec, state, { fresh: false }).notes.join()).toContain('unchanged');
    expect(specToActions(spec, state, { fresh: false, applyTheme: true }).actions[0]).toMatchObject({ tool: 'theme_update', args: { preset: 'Constellation' } });
    expect((await planFresh(spec)).actions[0]!.tool).toBe('theme_update');
  });

  it('spec.apply.parameters: checks existing names using the unique target source even when data_sources is empty', async () => {
    const f = fake(); f.sources[SOURCE]!.block.resource = { parameterConfiguration: { parameters: [{ key: 'target', value: { parameterDisplayConfiguration: { displayName: 'Target' } } }] } };
    const spec = await loadSpec({ spec: { ...specification(), data_sources: [], parameters: [{ name: 'Target' }, { name: 'Max', data_type: 'Number (whole)', default_value: '3' }] } });
    const plan = specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false });
    expect(plan.actions).toMatchObject([{ tool: 'parameter_add', args: { name: 'Max', default_value: 3 } }]);
    expect((await planFresh(spec)).actions.filter((action) => action.tool === 'parameter_add')).toHaveLength(2);
  });

  for (const [id, key, tool, items] of [
    ['spec.apply.calculated_fields', 'calculated_fields', 'calculated_field_add', [{ name: 'Double', formula: 'value*2' }, { name: 'Quadruple', formula: 'Double*2' }]],
    ['spec.apply.group_fields', 'group_fields', 'group_field_add', [{ name: 'Double', field: 'category', groups: [{ name: 'Selected', values: ['a'] }], other_group: 'Remaining' }]],
    ['spec.apply.bin_fields', 'bin_fields', 'bin_field_add', [{ name: 'Double', field: 'value', size: 5, min: 0, max: 50 }]],
  ] as const)
    it(`${id}: keeps field order and skips names already present in the target`, async () => {
      const f = fake(); f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('calc_double', 'Double', 33));
      const spec = await loadSpec({ spec: { ...specification(), data_sources: [], [key]: items } });
      expect((await planFresh(spec)).actions.filter((action) => action.tool === tool).map((action) => action.args)).toEqual(items);
      const plan = specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false });
      expect(plan.actions.map((action) => action.args!.name)).toEqual(key === 'calculated_fields' ? ['Quadruple'] : []);
    });

  it('spec.apply.blends: skips a named blend that is already present', async () => {
    const f = fake(); (f.original.report.resource as Json).dataViewResource = { entry: [{ key: 'blend-id', value: { blockDatasource: { datasourceBlock: { name: 'Joined' } } } }] };
    const spec = await loadSpec({ spec: { ...specification(), data_sources: [], blends: [{ name: 'Joined', tables: [], joins: [] }] } });
    expect(specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false }).actions).toEqual([]);
    expect((await planFresh(spec)).actions.find((action) => action.tool === 'blend_create')?.args?.name).toBe('Joined');
  });

  it('spec.apply.report_settings: adds report settings last for a new report and preserves existing settings', async () => {
    const f = fake(); const spec = await loadSpec({ spec: { ...specification(), report_settings: { filters: [{ name: 'Has category', field: 'category', condition: 'is_null', exclude: true }] } } });
    expect((await planFresh(spec)).actions.at(-1)).toMatchObject({ tool: 'page_settings_update', args: { scope: 'report', filters: [{ name: 'Has category' }] } });
    const plan = specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false });
    expect(plan.actions).toEqual([]); expect(plan.notes.join()).toContain('Report settings');
    await expect(loadSpec({ spec: { ...spec, report_settings: { style: {} } } })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('spec.apply.pages: renames the first new page, preserves duplicate names and never reorders existing pages', async () => {
    const spec = { ...specification(), pages: [{ name: 'Overview' }, { name: 'Details' }, { name: 'Overview' }] };
    const fresh = await planFresh(spec);
    expect(fresh.actions.map((action) => [action.tool, action.args!.name])).toEqual([['page_rename', 'Overview'], ['page_add', 'Details'], ['page_add', 'Overview']]);
    const f = fake(); await f.add('page_add', { name: 'Details' });
    const current = await loadSpec({ spec: { ...specification(), pages: [{ name: 'Details' }, { name: 'Overview' }, { name: 'New' }] } });
    expect(specToActions(current, await readState(f.ctx, ORIGINAL), { fresh: false }).actions).toMatchObject([{ tool: 'page_add', args: { name: 'New' } }]);
  });

  it('spec.apply.page_settings: places new page settings after its components and preserves existing page settings', async () => {
    const f = fake(); const spec = await loadSpec({ spec: { ...specification(), pages: [{ name: 'Overview', settings: { style: { 'Page background': '#FAFAFA' } } }, { name: 'Details', components: [{ component: 'text', text: 'D' }], settings: { date_range: 'Last 28 days' } }] } });
    const plan = specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false });
    expect(plan.actions.map((action) => action.tool)).toEqual(['page_add', 'text_add', 'page_settings_update']);
    expect(plan.actions[2]).toMatchObject({ pageRef: 1, args: { scope: 'page', date_range: 'Last 28 days' } }); expect(plan.notes.join()).toContain('Overview');
  });

  it('spec.apply.components: compares category and position with four-pixel tolerance and retains stacking order', async () => {
    const f = fake(); await f.add('shape_add', { shape: 'rectangle', position: { left: 0, top: 0, width: 1200, height: 90 } });
    await f.add('text_add', { text: 'A', position: { left: 40, top: 20, width: 600, height: 50 } });
    const spec = await loadSpec({ spec: { ...specification(), pages: [{ name: 'Overview', components: [
      { component: 'shape', shape: 'rectangle', position: { left: 0, top: 0, width: 1200, height: 90 } },
      { component: 'text', text: 'A', position: { left: 42, top: 22, width: 600, height: 50 } },
      { component: 'chart', type: 'table', position: { left: 0, top: 0, width: 1200, height: 90 } },
    ] }] } });
    expect(specToActions(spec, await readState(f.ctx, ORIGINAL), { fresh: false }).actions.map((action) => action.tool)).toEqual(['chart_add']);
    expect((await planFresh(spec)).actions.map((action) => action.tool)).toEqual(['page_rename', 'shape_add', 'text_add', 'chart_add']);
  });

  for (const [kind, tool, args] of [
    ['chart', 'chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }], position: { left: 40, top: 110, width: 600, height: 320 } }],
    ['text', 'text_add', { text: 'Sales', font_size: 28, bold: true }],
    ['shape', 'shape_add', { shape: 'rectangle', background: '#E8EAF6' }],
    ['control', 'control_add', { kind: 'drop_down', field: 'category', data_source: 'Metrics' }],
    ['image', 'image_add', { image: 'data:image/png;base64,AAEC', alt_text: 'Logo' }],
    ['line', 'line_add', { from: { x: 40, y: 100 }, to: { x: 1160, y: 100 }, color: '#E0E0E0', end: 'Pointer' }],
    ['embed', 'embed_add', { url: 'https://example.com/x' }],
  ] as const)
    it(`spec.apply.component.${kind}: forwards the creation tool inputs and binds its exact page`, async () => {
      const plan = await planFresh({ ...specification(), pages: [{ name: 'Overview', components: [{ component: kind, ...args }] }] });
      expect(plan.actions[1]).toEqual({ tool, args: { ...args, page: 'page-first' }, path: 'pages[0].components[0]' });
    });

  it('spec.apply.component.other: records the skipped panel and page without producing an action', async () => {
    const plan = await planFresh({ ...specification(), pages: [{ name: 'Overview' }, { name: 'Details', components: [{ component: 'text', text: 'A' }, { component: 'text', text: 'B' }, { component: 'other', panel: 'some-new-viz' }] }] });
    expect(plan.actions.filter((action) => action.tool === 'some-new-viz')).toEqual([]);
    expect(plan.notes.join()).toContain('Details'); expect(plan.notes.join()).toContain('component 2'); expect(plan.notes.join()).toContain('some-new-viz');
  });
});
