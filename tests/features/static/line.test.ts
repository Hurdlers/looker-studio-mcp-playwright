import { describe, expect, it } from 'vitest';

import { added, box, fakeRap, prop, rejects, report, run } from './fake.js';

const arrow = (c: Record<string, any>) => prop(c).arrowProperty;

describe('line_add', () => {
  it('line.add: an arrow component whose box and terminals come from the two points; equal points are invalid', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'line_add', { from: { x: 100, y: 200 }, to: { x: 500, y: 200 } });
    const c = added(f.calls);
    expect(c.type).toBe('arrow');
    expect(box(c)).toEqual({ left: 100, top: 200, width: 400, height: 0 });
    expect(arrow(c).terminals).toEqual({
      start: { componentId: '', anchorId: '', left: 100, top: 200 },
      end: { componentId: '', anchorId: '', left: 500, top: 200 },
    });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'line_add', { from: { x: 10, y: 10 }, to: { x: 10, y: 10 } }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('line.add: a line going left and down keeps its direction in the terminals', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'line_add', { from: { x: 400, y: 100 }, to: { x: 100, y: 300 } });
    const c = added(f.calls);
    expect(box(c)).toEqual({ left: 100, top: 100, width: 300, height: 200 });
    expect(arrow(c).terminals.start).toMatchObject({ left: 400, top: 100 });
    expect(arrow(c).terminals.end).toMatchObject({ left: 100, top: 300 });
  });

  it('line.add: preserves fractional endpoints and their exact box without rounding', async () => {
    const from = { x: 12.5, y: 34.25 }, to = { x: 321.875, y: 34.25 };
    for (const points of [{ from, to }, { from: to, to: from }]) {
      const f = fakeRap(report());
      await run(f.rap, 'line_add', points);
      const component = added(f.calls);
      expect(box(component)).toEqual({ left: 12.5, top: 34.25, width: 309.375, height: 0 });
      expect(arrow(component).terminals.start).toMatchObject({ left: points.from.x, top: points.from.y });
      expect(arrow(component).terminals.end).toMatchObject({ left: points.to.x, top: points.to.y });
    }
  });

  it.each([NaN, Infinity, -Infinity, -0.25, 20000.25])('line.add: refuses invalid endpoint %s before any request', async value => {
    const f = fakeRap(report());
    await rejects(run(f.rap, 'line_add', { from: { x: value, y: 20.5 }, to: { x: 40.25, y: 20.5 } }), 'invalid');
    expect(f.calls).toEqual([]);
  });

  const line = { from: { x: 100, y: 200 }, to: { x: 500, y: 200 } };

  it('line.color: strokeColor with opacity 1; a color name is invalid', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'line_add', { ...line, color: '#FF8F00' });
    expect(arrow(added(f.calls)).strokeColor).toEqual({ color: '#FF8F00', opacity: 1 });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'line_add', { ...line, color: 'orange' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('line.border_style: option text (case ignored) to strokeStyle; an unknown one lists the options', async () => {
    for (const [value, want] of [
      ['Dashed', 1],
      ['dotted', 2],
      ['Solid', 0],
    ] as const) {
      const f = fakeRap(report());
      await run(f.rap, 'line_add', { ...line, border_style: value });
      expect(arrow(added(f.calls)).strokeStyle).toBe(want);
    }
    const g = fakeRap(report());
    const err = await rejects(run(g.rap, 'line_add', { ...line, border_style: 'Wavy' }), 'invalid');
    expect(err.message).toContain('Solid, Dashed, Dotted, Double');
    expect(g.calls).toEqual([]);
  });

  it('line.ends: start and end markers; one side alone leaves the other as the template has it; unknown is invalid', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'line_add', { ...line, start: 'Circle', end: 'Pointer' });
    expect(arrow(added(f.calls))).toMatchObject({ startHeadStyle: 2, endHeadStyle: 1 });
    f = fakeRap(report());
    await run(f.rap, 'line_add', { ...line, end: 'Diamond' });
    expect(arrow(added(f.calls)).endHeadStyle).toBe(3);
    expect(arrow(added(f.calls)).startHeadStyle).toBeUndefined();
    const g = fakeRap(report());
    await rejects(run(g.rap, 'line_add', { ...line, start: 'Arrow' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('line.style: weight by label, "Stroke color" wins over color, unknown labels are not applied', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'line_add', { ...line, color: '#FF0000', style: { 'Border weight': 6, 'Stroke color': '#00FF00', Nope: 1 } });
    const p = arrow(added(f.calls));
    expect(p.strokeWidth).toBe(6);
    expect(p.strokeColor.color).toBe('#00FF00');
    expect(text).toContain('Not applied: Nope');
  });
});
