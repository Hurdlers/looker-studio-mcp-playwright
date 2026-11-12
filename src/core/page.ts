import { z } from 'zod';

import type { Position } from './components.js';
import { LookerError } from './errors.js';
import type { NavItem, ReportDoc } from './session.js';

// Pages as people see them: in the order of the page list (navigation), named
// as the list names them, numbered from 1. A report's page array is in another
// order; pages missing from the navigation come last, by position.

type Json = Record<string, any>;

export interface PageInfo {
  pageId: string;
  name: string;
  // 1-based, in navigation order.
  number: number;
  section?: string;
  hidden?: boolean;
}

// The input every tool uses for "which page".
export const pageArg = z
  .union([z.string().min(1), z.number().int().positive()])
  .describe('Page id, the name shown in the page list, or its number counted from 1');

export function listPages(doc: ReportDoc): PageInfo[] {
  const seen = new Map<string, Omit<PageInfo, 'number'>>();
  const walk = (items: NavItem[] = [], section?: string): void => {
    for (const item of items) {
      const p = item.page;
      if (p && doc.page.some((x) => x.pageId === p.pageId) && !seen.has(p.pageId))
        seen.set(p.pageId, {
          pageId: p.pageId,
          name: p.displayName ?? p.pageId,
          ...(section !== undefined ? { section } : {}),
          ...(p.hiddenFromViewer ? { hidden: true } : {}),
        });
      if (item.section) walk(item.section.navItems, item.section.displayName ?? '');
    }
  };
  walk(doc.navigationInfo?.navItems);
  const rest = doc.page
    .filter((p) => !seen.has(p.pageId))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((p) => ({ pageId: p.pageId, name: String((p.page.attributeConfig as Json | undefined)?.pageAttribute?.name ?? p.pageId) }));
  return [...seen.values(), ...rest].map((p, i) => ({ ...p, number: i + 1 }));
}

// A page id, a page name (case and surrounding spaces ignored) or a number
// counted from 1; the first page when omitted. Text that is a name or id wins
// over a number, so "2" finds a page called "2" before the second page.
export function resolvePage(doc: ReportDoc, page?: string | number): string {
  const pages = listPages(doc);
  if (!pages.length) throw new LookerError('not_found', `Report ${doc.shareable.id} has no pages.`);
  if (page === undefined || page === '') return pages[0]!.pageId;
  const want = String(page).trim();
  const hit =
    (typeof page === 'number' ? pages[page - 1] : undefined) ??
    pages.find((p) => p.pageId === want) ??
    pages.find((p) => p.name === want) ??
    pages.find((p) => p.name.toLowerCase() === want.toLowerCase()) ??
    (/^\d+$/.test(want) ? pages[Number(want) - 1] : undefined);
  if (hit) return hit.pageId;
  const list = pages.map((p) => `${p.number}. ${p.section ? `${p.section} › ` : ''}${p.name} (${p.pageId})`).join('; ');
  throw new LookerError('not_found', `No page "${page}" in report ${doc.shareable.id}. Pages: ${list}`);
}

// The page's own size when it has one, else the report's canvas size.
export function pageSize(doc: ReportDoc, pageId: string): { width: number; height: number } {
  const page = doc.page.find((p) => p.pageId === pageId);
  const own = ((page?.page.attributeConfig as Json | undefined)?.pageAttribute ?? {}) as { width?: number; height?: number };
  const canvas = ((doc.report.attributeConfig as Json | undefined)?.reportAttribute ?? {}) as { width?: number; height?: number };
  return { width: own.width ?? canvas.width ?? 1200, height: own.height ?? canvas.height ?? 900 };
}

// What a page shows: its own components and the report-level ones, which
// appear on every page.
export function pageComponents(doc: ReportDoc, pageId: string): Json[] {
  const page = doc.page.find((p) => p.pageId === pageId);
  return [...((page?.page.componentConfig ?? []) as Json[]), ...((doc.report.componentConfig ?? []) as Json[])];
}

export function boxOf(component: Json): Position {
  const a = component.attributeConfig?.componentAttribute ?? {};
  return { left: a.left ?? 0, top: a.top ?? 0, width: a.width ?? 0, height: a.height ?? 0 };
}

// Boxes on a page: its components and the report-level ones, and anything
// with a position in the page's groupConfig (a group's own box and boxes kept
// inside it; groups are rare and their format unchecked, so any object there
// with left/top/width/height counts).
export function pageBoxes(doc: ReportDoc, pageId: string): Position[] {
  const page = doc.page.find((p) => p.pageId === pageId);
  const grouped: Position[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Json;
      if (typeof o.width === 'number' && typeof o.height === 'number' && (typeof o.left === 'number' || typeof o.top === 'number'))
        grouped.push({ left: o.left ?? 0, top: o.top ?? 0, width: o.width, height: o.height });
      else Object.values(o).forEach(walk);
    }
  };
  walk((page?.page as Json | undefined)?.groupConfig ?? []);
  return [...pageComponents(doc, pageId).map(boxOf), ...grouped].filter((b) => b.width > 0 && b.height > 0);
}

// A place for a new component of this size that overlaps nothing on the page
// (pageBoxes): the highest spot, then the leftmost, that fits the page width,
// keeping `gap` pixels from the other boxes and the page edge. When nothing
// fits within the page height the spot is below everything and
// `beyondPage` is set: the page has to grow (pageSize) for it to show.
export function freeSpot(
  doc: ReportDoc,
  pageId: string,
  size: { width: number; height: number },
  gap = 20,
): Position & { beyondPage?: true } {
  const { width: pageWidth, height: pageHeight } = pageSize(doc, pageId);
  const boxes = pageBoxes(doc, pageId);
  const width = Math.min(size.width, Math.max(1, pageWidth - 2 * gap));
  const xs = [gap, ...boxes.map((b) => b.left + b.width + gap)].filter((x) => x + width <= pageWidth - gap || x === gap);
  const ys = [gap, ...boxes.map((b) => b.top + b.height + gap)];
  const free = (left: number, top: number) =>
    boxes.every(
      (b) => left >= b.left + b.width + gap || left + width + gap <= b.left || top >= b.top + b.height + gap || top + size.height + gap <= b.top,
    );
  const spot = (left: number, top: number) => ({
    left,
    top,
    width,
    height: size.height,
    ...(top + size.height > pageHeight ? { beyondPage: true as const } : {}),
  });
  for (const top of [...new Set(ys)].sort((a, b) => a - b))
    for (const left of [...new Set(xs)].sort((a, b) => a - b)) if (free(left, top)) return spot(left, top);
  const bottom = Math.max(0, ...boxes.map((b) => b.top + b.height));
  return spot(gap, bottom + gap);
}
