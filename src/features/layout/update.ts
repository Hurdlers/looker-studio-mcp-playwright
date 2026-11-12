import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater, Extensions, UpdateTarget } from '../../core/extensions.js';
import { boxOf, pageArg, resolvePage } from '../../core/page.js';
import type { PageDoc, ReportDoc, WriteResult } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import {
  conditionsOf,
  dropFromGroups,
  locate,
  pageComponentsOf,
  pageIdOf,
  pageName,
  pageOf,
  putComponent,
  removeComponent,
  reportComponentsOf,
  reportIdInput,
  reportIdOf,
  setConditions,
  type Json,
} from './model.js';
import { alreadyText, ORDERS, orderTarget, reorder, type Order } from './order.js';
import { applyPosition, canvasNote, checkPosition, describeBox, givenKeys, positionInput, type PartialPosition } from './position.js';

interface UpdateArgs {
  report_id: string;
  component_id: string;
  page?: string | number;
  position?: PartialPosition;
  report_level?: boolean;
  order?: Order;
  [key: string]: unknown;
}

const DESCRIPTION =
  'Changes one component (chart, control, text, shape, line, image, embed) found by its component_id: its box, its stacking order, whether it shows on every page, and every other setting the other inputs offer. ' +
  'Use it to move or resize a component (position: only the keys given change), to put it in front of or behind others (order: front, back, forward, backward; a new shape lands on top, so send a background band or card back), or to make it report-level so it repeats on every page such as a header or logo (report_level true; false puts it back on one page: the page input, else the first page). ' +
  'All changes in one call are saved together: settings first, then position, then report_level, then order, so report_level true with order back puts it behind everything on every page. ' +
  'An order or report_level that is already so is reported and nothing is saved for it; a call with nothing to change is refused. The box is saved exactly as given (no snapping); a box reaching past the page is saved with a warning. ' +
  'Groups made with component_arrange keep the component; making it report-level takes it out of its group.';

export const componentUpdateTool = defineTool({
  name: 'component_update',
  title: 'Update a component',
  description: DESCRIPTION,
  input: (ext: Extensions) => ({
    ...ext.updaterInput(),
    report_id: reportIdInput,
    component_id: z.string().min(1).describe('The component to change: its component_id (cd-…) from component_list.'),
    page: pageArg
      .optional()
      .describe(
        'Optional. When given, the component must be on this page (report-level components count as on every page). With report_level false it is the page the component moves to (the first page when left out).',
      ),
    position: positionInput.optional(),
    report_level: z
      .boolean()
      .optional()
      .describe('true: show it on every page (moves it to report level, on top of the stacking order there). false: put it back on one page.'),
    order: z
      .enum(ORDERS)
      .optional()
      .describe('Stacking order: front (on top of everything), back (behind everything), forward or backward (one step).'),
  }),
  write: true,
  run: (ctx, a) => updateComponent(ctx, a as unknown as UpdateArgs),
});

