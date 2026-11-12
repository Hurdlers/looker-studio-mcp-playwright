import { describe, expect, it } from 'vitest';
import { fromMapValue, toMapValue } from '../../../src/core/mapvalue.js';
import { pageControlsPreferredWidth, planPageControls } from '../../../src/features/component-templates/page-controls.js';
import { dataRequests } from '../../../src/core/check.js';
import { boxOf } from '../../../src/core/page.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const controls = { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day', dimensions: [{ field: 'category', label: '분류' }] };
const item = { key: 'total', template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day' }, common_options: { comparison: 'Previous period' } };
function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] controls'; return f; }
const args = { report_id: ORIGINAL, width: 800, density: 'compact', controls, items: [item] };
describe('page controls', () => {
  it('keeps wide-page controls compact and left aligned instead of filling the row', () => {
    const plan = planPageControls(controls, 24, 100, 1152, 16);
    expect(plan.entries.map(e => ({ left: e.left, top: e.top, width: e.width }))).toEqual([
      { left: 24, top: 100, width: 220 }, { left: 260, top: 100, width: 280 },
    ]);
    expect(plan.entries[1]!.left + plan.entries[1]!.width).toBeLessThan(24 + 1152);
  });
  it('wraps at the preferred widths and preserves readable narrow controls', () => {
    const paired = planPageControls(controls, 24, 100, 516, 16);
    expect(paired.entries[1]!.top).toBe(100);
    const wrapped = planPageControls(controls, 24, 100, 515, 16);
    expect(wrapped.entries[1]!.left).toBe(24);
    expect(wrapped.entries[1]!.top).toBeGreaterThan(wrapped.entries[0]!.top + 36);
    const minimum = planPageControls(controls, 24, 100, 240, 16);
    expect(minimum.entries.map(e => e.width)).toEqual([220, 240]);
    expect(() => planPageControls(controls, 24, 100, 239, 16)).toThrow();
  });
  it('gives long native labels more width without exceeding the row or adding captions', () => {
    const input = { ...controls, dimensions: [
      { field: 'category', label: '긴 분류 이름'.repeat(8) }, { field: 'other', label: '다른 분류' },
    ] };
    expect(pageControlsPreferredWidth(controls, 16)).toBe(516);
    expect(pageControlsPreferredWidth(input, 16)).toBeGreaterThan(220 + 220 + 280 + 32);
    const plan = planPageControls(input, 24, 100, 516, 16);
    const [category, other, date] = plan.entries;
    expect(category!.width).toBe(516);
    expect(other!.top).toBe(160);
    expect(date!.top).toBe(160);
    expect(date!.left + date!.width).toBeLessThanOrEqual(24 + 516);
    expect(plan.entries.every(e => e.captionHeight === 0)).toBe(true);
    expect(plan.height).toBe(120);
  });

  it('keeps native field labels, selection affordances and a shared themed control height', async () => {
    const f = setup();
    f.original.report.propertyConfig = { reportProperty: { themeConfig: 'control-theme' } };
    (f.original.report.resource as Json).theme = { value: [toMapValue({ id: 'control-theme', content: {
      themeBackground: '#F1F2F3', themeFontColor: '#123456', themeFontFamily: 'Tahoma', themeComponentHeaderColor: '#456789',
    } })] };
    const result = await f.run('component_page_add', args);
    expect(result.isError, resultText(result)).toBeFalsy();
    const components = f.original.page[0]!.page.componentConfig! as Json[];
    const filters = components.filter(c => ['dimension-filter', 'simple-daterangepicker'].includes(c.type));
    expect(filters.map(c => c.type)).toEqual(['dimension-filter', 'simple-daterangepicker']);
    const annotations = components.filter(c => c.type === 'simple-description');
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.propertyConfig.componentProperty.descriptionProperty.text).toContain('필터는 아래 모든 차트에 적용됩니다.');
    const dropdown = filters[0]!.propertyConfig.componentProperty.dimensionFilterProperty;
    expect(dropdown).toMatchObject({ labelPosition: 0, showMetricsValue: false, singleSelect: false, allowSelectAll: true,
      showSearch: true, itemFontSize: 14, labelFontSize: 14, labelFontFamily: 'Tahoma', labelFontColor: { color: '#123456' } });
    const date = filters[1]!.propertyConfig.componentProperty.dateRangePickerProperty;
    expect(date).toMatchObject({ fontSize: 14, fontFamily: 'Tahoma', fontColor: { color: '#123456' } });
    for (const control of [dropdown, date]) expect(control).toMatchObject({ paddingLeft: 12, paddingRight: 12, paddingTop: 0, centerVertical: true,
      backgroundAndBorderProperty: { background: { color: '#F1F2F3' }, border: { color: '#456789', radius: 6, size: 1, opacity: 1 }, boxShadow: false } });
    expect(filters.map(c => boxOf(c).height)).toEqual([44, 44]);
    expect(JSON.stringify(filters[0]!.conceptDefs)).toContain('분류');
  });

  it('compiles preview without writes', async () => {
    const f = setup(), before = structuredClone(f.original);
    const r = await f.run('component_page_add', { ...args, preview: true });
    expect(r.isError, resultText(r)).toBeFalsy(); expect(JSON.parse(resultText(r)).controls_count).toBe(2);
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
  });
  it('saves once and charts inherit the picker while preserving comparisons', async () => {
    const f = setup(); const r = await f.run('component_page_add', args);
    expect(r.isError, resultText(r)).toBeFalsy();
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const page = f.original.page[0]!, chart = page.page.componentConfig!.find(c => (c as Json).propertyConfig?.componentProperty?.compareDateDuration) as Json;
    expect(chart.propertyConfig.componentProperty.dateDuration).toBeUndefined();
    expect(chart.propertyConfig.componentProperty.compareDateDuration).toBeDefined();
    const request = dataRequests(ORIGINAL, page, 'UTC', f.original).find(a => a.component.componentId === chart.componentId)!;
    expect(request.request.datasetSpec.dateRanges).toHaveLength(2);
    expect(request.request.datasetSpec.dateRanges[1]).toMatchObject({ startDate: '20261029', endDate: '20261031' });
    expect(request.request.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20261101', endDate: '20261103' });
    const picker = page.page.componentConfig!.find(c => ((fromMapValue(c.behavior as Json) as Json)?.onSelect ?? []).some((action: Json) => action.action === 'lego-change-date-range')) as Json;
    picker.behavior = toMapValue({ onSelect: [{ action: 'lego-change-date-range', isControl: true, init: { dateRange: { startAnchor: '20261102', endAnchor: '20261102' } } }] });
    const changed = dataRequests(ORIGINAL, page, 'UTC', f.original).find(a => a.component.componentId === chart.componentId)!;
    expect(changed.request.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20261102', endDate: '20261102' });
  });
  it('accepts an explicitly matching period without fixing the chart', async () => {
    const f = setup(); await f.run('component_page_add', { ...args, items: [{ ...item, date_range: controls.date_range }] });
    const chart = f.original.page[0]!.page.componentConfig!.find(c => (c as Json).propertyConfig?.componentProperty?.compareDateDuration) as Json;
    expect(chart.propertyConfig.componentProperty.dateDuration).toBeUndefined();
  });
  it('wraps controls in narrow pages without overlaps', async () => {
    const f = setup(); const r = await f.run('component_page_add', { ...args, width: 360, header: { title: '요약' } });
    expect(r.isError, resultText(r)).toBeFalsy();
    const components = f.original.page[0]!.page.componentConfig!;
    const panel = boxOf(components.find(c => c.type === 'generic-shape')!);
    const content = components.filter(c => c.type !== 'generic-shape');
    const boxes = content.map(boxOf);
    for (const c of content.filter(c => ['simple-description', 'dimension-filter', 'simple-daterangepicker'].includes(String(c.type)))) {
      const box = boxOf(c);
      expect(box.left).toBeGreaterThanOrEqual(panel.left + 16);
      expect(box.top).toBeGreaterThanOrEqual(panel.top + 16);
      expect(box.left + box.width).toBeLessThanOrEqual(panel.left + panel.width - 16);
      expect(box.top + box.height).toBeLessThanOrEqual(panel.top + panel.height - 16);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
    }
  });
  it.each([
    { ...item, data_source: 'unknown source' },
    { ...item, bindings: { ...item.bindings, date: 'category' } },
    { ...item, bindings: { metric: item.bindings.metric } },
    { ...item, date_range: '2026-11-02..2026-11-03' },
    { ...item, template_id: 'common-overview-section' },
  ])('refuses incompatible scope without writes %#', async incompatible => {
    const f = setup(); await expect(f.run('component_page_add', { ...args, items: [incompatible] })).rejects.toThrow(); expect(f.writes()).toEqual([]);
  });
});

describe('optional fixed page filter lists', () => {
  const listControls = { ...controls, dimensions: [{ field: 'category', label: '분류', display: 'list' as const, visible_rows: 3 }] };
  it('uses an explicit list height hint and keeps the date picker below a wrapped list', () => {
    const wide = planPageControls(listControls, 24, 100, 1152, 16);
    expect(wide.entries.map(e => ({ width: e.width, height: e.height }))).toEqual([{ width: 260, height: 194 }, { width: 280, height: 44 }]);
    expect(wide.height).toBe(210);
    expect(pageControlsPreferredWidth(listControls, 16)).toBe(556);
    const narrow = planPageControls(listControls, 24, 100, 312, 16);
    expect(narrow.entries[1]!.top).toBe(100 + 194 + 16);
    expect(narrow.height).toBe(194 + 16 + 44 + 16);
    const long = planPageControls({ ...listControls, dimensions: [{ ...listControls.dimensions[0]!, label: '긴 분류 이름'.repeat(9) }] }, 24, 100, 312, 16);
    expect(long.entries[0]!.width).toBe(312); expect(long.entries[0]!.height).toBe(194);
  });
  it('compiles the native fixed list without changing query rows, source or page date scope', async () => {
    const f = setup(); const result = await f.run('component_page_add', { ...args, controls: listControls });
    expect(result.isError, resultText(result)).toBeFalsy();
    const page = f.original.page[0]!, components = page.page.componentConfig! as Json[];
    const control = components.find(c => c.preset === 'control-open-list')!;
    expect(control).toBeDefined(); expect(boxOf(control).height).toBe(194);
    const property = control.propertyConfig.componentProperty;
    expect(property.row).toBe(5001);
    expect(property.dimensionFilterProperty).toMatchObject({ expandable: false, singleSelect: false, allowSelectAll: true,
      showSearch: true, showMetricsValue: false, itemFontSize: 14, backgroundAndBorderProperty: { border: { opacity: 1 } } });
    const chart = components.find(c => c.type === 'kpi-metric')!;
    expect(chart.datasourceId).toBe(control.datasourceId);
    expect(JSON.stringify(control.conceptDefs)).toContain('_category_');
    const requests = dataRequests(ORIGINAL, page, 'UTC', f.original);
    for (const request of requests) expect(request.request.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20261101', endDate: '20261103' });
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });
  it.each([
    { field: 'category', visible_rows: 3 },
    { field: 'category', display: 'dropdown', visible_rows: 3 },
    { field: 'category', display: 'list', visible_rows: 2 },
    { field: 'category', display: 'list', visible_rows: 11 },
  ])('rejects an invalid row hint before writes %#', async dimension => {
    const f = setup(); let rejected = false;
    try { const result = await f.run('component_page_add', { ...args, controls: { ...controls, dimensions: [dimension] } }); rejected = !!result.isError; }
    catch { rejected = true; }
    expect(rejected).toBe(true); expect(f.writes()).toEqual([]);
  });
});
