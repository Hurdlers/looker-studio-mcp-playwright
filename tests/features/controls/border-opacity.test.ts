import { describe, expect, it } from 'vitest';
import { looker, prop } from './fake.js';
describe('explicit control border opacity', () => {
  it.each(['drop_down', 'date_range'])('preserves defaults and explicit transparency on %s', async kind => {
    const f = looker(), args = { kind, ...(kind === 'drop_down' ? { field: 'device' } : {}) };
    const border = () => {
      const p = prop(f.components().at(-1)!);
      return (p.dimensionFilterProperty ?? p.dateRangePickerProperty).backgroundAndBorderProperty.border;
    };
    await f.add({ ...args, style: { 'Border weight': '1', 'Border color': '#123456' } });
    expect(border().opacity).toBe(0);
    await f.add({ ...args, style: { 'Border weight': '1', 'Border opacity': 1 } });
    expect(border()).toMatchObject({ size: 1, opacity: 1 });
    const component_id = f.components().at(-1)!.componentId;
    await f.run('component_update', { component_id, style: { 'Border opacity': 0 } });
    expect(border().opacity).toBe(0);
    await f.run('component_update', { component_id, style: { 'Border opacity': '50%' } });
    expect(border().opacity).toBe(0.5);
  });
  it.each([-1, 101, 'nonsense'])('rejects invalid opacity %s before saving', async value => {
    const f = looker();
    await expect(f.add({ kind: 'date_range', style: { 'Border opacity': value } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
  });
});
