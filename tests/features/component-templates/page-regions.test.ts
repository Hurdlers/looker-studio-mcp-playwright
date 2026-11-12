import { describe, expect, it } from 'vitest';
import { dataRequests } from '../../../src/core/check.js';
import { toMapValue } from '../../../src/core/mapvalue.js';
import { boxOf } from '../../../src/core/page.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const metric = { field: 'value', aggregation: 'sum' };
const child = (key: string, template_id = 'common-kpi'): Json => ({ key, template_id, bindings: {
  metric, date: 'day', ...(['common-detail-table', 'common-radial-share'].includes(template_id) ? { dimension: 'category' } : {}),
} });
function regions(): Json[] { return [
  { key: 'overview', kind: 'kpi-group', title: 'Overview', items: [child('a'), child('b'), child('c')] },
  { key: 'change', kind: 'kpi-trend', title: 'Change', items: [child('d'), child('e', 'common-time-trend')] },
  { key: 'detail', kind: 'table-trend', title: 'Detail', items: [child('f', 'common-detail-table'), child('g', 'common-time-trend')] },
  { key: 'share', kind: 'table-share', title: 'Share', items: [child('h', 'common-detail-table'), child('i', 'common-radial-share')] },
]; }
const base = { report_id: ORIGINAL, width: 1500, density: 'compact', fit_height: true,
  controls: { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day' } };
function setup() {
  const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] regions';
  f.original.report.propertyConfig = { reportProperty: { themeConfig: 'test-theme' } };
  (f.original.report.resource as Json).theme = { value: [toMapValue({ id: 'test-theme', content: {
    themeBackground: '#F1F2F3', themeFontColor: '#123456', themeFontFamily: 'Tahoma',
  } })] };
  return f;
}
const props = (c: Json): Json => c.propertyConfig.componentProperty;
const componentList = (f: ReturnType<typeof fake>): Json[] => f.original.page[0]!.page.componentConfig ?? [];
async function add(f: ReturnType<typeof fake>, args: Json) {
  const result = await f.run('component_page_add', args); expect(result.isError, resultText(result)).toBeFalsy(); return JSON.parse(resultText(result));
}
function chartList(f: ReturnType<typeof fake>, out: Json) {
  const ids = new Set(out.items.flatMap((item: Json) => item.component_ids)); return componentList(f).filter(c => ids.has(c.componentId));
}
function semantics(chart: Json) {
  return { type: chart.type, source: chart.datasourceId, definitions: chart.conceptDefs.map((c: Json) => c.queryTimeTransformation),
    dateDuration: props(chart).dateDuration, compareDateDuration: props(chart).compareDateDuration };
}
async function rejected(args: Json) {
  const f = setup(), before = structuredClone(f.original), sources = structuredClone(f.sources);
  let failed = false;
  try { const r = await f.run('component_page_add', args); failed = !!r.isError; } catch { failed = true; }
  expect(failed).toBe(true); expect(f.writes()).toEqual([]); expect(f.original).toEqual(before); expect(f.sources).toEqual(sources);
}

describe('public analysis region pages', () => {
  it('preflights four regions and nine charts without writes, then saves once with linked summaries', async () => {
    const f = setup(), before = structuredClone(f.original), sources = structuredClone(f.sources);
    const args = { ...base, regions: regions() };
    const preview = await add(f, { ...args, preview: true });
    expect(preview.regions).toHaveLength(4); expect(preview.items).toHaveLength(9);
    expect(preview.saved).toBe(false); expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
    const saved = await add(f, args);
    expect(saved.saved).toBe(true); expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint !== 'updatePage')).toEqual([]);
    expect(f.sources).toEqual(sources); expect(f.original.report).toEqual(before.report);
    const ids = new Set(componentList(f).map(c => c.componentId));
    for (const region of saved.regions) for (const item of region.items) {
      expect(item).toEqual(saved.items.find((i: Json) => i.key === item.key));
      expect(item.component_ids.every((id: string) => ids.has(id))).toBe(true);
      const box = { ...item.position, ...item.size };
      expect(box.left).toBeGreaterThan(region.position.left);
      expect(box.top).toBeGreaterThan(region.position.top);
      expect(box.left + box.width).toBeLessThan(region.position.left + region.size.width);
      expect(box.top + box.height).toBeLessThan(region.position.top + region.size.height);
    }
    expect(f.original.page[0]!.page.groupConfig ?? []).toEqual([]);
    const charts = chartList(f, saved); expect(charts).toHaveLength(9);
    const requests = dataRequests(ORIGINAL, f.original.page[0]!, 'UTC', f.original);
    expect(requests).toHaveLength(9);
    for (const request of requests) expect(request.request.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20261101', endDate: '20261103' });
    for (const chart of charts) expect(props(chart).dateDuration).toBeUndefined();
  });

  it('inherits destination colors and font for outlined frames and reverse title bands', async () => {
    const f = setup(); const out = await add(f, { ...base, regions: regions(), design: { surface: 'outlined', heading: 'band' } });
    const firstRegionTop = out.regions[0].position.top;
    const shapes = componentList(f).filter(c => c.type === 'generic-shape' && boxOf(c).top >= firstRegionTop).map(c => props(c).genericShapeProperty.backgroundAndBorderProperty);
    expect(shapes).toHaveLength(8);
    expect(shapes.filter(s => s.border.size === 1)).toHaveLength(4);
    for (const frame of shapes.filter(s => s.border.size === 1)) {
      expect(frame.border.color).toBe('#123456'); expect(frame.background.color).toBe('#F1F2F3');
    }
    expect(shapes.filter(s => s.background.color === '#123456')).toHaveLength(4);
    const titles = componentList(f).filter(c => c.type === 'simple-description' && /Overview|Change|Detail|Share/.test(props(c).descriptionProperty.text));
    expect(titles).toHaveLength(4);
    for (const title of titles) {
      expect(props(title).descriptionProperty.text).toContain('Tahoma');
      expect(props(title).descriptionProperty.text.toUpperCase()).toContain('#F1F2F3');
    }
  });

  it('lets individual region designs override defaults without changing chart data', async () => {
    const plain = setup(), varied = setup();
    const a = await add(plain, { ...base, regions: regions() });
    const modified = regions(); modified[0]!.design = { surface: 'plain', heading: 'band' };
    modified[1]!.design = { heading: 'band' };
    const b = await add(varied, { ...base, regions: modified, design: { surface: 'outlined', heading: 'plain' } });
    expect(b.regions[0].design).toEqual({ surface: 'plain', heading: 'band' });
    expect(b.regions[1].design).toEqual({ surface: 'outlined', heading: 'band' });
    expect(b.regions[2].design).toEqual({ surface: 'outlined', heading: 'plain' });
    expect(chartList(varied, b).map(semantics)).toEqual(chartList(plain, a).map(semantics));
    // A band hugs its title, so banded regions are shorter; sizes and columns are unchanged.
    const size = (c: Json) => { const box = boxOf(c); return { left: box.left, width: box.width, height: box.height }; };
    expect(chartList(varied, b).map(size)).toEqual(chartList(plain, a).map(size));
    expect(b.regions[0].size.height).toBeLessThan(a.regions[0].size.height);
    expect(b.regions[2].size.height).toBe(a.regions[2].size.height);
  });

  it('preserves explicit child presentation overrides', async () => {
    const f = setup(), input = regions();
    input[0]!.items[0].common_options = { surface: 'card', emphasis: 'primary' };
    input[1]!.items[1].common_options = { design_rules: 'team-v1', show_values: false };
    input[2]!.items[0].common_options = { design_rules: 'team-v1', data_bars: false };
    const out = await add(f, { ...base, regions: input });
    expect(out.items.find((i: Json) => i.key === 'e').design_rules.overridden).toContain('trend.points-and-values');
    expect(out.items.find((i: Json) => i.key === 'f').design_rules.overridden).toContain('table.bar-with-value');
    const charts = chartList(f, out);
    expect(props(charts[0]!).kpiMetricProperty.backgroundAndBorderProperty.border.radius).toBe(8);
    expect(props(charts[1]!).kpiMetricProperty.backgroundAndBorderProperty.border.radius).toBe(0);
    expect(props(charts[4]!).lineChartProperty.seriesProperty[0]).toMatchObject({ seriesShowDataLabel: false, seriesShowPoints: false });
    expect(props(charts[5]!).tableProperty.tableMetricProperty[0].colType).toBe(2);
  });

  it('accepts the explicit two-column KPI region through the public schema without changing data', async () => {
    const legacy = setup(), grid = setup();
    const region = { key: 'grid', kind: 'kpi-trend', title: 'Grid', items: [child('k1'), child('k2'), child('k3'), child('k4'), child('trend', 'common-time-trend')] };
    const a = await add(legacy, { ...base, regions: [region] });
    const b = await add(grid, { ...base, regions: [{ ...region, kpi_columns: 2 }] });
    expect(b.items[0].position.top).toBe(b.items[1].position.top);
    expect(b.items[2].position.top).toBe(b.items[3].position.top);
    expect(b.items[4].position.left).toBeGreaterThan(b.items[1].position.left);
    expect(chartList(grid, b).map(semantics)).toEqual(chartList(legacy, a).map(semantics));
  });

  it('rejects a bad field in the final region with no partial page or source mutation', async () => {
    const input = regions(); input[3]!.items[1].bindings.metric = { field: 'missing', aggregation: 'sum' };
    await rejected({ ...base, regions: input });
  });

  it.each([
    ['both inputs', () => ({ ...base, regions: regions(), items: [child('legacy')] })],
    ['neither input', () => ({ ...base })],
    ['nested frame', () => ({ ...base, regions: regions(), content_frame: { title: 'Frame' } })],
    ['design without regions', () => ({ ...base, items: [child('legacy')], design: { surface: 'plain' } })],
    ['duplicate region key', () => { const r = regions(); r[3]!.key = r[0]!.key; return { ...base, regions: r }; }],
    ['duplicate child key', () => { const r = regions(); r[3]!.items[1].key = 'a'; return { ...base, regions: r }; }],
    ['explicit span', () => { const r = regions(); r[0]!.items[0].span = 1; return { ...base, regions: r }; }],
  ] as const)('refuses %s before any write', async (_name, build) => rejected(build()));
});
