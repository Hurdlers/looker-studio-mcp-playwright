import { describe, expect, it, vi } from 'vitest';
import { boxOf, pageSize } from '../../../src/core/page.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, SOURCE, type Json } from '../spec/fake.js';

const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
const metric = { field: 'value', aggregation: 'sum' };
const kpi = { key: 'total', template_id: 'common-kpi', bindings: { metric }, texts: { title: 'Total' } };
const trend = { key: 'trend', template_id: 'common-time-trend', bindings: { metric, date: 'day' }, date_range: '2026-11-01..2026-11-03', texts: { title: 'Trend' } };
const table = { key: 'table', template_id: 'common-detail-table', bindings: { metric, dimension: 'category' }, texts: { title: 'Details' } };
const section = { key: 'overview', template_id: 'common-overview-section', bindings: { metric, date: 'day', dimension: 'category' }, date_range: '2026-11-01..2026-11-03', texts: { title: 'Overview', description: 'Grouped scope' }, span: 2 };
const sidebar = { title: 'Sales', navigation: { items: [{ label: 'Overview', page: 'p1' }, { label: 'Details', page: 'p2' }] } };
function setup(options: Parameters<typeof fake>[0] = {}) {
  const f = fake(options);
  f.original.shareable.name = '[looker-studio-mcp-lab-1] automatic page layout';
  f.original.report.attributeConfig = { reportAttribute: { width: 1200, height: 500 } };
  f.original.page.push({ pageId: 'p2', version: '1', page: { componentConfig: [{ componentId: 'other', type: 'shape', attributeConfig: { componentAttribute: { left: 30, top: 40, width: 200, height: 100 } } }] } });
  f.original.navigationInfo!.navItems!.push({ page: { pageId: 'p2', displayName: 'Details' } });
  return f;
}
const base = { report_id: ORIGINAL, page: 'p1', width: 1200, columns: 2, gap: 24, padding: 24 };
const page = (f: ReturnType<typeof fake>) => f.original.page[0]!.page;
const intersects = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
function expectInside(f: ReturnType<typeof fake>, padding = 24) {
  const size = pageSize(f.original, 'p1');
  for (const c of page(f).componentConfig ?? []) {
    const b = boxOf(c);
    expect(b.left).toBeGreaterThanOrEqual(padding);
    expect(b.top).toBeGreaterThanOrEqual(padding);
    expect(b.left + b.width).toBeLessThanOrEqual(size.width - padding);
    expect(b.top + b.height).toBeLessThanOrEqual(size.height - padding);
  }
}

