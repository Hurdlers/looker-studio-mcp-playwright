import { describe, expect, it } from 'vitest';
import { planAnalysisRegions, type AnalysisRegion } from '../../../src/features/component-templates/analysis-regions.js';
import type { PageItem } from '../../../src/features/component-templates/page-add.js';
const item = (key: string, template_id: string, height?: number): PageItem => ({ key, template_id, bindings: {}, ...(height === undefined ? {} : { height }) });
const kpi = (key: string) => item(key, 'common-kpi');
const trend = item('trend', 'common-time-trend');
const table = item('table', 'common-detail-table');
const share = item('share', 'common-radial-share');
const input = { width: 1152, left: 24, top: 120, gap: 16 };
const groups: AnalysisRegion[] = [
  { key: 'overview', kind: 'kpi-group', title: 'Overview', items: [kpi('a'), kpi('b'), kpi('c')] },
  { key: 'history', kind: 'kpi-trend', title: 'History', items: [kpi('d'), kpi('e'), trend] },
  { key: 'details', kind: 'table-share', title: 'Details', items: [table, share] },
];
const overlap = (a: { left: number; top: number; width: number; height: number }, b: typeof a) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
describe('analysis region geometry', () => {
  it.each([1152, 700, 400])('places mixed regions within actual content width %s without child overlaps', width => {
    const before = structuredClone(groups), plan = planAnalysisRegions({ ...input, width, regions: groups });
    expect(groups).toEqual(before);
    expect(plan.regions.map(r => r.key)).toEqual(groups.map(r => r.key));
    expect(plan.height).toBe(plan.regions.at(-1)!.box.top + plan.regions.at(-1)!.box.height - input.top);
    for (let i = 0; i < plan.regions.length; i++) {
      const region = plan.regions[i]!;
      if (i) expect(region.box.top).toBeGreaterThanOrEqual(plan.regions[i - 1]!.box.top + plan.regions[i - 1]!.box.height + input.gap);
      const boxes = region.items.map(c => ({ ...c.position, ...c.size }));
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(region.box.left + 24);
        expect(box.left + box.width).toBeLessThanOrEqual(region.box.left + region.box.width - 24);
        expect(box.top).toBeGreaterThanOrEqual(region.titleBox.top + region.titleBox.height + 16);
        expect(box.top + box.height).toBeLessThanOrEqual(region.box.top + region.box.height - 24);
      }
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) expect(overlap(boxes[a]!, boxes[b]!)).toBe(false);
    }
    const region = plan.regions[1]!;
    if (width === 400) expect(region.items[2]!.position.top).toBeGreaterThan(region.items[1]!.position.top);
    else expect(region.items[2]!.position.top).toBe(region.items[0]!.position.top);
  });
  it('uses available inset width for paired charts and accepts valid custom heights', () => {
    const plan = planAnalysisRegions({ ...input, width: 800, regions: [{ key: 'pair', kind: 'table-trend', title: 'Pair', items: [{ ...table, height: 240 }, { ...trend, height: 260 }] }] });
    const [a, b] = plan.regions[0]!.items;
    expect(a!.size.height).toBe(240); expect(b!.size.height).toBe(260);
    expect(a!.size.width + b!.size.width + input.gap).toBe(800 - 48);
    expect(a!.size.width).toBeLessThan(b!.size.width);
  });
  it('reserves multiple title lines and keeps compact table height policy', () => {
    const plan = planAnalysisRegions({ ...input, width: 400, regions: [{ key: 'pair', kind: 'table-trend', title: 'First\nSecond', items: [{ ...table, common_options: { density: 'compact', visible_rows: 1 } }, trend] }] });
    expect(plan.regions[0]!.titleBox.height).toBe(64);
    expect(plan.regions[0]!.items[0]!.size.height).toBe(96);
  });
  it.each([
    { ...groups[0]!, items: [kpi('a')] },
    { ...groups[0]!, items: [table, trend] },
    { ...groups[1]!, items: [trend, kpi('a')] },
    { ...groups[2]!, items: [share, table] },
    { ...groups[0]!, items: [kpi('a'), { ...kpi('b'), span: 1 }] },
    { ...groups[0]!, items: [kpi('a'), { ...kpi('b'), height: 95 }] },
    { ...groups[0]!, items: [kpi('a'), kpi('a')] },
  ] as AnalysisRegion[])('rejects incompatible region children before compilation %#', region => {
    expect(() => planAnalysisRegions({ ...input, regions: [region] })).toThrow();
  });
  it('rejects duplicate global keys, insufficient width and canvas overflow', () => {
    expect(() => planAnalysisRegions({ ...input, regions: [groups[0]!, { ...groups[0]!, key: 'other' }] })).toThrow(/unique/);
    expect(() => planAnalysisRegions({ ...input, regions: [groups[0]!, groups[0]!] })).toThrow(/unique/);
    expect(() => planAnalysisRegions({ ...input, width: 350, regions: [groups[2]!] })).toThrow(/minimum/);
    expect(() => planAnalysisRegions({ ...input, top: 19900, regions: [groups[0]!] })).toThrow(/height/);
  });
  it.each(['kpi-trend', 'table-trend'] as const)('places an explicitly selected category line in %s without changing its recipe', kind => {
    const category = { ...item('category', 'common-category-line', 300), bindings: { dimension: 'day', date: 'day', metric: { field: 'value', aggregation: 'sum' as const } } };
    const region: AnalysisRegion = { key: 'chosen', kind, title: 'Trend', items: [kind === 'kpi-trend' ? kpi('total') : table, category] };
    const before = structuredClone(region);
    for (const width of [1152, 420]) {
      const plan = planAnalysisRegions({ ...input, width, regions: [region] });
      const [first, last] = plan.regions[0]!.items;
      expect(last!.key).toBe('category'); expect(last!.size.height).toBe(300);
      expect(last!.size.width).toBeGreaterThanOrEqual(360);
      if (width === 420) expect(last!.position.top).toBeGreaterThanOrEqual(first!.position.top + first!.size.height + input.gap);
      else expect(last!.position.left).toBeGreaterThanOrEqual(first!.position.left + first!.size.width + input.gap);
    }
    expect(region).toEqual(before);
  });
  it('rejects category lines outside a trend slot and rejects unrelated trend kinds', () => {
    const category = item('category', 'common-category-line');
    for (const region of [
      { key: 'bad', kind: 'kpi-group', title: 'Bad', items: [kpi('a'), category] },
      { key: 'bad', kind: 'table-share', title: 'Bad', items: [table, category] },
      { key: 'bad', kind: 'table-trend', title: 'Bad', items: [category, table] },
      { key: 'bad', kind: 'kpi-trend', title: 'Bad', items: [kpi('a'), share] },
    ] as AnalysisRegion[]) expect(() => planAnalysisRegions({ ...input, regions: [region] })).toThrow(/child chart kinds/);
  });

});

