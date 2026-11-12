import { z } from 'zod';

import { place, template } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { defineTool } from '../../core/tool.js';
import { addComponent, hexInput, pageInput, reportIdInput, styleInput } from './common.js';
import { applyStaticStyle, BORDER_STYLE_OPTIONS, staticLabels } from './styles.js';

type Json = Record<string, any>;

// arrowProperty.startHeadStyle / endHeadStyle.
export const LINE_ENDS = { None: 0, Pointer: 1, Circle: 2, Diamond: 3 } as const;

function pick<T extends Record<string, number>>(options: T, value: string, what: string): number {
  const hit = Object.keys(options).find((k) => k.toLowerCase() === value.trim().toLowerCase());
  if (hit === undefined) throw new LookerError('invalid', `${what} "${value}" is not an option: ${Object.keys(options).join(', ')}.`);
  return options[hit]!;
}

const point = (what: string) =>
  z
    .object({
      x: z.number().finite().min(0).max(20000).describe('Pixels from the left edge of the canvas; fractional coordinates are preserved.'),
      y: z.number().finite().min(0).max(20000).describe('Pixels from the top edge of the canvas; fractional coordinates are preserved.'),
    })
    .describe(what);

export const lineAdd = defineTool({
  name: 'line_add',
  title: 'Add a line',
  description:
    'Draws a straight line between two canvas points on a report page, with its color, dash style and end markers, in one save. ' +
    'Use it for dividers and connectors; the two points alone set its place and size (horizontal lines have height 0). ' +
    'Weight and path shape ("Line type": Linear, Elbow, Curved elbow) go in style. The two points must differ.',
  input: {
    report_id: reportIdInput,
    page: pageInput,
    from: point('Where the line starts.'),
    to: point('Where the line ends.'),
    color: hexInput('Line color'),
    border_style: z.string().optional().describe('Dash style: Solid, Dashed, Dotted or Double (case ignored).'),
    start: z.string().optional().describe('Marker at the start: None, Circle, Diamond or Pointer (an arrowhead). Unchanged when omitted.'),
    end: z.string().optional().describe('Marker at the end: None, Circle, Diamond or Pointer (an arrowhead). Unchanged when omitted.'),
    style: styleInput(
      'Other line settings by panel label: "Border weight" (or "Line weight", pixels), "Stroke color", "Border style", "Line type" (Linear, Elbow, Curved elbow). Style wins over color and border_style.',
    ),
  },
  write: true,
  run: async (ctx, a) => {
    if (a.from.x === a.to.x && a.from.y === a.to.y) throw new LookerError('invalid', 'The line starts and ends at the same point: give two different points.');
    const strokeStyle = a.border_style !== undefined ? pick(BORDER_STYLE_OPTIONS, a.border_style, 'Border style') : undefined;
    const startHead = a.start !== undefined ? pick(LINE_ENDS, a.start, 'Line start') : undefined;
    const endHead = a.end !== undefined ? pick(LINE_ENDS, a.end, 'Line end') : undefined;
    const box = {
      left: Math.min(a.from.x, a.to.x),
      top: Math.min(a.from.y, a.to.y),
      width: Math.abs(a.to.x - a.from.x),
      height: Math.abs(a.to.y - a.from.y),
    };
    const c: Json = place(template('arrow'), box);
    const p = (c.propertyConfig.componentProperty.arrowProperty ??= {});
    p.terminals = {
      start: { componentId: '', anchorId: '', left: a.from.x, top: a.from.y },
      end: { componentId: '', anchorId: '', left: a.to.x, top: a.to.y },
    };
    if (a.color) p.strokeColor = { color: a.color.toUpperCase(), opacity: 1 };
    if (strokeStyle !== undefined) p.strokeStyle = strokeStyle;
    const styled = applyStaticStyle(c, staticLabels('arrow'), a.style ?? {});
    if (startHead !== undefined) p.startHeadStyle = startHead;
    if (endHead !== undefined) p.endHeadStyle = endHead;
    return addComponent(ctx, a, () => ({ component: c, kind: 'line', notApplied: styled.notApplied, warnings: [] }), 'add line');
  },
});
