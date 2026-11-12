import { describe, expect, it } from 'vitest';
import { planPageHeader } from '../../../src/features/component-templates/page-header.js';
const controls = { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day', dimensions: [{ field: 'category', label: '분류' }] };
const base = { left: 24, top: 24, width: 1452, gap: 16, header: { title: '현황', description: '분석 설명' }, controls };
function geometry(plan: ReturnType<typeof planPageHeader>) {
  const boxes = [...plan.texts.map(t => t.box), ...(plan.scope ? [plan.scope.box] : []),
    ...(plan.controls?.entries.map(e => ({ left: e.left, top: e.top, width: e.width, height: 44 })) ?? [])];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
  }
  if (plan.panel) for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(plan.panel.left + 16);
    expect(b.top).toBeGreaterThanOrEqual(plan.panel.top + 16);
    expect(b.left + b.width).toBeLessThanOrEqual(plan.panel.left + plan.panel.width - 16);
    expect(b.top + b.height).toBeLessThanOrEqual(plan.panel.top + plan.panel.height - 16);
  }
}
describe('page filter header geometry', () => {
  it('places the title on the left and compact filters on the right of a 1500px canvas', () => {
    const plan = planPageHeader(base); expect(plan.inline).toBe(true);
    const title = plan.texts[0]!.box, first = plan.controls!.entries[0]!, last = plan.controls!.entries.at(-1)!;
    expect(title.left).toBe(40); expect(first.left).toBeGreaterThanOrEqual(title.left + title.width + 32);
    expect(last.left + last.width).toBe(1500 - 24 - 16);
    expect(plan.controls!.entries.map(c => c.field)).toEqual(['category', undefined]);
    expect(plan.height).toBe(plan.panel!.height + 16); geometry(plan);
  });
  it('stacks a 360px canvas with no content overlaps or content outside the panel', () => {
    const plan = planPageHeader({ ...base, width: 312 }); expect(plan.inline).toBe(false);
    const [category, date] = plan.controls!.entries;
    expect(date!.top).toBeGreaterThanOrEqual(category!.top + 44 + 16);
    expect(category!.top).toBeGreaterThan(plan.texts.at(-1)!.box.top + plan.texts.at(-1)!.box.height);
    geometry(plan);
  });
  it('reserves height for long multiline titles and wraps wide native labels', () => {
    const plan = planPageHeader({ ...base, width: 500, header: { title: '긴 제목'.repeat(30) + '\n다음 줄', description: '설명'.repeat(50) },
      controls: { ...controls, dimensions: [{ field: 'category', label: '긴 분류 이름'.repeat(9) }] } });
    expect(plan.texts[0]!.box.height).toBeGreaterThan(32);
    expect(plan.controls!.entries[0]!.width).toBe(468);
    expect(plan.controls!.entries[1]!.top).toBeGreaterThan(plan.controls!.entries[0]!.top);
    geometry(plan);
  });
  it('handles two classification filters and one date without adding external captions', () => {
    const plan = planPageHeader({ ...base, controls: { ...controls, dimensions: [{ field: 'category' }, { field: 'device' }] } });
    expect(plan.inline).toBe(true);
    expect(plan.controls!.entries.map(e => e.field)).toEqual(['category', 'device', undefined]);
    expect(plan.controls!.entries.every(e => e.captionHeight === 0)).toBe(true);
    expect(plan.texts).toHaveLength(2); geometry(plan);
  });
  it('retains the old title-only geometry without a filter panel or scope annotation', () => {
    const plan = planPageHeader({ ...base, controls: undefined });
    expect(plan.panel).toBeUndefined(); expect(plan.scope).toBeUndefined(); expect(plan.controls).toBeUndefined();
    expect(plan.texts[0]!.box).toEqual({ left: 24, top: 24, width: 1452, height: 32 });
    expect(plan.height).toBe(32 + 8 + 20 + 16); geometry(plan);
    expect(planPageHeader({ left: 24, top: 24, width: 1452, gap: 16 }).height).toBe(0);
  });
  it('supports controls without a title and rejects insufficient panel width', () => {
    const plan = planPageHeader({ ...base, header: undefined });
    expect(plan.texts).toEqual([]); expect(plan.scope).toBeDefined(); geometry(plan);
    expect(() => planPageHeader({ ...base, width: 271 })).toThrow(/272/);
  });
});

it('encloses a fixed list and leaves the scope note below its last row', () => {
  const plan = planPageHeader({ left: 24, top: 24, width: 1452, gap: 16, header: { title: '현황' },
    controls: { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day',
      dimensions: [{ field: 'category', label: '분류', display: 'list', visible_rows: 3 }] } });
  const list = plan.controls!.entries.find(entry => entry.field)!;
  expect(list.height).toBeGreaterThan(44);
  expect(plan.scope!.box.top).toBeGreaterThanOrEqual(list.top + list.height + 8);
  expect(plan.panel!.top + plan.panel!.height).toBeGreaterThanOrEqual(plan.scope!.box.top + plan.scope!.box.height + 16);
});

describe('brand band and logo', () => {
  const base = { left: 24, top: 24, width: 1452, gap: 16 };
  it('keeps the plain header unchanged when no brand input is given', () => {
    const plan = planPageHeader({ ...base, header: { title: 'Title' } });
    expect(plan.panel).toBeUndefined(); expect(plan.logo).toBeUndefined();
    expect(plan.texts[0]!.box.left).toBe(24);
  });
  it('makes a band panel without filters and starts the title after the logo', () => {
    const plan = planPageHeader({ ...base, header: { title: 'Title', description: 'About', band_color: '#123456', logo: { image: 'https://example.com/logo.png' } } });
    expect(plan.panel).toMatchObject({ left: 24, top: 24, width: 1452 });
    expect(plan.logo).toMatchObject({ left: 40, width: 144, height: 48 });
    expect(plan.texts[0]!.box.left).toBe(40 + 144 + 16);
    expect(plan.logo!.top + plan.logo!.height).toBeLessThanOrEqual(plan.panel!.top + plan.panel!.height - 16);
    expect(plan.height).toBe(plan.panel!.height + 16);
  });
  it('refuses a logo that leaves no room for the title', () => {
    expect(() => planPageHeader({ ...base, width: 300, header: { title: 'Title', logo: { image: 'x', width: 200 } } })).toThrow(/too narrow/);
  });
});
