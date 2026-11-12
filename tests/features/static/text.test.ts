import { describe, expect, it } from 'vitest';

import { added, box, endpoints, fakeRap, prop, rejects, report, run, savedComponents } from './fake.js';

const other = { componentId: 'cd-other00000', type: 'simple-description', attributeConfig: { componentAttribute: { left: 0, top: 0, width: 10, height: 10 } } };

describe('text_add', () => {
  it('text.add: escapes the text into a new simple-description at the end and leaves the others; blank text is invalid', async () => {
    const { rap, calls } = fakeRap(report([other]));
    const { text } = await run(rap, 'text_add', { text: 'Q3 매출 & 비용 <요약>' });
    const all = savedComponents(calls);
    const c = all.at(-1)!;
    expect(c.type).toBe('simple-description');
    expect(c.componentId).toMatch(/^cd-[0-9a-f]{10}$/);
    expect(prop(c).descriptionProperty.text).toBe('<div>Q3 매출 &amp; 비용 &lt;요약&gt;</div>');
    expect(all.slice(0, -1)).toEqual([other]);
    expect(text).toContain(`component_id: ${c.componentId}`);

    const blank = fakeRap(report());
    await rejects(run(blank.rap, 'text_add', { text: '   ' }), 'invalid');
    expect(blank.calls).toEqual([]);
  });

  it('text.add: dry run sends no snapshot or save and still answers kind and position; an unknown page is not_found', async () => {
    const { rap, calls } = fakeRap(report());
    const { text } = await run(rap, 'text_add', { text: 'Hi' }, { dryRun: true });
    expect(endpoints(calls)).not.toContain('createNamedRevision');
    expect(endpoints(calls)).not.toContain('updatePage');
    expect(text).toContain('Would add text');
    expect(text).toContain('position: {"left":40,"top":20,"width":400,"height":50}');

    const nope = fakeRap(report());
    await rejects(run(nope.rap, 'text_add', { text: 'Hi', page: 'Nope' }), 'not_found');
    expect(endpoints(nope.calls)).not.toContain('updatePage');
  });

  it('text.add: a page name puts it on that page', async () => {
    const { rap, calls } = fakeRap(report());
    await run(rap, 'text_add', { text: 'kds static check 1', page: 'second' });
    expect(calls.find((c) => c.endpoint === 'updatePage')!.body.pageId).toBe('p2');
  });

  it('text.layout: places at the given box, or 400×50 at left 40 below the lowest component, top 20 on an empty page', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'A', position: { left: 120, top: 300, width: 500, height: 60 } });
    expect(box(added(f.calls))).toEqual({ left: 120, top: 300, width: 500, height: 60 });

    const at = (top: number, height: number, id: string) => ({ componentId: id, type: 'x', attributeConfig: { componentAttribute: { left: 500, top, width: 100, height } } });
    f = fakeRap(report([at(100, 200, 'cd-a'), at(50, 400, 'cd-b')]));
    await run(f.rap, 'text_add', { text: 'A' });
    expect(box(added(f.calls))).toEqual({ left: 40, top: 470, width: 400, height: 50 });

    f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'A' });
    expect(box(added(f.calls))).toEqual({ left: 40, top: 20, width: 400, height: 50 });
  });

  it('text.layout: fills only what is missing; out-of-range sizes are invalid before any call', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'A', position: { left: 30 } });
    expect(box(added(f.calls))).toEqual({ left: 30, top: 20, width: 400, height: 50 });

    for (const position of [{ width: 5 }, { left: -1 }]) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'text_add', { text: 'A', position }), 'invalid');
      expect(g.calls).toEqual([]);
    }
  });

  it('text.font_size: wraps the text in a font-size span; 5 and 401 are invalid', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'Big', font_size: 40 });
    expect(prop(added(f.calls)).descriptionProperty.text).toBe('<div><span style="font-size: 40px;">Big</span></div>');
    for (const font_size of [5, 401]) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'text_add', { text: 'Big', font_size }), 'invalid');
      expect(g.calls).toEqual([]);
    }
  });

  it('text.color: wraps the text in <font color>; bad colors are invalid; style "Font color" wins', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'Alert', color: '#D32F2F' });
    expect(prop(added(f.calls)).descriptionProperty.text).toBe('<div><font color="#D32F2F">Alert</font></div>');
    for (const color of ['red', '#12345']) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'text_add', { text: 'Alert', color }), 'invalid');
      expect(g.calls).toEqual([]);
    }
    f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'Alert', color: '#D32F2F', style: { 'Font color': '#00FF00' } });
    expect(prop(added(f.calls)).descriptionProperty.text).toBe('<div><font color="#00FF00">Alert</font></div>');
  });

  it('text.background: sets the box background with opacity 1; a color without # is invalid', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'BG', background: '#FFF3E0' });
    expect(prop(added(f.calls)).descriptionProperty.backgroundAndBorderProperty.background).toEqual({ color: '#FFF3E0', opacity: 1 });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'text_add', { text: 'BG', background: 'FFF3E0' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  for (const [key, tag] of [
    ['bold', 'b'],
    ['italic', 'i'],
    ['underline', 'u'],
    ['strikethrough', 'strike'],
  ] as const) {
    it(`text.format.${key}: true wraps the text in <${tag}>, false leaves it plain`, async () => {
      let f = fakeRap(report());
      await run(f.rap, 'text_add', { text: 'Hi', [key]: true });
      expect(prop(added(f.calls)).descriptionProperty.text).toBe(`<div><${tag}>Hi</${tag}></div>`);
      f = fakeRap(report());
      await run(f.rap, 'text_add', { text: 'Hi', [key]: false });
      expect(prop(added(f.calls)).descriptionProperty.text).toBe('<div>Hi</div>');
    });
  }

  it('text.align: center and right go on the line div, left is plain; justify is invalid', async () => {
    const html = async (align: string) => {
      const f = fakeRap(report());
      await run(f.rap, 'text_add', { text: 'Hi', align });
      return prop(added(f.calls)).descriptionProperty.text;
    };
    expect(await html('center')).toBe('<div style="text-align: center;" align="center">Hi</div>');
    expect(await html('right')).toBe('<div style="text-align: right;" align="right">Hi</div>');
    expect(await html('left')).toBe('<div>Hi</div>');
    const g = fakeRap(report());
    await rejects(run(g.rap, 'text_add', { text: 'Hi', align: 'justify' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('text.style: border, opacity and font family by label', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'text_add', {
      text: 'Hi',
      style: { 'Border color': '#000000', 'Border weight': 2, 'Border radius': 8, Opacity: '80%', 'Font family': 'Roboto' },
    });
    const d = prop(added(f.calls)).descriptionProperty;
    expect(d.backgroundAndBorderProperty.border).toEqual({ color: '#000000', opacity: 1, size: 2, style: 0, radius: 8 });
    expect(d.backgroundAndBorderProperty.opacity).toBe(0.8);
    expect(d.text).toBe('<div><font face="Roboto">Hi</font></div>');
  });

  it('text.style: unknown labels are saved around and listed as not applied; bad colors and options are invalid before any call', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'text_add', { text: 'Hi', style: { 'No such label': true } });
    expect(endpoints(f.calls)).toContain('updatePage');
    expect(text).toContain('Not applied: No such label');

    let g = fakeRap(report());
    await rejects(run(g.rap, 'text_add', { text: 'Hi', style: { 'Border color': '#GGG' } }), 'invalid');
    expect(g.calls).toEqual([]);
    g = fakeRap(report());
    const err = await rejects(run(g.rap, 'text_add', { text: 'Hi', style: { 'Border style': 'Wavy' } }), 'invalid');
    expect(err.message).toContain('"Solid", "Dashed", "Dotted", "Double"');
    expect(g.calls).toEqual([]);
  });

  it('text.add: several lines become several divs and an empty line is <div><br></div>', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'text_add', { text: 'a\n\nb', bold: true });
    expect(prop(added(f.calls)).descriptionProperty.text).toBe('<div><b>a</b></div><div><br></div><div><b>b</b></div>');
  });
});
