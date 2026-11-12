import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { Extensions } from '../../../src/core/extensions.js';
import { ReportSession } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { FEATURE_EXTENSIONS, FEATURE_TOOLS } from '../../../src/features/registry.generated.js';
import { embedUrlUpdater } from '../../../src/features/static/embed.js';
import { applyTextStyle } from '../../../src/features/static/text.js';
import { styleUpdater } from '../../../src/features/static/update.js';
import type { Rap } from '../../../src/looker/rap.js';
import { endpoints, fakeRap, prop, REPORT, rejects, report, savedComponents } from './fake.js';

type Json = Record<string, any>;

// The real component_update (layout group) with every group's extensions, as
// the server registers them.
function serverContext(rap: Rap) {
  const home = mkdtempSync(join(tmpdir(), 'kds-static-upd-'));
  return createContext({
    rap,
    tools: FEATURE_TOOLS,
    home,
    config: parseConfig({ writes_enabled: true }, home),
    session: new ReportSession(rap),
    ext: new Extensions(FEATURE_EXTENSIONS),
  });
}

async function componentUpdate(rap: Rap, args: Json): Promise<{ text: string }> {
  const res = await runTool(serverContext(rap), 'component_update', { report_id: REPORT, ...args });
  return { text: resultText(res) };
}

const other = { componentId: 'cd-ffffffffff', type: 'generic-shape', preset: 'shape-rectangle', attributeConfig: { componentAttribute: { left: 1, top: 2, width: 30, height: 40 } } };
const text = {
  componentId: 'cd-aaaaaaaaaa',
  type: 'simple-description',
  preset: 'default',
  propertyConfig: { componentProperty: { descriptionProperty: { text: '<div><font color="#111111">A</font></div>', fontSize: 14 } } },
};
const legacyShape = {
  componentId: 'cd-bbbbbbbbbb',
  type: 'shape',
  propertyConfig: { componentProperty: { shapeProperty: { backgroundAndBorderProperty: { border: { color: 'transparent', opacity: 1, size: 0, style: 0, radius: 0 } } } } },
};
const circle = {
  componentId: 'cd-b0b0b0b0b0',
  type: 'generic-shape',
  preset: 'shape-ellipse',
  propertyConfig: { componentProperty: { genericShapeProperty: { shapeType: 1, backgroundAndBorderProperty: { border: { radius: 0 } } } } },
};
const line = {
  componentId: 'cd-cccccccccc',
  type: 'arrow',
  propertyConfig: { componentProperty: { arrowProperty: { strokeColor: { themeRef: { index: 2 } }, terminals: { start: { left: 1, top: 1 }, end: { left: 9, top: 1 } } } } },
};
const image = {
  componentId: 'cd-dddddddddd',
  type: 'image-component',
  propertyConfig: { componentProperty: { imageProperty: { file: { id: 'img', name: 'a.png', type: 'image/png' } } } },
};
const embed = {
  componentId: 'cd-eeeeeeeeee',
  type: 'framed-external-content',
  propertyConfig: { componentProperty: { framedExternalContentProperty: { contentUrl: 'https://a.example' } } },
};

const find = (calls: Parameters<typeof savedComponents>[0], id: string) => savedComponents(calls).find((c) => c.componentId === id)!;

