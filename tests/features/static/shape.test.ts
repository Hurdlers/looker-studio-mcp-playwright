import { describe, expect, it } from 'vitest';

import { SHAPES } from '../../../src/features/static/shape.js';
import { added, box, fakeRap, prop, rejects, report, run } from './fake.js';

const shapeProp = (c: Record<string, any>) => prop(c).genericShapeProperty;

describe('shape_add', () => {
  it('shape.layout: puts a generic-shape at the given box, last in the page, and answers its id and position', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'shape_add', { shape: 'rectangle', position: { left: 0, top: 0, width: 1200, height: 80 } });
    const c = added(f.calls);
    expect(c.type).toBe('generic-shape');
    expect(box(c)).toEqual({ left: 0, top: 0, width: 1200, height: 80 });
    expect(text).toContain(`component_id: ${c.componentId}`);
    expect(text).toContain('position: {"left":0,"top":0,"width":1200,"height":80}');
  });

  it('shape.layout: without a position it is 200×200 at left 40, 20 px below the lowest component', async () => {
    const f = fakeRap(report([{ componentId: 'cd-a', type: 'x', attributeConfig: { componentAttribute: { left: 0, top: 0, width: 1200, height: 80 } } }]));
    await run(f.rap, 'shape_add', { shape: 'star' });
    expect(box(added(f.calls))).toEqual({ left: 40, top: 100, width: 200, height: 200 });
  });

  for (const [name, { preset, shapeType }] of Object.entries(SHAPES)) {
    it(`shape.kind.${name}: makes a generic-shape with preset ${preset} and shapeType ${shapeType}; an unknown shape is invalid`, async () => {
      const f = fakeRap(report());
      await run(f.rap, 'shape_add', { shape: name });
      const c = added(f.calls);
      expect(c.type).toBe('generic-shape');
      expect(c.preset).toBe(preset);
      expect(shapeProp(c).shapeType).toBe(shapeType);
      expect(c.componentId).toMatch(/^cd-[0-9a-f]{10}$/);
      if (name === 'callout') expect(shapeProp(c).calloutTailDirection).toBe(5);

      const g = fakeRap(report());
      await rejects(run(g.rap, 'shape_add', { shape: 'blob' }), 'invalid');
      expect(g.calls).toEqual([]);
    });
  }

  it('shape.background: fills with the color at opacity 1; a color name is invalid', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', background: '#3B5998' });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.background).toEqual({ color: '#3B5998', opacity: 1 });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'shape_add', { shape: 'rectangle', background: 'blue' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('shape.border_color: sets the border color, raising weight 0 to 1 unless style sets it; a short color is invalid', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', border_color: '#FF8F00' });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.border).toMatchObject({ color: '#FF8F00', opacity: 1, size: 1 });
    f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', border_color: '#FF8F00', style: { 'Border weight': 4 } });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.border).toMatchObject({ color: '#FF8F00', size: 4 });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'shape_add', { shape: 'rectangle', border_color: '#FF8F0' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('shape.border_radius: rectangles take the radius (0 too); other shapes list it as not applied; 201 is invalid', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', border_radius: 20 });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.border.radius).toBe(20);
    f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', border_radius: 0 });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.border.radius).toBe(0);
    f = fakeRap(report());
    const { text } = await run(f.rap, 'shape_add', { shape: 'circle', border_radius: 20 });
    expect(shapeProp(added(f.calls)).backgroundAndBorderProperty.border.radius).toBe(0);
    expect(text).toContain('Not applied: border_radius');
    const g = fakeRap(report());
    await rejects(run(g.rap, 'shape_add', { shape: 'rectangle', border_radius: 201 }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('shape.style: opacity, weight, shadow and dash by label; Double is not a shape border style', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'shape_add', { shape: 'rectangle', style: { Opacity: '50%', 'Border weight': 0, 'Add border shadow': true, 'Border style': 'Dashed' } });
    const bab = shapeProp(added(f.calls)).backgroundAndBorderProperty;
    expect(bab.opacity).toBe(0.5);
    expect(bab.border.size).toBe(0);
    expect(bab.boxShadow).toBe(true);
    expect(bab.border.style).toBe(1);
    const g = fakeRap(report());
    const err = await rejects(run(g.rap, 'shape_add', { shape: 'rectangle', style: { 'Border style': 'Double' } }), 'invalid');
    expect(err.message).toContain('"Solid", "Dashed", "Dotted"');
    expect(g.calls).toEqual([]);
  });

  it('shape.style: an unknown label is saved around and listed as not applied', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'shape_add', { shape: 'rectangle', style: { Nope: 1 } });
    expect(f.calls.some((c) => c.endpoint === 'updatePage')).toBe(true);
    expect(text).toContain('Not applied: Nope');
  });
});
