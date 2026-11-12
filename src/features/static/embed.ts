import { z } from 'zod';

import { place, template } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { defineTool, type ToolContext } from '../../core/tool.js';
import { addComponent, boxFor, nextSpot, pageInput, positionInput, reportIdInput, styleInput } from './common.js';
import { applyStaticStyle, staticLabels } from './styles.js';

type Json = Record<string, any>;

export const EMBED_TYPE = 'framed-external-content';
export const EMBED_SIZE = { width: 400, height: 300 };

export function embedUrl(input: string): string {
  const url = input.trim();
  if (!/^https?:\/\/[^\s/?#]+\S*$/i.test(url))
    throw new LookerError('invalid', `"${input}" is not a web address: give one starting with https:// (or http://).`);
  return url;
}

// Whether the page lets itself be framed (checkEmbed). A page that refuses
// still saves; it shows empty. A failed check is not an error.
export async function frameWarning(ctx: ToolContext, url: string): Promise<string | undefined> {
  try {
    const res = await ctx.rap.call<{ canFrame?: boolean } | null>('checkEmbed', { url });
    if (res && res.canFrame === false) return `${url} does not allow being shown inside another page, so the embed will look empty. Saved anyway.`;
  } catch {
    return undefined;
  }
  return undefined;
}

export const embedAdd = defineTool({
  name: 'embed_add',
  title: 'Add a web page embed',
  description:
    'Adds a URL embed to a report page: a frame that shows a live web page (a video, a form, a document) inside the report. ' +
    'Use it for YouTube embeds, Google Forms, Sheets or Docs published to the web, and similar. The page must allow being framed; the answer warns when it does not (it is saved anyway and shows empty). ' +
    'Without a position it is 400×300 at left 40, 20 px below the lowest component. Change the address later with component_update embed_url.',
  input: {
    report_id: reportIdInput,
    page: pageInput,
    url: z.string().describe('The web address to show, starting with https:// or http://. Surrounding spaces are trimmed.'),
    position: positionInput('400×300 at left 40, 20 px below the lowest component.'),
    style: styleInput(
      'Embed Style tab settings by label: "Background", "Opacity", "Border color", "Border weight" (None, 1–5), "Border style" (Solid, Dashed, Dotted, Double), "Border radius" (0–100), "Border shadow".',
    ),
  },
  write: true,
  run: async (ctx, a) => {
    const url = embedUrl(a.url);
    const style = a.style ?? {};
    applyStaticStyle(template(EMBED_TYPE), staticLabels(EMBED_TYPE), style);
    return addComponent(
      ctx,
      a,
      async (doc, pageId) => {
        const c: Json = place(template(EMBED_TYPE), boxFor(a.position, EMBED_SIZE, () => nextSpot(doc, pageId)));
        (c.propertyConfig.componentProperty.framedExternalContentProperty ??= {}).contentUrl = url;
        const styled = applyStaticStyle(c, staticLabels(EMBED_TYPE), style);
        const warning = await frameWarning(ctx, url);
        return { component: c, kind: 'URL embed', notApplied: styled.notApplied, warnings: warning ? [warning] : [] };
      },
      'add embed',
    );
  },
});

// component_update's embed_url: the address a URL embed shows.
export const embedUrlUpdater: ComponentUpdater = {
  key: 'embed_url',
  input: z
    .string()
    .describe('URL embeds only: the new web address to show (https:// or http://). Given for another component type, the call is refused and nothing is saved.'),
  // component_update refuses it for other types before anything is saved.
  types: [EMBED_TYPE],
  apply: async (target, value, ctx) => {
    const url = embedUrl(String(value));
    const c = target.component;
    if (c.type !== EMBED_TYPE) return `Not applied: embed_url (${c.componentId} is a ${c.type}, not a URL embed)`;
    (((c.propertyConfig ??= {}).componentProperty ??= {}).framedExternalContentProperty ??= {}).contentUrl = url;
    const warning = await frameWarning(ctx, url);
    return warning ? `Warning: ${warning}` : undefined;
  },
  read: (c) => (c.type === EMBED_TYPE ? c.propertyConfig?.componentProperty?.framedExternalContentProperty?.contentUrl || undefined : undefined),
};
