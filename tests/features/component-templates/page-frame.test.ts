import { describe, expect, it } from 'vitest';
import { boxOf } from '../../../src/core/page.js';
import { dataRequests } from '../../../src/core/check.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const kpi = { key: 'sales', template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day' }, common_options: { comparison: 'Previous period' }, height: 112 };
const args = { report_id: ORIGINAL, width: 1200, columns: 4, density: 'compact', content_frame: { title: '매출 분석' },
  header: { title: '현황' }, controls: { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day' },
  items: [{ ...kpi, span: 2 }, { ...kpi, key: 'second' }, { ...kpi, key: 'third' },
    { key: 'trend', template_id: 'common-time-trend', bindings: kpi.bindings, span: 2, height: 260 },
    { key: 'table', template_id: 'common-detail-table', bindings: { ...kpi.bindings, dimension: 'category' }, span: 2, height: 260 }] };
function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] frame'; return f; }
describe('page content frame', () => {
  it('previews without writes or mutation', async () => {
    const f = setup(), before = structuredClone(f.original);
    const result = await f.run('component_page_add', { ...args, preview: true });
    expect(result.isError, resultText(result)).toBeFalsy();
    expect(JSON.parse(resultText(result)).component_count).toBe(11);
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
  });
  it.each([1200, 600])('contains charts using inset width and retains page date scope at width %s', async width => {
    const f = setup(); const result = await f.run('component_page_add', { ...args, width });
    expect(result.isError, resultText(result)).toBeFalsy();
    const out = JSON.parse(resultText(result));
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const page = f.original.page[0]!;
    expect(page.page.groupConfig ?? []).toHaveLength(0);
    const components = page.page.componentConfig!;
    const frame = boxOf(components[0]!);
    const chartIds = new Set(out.items.flatMap((item: Json) => item.component_ids));
    const charts = components.filter(c => chartIds.has(c.componentId));
    expect(charts).toHaveLength(5);
    for (const chart of charts) {
      const box = boxOf(chart);
      expect(box.left).toBeGreaterThanOrEqual(frame.left + 16);
      expect(box.left + box.width).toBeLessThanOrEqual(frame.left + frame.width - 16);
      expect(box.top).toBeGreaterThanOrEqual(frame.top + 56);
      expect(box.top + box.height).toBeLessThanOrEqual(frame.top + frame.height - 16);
      expect((chart.propertyConfig as Json).componentProperty.dateDuration).toBeUndefined();
    }
    const boxes = charts.map(boxOf);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
    }
    const requests = dataRequests(ORIGINAL, page, 'UTC', f.original);
    expect(requests).toHaveLength(5);
    for (const request of requests) expect(request.request.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20261101', endDate: '20261103' });
    expect(requests.filter(r => r.request.datasetSpec.dateRanges.length === 2)).toHaveLength(3);
  });
  it('keeps the sidebar outside the content frame', async () => {
    const f = setup();
    const result = await f.run('component_page_add', { ...args, width: 1500,
      sidebar: { title: 'Navigation', navigation: { items: [{ label: 'Overview', page: 'p1' }] } } });
    expect(result.isError, resultText(result)).toBeFalsy();
    const out = JSON.parse(resultText(result)), components = f.original.page[0]!.page.componentConfig!;
    const frame = boxOf(components[0]!);
    const sidebar = out.items.find((item: Json) => item.key === '$sidebar');
    for (const component of components.filter(c => sidebar.component_ids.includes(c.componentId))) {
      const box = boxOf(component);
      expect(box.left + box.width).toBeLessThanOrEqual(frame.left - 16);
    }
    expect(f.original.page[0]!.page.groupConfig).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });

});
