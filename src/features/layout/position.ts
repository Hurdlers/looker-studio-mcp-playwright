import { z } from 'zod';

import type { Position } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { boxOf, pageSize } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import type { Json } from './model.js';

// A component's box: attributeConfig.componentAttribute {left, top, width,
// height}, in pixels from the page's top left corner. Looker Studio stores
// what it is sent (no snapping), so the box saved is the box given.

export const LIMITS = { min: 0, minSize: 10, max: 20000 } as const;

export type PartialPosition = { [K in keyof Position]?: number | undefined };

export const positionInput = z
  .object({
    left: z.number().optional().describe('Pixels from the left edge of the page (0–20000).'),
    top: z.number().optional().describe('Pixels from the top of the page (0–20000).'),
    width: z.number().optional().describe('Width in pixels (10–20000).'),
    height: z.number().optional().describe('Height in pixels (10–20000).'),
  })
  .describe('New box in pixels. Only the keys given change; the others keep their current value.');

// Throws invalid for a value outside what the editor allows.
export function checkPosition(p: PartialPosition): void {
  const bad: string[] = [];
  for (const key of ['left', 'top'] as const) {
    const v = p[key];
    if (v !== undefined && (!Number.isFinite(v) || v < LIMITS.min || v > LIMITS.max)) bad.push(`${key} ${v} (0–${LIMITS.max})`);
  }
  for (const key of ['width', 'height'] as const) {
    const v = p[key];
    if (v !== undefined && (!Number.isFinite(v) || v < LIMITS.minSize || v > LIMITS.max)) bad.push(`${key} ${v} (${LIMITS.minSize}–${LIMITS.max})`);
  }
  if (bad.length) throw new LookerError('invalid', `Position out of range: ${bad.join(', ')}. Give values within those limits.`);
}

export function givenKeys(p: PartialPosition | undefined): Array<keyof Position> {
  return p ? (['left', 'top', 'width', 'height'] as const).filter((k) => p[k] !== undefined) : [];
}

// Sets the keys given. A line (arrow) keeps its two end points in page
// coordinates too: they move with the box.
export function applyPosition(component: Json, p: PartialPosition): void {
  const attr = ((component.attributeConfig ??= {}).componentAttribute ??= {});
  const before = boxOf(component);
  for (const key of givenKeys(p)) attr[key] = p[key];
  const dx = (p.left ?? before.left) - before.left;
  const dy = (p.top ?? before.top) - before.top;
  if (dx || dy) shiftTerminals(component, dx, dy);
}

export function shiftTerminals(component: Json, dx: number, dy: number): void {
  const terminals = component.propertyConfig?.componentProperty?.arrowProperty?.terminals;
  if (!terminals || typeof terminals !== 'object') return;
  for (const end of Object.values(terminals) as Json[]) {
    if (!end || typeof end !== 'object') continue;
    if (typeof end.left === 'number') end.left += dx;
    if (typeof end.top === 'number') end.top += dy;
  }
}

// A note when the box reaches past the page: it is saved, but people only
// see it if the page grows.
export function canvasNote(doc: ReportDoc, pageId: string | undefined, box: Position): string | undefined {
  if (!pageId) return undefined;
  const size = pageSize(doc, pageId);
  const out: string[] = [];
  if (box.left + box.width > size.width) out.push(`its right edge (${box.left + box.width}) is past the page width ${size.width}`);
  if (box.top + box.height > size.height) out.push(`its bottom edge (${box.top + box.height}) is past the page height ${size.height}`);
  return out.length ? `Saved, but ${out.join(' and ')}: make the page bigger (page_settings_update) or move it to show all of it.` : undefined;
}

export function describeBox(b: Position): string {
  return `{left ${b.left}, top ${b.top}, width ${b.width}, height ${b.height}}`;
}

// The `position` key of component_update, also given to other groups (spec
// export reads a component's box through it). component_update applies it
// last, after every other change.
export const positionUpdater: ComponentUpdater = {
  key: 'position',
  input: positionInput,
  apply: (target, value) => {
    const p = value as PartialPosition;
    checkPosition(p);
    applyPosition(target.component, p);
    return canvasNote(target.doc, target.page?.pageId, boxOf(target.component));
  },
  read: (component) => boxOf(component),
};
