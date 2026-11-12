import { describe, expect, it } from 'vitest';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
import { resultText } from '../../../src/core/tool.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
const setup = () => { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] composition'; return f; };
const section = { report_id: ORIGINAL, template_id: 'common-overview-section', bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day', dimension: 'category' }, date_range: '2026-11-01..2026-11-07' };
describe('common composition assembly', () => {
  it('preflights all children then saves one grouped section while leaving report defaults alone', async () => {
    const f = setup(), defaults = structuredClone(f.original.report);
    const out = parsed(await f.run('component_template_add', section));
    expect(out.saved).toBe(true); expect(out.component_count).toBe(7);
    const page = f.original.page[0]!.page;
    expect(page.groupConfig).toHaveLength(1);
    expect(page.groupConfig![0]!.componentId).toHaveLength(7);
    expect((page.groupConfig![0]!.propertyConfig as Json).groupProperty.controlStatePassThrough).toBe(false);
    const charts = page.componentConfig!.filter(c => ['kpi-metric','simple-linechart','simple-table'].includes(String(c.type)));
    expect(charts).toHaveLength(3);
    expect(charts.every(c => !((c.propertyConfig as Json).componentProperty as Json).dateDuration)).toBe(true);
    expect(new Set(charts.map(c => c.datasourceId)).size).toBe(1);
    const date = page.componentConfig!.find(c => c.type === 'simple-daterangepicker')!;
    expect(JSON.stringify(fromMapValue(date.behavior))).toContain('20261101');
    expect(f.original.report).toEqual(defaults);
    expect(f.calls.filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(resultText(await f.run('report_spec_export', { report_id: ORIGINAL }))).toContain('"groups"');
  });
  it('leaves no partial elements for invalid late chart bindings or previews', async () => {
    const f = setup();
    await expect(f.run('component_template_add', { ...section, bindings: { ...section.bindings, metric: 'missing' } })).rejects.toThrow(/missing/i);
    expect(f.writes()).toEqual([]);
    const preview = parsed(await f.run('component_template_add', { ...section, preview: true }));
    expect(preview.saved).toBe(false); expect(f.writes()).toEqual([]);
    expect(f.original.page[0]!.page.componentConfig ?? []).toHaveLength(0);
  });
  it('keeps two section groups and their date controls separate', async () => {
    const f = setup();
    const a = parsed(await f.run('component_template_add', section));
    const b = parsed(await f.run('component_template_add', { ...section, date_range: '2026-11-01..2026-11-03' }));
    expect(a.group_id).not.toBe(b.group_id);
    expect(a.component_ids.some((id: string) => b.component_ids.includes(id))).toBe(false);
    expect(f.original.page[0]!.page.groupConfig).toHaveLength(2);
  });
  it('creates page links and current-page metadata without data bindings', async () => {
    const f = setup(); const page = f.original.page[0]!.pageId;
    const out = parsed(await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-navbar', bindings: {}, texts: { title: 'Overview' }, navigation: { items: [{ label: 'Current', page }] } }));
    expect(out.saved).toBe(true); expect(out.navigation_items[0]).toMatchObject({ page_id: page, active: true });
    const button = f.original.page[0]!.page.componentConfig!.find(c => c.type === 'button')!;
    expect(((button.propertyConfig as Json).componentProperty as Json).buttonProperty.internalLink).toBe(page);
    expect(f.calls.filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });
  it('rejects invalid targets and cross-kind options without saving', async () => {
    const f = setup();
    await expect(f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-navbar', bindings: {}, navigation: { items: [{ label: 'Missing', page: 'missing' }] } })).rejects.toThrow();
    await expect(f.run('component_template_add', { ...section, common_options: { average_line: true } })).rejects.toThrow(/not common_options/);
    await expect(f.run('component_template_add', { ...section, template_id: 'common-kpi', section_options: {} })).rejects.toThrow(/corresponding compositions/);
    expect(f.writes()).toEqual([]);
  });
});

it('compiles compact presentation in one unchanged data scope and preserves the report on preview', async () => {
  const f = setup(), before = structuredClone(f.original);
  const args = { ...section, texts: { title: '활동 요약' }, section_options: { density: 'compact', table_rows: 10 } };
  const preview = parsed(await f.run('component_template_add', { ...args, preview: true }));
  expect(preview.saved).toBe(false);
  expect(f.original).toEqual(before);
  expect(f.writes()).toEqual([]);
  const saved = parsed(await f.run('component_template_add', args));
  expect(saved.saved).toBe(true);
  const page = f.original.page[0]!.page;
  expect(page.groupConfig).toHaveLength(1);
  expect((page.groupConfig![0]!.propertyConfig as Json).groupProperty.controlStatePassThrough).toBe(false);
  const charts = page.componentConfig!.filter(c => ['kpi-metric', 'simple-linechart', 'simple-table'].includes(String(c.type)));
  expect(charts).toHaveLength(3);
  expect(new Set(charts.map(c => c.datasourceId)).size).toBe(1);
  for (const c of charts) expect((c.propertyConfig as Json).componentProperty.dateDuration).toBeUndefined();
  const date = page.componentConfig!.find(c => c.type === 'simple-daterangepicker')!;
  expect(JSON.stringify(fromMapValue(date.behavior))).toContain('20261101');
  const line = charts.find(c => c.type === 'simple-linechart')!;
  expect((line.propertyConfig as Json).componentProperty.lineChartProperty.chartTitleProperty.chartTitleShowTitle).toBe(false);
  expect(f.original.report).toEqual(before.report);
  expect(f.calls.filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
});
