import type { Position } from '../../core/components.js';
import { pageSize } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { invalid } from './store.js';

type Json = Record<string, any>;

/** Grow only this page to contain the given boxes. Unchanged inherited axes
 * remain inherited; no report-wide canvas settings are modified. */
export function fitPageCanvas(page: PageDoc, doc: ReportDoc, boxes: readonly Position[], padding = 24): { width: number; height: number } {
  if (!Number.isInteger(padding) || padding < 0 || padding > 20000) throw invalid('Canvas padding must be an integer from 0 to 20000.');
  const current = pageSize({ ...doc, page: doc.page.map(p => p.pageId === page.pageId ? page : p) }, page.pageId);
  for (const value of Object.values(current)) if (!Number.isFinite(value) || value <= 0 || value > 20000)
    throw invalid('The current page size is outside the supported 1–20000 pixel canvas range.');
  for (const box of boxes) {
    if (!Object.values(box).every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0)
      throw invalid('Canvas content needs finite, nonnegative coordinates and positive dimensions.');
  }
  const width = Math.ceil(Math.max(current.width, ...boxes.map(b => b.left + b.width + padding)));
  const height = Math.ceil(Math.max(current.height, ...boxes.map(b => b.top + b.height + padding)));
  if (width > 20000 || height > 20000) throw invalid('Content and padding exceed the 20000 pixel page limit. Use another page or a smaller layout.');
  if (width > current.width || height > current.height) {
    const a = (((page.page.attributeConfig ??= {}) as Json).pageAttribute ??= {});
    if (width > current.width) a.width = width;
    if (height > current.height) a.height = height;
  }
  return { width, height };
}
