import { z } from 'zod';

import type { Position } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { boxOf, pageArg } from '../../core/page.js';
import type { PageDoc, ReportDoc, WriteResult } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import {
  groupId,
  groupMembers,
  groupsOf,
  groupTree,
  knownIds,
  locate,
  outermostGroup,
  pageIdOf,
  pageName,
  pageOf,
  parentGroup,
  plural,
  reportIdInput,
  reportIdOf,
  type Json,
} from './model.js';
import { applyPosition, describeBox } from './position.js';

// Arrange › Align, Distribute, Group and Ungroup, as the editor does them on
// the components picked: alignment uses the box around all of them, a group
// moves as one block, and nothing else on the page changes.

export const ALIGN = ['align_left', 'align_center', 'align_right', 'align_top', 'align_middle', 'align_bottom'] as const;
export const DISTRIBUTE = ['distribute_horizontally', 'distribute_vertically'] as const;
export const ACTIONS = [...ALIGN, ...DISTRIBUTE, 'group', 'ungroup'] as const;
export type Action = (typeof ACTIONS)[number];
type AlignAction = (typeof ALIGN)[number];
type DistributeAction = (typeof DISTRIBUTE)[number];

// One thing that moves: a component, or a group with all its members.
export interface Unit {
  id: string;
  kind: 'component' | 'group';
  level: 'page' | 'report';
  pageId?: string;
  // The components that move with it.
  members: string[];
  box: Position;
}

export function unionBox(boxes: Position[]): Position {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

// Component ids and group ids (g-…) as units, duplicates merged. Unknown ids
// are not_found; units on two different pages are invalid.
export function resolveUnits(doc: ReportDoc, ids: string[], pageId?: string): Unit[] {
  const units: Unit[] = [];
  for (const raw of [...new Set(ids.map((i) => i.trim()).filter(Boolean))]) {
    const group = findGroup(doc, raw, pageId);
    if (group) {
      const members = groupMembers(groupsOf(group.page), group.group);
      const comps = members.map((m) => (group.page.page.componentConfig ?? []).find((c) => c.componentId === m)).filter(Boolean) as Json[];
      if (!comps.length) throw new LookerError('invalid', `Group ${raw} has no components on its page.`);
      units.push({ id: raw, kind: 'group', level: 'page', pageId: group.page.pageId, members: comps.map((c) => c.componentId), box: unionBox(comps.map(boxOf)) });
      continue;
    }
    if (raw.startsWith('g-')) throw new LookerError('not_found', `No group ${raw} in report ${doc.shareable.id}${pageId ? ` on page ${pageName(doc, pageId)}` : ''}.`);
    const loc = locate(doc, raw, pageId);
    units.push({
      id: raw,
      kind: 'component',
      level: loc.level,
      ...(loc.pageId ? { pageId: loc.pageId } : {}),
      members: [raw],
      box: boxOf(loc.component),
    });
  }
  const pages = [...new Set(units.flatMap((u) => (u.pageId ? [u.pageId] : [])))];
  if (pages.length > 1)
    throw new LookerError('invalid', `The components are on different pages (${pages.map((p) => pageName(doc, p)).join(', ')}): arrange components of one page at a time.`);
  return units;
}

function findGroup(doc: ReportDoc, id: string, pageId?: string): { page: PageDoc; group: Json } | undefined {
  for (const page of doc.page) {
    if (pageId && page.pageId !== pageId) continue;
    const group = (page.page.groupConfig ?? []).find((g) => g.groupId === id);
    if (group) return { page, group: group as Json };
  }
  return undefined;
}

// New left/top of each unit's box (rounded, .5 up).
export function alignTargets(units: Unit[], action: AlignAction): Map<string, { left: number; top: number }> {
  const all = unionBox(units.map((u) => u.box));
  const out = new Map<string, { left: number; top: number }>();
  for (const u of units) {
    let { left, top } = u.box;
    switch (action) {
      case 'align_left':
        left = all.left;
        break;
      case 'align_center':
        left = all.left + all.width / 2 - u.box.width / 2;
        break;
      case 'align_right':
        left = all.left + all.width - u.box.width;
        break;
      case 'align_top':
        top = all.top;
        break;
      case 'align_middle':
        top = all.top + all.height / 2 - u.box.height / 2;
        break;
      case 'align_bottom':
        top = all.top + all.height - u.box.height;
        break;
    }
    out.set(u.id, { left: Math.round(left), top: Math.round(top) });
  }
  return out;
}

// Sorted by position, the first and last stay; the ones between are laid
// out one after another with the average gap between neighbours.
export function distributeTargets(units: Unit[], action: DistributeAction): Map<string, { left: number; top: number }> {
  const horizontal = action === 'distribute_horizontally';
  const start = (b: Position) => (horizontal ? b.left : b.top);
  const size = (b: Position) => (horizontal ? b.width : b.height);
  const sorted = [...units].sort((a, b) => start(a.box) - start(b.box));
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) gaps += start(sorted[i]!.box) - (start(sorted[i - 1]!.box) + size(sorted[i - 1]!.box));
  const gap = gaps / (sorted.length - 1);
  const out = new Map<string, { left: number; top: number }>();
  let at = start(sorted[0]!.box);
  sorted.forEach((u, i) => {
    const pos = i === 0 || i === sorted.length - 1 ? start(u.box) : Math.round(at);
    out.set(u.id, horizontal ? { left: pos, top: u.box.top } : { left: u.box.left, top: pos });
    at = (i === 0 || i === sorted.length - 1 ? start(u.box) : at) + size(u.box) + gap;
  });
  return out;
}

