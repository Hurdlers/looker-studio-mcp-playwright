import { describe, expect, it } from 'vitest';
import { planAnalysisRegions, type AnalysisRegion } from '../../../src/features/component-templates/analysis-regions.js';
import type { PageItem } from '../../../src/features/component-templates/page-add.js';

const item = (key: string, template_id: string, height?: number): PageItem => ({ key, template_id, bindings: {}, ...(height === undefined ? {} : { height }) });
const input = { left: 24, top: 120, gap: 16 };
const block = (items: PageItem[]): AnalysisRegion[] => [{ key: 'q', kind: 'block', title: 'Question', items }];
type Box = { left: number; top: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
function boxes(width: number, items: PageItem[]) {
  const plan = planAnalysisRegions({ ...input, width, regions: block(items) }), region = plan.regions[0]!;
  const map = new Map(region.items.map(c => [c.key, { ...c.position, ...c.size }]));
  const all = [...map.values()];
  for (const box of all) {
    expect(box.left).toBeGreaterThanOrEqual(region.box.left + 24);
    expect(box.left + box.width).toBeLessThanOrEqual(region.box.left + region.box.width - 24);
    expect(box.top + box.height).toBeLessThanOrEqual(region.box.top + region.box.height - 24);
  }
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!, all[j]!)).toBe(false);
  return { map, plan };
}
const kpis = (n: number) => Array.from({ length: n }, (_, i) => item(`k${i}`, 'common-kpi'));

describe('free block region', () => {
  it('puts a KPI cluster beside the first chart row and keeps later charts below', () => {
    const { map } = boxes(1500, [...kpis(4), item('trend', 'common-time-trend'), item('bars', 'common-category-bars'), item('pivot', 'common-pivot-table')]);
    const trend = map.get('trend')!, k0 = map.get('k0')!, k1 = map.get('k1')!, k2 = map.get('k2')!;
    expect(k0.top).toBe(k1.top); expect(k2.top).toBeGreaterThan(k0.top);
    expect(trend.left).toBeGreaterThan(k1.left + k1.width); expect(trend.top).toBe(k0.top);
    expect(trend.width).toBeGreaterThan(k0.width);
    expect(map.get('pivot')!.top).toBeGreaterThanOrEqual(trend.top + trend.height + 16);
  });
  it('gives a share ring less width than a stacked bar and a trend in one row', () => {
    const { map } = boxes(1500, [item('ring', 'common-radial-share'), item('stack', 'common-category-bars'), item('trend', 'common-time-trend')]);
    const [ring, stack, trend] = ['ring', 'stack', 'trend'].map(key => map.get(key)!);
    expect(new Set([ring!.top, stack!.top, trend!.top]).size).toBe(1);
    expect(ring!.width).toBeLessThan(stack!.width); expect(stack!.width).toBeLessThanOrEqual(trend!.width);
    expect(trend!.left + trend!.width).toBe(24 + 1500 - 24);
  });
  it('accepts every common chart kind, including a single chart', () => {
    for (const id of ['common-kpi', 'common-time-trend', 'common-category-line', 'common-detail-table', 'common-radial-share', 'common-category-bars', 'common-area-trend', 'common-mixed-series', 'common-pivot-table', 'common-xy-scatter'])
      expect(boxes(1200, [item('one', id)]).map.size).toBe(1);
  });
  it.each([1500, 900, 520])('keeps minimum widths and avoids overlaps at width %s', width => {
    const { map } = boxes(width, [...kpis(3), item('combo', 'common-mixed-series'), item('ring', 'common-radial-share'), item('table', 'common-detail-table'), item('scatter', 'common-xy-scatter')]);
    expect(map.get('combo')!.width).toBeGreaterThanOrEqual(440);
    expect(map.get('ring')!.width).toBeGreaterThanOrEqual(320);
    expect(map.get('scatter')!.width).toBeGreaterThanOrEqual(400);
  });
  it('refuses empty or oversized blocks, unknown charts and block-only charts in fixed regions', () => {
    expect(() => planAnalysisRegions({ ...input, width: 1200, regions: block([]) })).toThrow(/do not match/);
    expect(() => planAnalysisRegions({ ...input, width: 1200, regions: block(kpis(9)) })).toThrow(/do not match/);
    expect(() => planAnalysisRegions({ ...input, width: 1200, regions: block([item('x', 'common-overview-section')]) })).toThrow(/do not match/);
    expect(() => planAnalysisRegions({ ...input, width: 1200, regions: [{ key: 'q', kind: 'kpi-trend', title: 'T', items: [item('k', 'common-kpi'), item('b', 'common-category-bars')] }] })).toThrow();
  });
});

describe('regions side by side', () => {
  const one = (key: string, share?: number): AnalysisRegion => ({ key, kind: 'block', title: key, items: [item(`${key}-chart`, 'common-detail-table')], ...(share === undefined ? {} : { share }) });
  it('places shared regions in one row with equal height and fills the page width', () => {
    const plan = planAnalysisRegions({ ...input, width: 1452, regions: [one('full'), one('wide', 7), { ...one('side', 5), items: [item('side-a', 'common-category-bars'), item('side-b', 'common-radial-share', 300)] }, one('after')] });
    const [full, wide, side, after] = plan.regions;
    expect(wide!.box.top).toBe(side!.box.top); expect(wide!.box.height).toBe(side!.box.height);
    expect(wide!.box.top).toBe(full!.box.top + full!.box.height + 16);
    expect(side!.box.left).toBe(wide!.box.left + wide!.box.width + 16);
    expect(side!.box.left + side!.box.width).toBe(24 + 1452);
    expect(wide!.box.width).toBeGreaterThan(side!.box.width);
    expect(after!.box.top).toBe(wide!.box.top + wide!.box.height + 16); expect(after!.box.width).toBe(1452);
    expect(plan.height).toBe(after!.box.top + after!.box.height - input.top);
  });
  it('starts a new row when shares pass twelve and refuses invalid shares', () => {
    const plan = planAnalysisRegions({ ...input, width: 1452, regions: [one('a', 8), one('b', 6)] });
    expect(plan.regions[1]!.box.top).toBeGreaterThan(plan.regions[0]!.box.top);
    expect(() => planAnalysisRegions({ ...input, width: 1452, regions: [one('a', 1)] })).toThrow(/twelfths/);
  });
});

describe('even rows and extra table columns', () => {
  it('splits four charts into two rows of two', () => {
    const { map } = boxes(1452, ['a', 'b', 'c', 'd'].map(key => item(key, 'common-detail-table')));
    expect(map.get('a')!.top).toBe(map.get('b')!.top);
    expect(map.get('c')!.top).toBe(map.get('d')!.top);
    expect(map.get('c')!.top).toBeGreaterThan(map.get('a')!.top);
    expect(map.get('d')!.width).toBeLessThan(800);
  });
});
