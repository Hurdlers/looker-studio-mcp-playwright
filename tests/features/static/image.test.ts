import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { added, box, fakeRap, prop, REPORT, rejects, report, run } from './fake.js';

const PNG = 'fixtures/static/red-120x40.png';
const fromWebSafe = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64');
const upload = (calls: Array<{ endpoint: string; body: Record<string, any> }>) => calls.find((c) => c.endpoint === 'uploadImage')!.body;

describe('image_add', () => {
  it('image.source.file: uploads the file as web-safe base64 and points the new image at the uploaded id', async () => {
    const f = fakeRap(report(), { uploadImage: () => ({ id: 'img-up-1' }) });
    await run(f.rap, 'image_add', { image: PNG });
    const body = upload(f.calls);
    expect(body).toMatchObject({ filename: 'red-120x40.png', contentType: 'image/png', reportId: REPORT });
    expect(body.payload).not.toMatch(/[+/=]/);
    expect(fromWebSafe(body.payload).equals(readFileSync(PNG))).toBe(true);
    const c = added(f.calls);
    expect(c.type).toBe('image-component');
    expect(prop(c).imageProperty.file).toEqual({ id: 'img-up-1', name: 'red-120x40.png', type: 'image/png' });
  });

  it('image.source.file: a .bmp, a missing path and an empty file are invalid before any call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kds-img-'));
    writeFileSync(join(dir, 'a.bmp'), 'BM');
    writeFileSync(join(dir, 'empty.png'), '');
    for (const image of [join(dir, 'a.bmp'), join(dir, 'missing.png'), join(dir, 'empty.png')]) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'image_add', { image }), 'invalid');
      expect(g.calls).toEqual([]);
    }
  });

  it('image.source.url: Looker fetches the address, the bytes are uploaded web-safe, and the image is 250×250 in the middle', async () => {
    const f = fakeRap(report(), {
      getImageDataByUrl: () => ({ dataByteArray: 'iVBO+/8=', filename: 'logo.png', contentType: 'image/png' }),
    });
    await run(f.rap, 'image_add', { image: 'https://example.com/a/logo.png' });
    expect(f.calls.find((c) => c.endpoint === 'getImageDataByUrl')!.body).toEqual({ url: 'https://example.com/a/logo.png' });
    expect(upload(f.calls)).toMatchObject({ payload: 'iVBO-_8.', contentType: 'image/png', filename: 'logo.png' });
    expect(box(added(f.calls))).toEqual({ left: 475, top: 325, width: 250, height: 250 });
  });

  it('image.source.url: http and spaces are invalid before any call; no bytes back means invalid and no save', async () => {
    for (const image of ['http://example.com/a.png', 'https://example.com/a b.png']) {
      const g = fakeRap(report());
      await rejects(run(g.rap, 'image_add', { image }), 'invalid');
      expect(g.calls).toEqual([]);
    }
    const f = fakeRap(report(), { getImageDataByUrl: () => ({ filename: 'x', contentType: 'image/png' }) });
    await rejects(run(f.rap, 'image_add', { image: 'https://example.com/a.png' }), 'invalid');
    expect(f.calls.map((c) => c.endpoint)).not.toContain('updatePage');
    expect(f.calls.map((c) => c.endpoint)).not.toContain('uploadImage');
  });

  it('image.source.data_uri: decodes the URI and uploads it as image.<ext>; other types are invalid', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'image_add', { image: 'data:image/png;base64,iVBO+/8=' });
    expect(upload(f.calls)).toMatchObject({ filename: 'image.png', contentType: 'image/png', payload: 'iVBO-_8.' });
    f = fakeRap(report());
    await run(f.rap, 'image_add', { image: 'data:image/jpeg;base64,/9j/4AAQ' });
    expect(upload(f.calls)).toMatchObject({ filename: 'image.jpg', contentType: 'image/jpeg' });
    const g = fakeRap(report());
    await rejects(run(g.rap, 'image_add', { image: 'data:image/bmp;base64,AAAA' }), 'invalid');
    expect(g.calls).toEqual([]);
  });

  it('image.alt_text: sets altText, and leaves the key out when omitted', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'image_add', { image: PNG, alt_text: 'Company logo' });
    expect(prop(added(f.calls)).imageProperty.altText).toBe('Company logo');
    f = fakeRap(report());
    await run(f.rap, 'image_add', { image: PNG });
    expect('altText' in prop(added(f.calls)).imageProperty).toBe(false);
  });

  it('image.layout: the given box as is; a file without position on an empty page is 200×150 at left 40, top 20', async () => {
    let f = fakeRap(report());
    await run(f.rap, 'image_add', { image: PNG, position: { left: 10, top: 20, width: 300, height: 100 } });
    expect(box(added(f.calls))).toEqual({ left: 10, top: 20, width: 300, height: 100 });
    f = fakeRap(report());
    await run(f.rap, 'image_add', { image: PNG });
    expect(box(added(f.calls))).toEqual({ left: 40, top: 20, width: 200, height: 150 });
  });

  it('image.style: radius and opacity by label; unknown labels are not applied', async () => {
    const f = fakeRap(report());
    const { text } = await run(f.rap, 'image_add', { image: PNG, style: { 'Border radius': 12, Opacity: '80%', Nope: true } });
    const bab = prop(added(f.calls)).imageProperty.backgroundAndBorderProperty;
    expect(bab.border.radius).toBe(12);
    expect(bab.opacity).toBe(0.8);
    expect(text).toContain('Not applied: Nope');
  });

  it('image.style: a radius is saved inside a whole border object, as the editor saves it', async () => {
    const f = fakeRap(report());
    await run(f.rap, 'image_add', { image: PNG, position: { left: 100, top: 100, width: 200, height: 200 }, style: { 'Border radius': 50 } });
    const bab = prop(added(f.calls)).imageProperty.backgroundAndBorderProperty;
    expect(bab.border).toEqual({ radius: 50, color: 'transparent', opacity: 1, size: 0, style: 0 });
  });
});