export const componentArrangeTool = defineTool({
  name: 'component_arrange',
  title: 'Align, distribute or group components',
  description:
    'Lines up, spaces out, groups or ungroups components of one page, given by component_id, as the editor\'s Arrange menu does. ' +
    'align_left, align_center and align_right line up the left edges, centres or right edges within the box around all of them; align_top, align_middle and align_bottom do the same vertically. ' +
    'distribute_horizontally and distribute_vertically keep the first and last in place and give the ones between equal gaps (3 or more). Only the left or top changes; sizes stay. A group id (g-…) moves the whole group as one block. ' +
    'group puts 2 or more components (or groups, which are merged) into one group that moves together; ungroup takes groups apart again (give the group id or any component in it). Report-level components can be aligned but not grouped. ' +
    'Answers with each component\'s new box or the group made.',
  input: {
    report_id: reportIdInput,
    component_ids: z
      .array(z.string().min(1))
      .min(1)
      .describe('Components (cd-…) or groups (g-…) to arrange, all on one page. Repeats count once.'),
    action: z.enum(ACTIONS).describe('What to do with them.'),
    page: pageArg.optional().describe('Optional. When given, the components must be on this page.'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = pageIdOf(doc, a.page);
    if (a.action === 'group') return group(ctx, reportId, doc, a.component_ids, pageId);
    if (a.action === 'ungroup') return ungroup(ctx, reportId, doc, a.component_ids, pageId);
    return move(ctx, reportId, doc, a.component_ids, a.action, pageId);
  },
});

async function move(ctx: ToolContext, reportId: string, doc: ReportDoc, ids: string[], action: AlignAction | DistributeAction, pageId?: string) {
  const units = resolveUnits(doc, ids, pageId);
  const need = (DISTRIBUTE as readonly string[]).includes(action) ? 3 : 2;
  if (units.length < need)
    throw new LookerError('invalid', `${action} needs at least ${need} different components or groups; got ${units.length}.`);
  const targets = (ALIGN as readonly string[]).includes(action) ? alignTargets(units, action as AlignAction) : distributeTargets(units, action as DistributeAction);

  // Absolute boxes for every component that moves (repeatable on a fresh copy).
  const boxes = new Map<string, { left: number; top: number }>();
  const groupShift = new Map<string, { dx: number; dy: number; pageId: string }>();
  for (const u of units) {
    const t = targets.get(u.id)!;
    const dx = t.left - u.box.left;
    const dy = t.top - u.box.top;
    if (u.kind === 'group') groupShift.set(u.id, { dx, dy, pageId: u.pageId! });
    for (const m of u.members) {
      const b = boxOf(locate(doc, m).component);
      boxes.set(m, { left: b.left + dx, top: b.top + dy });
    }
  }
  // Groups that keep their own box (not seen so far) move with their members.
  const groups0 = new Map<string, Json>();
  for (const p of doc.page) for (const g of (p.page.groupConfig ?? []) as Json[]) groups0.set(g.groupId, structuredClone((g as Json).attributeConfig?.groupAttribute ?? {}));
  const moveIn = (list: Json[]): void => {
    for (const c of list) {
      const b = boxes.get(c.componentId);
      if (b) applyPosition(c, b);
    }
  };
  const movePage = (page: PageDoc): void => {
    moveIn(page.page.componentConfig ?? []);
    for (const g of (page.page.groupConfig ?? []) as Json[]) {
      const s = groupShift.get(g.groupId);
      const attr = (g as Json).attributeConfig?.groupAttribute;
      if (!s || !attr) continue;
      const before = groups0.get(g.groupId);
      if (before && typeof before.left === 'number') attr.left = before.left + s.dx;
      if (before && typeof before.top === 'number') attr.top = before.top + s.dy;
    }
  };

  const onPage = units.find((u) => u.level === 'page')?.pageId;
  const onReport = units.some((u) => u.level === 'report');
  const label = `${action} ${plural(units.length, 'component')}`;
  let res: WriteResult;
  if (onPage && onReport) res = await ctx.session.editReportThenPage(reportId, onPage, { report: (d) => moveIn(d.report.componentConfig ?? []), page: movePage }, label);
  else if (onPage) res = await ctx.session.editPage(reportId, onPage, movePage, label);
  else res = await ctx.session.editReport(reportId, (d) => moveIn(d.report.componentConfig ?? []), label);

  const lines = [...boxes.entries()].map(([id, b]) => {
    const c = locate(doc, id).component;
    return `${id} (${c.type}): ${describeBox({ ...boxOf(c), ...b })}`;
  });
  return {
    ...text([`${action}: moved ${plural(units.length, 'item')}. Saved as version ${res.version}.`, ...lines, ...(res.snapshot ? [`To undo, restore revision ${res.snapshot} (version_restore).`] : [])].join('\n')),
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `${action} ${[...new Set(ids)].join(', ')}` },
  };
}

