import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { FIXTURES } from '../../core/components.js';
import { toMapValue } from '../../core/mapvalue.js';
import { listPages, pageSize } from '../../core/page.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { exportComponent, type StyleDepth } from './components.js';
import { exportGroups } from './groups.js';
import { expandPath, readState, reportIdOf, reportInput, type Json, type Spec, type State } from './model.js';
import { color, exportSources, property, settingsOf } from './reverse.js';

async function themeOf(ctx: ToolContext, state: State): Promise<Json> {
  const known = ctx.ext.reportTheme(state.doc);
  const canvas = pageSize(state.doc, '');
  if (!known) { state.notes.push('Theme labels are unavailable; only the canvas size was exported.'); return { canvas }; }
  const out: Json = { ...known, canvas: known.canvas ?? canvas };
  let defaults: Json = {};
  if (known.preset) {
    try {
      const preset = JSON.parse(await readFile(join(FIXTURES, 'theme/presets', `${known.preset}.json`), 'utf8'));
      const doc = structuredClone(state.doc);
      const resource = (doc.report.resource ??= {}) as Json;
      resource.theme = { value: [toMapValue({ id: 'export-base', content: preset })] };
      const prop: Json = ((doc.report.propertyConfig ??= {}).reportProperty ??= {});
      prop.themeConfig = 'export-base';
      defaults = ctx.ext.reportTheme(doc)?.settings ?? {};
    } catch { state.notes.push('Theme preset defaults were unavailable; every known theme setting was retained.'); }
  }
  const settings = Object.fromEntries(Object.entries(known.settings ?? {}).filter(([key, value]) => !isDeepStrictEqual(value, defaults[key])).map(([key, value]) => [key, value === 'transparent' || (value as Json | undefined)?.color === 'transparent' ? 'transparent' : (value as Json | undefined)?.opacity === 0 ? value : color(value)]));
  if (Object.keys(settings).length) out.settings = settings; else delete out.settings;
  if (!Object.keys(known.layout ?? {}).length) delete out.layout;
  return out;
}

async function imageOf(ctx: ToolContext, component: Json, state: State, path: string | undefined, page: string, index: number): Promise<Json> {
  const base = await exportComponent(ctx, component, state, 'none', new Set());
  const image = property(component).imageProperty ?? {}, file = image.file ?? {};
  if (image.altText !== undefined) base.alt_text = image.altText;
  if (image.linkUrl || image.internalLink) state.notes.push(`${component.componentId}: image links are not supported by image_add and were omitted.`);
  if (typeof file.name === 'string' && /^https:\/\//i.test(file.name)) { base.image = file.name; return base; }
  try {
    const reply = await ctx.rap.call<{ payload: string }>('getImageV2', { reportId: state.doc.shareable.id, id: file.id }, undefined, 'get');
    if (typeof reply?.payload !== 'string') throw new Error('The response has no image payload');
    const bytes = Buffer.from(reply.payload.replaceAll('-', '+').replaceAll('_', '/').replaceAll('.', '='), 'base64');
    const encoded = bytes.toString('base64');
    if (path) {
      const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as Json)[file.type] ?? 'png';
      const folder = `${basename(path, extname(path))}-images`;
      const name = `${page}-${index}.${extension}`;
      await mkdir(join(dirname(path), folder), { recursive: true });
      await writeFile(join(dirname(path), folder, name), bytes);
      base.image = `${folder}/${name}`;
    } else if (encoded.length <= 512 * 1024) base.image = `data:${file.type || 'image/png'};base64,${encoded}`;
    else return { component: 'other', panel: `Image ${file.name ?? ''} (${Math.ceil(bytes.length / 1024)} KB); pass path to export its bytes.`, position: base.position };
    return base;
  } catch (error) {
    state.notes.push(`${component.componentId}: image could not be read: ${error instanceof Error ? error.message : String(error)}.`);
    return { component: 'other', panel: `Unreadable image ${file.name ?? ''}`, position: base.position };
  }
}

export async function docToSpec(ctx: ToolContext, state: State, depth: StyleDepth, path?: string): Promise<Spec> {
  const valueColorsUsed = new Set<string>();
  const convert = async (component: Json, page: string, index: number): Promise<Json> => {
    if (component.type === 'image-component') {
      const image = await imageOf(ctx, component, state, path, page, index);
      const styled = await exportComponent(ctx, component, state, depth, valueColorsUsed);
      if (styled.style && image.component !== 'other') image.style = styled.style;
      return image;
    }
    return exportComponent(ctx, component, state, depth, valueColorsUsed);
  };
  const data = exportSources(state);
  const spec: Spec = { version: 1, name: state.doc.shareable.name ?? 'Untitled report', ...data, data_sources: data.data_sources,
    theme: await themeOf(ctx, state), pages: [], report_components: [] };
  for (const [index, info] of listPages(state.doc).entries()) {
    const page = state.doc.page.find((entry) => entry.pageId === info.pageId)!;
    const settings = settingsOf(ctx, page.page, 'page', state);
    const components: Json[] = [];
    for (const [componentIndex, component] of (page.page.componentConfig ?? []).entries()) components.push(await convert(component, `page${index + 1}`, componentIndex));
    const groups = exportGroups(page, components, state.notes);
    spec.pages.push({ name: info.name, components, ...(groups ? { groups } : {}), ...(settings ? { settings } : {}), ...(info.hidden ? { hidden: true } : {}) });
    if (info.section) state.notes.push(`Page "${info.name}" belongs to a section; section grouping is not exported.`);
  }
  for (const [index, component] of (state.doc.report.componentConfig ?? []).entries()) spec.report_components.push(await convert(component, 'report', index));
  const reportSettings = settingsOf(ctx, state.doc.report, 'report', state);
  if (reportSettings) spec.report_settings = reportSettings;
  const other = [...spec.pages.flatMap((page) => page.components), ...spec.report_components].filter((component) => component.component === 'other').length;
  if (other) state.notes.push(`${other} other component(s) will be skipped by report_spec_apply.`);
  return spec;
}

export const reportSpecExport = defineTool({
  name: 'report_spec_export', title: 'Export a report specification',
  description: 'Reads a report into a portable JSON specification using the same inputs as the creation tools. Use it to recreate pages, sources and components elsewhere; unsupported settings are listed as notes, and path saves uploaded image bytes beside the JSON file.',
  input: { report_id: reportInput, style: z.enum(['none', 'main', 'all']).default('main').describe('스타일 깊이. main은 주요 설정 중 기본값과 다른 것, all은 알려진 모든 값, none은 스타일을 생략합니다.'), path: z.string().min(1).optional().describe('스펙을 쓸 JSON 파일 경로. ~와 상대 경로를 받으며 이미지 파일도 옆 폴더에 저장합니다.') },
  write: false, readOnlyHint: false,
  run: async (ctx, input) => {
    const state = await readState(ctx, reportIdOf(input.report_id));
    const path = input.path === undefined ? undefined : expandPath(input.path);
    const spec = await docToSpec(ctx, state, input.style, path);
    const json = JSON.stringify(spec, null, 2);
    if (path) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${json}\n`, 'utf8'); }
    return text([`\`\`\`json\n${json}\n\`\`\``, ...(path ? [`Saved ${path}. Use spec_path with report_spec_apply to read it.`] : []), ...state.notes.map((note) => `Note: ${note}`)].join('\n'));
  },
});
