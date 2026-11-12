import { describe, expect, it } from 'vitest';

import { added, box, fakeRap, prop, rejects, report, run } from './fake.js';

describe('embed_add', () => {
  it('embed.add: a framed-external-content showing the trimmed address; non-web addresses are invalid before any call', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'embed_add', { url: ' https://example.com/page ' });
    const c = added(f.calls);
    expect(c.type).toBe('framed-external-content');
    expect(prop(c).framedExternalContentProperty.contentUrl).toBe('https://example.com/page');
    for (const url of ['ftp://x', 'example.com']) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'embed_add', { url }), 'invalid');
      expect(g.calls).toEqual([]);
    }
  });

  it('embed.add: a page that refuses framing is still saved, with a warning', async () => {
    const f = fakeRap(report(), { checkEmbed: () => ({ canFrame: false }) });
    const { text } = await run(f.rap, 'embed_add', { url: 'https://example.com/page' });
    expect(f.calls.some((c) => c.endpoint === 'updatePage')).toBe(true);
    expect(text).toMatch(/Warning: .*does not allow being shown inside another page/);
  });

  it('embed.layout: 400×300 at left 40, top 20 on an empty page; a given box is kept', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'embed_add', { url: 'https://example.com' });
    expect(box(added(f.calls))).toEqual({ left: 40, top: 20, width: 400, height: 300 });
    f = fakeRap(report());
    await run(f.rap, 'embed_add', { url: 'https://example.com', position: { left: 0, top: 500, width: 1200, height: 400 } });
    expect(box(added(f.calls))).toEqual({ left: 0, top: 500, width: 1200, height: 400 });
  });

  it('embed.style: background, border weight and color by label; unknown labels are not applied', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'embed_add', {
      url: 'https://example.com',
      style: { Background: '#FFFFFF', 'Border weight': 2, 'Border color': '#000000', Nope: 1 },
    });
    const bab = prop(added(f.calls)).framedExternalContentProperty.backgroundAndBorderProperty;
    expect(bab.background).toEqual({ color: '#FFFFFF', opacity: 1 });
    expect(bab.border.size).toBe(2);
    expect(bab.border.color).toBe('#000000');
    expect(text).toContain('Not applied: Nope');
  });
});