// Picked components and groups as the editor selects them: a component in a
// group stands for its top group.
function selection(doc: ReportDoc, ids: string[], pageId?: string): { page: PageDoc; picked: Array<{ id: string; group?: Json }> } {
  const picked: Array<{ id: string; group?: Json; pageId?: string }> = [];
  for (const raw of [...new Set(ids.map((i) => i.trim()).filter(Boolean))]) {
    const g = findGroup(doc, raw, pageId);
    if (g) {
      const top = outermostGroup(groupsOf(g.page), raw) ?? g.group;
      picked.push({ id: top.groupId, group: top, pageId: g.page.pageId });
      continue;
    }
    if (raw.startsWith('g-')) throw new LookerError('not_found', `No group ${raw} in report ${doc.shareable.id}. ${knownIds(doc, pageId)}`);
    const loc = locate(doc, raw, pageId);
    if (loc.level === 'report') {
      picked.push({ id: raw });
      continue;
    }
    const top = outermostGroup(groupsOf(pageOf(doc, loc.pageId!)), raw);
    picked.push(top ? { id: top.groupId, group: top, pageId: loc.pageId! } : { id: raw, pageId: loc.pageId! });
  }
  const pages = [...new Set(picked.flatMap((p) => (p.pageId ? [p.pageId] : [])))];
  if (pages.length > 1)
    throw new LookerError('invalid', `The components are on different pages (${pages.map((p) => pageName(doc, p)).join(', ')}): arrange components of one page at a time.`);
  const unique = [...new Map(picked.map((p) => [p.id, p])).values()];
  return { page: pages[0] ? pageOf(doc, pages[0]) : pageOf(doc, pageId ?? doc.page[0]!.pageId), picked: unique };
}