describe('component_update with the static group extensions', () => {
  it('text.update.style: background by label and font color rewrites the HTML; other components stay as they were', async () => {
    const f = fakeRap(report([text, other]));
    await componentUpdate(f.rap, { component_id: text.componentId, style: { Background: '#000000', 'Font color': '#FFFFFF' } });
    const d = prop(find(f.calls, text.componentId)).descriptionProperty;
    expect(d.backgroundAndBorderProperty.background).toEqual({ color: '#000000', opacity: 1 });
    expect(d.text).toBe('<div><font color="#FFFFFF">A</font></div>');
    expect(find(f.calls, other.componentId)).toEqual(other);
  });

  it('text.update.style: an unknown id is not_found with no save; an unknown label is saved around and not applied', async () => {
    const f = fakeRap(report([text]));
    await rejects(componentUpdate(f.rap, { component_id: 'cd-0000000000', style: { Background: '#000000' } }), 'not_found');
    expect(endpoints(f.calls)).not.toContain('updatePage');
    const g = fakeRap(report([text]));
    const { text: notes } = await componentUpdate(g.rap, { component_id: text.componentId, style: { Nope: 1 } });
    expect(endpoints(g.calls)).toContain('updatePage');
    expect(notes).toContain('Not applied: Nope');
    expect(prop(find(g.calls, text.componentId)).descriptionProperty.text).toBe(text.propertyConfig.componentProperty.descriptionProperty.text);
  });

  it('shape.update.style: older "shape" components take fill, border color and radius; a circle does not take a radius', async () => {
    const f = fakeRap(report([legacyShape, circle]));
    await componentUpdate(f.rap, { component_id: legacyShape.componentId, style: { Background: '#3B5998', 'Border color': '#FF8F00', 'Border radius': 15 } });
    const bab = prop(find(f.calls, legacyShape.componentId)).shapeProperty.backgroundAndBorderProperty;
    expect(bab.background).toEqual({ color: '#3B5998', opacity: 1 });
    expect(bab.border.color).toBe('#FF8F00');
    expect(bab.border.radius).toBe(15);

    const g = fakeRap(report([legacyShape, circle]));
    const { text: notes } = await componentUpdate(g.rap, { component_id: circle.componentId, style: { 'Border radius': 15 } });
    expect(notes).toContain('Not applied: Border radius');
  });

  it('line.update.style: stroke color (theme reference dropped) and dash style; "Line start" is not applied', async () => {
    const f = fakeRap(report([line]));
    const { text: notes } = await componentUpdate(f.rap, {
      component_id: line.componentId,
      style: { 'Stroke color': '#E0E0E0', 'Border style': 'Dotted', 'Line start': 'Circle' },
    });
    const p = prop(find(f.calls, line.componentId)).arrowProperty;
    expect(p.strokeColor).toEqual({ color: '#E0E0E0', opacity: 1 });
    expect(p.strokeStyle).toBe(2);
    expect(p.terminals).toEqual(line.propertyConfig.componentProperty.arrowProperty.terminals);
    expect(notes).toContain('Not applied: Line start');
  });

  it('image.update.style: radius and opacity, file untouched', async () => {
    const f = fakeRap(report([image]));
    await componentUpdate(f.rap, { component_id: image.componentId, style: { 'Border radius': 8, Opacity: '50%' } });
    const p = prop(find(f.calls, image.componentId)).imageProperty;
    expect(p.backgroundAndBorderProperty.border.radius).toBe(8);
    expect(p.backgroundAndBorderProperty.opacity).toBe(0.5);
    expect(p.file).toEqual(image.propertyConfig.componentProperty.imageProperty.file);
    // A whole border, as the editor saves it (a lone {radius} drew square corners).
    expect(p.backgroundAndBorderProperty.border).toEqual({ radius: 8, color: 'transparent', opacity: 1, size: 0, style: 0 });
  });

  it('embed.update.style: background and border weight, address untouched', async () => {
    const f = fakeRap(report([embed]));
    await componentUpdate(f.rap, { component_id: embed.componentId, style: { Background: '#FFFFFF', 'Border weight': 2 } });
    const p = prop(find(f.calls, embed.componentId)).framedExternalContentProperty;
    expect(p.backgroundAndBorderProperty.background).toEqual({ color: '#FFFFFF', opacity: 1 });
    expect(p.backgroundAndBorderProperty.border.size).toBe(2);
    expect(p.contentUrl).toBe('https://a.example');
  });

  it('embed.update.style: an unknown label alone is saved around and reported as not applied', async () => {
    const f = fakeRap(report([embed]));
    const { text: notes } = await componentUpdate(f.rap, { component_id: embed.componentId, style: { Nope: 1 } });
    expect(endpoints(f.calls)).toContain('updatePage');
    expect(notes).toContain('Not applied: Nope');
    expect(prop(find(f.calls, embed.componentId)).framedExternalContentProperty.contentUrl).toBe('https://a.example');
  });

  it('embed.update.url: changes the address; a non-web address is invalid; on another type it is refused before anything is saved', async () => {
    const f = fakeRap(report([embed, text]));
    await componentUpdate(f.rap, { component_id: embed.componentId, embed_url: 'https://b.example/x' });
    expect(prop(find(f.calls, embed.componentId)).framedExternalContentProperty.contentUrl).toBe('https://b.example/x');
    expect(f.calls.find((c) => c.endpoint === 'checkEmbed')!.body).toEqual({ url: 'https://b.example/x' });

    const g = fakeRap(report([embed]));
    await rejects(componentUpdate(g.rap, { component_id: embed.componentId, embed_url: 'javascript:alert(1)' }), 'invalid');
    expect(endpoints(g.calls)).not.toContain('updatePage');

    const h = fakeRap(report([text]));
    const err = await rejects(componentUpdate(h.rap, { component_id: text.componentId, embed_url: 'https://b.example/x' }), 'invalid');
    expect(err.message).toContain('embed_url');
    expect(endpoints(h.calls)).not.toContain('updatePage');
    expect(endpoints(h.calls)).not.toContain('createNamedRevision');
  });

  it('text.update.style: font size and font through component_update rewrite the HTML; a bad font size saves nothing', async () => {
    const f = fakeRap(report([text]));
    await componentUpdate(f.rap, { component_id: text.componentId, style: { 'Font size': 30, Font: 'Roboto' } });
    const html = prop(find(f.calls, text.componentId)).descriptionProperty.text as string;
    expect(html).toContain('font-size: 30px');
    expect(html).toContain('Roboto');
    expect(html).toContain('A');
    const g = fakeRap(report([text]));
    await rejects(componentUpdate(g.rap, { component_id: text.componentId, style: { 'Font size': 2 } }), 'invalid');
    expect(endpoints(g.calls)).not.toContain('updatePage');
  });

  it('text.update.style: component_update offers style as an input, owned by this group', () => {
    const ext = new Extensions(FEATURE_EXTENSIONS);
    expect(ext.updater('style')).toBe(styleUpdater);
    const tool = FEATURE_TOOLS.find((t) => t.name === 'component_update')!;
    const shape = typeof tool.input === 'function' ? tool.input(ext) : tool.input;
    expect(Object.keys(shape)).toContain('style');
    expect(Object.keys(shape)).toContain('embed_url');
  });

  it('shape.update.style: a bad color fails the call before anything is saved', async () => {
    const f = fakeRap(report([legacyShape]));
    await rejects(componentUpdate(f.rap, { component_id: legacyShape.componentId, style: { Background: '#12' } }), 'invalid');
    expect(endpoints(f.calls)).not.toContain('updatePage');
  });

  it('shape.update.style: reads the static settings back by label', () => {
    const c = structuredClone(legacyShape) as Json;
    c.propertyConfig.componentProperty.shapeProperty.backgroundAndBorderProperty.background = { color: '#3B5998', opacity: 1 };
    const style = styleUpdater.read!(c, report()) as Json;
    expect(style.Background).toBe('#3B5998');
    expect(style['Border radius']).toBe(0);
  });

  it('embed.update.url: reads the address back for inspect and spec export', () => {
    expect(embedUrlUpdater.read!(embed, report())).toBe('https://a.example');
    expect(embedUrlUpdater.read!(text, report())).toBeUndefined();
  });

  it('text.update.style: restyling keeps bold and alignment and replaces only the font settings', () => {
    const c = structuredClone(text) as Json;
    c.propertyConfig.componentProperty.descriptionProperty.text =
      '<div style="text-align: center;" align="center"><span style="font-size: 20px;"><b>A</b></span></div><div><br></div>';
    applyTextStyle(c, { 'Font size': 30 });
    expect(c.propertyConfig.componentProperty.descriptionProperty.text).toBe(
      '<div style="text-align: center;" align="center"><span style="font-size: 30px;"><b>A</b></span></div><div><br></div>',
    );
  });
});