describe('explicit KPI grid beside trend', () => {
  const region = (count = 4): AnalysisRegion => ({ key: 'grid', kind: 'kpi-trend', title: 'KPI grid', kpi_columns: 2,
    items: [...Array.from({ length: count }, (_, i) => item(`k${i}`, 'common-kpi', i === 0 ? 200 : 120)), trend] });
  it('places four KPIs in two rows with row maximum heights and the trend on the right', () => {
    const r = region(), before = structuredClone(r);
    const plan = planAnalysisRegions({ ...input, regions: [r] }).regions[0]!;
    const [a,b,c,d,t] = plan.items;
    expect(a!.position.top).toBe(b!.position.top);
    expect(c!.position.top).toBe(d!.position.top);
    expect(c!.position.top).toBe(a!.position.top + 200 + 16);
    expect(c!.position.left).toBe(a!.position.left);
    expect(d!.position.left).toBe(b!.position.left);
    expect(t!.position.top).toBe(a!.position.top);
    expect(t!.position.left).toBeGreaterThanOrEqual(b!.position.left + b!.size.width + 16);
    expect(plan.items.slice(0,4).map(c => c.size.height)).toEqual([200,120,120,120]);
    expect(r).toEqual(before);
  });
  it('keeps an odd third KPI aligned to the first column without stretching it', () => {
    const [a,b,c,t] = planAnalysisRegions({ ...input, regions: [region(3)] }).regions[0]!.items;
    expect(c!.size.width).toBe(a!.size.width); expect(c!.position.left).toBe(a!.position.left);
    expect(c!.position.top).toBeGreaterThan(b!.position.top); expect(t!.position.top).toBe(a!.position.top);
  });
  it.each([[600,2],[368,1]] as const)('adapts width %s to %s KPI columns with the trend below', (width, columns) => {
    const r = region(); r.title = '긴 제목'.repeat(30) + '\n다음 줄';
    const plan = planAnalysisRegions({ ...input, width, regions: [r] }).regions[0]!;
    const boxes = plan.items.map(c => ({ ...c.position, ...c.size }));
    expect(plan.titleBox.height).toBeGreaterThan(32);
    if (columns === 2) expect(boxes[0]!.top).toBe(boxes[1]!.top);
    else expect(boxes[1]!.top).toBeGreaterThanOrEqual(boxes[0]!.top + boxes[0]!.height + 16);
    expect(boxes.at(-1)!.top).toBeGreaterThanOrEqual(Math.max(...boxes.slice(0,-1).map(b=>b.top+b.height))+16);
    for (const b of boxes) {
      expect(b.top).toBeGreaterThanOrEqual(plan.titleBox.top + plan.titleBox.height + 16);
      expect(b.left).toBeGreaterThanOrEqual(plan.box.left + 24);
      expect(b.left+b.width).toBeLessThanOrEqual(plan.box.left+plan.box.width-24);
      expect(b.top+b.height).toBeLessThanOrEqual(plan.box.top+plan.box.height-24);
    }
    for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) expect(overlap(boxes[i]!,boxes[j]!)).toBe(false);
  });
  it('retains legacy placement when omitted or explicitly one column', () => {
    const legacy = { ...region(), kpi_columns: undefined };
    expect(planAnalysisRegions({ ...input, regions: [legacy] })).toEqual(planAnalysisRegions({ ...input, regions: [{ ...legacy, kpi_columns: 1 }] }));
  });
  it('rejects other region kinds and insufficient KPIs', () => {
    for (const r of [groups[0]!, groups[2]!]) expect(() => planAnalysisRegions({ ...input, regions: [{ ...r, kpi_columns: 1 }] })).toThrow(/kpi_columns/);
    expect(() => planAnalysisRegions({ ...input, regions: [region(1)] })).toThrow(/at least two/);
  });
});
