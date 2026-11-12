import { z } from 'zod';

import { componentId } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { listPages, resolvePage } from '../../core/page.js';
import type { NavItem, PageDoc, ReportDoc, WriteResult } from '../../core/session.js';
import { text } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';

export type Json = Record<string, any>;

export const reportIdInput = z.string().min(1).describe('리포트 ID 또는 Looker Studio 리포트 URL.');
export const nameInput = z.string().trim().min(1).describe('앞뒤 공백을 뺀 페이지 이름. 공백만 있는 이름은 사용할 수 없습니다.');

export function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Invalid report id or URL: ${input}. Supply a Looker Studio report id or link.`);
  }
}

export function pageIdOf(doc: ReportDoc, page?: string | number): string {
  const names = listPages(doc);
  if (typeof page === 'string' && !names.some((p) => p.pageId === page.trim())) {
    const matches = names.filter((p) => p.name.trim().toLowerCase() === page.trim().toLowerCase());
    if (matches.length > 1)
      throw new LookerError('invalid', `Several pages are named "${page}": use a page id (${matches.map((p) => p.pageId).join(', ')}).`);
  }
  try {
    return resolvePage(doc, page);
  } catch (err) {
    if (err instanceof LookerError && err.code === 'not_found')
      throw new LookerError('not_found', `No page "${page}". Available pages: ${names.map((p) => p.name).join(', ')}.`);
    throw err;
  }
}

export function pageLines(doc: ReportDoc): string {
  const pages = listPages(doc);
  return pages.length
    ? pages.map((p) => `${p.number}. ${p.name} (${p.pageId})${p.section ? ` — section: ${p.section}` : ''}${p.hidden ? ' [hidden from viewers]' : ''}`).join('\n')
    : 'This report has no pages.';
}

export function saved(reportId: string, res: WriteResult, message: string) {
  return {
    ...text(`${message}\nSaved version ${res.version}.${res.snapshot ? ` To undo, restore revision ${res.snapshot}.` : ''}`),
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}) },
  };
}

export interface NavLocation {
  items: NavItem[];
  index: number;
  item: NavItem;
  sectionId?: string;
}

export function findNav(items: NavItem[], pageId: string, sectionId?: string): NavLocation | undefined {
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (item.page?.pageId === pageId) return { items, index, item, ...(sectionId ? { sectionId } : {}) };
    if (item.section) {
      const found = findNav(item.section.navItems ?? [], pageId, item.section.sectionId);
      if (found) return found;
    }
  }
  return undefined;
}

export function mustFindNav(items: NavItem[], pageId: string): NavLocation {
  const hit = findNav(items, pageId);
  if (!hit) throw new LookerError('not_found', `Page ${pageId} is no longer in the navigation. Refresh page_list and try again.`);
  return hit;
}

// Replace exact ids throughout the copied page, including line attachments,
// group members and conditional-format references.
export function copyPage(source: PageDoc): { page: PageDoc['page']; chartCondition: Json[] } {
  const ids = new Map<string, string>();
  for (const c of source.page.componentConfig ?? []) if (typeof c.componentId === 'string') ids.set(c.componentId, componentId());
  const groups = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(groups);
    else if (v && typeof v === 'object') {
      const o = v as Json;
      if (typeof o.groupId === 'string' && !ids.has(o.groupId)) ids.set(o.groupId, `group-${componentId().slice(3)}`);
      Object.values(o).forEach(groups);
    }
  };
  groups(source.page.groupConfig);
  const replace = (value: unknown): any => {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, replace(v)]));
    return value;
  };
  return { page: replace(source.page), chartCondition: replace(source.chartCondition ?? []) };
}