async function updateComponent(ctx: ToolContext, a: UpdateArgs) {
  const reportId = reportIdOf(a.report_id);
  const doc = await ctx.session.load(reportId);
  const pageId = pageIdOf(doc, a.page);
  const loc = locate(doc, a.component_id, pageId);
  const id = String(loc.component.componentId);
  const type = String(loc.component.type ?? 'component');

  const updates = ctx.ext.updaterValues(a).filter(([u]) => u.key !== 'position');
  const pos = givenKeys(a.position).length ? a.position : undefined;
  if (!updates.length && !pos && a.report_level === undefined && a.order === undefined)
    throw new LookerError('invalid', `Nothing to change for component ${id}: give position, order, report_level or another setting.`);
  for (const [u] of updates)
    if (u.types && !u.types.includes(type))
      throw new LookerError('invalid', `"${u.key}" does not apply to a ${type} component (only ${u.types.join(', ')}). Leave it out.`);
  if (pos) checkPosition(pos);

  const toLevel = a.report_level === undefined ? loc.level : a.report_level ? 'report' : 'page';
  const moving = toLevel !== loc.level;
  let touches = updates.some(([u]) => u.touchesReport);
  if (moving && toLevel === 'page' && touches)
    throw new LookerError(
      'invalid',
      `${updates.filter(([u]) => u.touchesReport).map(([u]) => u.key).join(', ')} changes report settings and cannot be saved in the same call as report_level false: make it page-level first, then change those in a second call.`,
    );
  // The page the component is (or will be) on; for a report-level one that
  // stays so, the page given or the first page (where the updaters look).
  const homePageId = loc.level === 'page' && !moving ? loc.pageId! : (pageId ?? resolvePage(doc));

  // Settings first, on a copy: updaters may need to read (async), and the
  // saves below run synchronously on a fresh copy, so they put back what the
  // updaters made.
  const work = structuredClone(doc);
  const target: UpdateTarget = { component: locate(work, id).component, page: pageOf(work, homePageId), doc: work };
  const notes: string[] = [];
  for (const [u, value] of updates) await note(notes, u, () => u.apply(target, value, ctx));
  touches &&= !isDeepStrictEqual(work.report, doc.report) || !isDeepStrictEqual(work.chartCondition, doc.chartCondition);
  if (pos) applyPosition(target.component, pos);
  const prepared = target.component;
  // Its conditional formatting, from where it is now (an updater working on
  // a report-level component may have written to the page's list).
  const conds =
    loc.level === 'page'
      ? conditionsOf(target.page.chartCondition, id)
      : [...conditionsOf(work.chartCondition, id), ...conditionsOf(target.page.chartCondition, id)];
  const box = boxOf(prepared);
  if (pos) {
    const n = canvasNote(work, homePageId, box);
    if (n) notes.push(n);
  }

  // The stacking list it ends up in, to check the order and report its place.
  const finalList = (toLevel === 'page' ? [...(pageOf(work, homePageId).page.componentConfig ?? [])] : [...(work.report.componentConfig ?? [])]) as Json[];
  if (moving) {
    removeComponent(finalList, id);
    finalList.push(prepared);
  }
  const orderNoop = a.order !== undefined && orderTarget(finalList, id, a.order) === undefined;
  if (a.order && !orderNoop) reorder(finalList, id, a.order);
  const levelNoop = a.report_level !== undefined && !moving;
  if (levelNoop) notes.push(`It is already ${loc.level === 'report' ? 'report-level' : 'page-level'}: report_level left as it is.`);
  if (orderNoop) notes.push(`It is ${alreadyText(a.order!)}: order left as it is.`);

  const where = toLevel === 'report' ? 'report level (every page)' : `page ${pageName(doc, homePageId)}`;
  const stack = finalList.findIndex((c) => c.componentId === id);
  const stacking = `stacking position ${stack} of ${finalList.length - 1} (0 = back, ${finalList.length - 1} = front) at ${where}`;

  if (!updates.length && !pos && !moving && (a.order === undefined || orderNoop))
    return text([`Nothing saved for ${type} ${id}.`, ...notes, `Box ${describeBox(box)}, ${stacking}.`].join(' '));

  const copyReport = (fresh: ReportDoc): void => {
    if (!touches) return;
    for (const [k, v] of Object.entries(work.report)) if (k !== 'componentConfig') (fresh.report as Json)[k] = structuredClone(v);
  };
  const order = (list: Json[]): void => {
    if (a.order && !orderNoop) reorder(list, id, a.order);
  };
  const intoPage = (page: PageDoc): void => {
    const list = pageComponentsOf(page);
    if (moving) removeComponent(list, id);
    putComponent(list, prepared);
    page.chartCondition = setConditions(page.chartCondition ?? [], id, conds);
    order(list);
  };
  const intoReport = (fresh: ReportDoc): void => {
    copyReport(fresh);
    const list = reportComponentsOf(fresh);
    if (moving) removeComponent(list, id);
    putComponent(list, prepared);
    fresh.chartCondition = setConditions(fresh.chartCondition ?? [], id, conds);
    order(list);
  };
  const label = `update ${type} ${id}`;
  let res: WriteResult;
  if (!moving && toLevel === 'page')
    res = touches
      ? await ctx.session.editReportThenPage(reportId, homePageId, { report: copyReport, page: intoPage }, label)
      : await ctx.session.editPage(reportId, homePageId, intoPage, label);
  else if (!moving) res = await ctx.session.editReport(reportId, intoReport, label);
  else if (toLevel === 'report')
    // Added at report level first, then taken off the page: if the second
    // save fails, the first is undone, so it is never in two places.
    res = await ctx.session.editReportThenPage(
      reportId,
      loc.pageId!,
      {
        report: intoReport,
        page: (page) => {
          removeComponent(pageComponentsOf(page), id);
          page.chartCondition = (page.chartCondition ?? []).filter((c) => c.chartId !== id);
          dropFromGroups(page, id);
        },
      },
      `make ${id} report-level`,
    );
  else
    res = await ctx.session.editPageAndReport(
      reportId,
      homePageId,
      {
        page: intoPage,
        report: (fresh) => {
          removeComponent(reportComponentsOf(fresh), id);
          fresh.chartCondition = (fresh.chartCondition ?? []).filter((c) => c.chartId !== id);
        },
      },
      `make ${id} page-level`,
    );

  const changed = [
    ...updates.map(([u]) => u.key),
    ...(pos ? ['position'] : []),
    ...(moving ? [toLevel === 'report' ? 'made report-level' : 'made page-level'] : []),
    ...(a.order && !orderNoop ? [`order ${a.order}`] : []),
  ];
  return {
    ...text(
      [
        `Updated ${type} ${id} (${changed.join(', ')}): box ${describeBox(box)}, ${stacking}. Saved as version ${res.version}.`,
        ...notes,
        ...(res.snapshot ? [`To undo, restore revision ${res.snapshot} (version_restore).`] : []),
      ].join('\n'),
    ),
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: changed.join(', ') },
  };
}

async function note(notes: string[], u: ComponentUpdater, run: () => unknown): Promise<void> {
  const n = await run();
  if (typeof n === 'string' && n.trim()) notes.push(`${u.key}: ${n}`);
}
