import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { listPages, resolvePage } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { parseReportId } from '../../looker/view.js';

// Where components live in a report definition and how to find them by id.
// A page component sits in page.componentConfig (its conditional formatting
// in that page's chartCondition); a report-level one, shown on every page,
// in report.componentConfig (conditional formatting in the report's
// chartCondition). Groups are page.groupConfig entries; report level has none.

export type Json = Record<string, any>;

export const reportIdInput = z.string().describe('Report id or its Looker Studio URL.');

export function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}

export interface Located {
  component: Json;
  // 'report': report-level, shown on every page.
  level: 'page' | 'report';
  // The page it is on (page level only).
  pageId?: string;
}

export function pageComponentsOf(page: PageDoc): Json[] {
  return (page.page.componentConfig ??= []) as Json[];
}

export function reportComponentsOf(doc: ReportDoc): Json[] {
  return (doc.report.componentConfig ??= []) as Json[];
}

// The component with this id on any page or at report level. With `pageId`,
// a page component must be on that page (report-level ones show on every
// page, so they count as on it).
export function locate(doc: ReportDoc, componentId: string, pageId?: string): Located {
  const id = componentId.trim();
  for (const p of doc.page) {
    const c = (p.page.componentConfig ?? []).find((x) => x.componentId === id);
    if (!c) continue;
    if (pageId && p.pageId !== pageId)
      throw new LookerError('not_found', `Component ${id} is on page ${pageName(doc, p.pageId)}, not on page ${pageName(doc, pageId)}. Leave out page or give the right one.`);
    return { component: c as Json, level: 'page', pageId: p.pageId };
  }
  const r = (doc.report.componentConfig ?? []).find((x) => x.componentId === id);
  if (r) return { component: r as Json, level: 'report' };
  throw new LookerError('not_found', `No component ${id} in report ${doc.shareable.id}. ${knownIds(doc, pageId)}`);
}

// A short list of the ids there are, for not_found messages.
export function knownIds(doc: ReportDoc, pageId?: string): string {
  const pages = pageId ? doc.page.filter((p) => p.pageId === pageId) : doc.page;
  const ids = [
    ...pages.flatMap((p) => (p.page.componentConfig ?? []).map((c) => `${c.componentId} (${c.type})`)),
    ...(doc.report.componentConfig ?? []).map((c) => `${c.componentId} (${c.type}, report level)`),
  ];
  if (!ids.length) return 'It has no components.';
  return `Components: ${ids.slice(0, 25).join(', ')}${ids.length > 25 ? ', …' : ''}. component_list shows them all.`;
}

export function pageName(doc: ReportDoc, pageId: string): string {
  const p = listPages(doc).find((x) => x.pageId === pageId);
  return p ? `"${p.name}" (${pageId})` : pageId;
}

export function pageOf(doc: ReportDoc, pageId: string): PageDoc {
  const p = doc.page.find((x) => x.pageId === pageId);
  if (!p) throw new LookerError('not_found', `Page ${pageId} is not in report ${doc.shareable.id}.`);
  return p;
}

// The page id for an optional page input.
export function pageIdOf(doc: ReportDoc, page: string | number | undefined): string | undefined {
  return page === undefined || page === '' ? undefined : resolvePage(doc, page);
}

// Conditional formatting entries of a component, from wherever they are.
export function conditionsOf(list: Json[] | undefined, componentId: string): Json[] {
  return (list ?? []).filter((c) => c.chartId === componentId);
}

// Replaces a component's conditional formatting entries in a list.
export function setConditions(list: Json[], componentId: string, entries: Json[]): Json[] {
  return [...list.filter((c) => c.chartId !== componentId), ...structuredClone(entries)];
}

// Puts `component` in place of the one with its id, or at the end.
export function putComponent(list: Json[], component: Json): void {
  const at = list.findIndex((c) => c.componentId === component.componentId);
  if (at >= 0) list[at] = structuredClone(component);
  else list.push(structuredClone(component));
}

export function removeComponent(list: Json[], componentId: string): void {
  const at = list.findIndex((c) => c.componentId === componentId);
  if (at >= 0) list.splice(at, 1);
}

// ---- groups --------------------------------------------------------------

export function groupsOf(page: PageDoc): Json[] {
  return (page.page.groupConfig ??= []) as Json[];
}

export function groupId(): string {
  return `g-${randomBytes(5).toString('hex')}`;
}

// The group that holds `id` (a component or a group) directly.
export function parentGroup(groups: Json[], id: string): Json | undefined {
  return groups.find((g) => (g.componentId ?? []).includes(id) || (g.childGroupId ?? []).includes(id));
}

// The top group around a component or group: what the editor selects when
// one of its members is clicked. Undefined when it is in no group.
export function outermostGroup(groups: Json[], id: string): Json | undefined {
  let top: Json | undefined;
  let at = id;
  for (let i = 0; i < 50; i++) {
    const g = parentGroup(groups, at);
    if (!g) break;
    top = g;
    at = g.groupId;
  }
  return top;
}

// Every component in a group, its child groups included.
export function groupMembers(groups: Json[], group: Json, seen = new Set<string>()): string[] {
  if (seen.has(group.groupId)) return [];
  seen.add(group.groupId);
  const kids = ((group.childGroupId ?? []) as string[]).flatMap((cid) => {
    const child = groups.find((g) => g.groupId === cid);
    return child ? groupMembers(groups, child, seen) : [];
  });
  return [...((group.componentId ?? []) as string[]), ...kids];
}

// A group and every group nested in it.
export function groupTree(groups: Json[], group: Json, seen = new Set<string>()): string[] {
  if (seen.has(group.groupId)) return [];
  seen.add(group.groupId);
  return [
    group.groupId,
    ...((group.childGroupId ?? []) as string[]).flatMap((cid) => {
      const child = groups.find((g) => g.groupId === cid);
      return child ? groupTree(groups, child, seen) : [];
    }),
  ];
}

// Takes a component out of every group it is in; groups left with nothing
// in them go.
export function dropFromGroups(page: PageDoc, componentId: string): void {
  const groups = page.page.groupConfig as Json[] | undefined;
  if (!groups?.length) return;
  for (const g of groups) if (Array.isArray(g.componentId)) g.componentId = g.componentId.filter((x: string) => x !== componentId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of [...groups]) {
      if ((g.componentId ?? []).length || (g.childGroupId ?? []).length) continue;
      groups.splice(groups.indexOf(g), 1);
      for (const o of groups) if (Array.isArray(o.childGroupId)) o.childGroupId = o.childGroupId.filter((x: string) => x !== g.groupId);
      changed = true;
    }
  }
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