async function group(ctx: ToolContext, reportId: string, doc: ReportDoc, ids: string[], pageId?: string) {
  const { page, picked } = selection(doc, ids, pageId);
  const report = picked.filter((p) => !p.group && !(page.page.componentConfig ?? []).some((c) => c.componentId === p.id));
  if (report.length)
    throw new LookerError('invalid', `${report.map((p) => p.id).join(', ')} ${report.length === 1 ? 'is' : 'are'} report-level: report-level components cannot be grouped. Make them page-level first (component_update report_level false).`);
  if (picked.length < 2) throw new LookerError('invalid', `group needs at least 2 different components or groups; got ${picked.length}${picked[0]?.group ? ` (they are all in group ${picked[0].id} already)` : ''}.`);
  const groups = groupsOf(page);
  const members = [...new Set(picked.flatMap((p) => (p.group ? groupMembers(groups, p.group) : [p.id])))];
  const removed = new Set(picked.flatMap((p) => (p.group ? groupTree(groups, p.group) : [])));
  const newId = groupId();
  const entry = {
    groupId: newId,
    componentId: members,
    childGroupId: [],
    conceptDefs: [],
    propertyConfig: {
      groupProperty: { filters: [], inheritFilters: true, controlStatePassThrough: false, backgroundAndBorderProperty: {}, groupAlignment: {}, sectionType: 0 },
    },
    attributeConfig: { groupAttribute: {} },
  };
  const res = await ctx.session.editPage(
    reportId,
    page.pageId,
    (p) => {
      const list = groupsOf(p).filter((g) => !removed.has(g.groupId) && g.groupId !== newId);
      list.push(structuredClone(entry));
      p.page.groupConfig = list;
    },
    `group ${plural(members.length, 'component')}`,
  );
  return {
    ...text(
      [
        `Grouped ${members.join(', ')} as ${newId} on page ${pageName(doc, page.pageId)}${removed.size ? ` (replacing group${removed.size === 1 ? '' : 's'} ${[...removed].join(', ')})` : ''}. Boxes and stacking order are unchanged. Saved as version ${res.version}.`,
        ...(res.snapshot ? [`To undo, restore revision ${res.snapshot} (version_restore).`] : []),
      ].join('\n'),
    ),
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `group ${newId}: ${members.join(', ')}` },
  };
}

async function ungroup(ctx: ToolContext, reportId: string, doc: ReportDoc, ids: string[], pageId?: string) {
  const { page, picked } = selection(doc, ids, pageId);
  const targets = picked.filter((p) => p.group).map((p) => p.group!);
  // A group given by its own id may sit inside another: that one is taken
  // apart, not its outer group.
  for (const raw of new Set(ids.map((i) => i.trim()))) {
    const g = (page.page.groupConfig ?? []).find((x) => x.groupId === raw) as Json | undefined;
    if (g && !targets.some((t) => t.groupId === raw)) {
      const outer = outermostGroup(groupsOf(page), raw);
      const at = targets.findIndex((t) => t.groupId === outer?.groupId);
      if (at >= 0) targets.splice(at, 1, g);
      else targets.push(g);
    }
  }
  if (!targets.length)
    throw new LookerError('invalid', `${[...new Set(ids)].join(', ')} ${ids.length === 1 ? 'is' : 'are'} not in any group: nothing to ungroup.`);
  const gone = targets.map((t) => t.groupId as string);
  const res = await ctx.session.editPage(
    reportId,
    page.pageId,
    (p) => {
      const groups = groupsOf(p);
      for (const id of gone) {
        const g = groups.find((x) => x.groupId === id);
        if (!g) continue;
        // Its members stay in the group around it, if any.
        const parent = parentGroup(groups, id);
        if (parent) {
          parent.childGroupId = [...(parent.childGroupId ?? []).filter((x: string) => x !== id), ...(g.childGroupId ?? [])];
          parent.componentId = [...(parent.componentId ?? []), ...(g.componentId ?? [])];
        }
        groups.splice(groups.indexOf(g), 1);
      }
    },
    `ungroup ${gone.join(', ')}`,
  );
  const members = targets.flatMap((t) => (t.componentId ?? []) as string[]);
  return {
    ...text(
      [
        `Ungrouped ${gone.join(', ')} on page ${pageName(doc, page.pageId)}: ${members.join(', ')} ${members.length === 1 ? 'is' : 'are'} separate again; boxes unchanged. Saved as version ${res.version}.`,
        ...(res.snapshot ? [`To undo, restore revision ${res.snapshot} (version_restore).`] : []),
      ].join('\n'),
    ),
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `ungroup ${gone.join(', ')}` },
  };
}

