import { describe, expect, it, vi } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
import { column, fake, ORIGINAL, SOURCE, type Json } from '../spec/fake.js';

const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
function setup() {
  const f = fake();
  f.original.shareable.name = '[looker-studio-mcp-lab-1] component updates';
  f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_orders_', 'orders', 33));
  const second = structuredClone(f.sources[SOURCE]!);
  second.name = 'Alternate'; second.block.datasourceId = 'alternate-source'; second.block.datasourceBlock.name = 'Alternate';
  f.sources['alternate-source'] = second;
  f.original.report.resource!.datasourceAlias!.push({ datasourceId: 'alternate-source', alias: 'alternate' });
  for (const [pageId, displayName] of [['p2', 'Details'], ['p3', 'Channels']]) {
    f.original.page.push({ pageId: pageId!, version: '1', page: { componentConfig: [] } });
    f.original.navigationInfo!.navItems!.push({ page: { pageId: pageId!, displayName: displayName! } });
  }
  return f;
}
const chart = { report_id: ORIGINAL, template_id: 'common-kpi', data_source: SOURCE, bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day' }, date_range: '2026-11-01..2026-11-07', position: { left: 40, top: 50 }, size: { width: 320, height: 200 } };
const section = { report_id: ORIGINAL, template_id: 'common-overview-section', data_source: SOURCE, bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day', dimension: 'category' }, date_range: '2026-11-01..2026-11-07', position: { left: 24, top: 24 }, size: { width: 1200, height: 900 } };
const navbar = { report_id: ORIGINAL, template_id: 'common-navbar', bindings: {}, texts: { title: 'Sales' }, position: { left: 24, top: 24 }, size: { width: 1200, height: 72 }, navigation: { items: [{ label: 'Overview', page: 'p1' }, { label: 'Details', page: 'p2' }] } };
const page = (f: ReturnType<typeof fake>) => f.original.page[0]!.page;
const props = (c: Json) => c.propertyConfig.componentProperty;

describe('updating existing common components', () => {
  it('changes source, metric, date and size in place, retaining the component ID and unrelated chart', async () => {
    const f = setup();
    const created = parsed(await f.run('component_template_add', chart));
    await f.run('component_template_add', { ...chart, position: { left: 500, top: 50 } });
    const other = structuredClone(page(f).componentConfig![1]);
    f.clear();
    const out = parsed(await f.run('component_template_update', { ...chart, component_id: created.component_ids[0], data_source: 'Alternate', bindings: { metric: { field: 'orders', aggregation: 'avg' }, date: 'day' }, date_range: '2026-11-01..2026-11-03', size: { width: 400, height: 240 } }));
    expect(out.saved).toBe(true);
    expect(page(f).componentConfig).toHaveLength(2);
    const updated = page(f).componentConfig![0]!;
    expect(updated.componentId).toBe(created.component_ids[0]);
    expect(updated.datasourceId).toBe('alternate-source');
    expect(updated.attributeConfig).toMatchObject({ componentAttribute: { left: 40, top: 50, width: 400, height: 240 } });
    expect(page(f).componentConfig![1]).toEqual(other);
    const spec = (await f.exportSpec()).spec.pages[0].components[0];
    expect(spec.metrics).toEqual([{ field: 'orders', aggregation: 'avg' }]);
    expect(spec.date_range).toBe('2026-11-01..2026-11-03');
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });

  it('keeps omitted position and size and repeated full configuration creates no duplicate or extra write', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', chart));
    const { position: _position, size: _size, ...desired } = chart;
    const args = { ...desired, component_id: created.component_ids[0], texts: { title: 'Orders' }, bindings: { metric: 'orders', date: 'day' } };
    await f.run('component_template_update', args);
    const before = structuredClone(page(f)); f.clear();
    await f.run('component_template_update', args);
    expect(page(f)).toEqual(before);
    expect(page(f).componentConfig![0]!.attributeConfig).toMatchObject({ componentAttribute: { ...chart.position, ...chart.size } });
    expect(f.writes()).toEqual([]);
  });

  it('updates the section together while preserving its group ID, scope and neighboring section', async () => {
    const f = setup(), first = parsed(await f.run('component_template_add', section));
    const second = parsed(await f.run('component_template_add', { ...section, position: { left: 24, top: 1000 } }));
    const other = structuredClone(page(f).componentConfig!.filter(c => second.component_ids.includes(c.componentId)));
    const oldGroup = page(f).groupConfig!.find(g => g.groupId === first.group_id)!;
    (oldGroup.propertyConfig as Json).groupProperty.inheritFilters = false;
    const groupSettings = structuredClone(oldGroup.propertyConfig);
    f.clear();
    await f.run('component_template_update', { ...section, group_id: first.group_id, data_source: 'Alternate', bindings: { ...section.bindings, metric: { field: 'orders', aggregation: 'sum' } }, date_range: '2026-11-01..2026-11-03' });
    expect(page(f).groupConfig).toHaveLength(2);
    const updatedGroup = page(f).groupConfig!.find(g => g.groupId === first.group_id)!;
    expect(updatedGroup.propertyConfig).toEqual(groupSettings);
    expect(updatedGroup.componentId).toEqual(first.component_ids);
    expect(page(f).componentConfig!.filter(c => second.component_ids.includes(c.componentId))).toEqual(other);
    const children = page(f).componentConfig!.filter(c => first.component_ids.includes(c.componentId));
    expect(children.filter(c => ['kpi-metric', 'simple-linechart', 'simple-table'].includes(String(c.type))).every(c => c.datasourceId === 'alternate-source')).toBe(true);
    const picker = children.find(c => c.type === 'simple-daterangepicker')!;
    expect(JSON.stringify(fromMapValue(picker.behavior))).toContain('20261103');
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });

  it('adds, reorders and removes navigation items and switches to a vertical sidebar without extra groups', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', navbar));
    const oldButtons = new Map(page(f).componentConfig!.filter(c => c.type === 'button').map(c => [props(c).buttonProperty.internalLink, c.componentId]));
    const changed = { ...navbar, group_id: created.group_id, size: { width: 240, height: 720 }, navigation: { layout: 'vertical', items: [{ label: 'Channels', page: 'p3' }, { label: 'Overview', page: 'p1' }, { label: 'Details', page: 'p2' }] } };
    await f.run('component_template_update', changed);
    expect(page(f).groupConfig).toHaveLength(1);
    expect(page(f).groupConfig![0]!.groupId).toBe(created.group_id);
    let buttons = page(f).componentConfig!.filter(c => c.type === 'button');
    expect(buttons.map(c => props(c).buttonProperty.internalLink)).toEqual(['p3', 'p1', 'p2']);
    for (const c of buttons) if (oldButtons.has(props(c).buttonProperty.internalLink)) expect(c.componentId).toBe(oldButtons.get(props(c).buttonProperty.internalLink));
    expect(new Set(buttons.map(c => (c.attributeConfig as Json).componentAttribute.left)).size).toBe(1);
    await f.run('component_template_update', { ...changed, navigation: { ...changed.navigation, items: changed.navigation.items.slice(0, 2) } });
    buttons = page(f).componentConfig!.filter(c => c.type === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons.map(c => props(c).buttonProperty.internalLink)).toEqual(['p3', 'p1']);
    expect(page(f).groupConfig![0]!.componentId).toHaveLength(4);
    expect(page(f).componentConfig).toHaveLength(4);
  });

  it('previews a complete section change without writing or changing the original', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', section));
    const before = structuredClone(f.original); f.clear();
    const out = parsed(await f.run('component_template_update', { ...section, group_id: created.group_id, bindings: { ...section.bindings, metric: 'orders' }, preview: true }));
    expect(out.saved).toBe(false); expect(out.preview).toBe(true);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('rejects invalid fields, sources and menus before changing any existing elements', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', section));
    const nav = parsed(await f.run('component_template_add', { ...navbar, position: { left: 24, top: 1100 } }));
    const before = structuredClone(f.original); f.clear();
    await expect(f.run('component_template_update', { ...section, group_id: created.group_id, bindings: { ...section.bindings, metric: 'missing' } })).rejects.toThrow();
    await expect(f.run('component_template_update', { ...section, group_id: created.group_id, data_source: 'Missing source' })).rejects.toThrow();
    await expect(f.run('component_template_update', { ...navbar, group_id: nav.group_id, navigation: { items: [{ label: 'Missing', page: 'missing' }] } })).rejects.toThrow();
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('requires one explicit target and refuses nested or shared group members', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', section));
    f.clear();
    await expect(f.run('component_template_update', section)).rejects.toThrow();
    await expect(f.run('component_template_update', { ...section, component_id: created.component_ids[0], group_id: created.group_id })).rejects.toThrow();
    page(f).groupConfig!.push({ groupId: 'outer', childGroupId: [created.group_id], componentId: [] });
    await expect(f.run('component_template_update', { ...section, group_id: created.group_id })).rejects.toThrow();
    page(f).groupConfig!.pop();
    page(f).groupConfig!.push({ groupId: 'shared', childGroupId: [], componentId: [created.component_ids[0]] });
    await expect(f.run('component_template_update', { ...section, group_id: created.group_id })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });

  it('refuses conditional formatting and external references instead of dropping them', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', chart));
    f.original.page[0]!.chartCondition = [{ chartId: created.component_ids[0], conditions: [{ value: 10 }] }];
    f.clear();
    await expect(f.run('component_template_update', { ...chart, component_id: created.component_ids[0], bindings: { metric: 'orders', date: 'day' } })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
    f.original.page[0]!.chartCondition = [];
    page(f).componentConfig!.push({ componentId: 'outside-arrow', type: 'arrow', propertyConfig: { componentProperty: { arrowProperty: { terminals: { start: { componentId: created.component_ids[0] } } } } } });
    await expect(f.run('component_template_update', { ...chart, component_id: created.component_ids[0], bindings: { metric: 'orders', date: 'day' } })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });

  it('keeps the native component alias when changing its metric', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', chart));
    const c = page(f).componentConfig![0]!;
    (c.attributeConfig as Json).componentAttribute.alias = 'overview-revenue';
    await f.run('component_template_update', { ...chart, component_id: created.component_ids[0], bindings: { metric: 'orders', date: 'day' } });
    expect((page(f).componentConfig![0]!.attributeConfig as Json).componentAttribute.alias).toBe('overview-revenue');
    expect(page(f).componentConfig![0]!.componentId).toBe(created.component_ids[0]);
  });

  it('rejects a group interleaved with unrelated content before changing stacking order', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', section));
    await f.run('component_template_add', { ...chart, position: { left: 100, top: 120 } });
    const all = page(f).componentConfig!;
    all.splice(1, 0, all.pop()!);
    const before = structuredClone(page(f)); f.clear();
    await expect(f.run('component_template_update', { ...section, group_id: created.group_id, bindings: { ...section.bindings, metric: 'orders' } })).rejects.toThrow(/interleaved|stacking/i);
    expect(page(f)).toEqual(before);
    expect(f.writes()).toEqual([]);
  });

  it('preserves the target source when data_source is omitted instead of selecting the first source', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', { ...chart, data_source: 'Alternate' }));
    const { data_source: _source, ...desired } = chart;
    await f.run('component_template_update', { ...desired, component_id: created.component_ids[0], bindings: { metric: 'orders', date: 'day' } });
    expect(page(f).componentConfig).toHaveLength(1);
    expect(page(f).componentConfig![0]!.datasourceId).toBe('alternate-source');
    const spec = (await f.exportSpec()).spec.pages[0].components[0];
    expect(spec.metrics[0].field).toBe('orders');
  });

  it('does not overwrite a target that changed after the update was planned', async () => {
    const f = setup(), created = parsed(await f.run('component_template_add', chart));
    const originalEdit = f.ctx.session.editPage.bind(f.ctx.session);
    vi.spyOn(f.ctx.session, 'editPage').mockImplementation((reportId, pageId, mutate, reason) => originalEdit(reportId, pageId, current => {
      const c = current.page.componentConfig!.find(c => c.componentId === created.component_ids[0])!;
      (c.attributeConfig as Json).componentAttribute.left += 10;
      mutate(current, f.original);
    }, reason));
    f.clear();
    await expect(f.run('component_template_update', { ...chart, component_id: created.component_ids[0], bindings: { metric: 'orders', date: 'day' } })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });
  it('treats server-normalized empty table row heights as the same automatic layout', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', section));
    const table = page(f).componentConfig!.find(c => c.type === 'simple-table')!;
    ((table.propertyConfig as Json).componentProperty.tableProperty ??= {}).rowsHeight = [];
    const before = structuredClone(page(f)); f.clear();
    const updated = parsed(await f.run('component_template_update', { ...section, group_id: made.group_id }));
    expect(updated.unchanged).toBe(true);
    expect(updated.saved).toBe(false);
    expect(page(f)).toEqual(before);
    expect(f.writes()).toEqual([]);
  });

});