describe('whole-page common component composition', () => {
  it('lays out mixed charts without overlaps and saves a canvas enclosing every item once', async () => {
    const f = setup(), report = structuredClone(f.original.report), other = structuredClone(f.original.page[1]);
    const out = parsed(await f.run('component_page_add', { ...base, items: [kpi, trend, { ...table, span: 2, height: 420 }] }));
    expect(out.saved).toBe(true);
    expect(page(f).componentConfig).toHaveLength(3);
    const boxes = page(f).componentConfig!.map(c => boxOf(c));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(intersects(boxes[i]!, boxes[j]!)).toBe(false);
    expect(boxes[0]!.top).toBe(boxes[1]!.top);
    expect(boxes[2]!.top).toBeGreaterThanOrEqual(Math.max(boxes[0]!.top + boxes[0]!.height, boxes[1]!.top + boxes[1]!.height) + 24);
    expectInside(f);
    expect(pageSize(f.original, 'p1').height).toBeGreaterThan(500);
    expect(f.original.report).toEqual(report); expect(f.original.page[1]).toEqual(other);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint === 'updateReport')).toEqual([]);
  });

  it('reduces columns on narrow pages without shrinking chart minimum widths', async () => {
    const f = setup();
    await f.run('component_page_add', { ...base, width: 600, columns: 2, items: [trend, table] });
    const [a, b] = page(f).componentConfig!.map(c => boxOf(c));
    expect(a!.left).toBe(b!.left);
    expect(a!.width).toBeGreaterThanOrEqual(320); expect(b!.width).toBeGreaterThanOrEqual(320);
    expect(b!.top).toBeGreaterThanOrEqual(a!.top + a!.height + 24);
    expectInside(f);
  });

  it('reserves a sidebar column and preserves independent section groups and initial periods', async () => {
    const f = setup();
    await f.run('component_page_add', { ...base, width: 1500, items: [section, { ...kpi, height: 180 }], sidebar });
    expect(page(f).groupConfig).toHaveLength(2);
    const groups = page(f).groupConfig! as Json[];
    const nav = groups.find(g => g.componentId.some((id: string) => page(f).componentConfig!.find(c => c.componentId === id)?.type === 'button'))!;
    const overview = groups.find(g => g !== nav)!;
    expect(nav.groupId).not.toBe(overview.groupId);
    expect(nav.componentId.some((id: string) => overview.componentId.includes(id))).toBe(false);
    const navMembers = page(f).componentConfig!.filter(c => nav.componentId.includes(c.componentId));
    const navRight = Math.max(...navMembers.map(c => { const b = boxOf(c); return b.left + b.width; }));
    for (const c of page(f).componentConfig!.filter(c => !nav.componentId.includes(c.componentId))) expect(boxOf(c).left).toBeGreaterThanOrEqual(navRight + 24);
    const buttons = navMembers.filter(c => c.type === 'button');
    expect(buttons.map(c => (c.propertyConfig as Json).componentProperty.buttonProperty.internalLink)).toEqual(['p1', 'p2']);
    expect((overview.propertyConfig as Json).groupProperty.controlStatePassThrough).toBe(false);
    expect((overview.propertyConfig as Json).groupProperty.inheritFilters).toBe(true);
    const children = page(f).componentConfig!.filter(c => overview.componentId.includes(c.componentId));
    const picker = children.find(c => c.type === 'simple-daterangepicker')!;
    expect(JSON.stringify(fromMapValue(picker.behavior))).toContain('20261103');
    expect(children.filter(c => c.datasourceId).every(c => c.datasourceId === SOURCE)).toBe(true);
    expectInside(f);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });

  it('previews the complete page without saving a page or snapshot', async () => {
    const f = setup({ snapshots: true }), before = structuredClone(f.original);
    const out = parsed(await f.run('component_page_add', { ...base, width: 1500, items: [section, kpi], sidebar, preview: true }));
    expect(out.saved).toBe(false); expect(out.preview).toBe(true);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('does not leave partial charts when a later item or navigation target is invalid', async () => {
    const f = setup(), before = structuredClone(f.original);
    for (const args of [
      { ...base, items: [kpi, { ...trend, bindings: { metric: 'missing', date: 'day' } }] },
      { ...base, width: 1500, items: [section], sidebar: { navigation: { items: [{ label: 'Missing', page: 'missing' }] } } },
    ]) await expect(f.run('component_page_add', args)).rejects.toThrow();
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('refuses nonempty targets and repeated builds without changing the existing page', async () => {
    const f = setup();
    await f.run('component_page_add', { ...base, items: [kpi, trend] });
    const before = structuredClone(f.original); f.clear();
    await expect(f.run('component_page_add', { ...base, items: [kpi, trend] })).rejects.toThrow();
    await expect(f.run('component_page_add', { ...base, page: 'p2', items: [kpi] })).rejects.toThrow();
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('rebuilds a filled page only with its confirmed name and leaves other pages alone', async () => {
    const f = setup();
    await f.run('component_page_add', { ...base, items: [kpi, trend] });
    const firstIds = (page(f).componentConfig ?? []).map(c => c.componentId), other = structuredClone(f.original.page[1]);
    const name = f.original.navigationInfo!.navItems![0]!.page!.displayName!;
    f.clear();
    await expect(f.run('component_page_add', { ...base, items: [table], replace: { confirm_page_name: `${name} wrong` } })).rejects.toThrow(/confirm_page_name/);
    expect(f.writes()).toEqual([]);
    const out = parsed(await f.run('component_page_add', { ...base, items: [{ ...table, height: 300 }], replace: { confirm_page_name: name } }));
    expect(out.saved).toBe(true); expect(out.replaced.components).toBe(firstIds.length);
    const now = page(f).componentConfig ?? [];
    expect(now.map(c => c.type)).toEqual(['simple-table']);
    expect(now.some(c => firstIds.includes(c.componentId))).toBe(false);
    expect(f.original.page[1]).toEqual(other);
    expect(f.writes().length).toBe(1);
    expectInside(f);
  });

  it('refuses report-level content and orphan groups instead of hiding overlap hazards', async () => {
    const f = setup();
    f.original.report.componentConfig = [{ componentId: 'report-title', type: 'text-area' }];
    await expect(f.run('component_page_add', { ...base, items: [kpi] })).rejects.toThrow();
    f.original.report.componentConfig = [];
    page(f).groupConfig = [{ groupId: 'existing-group', componentId: [] }];
    await expect(f.run('component_page_add', { ...base, items: [kpi] })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });

  it('rejects impossible geometry, duplicate keys and unsupported templates before writes', async () => {
    const f = setup();
    for (const args of [
      { ...base, width: 300, items: [trend] },
      { ...base, columns: 1, items: [{ ...trend, height: 20000 }] },
      { ...base, items: [kpi, kpi] },
      { ...base, items: [{ ...kpi, template_id: 'saved-design' }] },
      { ...base, items: [{ ...kpi, template_id: 'common-navbar' }] },
    ]) await expect(f.run('component_page_add', args)).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });

  it('keeps configured dry runs isolated and builds on a report with any name', async () => {
    const f = setup({ dryRun: true }), before = structuredClone(f.original);
    await f.run('component_page_add', { ...base, items: [kpi, trend] });
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    const ordinary = setup(); ordinary.original.shareable.name = 'Customer report';
    expect((await ordinary.run('component_page_add', { ...base, items: [kpi] })).isError).toBeFalsy();
    expect(ordinary.writes().length).toBe(1);
    const disabled = setup(); disabled.ctx.config.writesEnabled = false;
    disabled.ctx.tools = new Map([...disabled.ctx.tools].filter(([, tool]) => !tool.write));
    await expect(disabled.run('component_page_add', { ...base, items: [kpi] })).rejects.toThrow(/write tools are off/i);
    expect(disabled.writes()).toEqual([]);
  });

  it('does not overwrite content inserted after the layout was prepared', async () => {
    const f = setup(), originalEdit = f.ctx.session.editPage.bind(f.ctx.session);
    vi.spyOn(f.ctx.session, 'editPage').mockImplementation((reportId, pageId, mutate, reason) => originalEdit(reportId, pageId, (current, doc) => {
      (current.page.componentConfig ??= []).push({ componentId: 'concurrent-chart', type: 'kpi-metric' });
      mutate(current, doc);
    }, reason));
    await expect(f.run('component_page_add', { ...base, items: [kpi, trend] })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });
});

it('fits a compact header and table to content while preserving data and other pages', async () => {
  const f = setup();
  f.original.report.attributeConfig = { reportAttribute: { width: 1200, height: 1800 } };
  const before = structuredClone(f.original), args = { ...base, density: 'compact', header: { title: 'Sample overview', description: 'Synthetic data' }, items: [kpi, { ...table, common_options: { visible_rows: 5 } }] };
  const preview = parsed(await f.run('component_page_add', { ...args, preview: true }));
  expect(f.original).toEqual(before); expect(f.writes()).toHaveLength(0);
  expect(preview.canvas.height).toBeLessThan(1800);
  const saved = parsed(await f.run('component_page_add', args));
  expect(saved.canvas).toEqual(preview.canvas);
  const charts = page(f).componentConfig!.filter(c => c.type !== 'simple-description');
  expect(charts).toHaveLength(2);
  expect(charts.every(c => boxOf(c).top >= 24 + saved.header_height)).toBe(true);
  expectInside(f);
  expect(f.original.report).toEqual(before.report); expect(f.original.page[1]).toEqual(before.page[1]);
  expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
});


it('reserves separate lines in a page header before placing charts', async () => {
  const f = setup();
  const out = parsed(await f.run('component_page_add', { ...base, density: 'compact', header: { title: 'First\nSecond', description: 'Line one\nLine two' }, items: [kpi] }));
  expect(out.header_height).toBe(64 + 8 + 40 + 24);
  const title = page(f).componentConfig!.find(c => c.type === 'simple-description')!;
  expect(boxOf(title).height).toBe(64);
  const card = page(f).componentConfig!.find(c => c.type === 'kpi-metric')!;
  expect(boxOf(card).top).toBe(24 + out.header_height);
  expectInside(f);
});
