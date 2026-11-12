import { z } from 'zod';

import { componentId, conceptName } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { boxOf, pageArg } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import { defineTool, text } from '../../core/tool.js';
import {
  conditionsOf,
  locate,
  pageComponentsOf,
  pageIdOf,
  pageName,
  reportComponentsOf,
  reportIdInput,
  reportIdOf,
  type Json,
} from './model.js';
import { applyPosition, canvasNote, checkPosition, describeBox, givenKeys, positionInput } from './position.js';

// Duplicate as the editor's Edit › Duplicate (copy, then paste) makes it: a
// new component id, a new control alias, new names for the component's own
// concepts (every reference to them follows), the box 20 px right and down,
// added on top of the stacking order, with its conditional formatting
// copied. A line keeps its end points in page coordinates; they move with it
// and lose what they were attached to.

export const PASTE_OFFSET = 20;

export interface CopyPlan {
  newId: string;
  // Old concept name → new name.
  names: Record<string, string>;
  alias?: string;
}

export function planCopy(doc: ReportDoc, component: Json): CopyPlan {
  const names: Record<string, string> = {};
  for (const d of (component.conceptDefs ?? []) as Json[]) if (typeof d.name === 'string' && d.name) names[d.name] = conceptName();
  const old = component.attributeConfig?.componentAttribute?.alias;
  const alias = typeof old === 'string' && old ? nextAlias(doc, old) : undefined;
  return { newId: componentId(), names, ...(alias ? { alias } : {}) };
}

// The copy of `component` under the plan, before it is placed.
export function copyComponent(component: Json, plan: CopyPlan): Json {
  const copy = renamed(component, plan);
  copy.componentId = plan.newId;
  if (plan.alias) copy.attributeConfig.componentAttribute.alias = plan.alias;
  const terminals = copy.propertyConfig?.componentProperty?.arrowProperty?.terminals;
  if (terminals && typeof terminals === 'object')
    for (const end of Object.values(terminals) as Json[])
      if (end && typeof end === 'object') {
        if ('componentId' in end) end.componentId = '';
        if ('anchorId' in end) end.anchorId = '';
      }
  return copy;
}

// A copy with the component's concept names replaced wherever they appear.
export function renamed<T>(value: T, plan: CopyPlan): T {
  let json = JSON.stringify(value);
  for (const [from, to] of Object.entries(plan.names)) json = json.replace(new RegExp(`(?<![A-Za-z0-9_])${escape(from)}(?![A-Za-z0-9_])`, 'g'), to);
  return JSON.parse(json) as T;
}

// The same letters with the next number used in the report: sd189 → sd190
// when sd189 is the highest.
export function nextAlias(doc: ReportDoc, alias: string): string {
  const prefix = alias.replace(/\d+$/, '') || 'cd';
  const used = new Set<string>();
  const all = [...doc.page.flatMap((p) => p.page.componentConfig ?? []), ...(doc.report.componentConfig ?? [])] as Json[];
  let max = 0;
  for (const c of all) {
    const a = c.attributeConfig?.componentAttribute?.alias;
    if (typeof a !== 'string') continue;
    used.add(a);
    const m = /^(.*?)(\d+)$/.exec(a);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  let n = max + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const componentDuplicateTool = defineTool({
  name: 'component_duplicate',
  title: 'Duplicate a component',
  description:
    'Makes a copy of one component (chart, control, text, shape, line, image, embed) with all its settings, on the same page, or at report level for a report-level component, and returns the copy\'s new component_id and box. ' +
    'Use it to repeat a styled chart or card and then change the copy with component_update. Without position the copy sits 20 px right of and below the original, as the editor\'s Duplicate puts it; with position, the keys given replace that box. ' +
    'The copy is added on top of the stacking order with its conditional formatting; a control copy gets its own alias. Copies stay in the report: to put one on another page, move it there with the editor or rebuild it on that page.',
  input: {
    report_id: reportIdInput,
    component_id: z.string().min(1).describe('The component to copy: its component_id (cd-…) from component_list.'),
    page: pageArg.optional().describe('Optional. When given, the component must be on this page.'),
    position: positionInput.optional().describe('Box for the copy in pixels; keys left out keep the default (the original box moved 20 px right and down).'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = pageIdOf(doc, a.page);
    const loc = locate(doc, a.component_id, pageId);
    const id = String(loc.component.componentId);
    const type = String(loc.component.type ?? 'component');
    const pos = givenKeys(a.position).length ? a.position! : undefined;
    if (pos) checkPosition(pos);
    const plan = planCopy(doc, loc.component);
    const src = boxOf(loc.component);
    const box = { left: src.left + PASTE_OFFSET, top: src.top + PASTE_OFFSET, ...pos } as Partial<typeof src>;

    // Builds the copy from the component as it is in the copy being saved.
    const add = (list: Json[], conds: Json[]): Json[] => {
      const original = list.find((c) => c.componentId === id);
      if (!original) throw new LookerError('not_found', `Component ${id} is gone from report ${reportId}: someone removed it meanwhile.`);
      const at = list.findIndex((c) => c.componentId === plan.newId);
      if (at >= 0) list.splice(at, 1);
      const copy = copyComponent(original, plan);
      applyPosition(copy, box);
      list.push(copy);
      return [
        ...conds.filter((c) => c.chartId !== plan.newId),
        ...conditionsOf(conds, id).map((c) => ({ ...renamed(c, plan), chartId: plan.newId })),
      ];
    };
    const label = `duplicate ${type} ${id}`;
    const res =
      loc.level === 'page'
        ? await ctx.session.editPage(
            reportId,
            loc.pageId!,
            (page) => {
              page.chartCondition = add(pageComponentsOf(page), page.chartCondition ?? []);
            },
            label,
          )
        : await ctx.session.editReport(
            reportId,
            (fresh) => {
              fresh.chartCondition = add(reportComponentsOf(fresh), fresh.chartCondition ?? []);
            },
            label,
          );

    const copyBox = { ...src, ...box };
    const where = loc.level === 'page' ? `page ${pageName(doc, loc.pageId!)}` : 'report level (every page)';
    const warn = canvasNote(doc, loc.pageId ?? pageIdOf(doc, a.page) ?? doc.page[0]?.pageId, copyBox);
    return {
      ...text(
        [
          `Duplicated ${type} ${id} as ${plan.newId} on ${where}: box ${describeBox(copyBox)}, on top of the stacking order. Saved as version ${res.version}.`,
          ...(warn ? [warn] : []),
          ...(res.snapshot ? [`To undo, restore revision ${res.snapshot} (version_restore).`] : []),
        ].join('\n'),
      ),
      audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `${id} → ${plan.newId}` },
    };
  },
});
