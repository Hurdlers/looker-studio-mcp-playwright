import { z } from 'zod';

import { place, template } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { defineTool } from '../../core/tool.js';
import { addComponent, boxFor, hexInput, nextSpot, pageInput, positionInput, reportIdInput, styleInput } from './common.js';
import { restyleHtml, textHtml, type TextFormat } from './html.js';
import { applyStaticStyle, checkHex, staticLabels, type StaticLabel, type StyleOutcome } from './styles.js';

type Json = Record<string, any>;

export const TEXT_SIZE = { width: 400, height: 50 };

// Labels that live in the text box's HTML rather than in its properties.
export const HTML_LABELS = ['font color', 'font size', 'font', 'font family'];

function isHtmlLabel(key: string): boolean {
  return HTML_LABELS.includes(key.trim().toLowerCase());
}

function fontSizeOf(value: unknown, key: string): number {
  const n = typeof value === 'string' ? Number(/^\s*(\d+)\s*(px)?\s*$/i.exec(value)?.[1] ?? NaN) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 6 || n > 400)
    throw new LookerError('invalid', `${key} takes a whole number of pixels from 6 to 400, not ${JSON.stringify(value)}.`);
  return n;
}

// The font settings a style gives (they win over the tool's own inputs), and
// the rest of the style for the label table.
export function splitTextStyle(style: Record<string, unknown> = {}): { html: Pick<TextFormat, 'color' | 'fontSize' | 'font'>; rest: Record<string, unknown> } {
  const html: Pick<TextFormat, 'color' | 'fontSize' | 'font'> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    const k = key.trim().toLowerCase();
    if (!isHtmlLabel(key)) rest[key] = value;
    else if (k === 'font color') html.color = checkHex(value, `Style "${key}"`);
    else if (k === 'font size') html.fontSize = fontSizeOf(value, `Style "${key}"`);
    else {
      if (typeof value !== 'string' || !value.trim()) throw new LookerError('invalid', `Style "${key}" takes a font name such as "Roboto".`);
      html.font = value.trim();
    }
  }
  return { html, rest };
}

// Style for an existing text box (component_update): font color, size and
// face rewrite the box's HTML, the rest goes through the label table.
// `labels` defaults to this group's table; component_update passes the
// registered table (ctx.ext.styleLabels), which is the same one.
export function applyTextStyle(
  component: Json,
  style: Record<string, unknown>,
  labels: StaticLabel[] = staticLabels('simple-description', component.preset),
): StyleOutcome {
  const { html, rest } = splitTextStyle(style);
  // Check the table values before touching the HTML.
  const probe = structuredClone(component);
  applyStaticStyle(probe, labels, rest);
  const desc = (((component.propertyConfig ??= {}).componentProperty ??= {}).descriptionProperty ??= {});
  if (Object.keys(html).length) desc.text = restyleHtml(String(desc.text ?? ''), html);
  return applyStaticStyle(component, labels, rest);
}

export const textAdd = defineTool({
  name: 'text_add',
  title: 'Add a text box',
  description:
    'Adds a text box with the given text to a report page, formatted as a whole (size, color, bold, italic, underline, strikethrough, alignment, background), and saves it in one go. ' +
    'Use it for titles, section headers, notes and labels; newlines start new lines. Without a position the box is 400×50, 40 px from the left and 20 px below the lowest component on the page. ' +
    'Panel settings without their own input (font, line height, border, opacity, shadow) go in style by label; style wins over color, font_size and background when both set the same thing. ' +
    'The answer gives the new component_id for later changes.',
  input: {
    report_id: reportIdInput,
    page: pageInput,
    text: z.string().describe('The text to show. Newlines start new lines; it cannot be only spaces.'),
    position: positionInput('400×50, at left 40 and 20 px below the lowest component.'),
    font_size: z.number().int().min(6).max(400).optional().describe('Font size in pixels (6–400). The report default when omitted.'),
    color: hexInput('Text color'),
    background: hexInput('Background color of the box'),
    bold: z.boolean().default(false).describe('Bold the whole text.'),
    italic: z.boolean().default(false).describe('Italicize the whole text.'),
    underline: z.boolean().default(false).describe('Underline the whole text.'),
    strikethrough: z.boolean().default(false).describe('Strike through the whole text.'),
    align: z.enum(['left', 'center', 'right']).optional().describe('Horizontal alignment of the text; left when omitted.'),
    style: styleInput(
      'Other text box settings by panel label: "Font color", "Font size", "Font" (or "Font family"), "Line height", "Background", "Opacity", "Border color", "Border weight" (None, 1–5), "Border style" (Solid, Dashed, Dotted, Double), "Border radius" (0–100), "Border shadow".',
    ),
  },
  write: true,
  run: async (ctx, a) => {
    if (!a.text.trim()) throw new LookerError('invalid', 'The text is empty or only spaces: give the words to show.');
    // Check everything before reading the report.
    const { html, rest } = splitTextStyle(a.style);
    const format: TextFormat = {
      ...(a.font_size !== undefined ? { fontSize: a.font_size } : {}),
      ...(a.color ? { color: a.color.toUpperCase() } : {}),
      ...html,
      bold: a.bold,
      italic: a.italic,
      underline: a.underline,
      strikethrough: a.strikethrough,
      ...(a.align ? { align: a.align } : {}),
    };
    const build = (box: ReturnType<typeof boxFor>) => {
      const c = place(template('simple-description'), box);
      const desc = c.propertyConfig.componentProperty.descriptionProperty;
      desc.text = textHtml(a.text, format);
      if (a.background) desc.backgroundAndBorderProperty = { ...(desc.backgroundAndBorderProperty ?? {}), background: { color: a.background.toUpperCase(), opacity: 1 } };
      const styled = applyStaticStyle(c, staticLabels('simple-description'), rest);
      return { c, styled };
    };
    // A dry build checks the style values before anything is read or sent.
    build({ left: 0, top: 0, ...TEXT_SIZE });
    return addComponent(
      ctx,
      a,
      (doc, pageId) => {
        const { c, styled } = build(boxFor(a.position, TEXT_SIZE, () => nextSpot(doc, pageId)));
        return { component: c, kind: 'text', notApplied: styled.notApplied, warnings: [] };
      },
      'add text',
    );
  },
});

