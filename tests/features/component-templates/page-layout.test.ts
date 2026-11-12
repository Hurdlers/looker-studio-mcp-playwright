import { describe, expect, it } from 'vitest';
import { planPageLayout, type PageLayoutInput, type PageLayoutPlan } from '../../../src/features/component-templates/page-layout.js';

const base: PageLayoutInput = { width: 1200, columns: 2, padding: 24, gap: 24, items: [] };
function inspect(plan: PageLayoutPlan, input: PageLayoutInput) {
  expect(plan.items.map(item => item.key)).toEqual(input.items.map(item => item.key));
  const boxes = [...plan.items, ...(plan.sidebar ? [plan.sidebar] : [])];
  for (const item of boxes) {
    expect(item.position.left).toBeGreaterThanOrEqual(input.padding);
    expect(item.position.top).toBeGreaterThanOrEqual(input.padding);
    expect(item.position.left + item.size.width + input.padding).toBeLessThanOrEqual(plan.width);
    expect(item.position.top + item.size.height + input.padding).toBeLessThanOrEqual(plan.height);
    for (const value of Object.values({ ...item.position, ...item.size })) expect(Number.isInteger(value)).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.position.left + a.size.width + input.gap <= b.position.left ||
      b.position.left + b.size.width + input.gap <= a.position.left ||
      a.position.top + a.size.height + input.gap <= b.position.top ||
      b.position.top + b.size.height + input.gap <= a.position.top).toBe(true);
  }
  plan.items.forEach((item, i) => {
    expect(item.size.width).toBeGreaterThanOrEqual(input.items[i]!.min_width);
    expect(item.size.height).toBe(input.items[i]!.height);
  });
}

describe('page grid layout', () => {
  it('keeps input order, wraps spans and sizes rows by their tallest item', () => {
    const input = { ...base, items: [
      { key: 'short', height: 160, min_width: 160 },
      { key: 'tall', height: 360, min_width: 320 },
      { key: 'wide', span: 2, height: 480, min_width: 600 },
      { key: 'bottom', height: 180, min_width: 160 },
    ] };
    const result = planPageLayout(input);
    expect(result.items.map(i => i.position.top)).toEqual([24, 24, 408, 912]);
    expect(result.height).toBe(1116);
    expect(result.items[2]!.size.width).toBe(1152);
    inspect(result, input);
  });

  it('reduces columns on narrow pages and clamps spans without shrinking contents', () => {
    const input = { ...base, width: 720, columns: 3, items: [
      { key: 'chart', height: 360, min_width: 360 },
      { key: 'section', span: 3, height: 900, min_width: 600 },
    ] };
    const result = planPageLayout(input);
    expect(result.columns).toBe(1);
    expect(result.notes.join(' ')).toContain('3개에서 1개');
    expect(result.items[1]!.size.width).toBe(672);
    inspect(result, input);
  });

  it('reserves the sidebar lane and extends it to the full body height', () => {
    const input = { ...base, width: 1440, sidebar_width: 240, items: [
      { key: 'section', span: 2, height: 1000, min_width: 600 },
      { key: 'card', height: 180, min_width: 160 },
    ] };
    const result = planPageLayout(input);
    expect(result.items[0]!.position.left).toBe(288);
    expect(result.sidebar).toEqual({ position: { left: 24, top: 24 }, size: { width: 240, height: 1204 } });
    expect(result.height).toBe(1252);
    inspect(result, input);
  });

  it('leaves a short sidebar large enough for its navigation content', () => {
    const input = { ...base, sidebar_width: 240, items: [{ key: 'card', min_width: 160, height: 160 }] };
    const result = planPageLayout(input);
    expect(result.sidebar!.size.height).toBe(720);
    expect(result.height).toBe(768);
    inspect(result, input);
    const taller = { ...input, sidebar_min_height: 1100 };
    const tallResult = planPageLayout(taller);
    expect(tallResult.sidebar!.size.height).toBe(1100);
    expect(tallResult.height).toBe(1148);
    inspect(tallResult, taller);
  });

  it('fits odd page widths and mixed spans without overlaps or fractional pixels', () => {
    for (const width of [641, 987, 1201, 1673]) for (const columns of [1, 2, 3, 4]) {
      const input = { ...base, width, columns, gap: 17, padding: 19, items: Array.from({ length: 12 }, (_, i) => ({
        key: `item-${i}`, span: i % columns + 1, height: 97 + i * 11, min_width: 150,
      })) };
      inspect(planPageLayout(input), input);
    }
  });

  it('refuses a component that cannot fit even after reducing to one column', () => {
    expect(() => planPageLayout({ ...base, width: 800, sidebar_width: 240, items: [{ key: 'wide', min_width: 600, height: 300 }] })).toThrow(/minimum/);
    expect(() => planPageLayout({ ...base, width: 200, sidebar_width: 240, items: [{ key: 'a', min_width: 1, height: 1 }] })).toThrow(/no room/);
  });

  it('enforces the outer page limit including padding and row gaps', () => {
    const item = { key: 'a', height: 19952, min_width: 1 };
    expect(planPageLayout({ ...base, columns: 1, items: [item] }).height).toBe(20000);
    expect(() => planPageLayout({ ...base, columns: 1, items: [{ ...item, height: 19953 }] })).toThrow(/height/);
    expect(() => planPageLayout({ ...base, columns: 1, items: [{ ...item, height: 10000 }, { ...item, key: 'b', height: 10000 }] })).toThrow(/height/);
  });

  it('rejects missing, duplicate or invalid layout inputs before producing positions', () => {
    const item = { key: 'a', min_width: 160, height: 160 };
    for (const input of [
      { ...base, items: [] }, { ...base, items: [item, item] },
      { ...base, width: NaN, items: [item] }, { ...base, gap: -1, items: [item] },
      { ...base, padding: 1.5, items: [item] }, { ...base, columns: 5, items: [item] },
      { ...base, sidebar_width: 159, items: [item] },
      { ...base, items: [{ ...item, span: 3 }] }, { ...base, items: [{ ...item, height: Infinity }] },
      { ...base, items: [{ ...item, key: ' ' }] },
    ]) expect(() => planPageLayout(input)).toThrow();
  });
});
