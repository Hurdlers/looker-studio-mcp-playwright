import { z } from 'zod';

import { place, template } from '../../core/components.js';
import { defineTool } from '../../core/tool.js';
import { addComponent, boxFor, hexInput, nextSpot, pageInput, positionInput, reportIdInput, styleInput } from './common.js';
import { applyStaticStyle, borderShown, staticLabels } from './styles.js';

type Json = Record<string, any>;

// Our shape names → the editor's preset and genericShapeProperty.shapeType.
export const SHAPES = {
  rectangle: { preset: 'shape-rectangle', shapeType: 2 },
  circle: { preset: 'shape-ellipse', shapeType: 1 },
  triangle: { preset: 'shape-triangle', shapeType: 3 },
  heart: { preset: 'shape-heart', shapeType: 6 },
  diamond: { preset: 'shape-diamond', shapeType: 7 },
  pentagon: { preset: 'shape-pentagon', shapeType: 9 },
  star: { preset: 'shape-star', shapeType: 8 },
  hexagon: { preset: 'shape-hexagon', shapeType: 12 },
  octagon: { preset: 'shape-octagon', shapeType: 10 },
  cylinder: { preset: 'shape-cylinder', shapeType: 11 },
  arrow_right: { preset: 'shape-block-arrow-right', shapeType: 4 },
  arrow_left: { preset: 'shape-block-arrow-left', shapeType: 14 },
  arrow_up: { preset: 'shape-block-arrow-up', shapeType: 5 },
  arrow_down: { preset: 'shape-block-arrow-down', shapeType: 15 },
  callout: { preset: 'shape-callout', shapeType: 13 },
} as const;

export type ShapeName = keyof typeof SHAPES;

// The size of the template the editor's new shapes start from.
export const SHAPE_SIZE = { width: 200, height: 200 };

const BOX = 'propertyConfig.componentProperty.genericShapeProperty.backgroundAndBorderProperty';

export const shapeAdd = defineTool({
  name: 'shape_add',
  title: 'Add a shape',
  description:
    'Adds a shape to a report page with its fill, border and corner radius, in one save: a rectangle, circle, triangle, diamond, pentagon, hexagon, octagon, star, heart, cylinder, callout bubble, or a block arrow pointing right, left, up or down. ' +
    'Use rectangles for header bands and card backgrounds. A new shape sits on top of everything, so send it back with component_update order "back" when it should be behind charts or text. ' +
    'Without a position it is 200×200, 40 px from the left and 20 px below the lowest component. Only rectangles take a corner radius; for other shapes border_radius is listed under "Not applied". ' +
    'The shape kind cannot be changed later.',
  input: {
    report_id: reportIdInput,
    page: pageInput,
    shape: z.enum(Object.keys(SHAPES) as [ShapeName, ...ShapeName[]]).describe('Which shape.'),
    position: positionInput('200×200, at left 40 and 20 px below the lowest component.'),
    background: hexInput('Fill color'),
    border_color: hexInput('Border color (a border of weight 0 becomes 1 so it shows)'),
    border_radius: z.number().int().min(0).max(200).optional().describe('Corner radius in pixels (0–200; 0 is square corners). Rectangles only.'),
    style: styleInput(
      'Other shape settings by panel label: "Background", "Opacity", "Border color", "Border weight" (None, 1–5), "Border style" (Solid, Dashed, Dotted), "Border radius" (0–100, rectangles), "Border shadow". Style wins over background, border_color and border_radius.',
    ),
  },
  write: true,
  run: async (ctx, a) => {
    const kind = SHAPES[a.shape];
    const build = (box: ReturnType<typeof boxFor>) => {
      const c: Json = place(template('generic-shape', kind.preset), box);
      c.preset = kind.preset;
      const p = (c.propertyConfig.componentProperty.genericShapeProperty ??= {});
      p.shapeType = kind.shapeType;
      const bab = (p.backgroundAndBorderProperty ??= {});
      const notApplied: string[] = [];
      if (a.background) bab.background = { color: a.background.toUpperCase(), opacity: 1 };
      if (a.border_color) {
        bab.border = { ...(bab.border ?? {}), color: a.border_color.toUpperCase() };
        borderShown(c, `${BOX}.border`);
      }
      if (a.border_radius !== undefined) {
        if (a.shape === 'rectangle') bab.border = { ...(bab.border ?? {}), radius: a.border_radius };
        else notApplied.push('border_radius');
      }
      const styled = applyStaticStyle(c, staticLabels('generic-shape', kind.preset), a.style ?? {});
      return { c, notApplied: [...notApplied, ...styled.notApplied] };
    };
    build({ left: 0, top: 0, ...SHAPE_SIZE });
    return addComponent(
      ctx,
      a,
      (doc, pageId) => {
        const { c, notApplied } = build(boxFor(a.position, SHAPE_SIZE, () => nextSpot(doc, pageId)));
        return { component: c, kind: `shape (${a.shape})`, notApplied, warnings: [] };
      },
      'add shape',
    );
  },
});
