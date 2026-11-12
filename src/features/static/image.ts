import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';

import { z } from 'zod';

import { place, template } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { pageSize } from '../../core/page.js';
import { defineTool, type ToolContext } from '../../core/tool.js';
import { addComponent, boxFor, nextSpot, pageInput, positionInput, reportIdInput, styleInput } from './common.js';
import { applyStaticStyle, staticLabels } from './styles.js';

type Json = Record<string, any>;

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

// Data URI media type → extension of the uploaded file's name.
const DATA_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

export const FILE_SIZE = { width: 200, height: 150 };
export const URL_SIZE = { width: 250, height: 250 };

// uploadImage wants web-safe base64 with "." padding: with plain base64 the
// "=" is stored escaped and the image shows blank.
export function webSafe(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
}

export type ImageSource =
  | { kind: 'file'; path: string; filename: string; contentType: string }
  | { kind: 'data'; filename: string; contentType: string; base64: string }
  | { kind: 'url'; url: string };

// Works out where the image comes from and checks it, without any request.
export function imageSource(input: string): ImageSource {
  const s = input.trim();
  if (/^data:/i.test(s)) {
    const m = /^data:([^;,]+);base64,(.*)$/is.exec(s);
    const type = m?.[1]!.toLowerCase();
    const ext = type ? DATA_TYPES[type] : undefined;
    if (!m || !ext)
      throw new LookerError('invalid', `Only base64 data URIs of PNG, JPEG, GIF, SVG or WebP images work (data:image/png;base64,…), not "${s.slice(0, 40)}…".`);
    const base64 = m[2]!.replace(/\s+/g, '');
    if (!base64) throw new LookerError('invalid', 'The data URI holds no image data.');
    return { kind: 'data', filename: `image.${ext}`, contentType: type!, base64 };
  }
  if (/^https:\/\//i.test(s)) {
    if (/\s/.test(s)) throw new LookerError('invalid', `The image address has spaces in it: encode them as %20. (${s})`);
    return { kind: 'url', url: s };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s))
    throw new LookerError('invalid', `Image addresses must start with https:// (${s}). Download the file and give its path instead.`);
  const path = resolve(s.replace(/^~(?=$|\/)/, homedir()));
  const ext = extname(path).slice(1).toLowerCase();
  const contentType = TYPES[ext];
  if (!contentType) throw new LookerError('invalid', `"${basename(path)}" has an extension other than .png, .jpg, .jpeg, .gif, .svg or .webp.`);
  let size: number;
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    throw new LookerError('invalid', `No image file at ${path}.`);
  }
  if (size === 0) throw new LookerError('invalid', `${path} is empty (0 bytes).`);
  return { kind: 'file', path, filename: basename(path), contentType };
}

interface Uploaded {
  file: { id: string; name: string; type: string };
}

// Gets the bytes (from the file, the data URI, or Looker fetching the URL)
// and uploads them to the report.
async function upload(ctx: ToolContext, reportId: string, src: ImageSource): Promise<Uploaded> {
  let filename: string;
  let contentType: string;
  let payload: string;
  if (src.kind === 'url') {
    const got = await ctx.rap.call<{ dataByteArray?: string; filename?: string; contentType?: string } | null>('getImageDataByUrl', { url: src.url });
    if (!got?.dataByteArray)
      throw new LookerError('invalid', `Looker Studio could not fetch an image from ${src.url}: check that the address opens an image without signing in.`);
    filename = got.filename || basename(new URL(src.url).pathname) || 'image';
    contentType = got.contentType || 'image/png';
    payload = webSafe(got.dataByteArray);
  } else {
    filename = src.filename;
    contentType = src.contentType;
    payload = webSafe(src.kind === 'file' ? readFileSync(src.path).toString('base64') : src.base64);
  }
  const res = await ctx.rap.call<{ id?: string } | null>('uploadImage', { filename, contentType, payload, reportId });
  const id = res?.id ?? (ctx.dryRun ? 'dry-run-image' : undefined);
  if (!id) throw new LookerError('format_changed', 'uploadImage answered without an image id: Looker Studio may have changed its internal API.');
  return { file: { id, name: filename, type: contentType } };
}

export const imageAdd = defineTool({
  name: 'image_add',
  title: 'Add an image',
  description:
    'Uploads an image into a report page as an image component: a local file (.png, .jpg, .jpeg, .gif, .svg, .webp), an https:// address that Looker Studio fetches itself, or a data:image/…;base64 URI. ' +
    'Use it for logos, icons and pictures; the image is stored in the report, so it keeps showing if the original goes away. ' +
    'Without a position a file or data URI gets a 200×150 box at left 40, 20 px below the lowest component, and an address gets 250×250 in the middle of the page. ' +
    'The box is used as given; the image keeps its proportions inside it. Plain http:// addresses are refused. ' +
    'Note: the upload happens before the save, so a failed save can leave an unused image stored in the report (harmless).',
  input: {
    report_id: reportIdInput,
    page: pageInput,
    image: z.string().describe('A local file path, an https:// image address, or a data:image/<type>;base64,… URI.'),
    alt_text: z.string().optional().describe('Alternative text for screen readers.'),
    position: positionInput('200×150 at left 40, 20 px below the lowest component (files, data URIs); 250×250 centered on the page (https addresses).'),
    style: styleInput(
      'Image Style tab settings by label: "Background", "Opacity", "Border color", "Border weight" (None, 1–5), "Border style" (Solid, Dashed, Dotted, Double), "Border radius" (0–100), "Border shadow".',
    ),
  },
  write: true,
  run: async (ctx, a) => {
    const src = imageSource(a.image);
    const style = a.style ?? {};
    // Check the style before anything is sent.
    applyStaticStyle(template('image-component'), staticLabels('image-component'), style);
    return addComponent(
      ctx,
      a,
      async (doc, pageId, reportId) => {
        const size = src.kind === 'url' ? URL_SIZE : FILE_SIZE;
        const box = boxFor(a.position, size, () => {
          if (src.kind !== 'url') return nextSpot(doc, pageId);
          const page = pageSize(doc, pageId);
          const w = a.position?.width ?? size.width;
          const h = a.position?.height ?? size.height;
          return { left: Math.max(0, Math.round((page.width - w) / 2)), top: Math.max(0, Math.round((page.height - h) / 2)) };
        });
        const up = await upload(ctx, reportId, src);
        const c: Json = place(template('image-component'), box);
        const p = (c.propertyConfig.componentProperty.imageProperty ??= {});
        p.file = up.file;
        if (a.alt_text) p.altText = a.alt_text;
        const styled = applyStaticStyle(c, staticLabels('image-component'), style);
        return { component: c, kind: 'image', notApplied: styled.notApplied, warnings: [] };
      },
      'add image',
    );
  },
});
