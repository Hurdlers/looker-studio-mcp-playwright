import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { kindLabel, locate, notFound, reportIdInput, reportIdOf, type Json } from './common.js';

// Takes a component id out of a page's (or the report's) groupConfig: from
// member lists, and member entries that are that component.
function ungroup(groups: unknown, id: string): unknown {
  if (Array.isArray(groups))
    return groups.filter((g) => g !== id && !(g && typeof g === 'object' && (g as Json).componentId === id)).map((g) => ungroup(g, id));
  if (groups && typeof groups === 'object') return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, ungroup(v, id)]));
  return groups;
}

export const componentDelete = defineTool({
  name: 'component_delete',
  title: 'Delete a component',
  description:
    'Deletes one component (chart, control, text, shape, image …) by its component_id, together with its conditional formatting rules; a report-level component is removed from every page. ' +
    'Use component_list to find the id. It asks for no confirmation, but an undo point is saved first: the answer names the revision to restore with version_restore. ' +
    'Other components keep their ids.',
  input: {
    report_id: reportIdInput,
    component_id: z.string().min(1).describe('Id of the component to delete (cd-…), from component_list.'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const id = a.component_id.trim();
    const doc = await ctx.session.load(reportId);
    const hit = locate(doc, id);
    if (!hit) throw notFound(doc, id);
    const what = `${kindLabel(ctx.ext, hit.component)} ${id}`;
    const gone = (where: string) => new LookerError('not_found', `Component ${id} is no longer on ${where} of report ${reportId}: someone changed it meanwhile.`);
    const res = hit.page
      ? await ctx.session.editPage(
          reportId,
          hit.page.pageId,
          (page) => {
            const list = (page.page.componentConfig ?? []) as Json[];
            if (!list.some((c) => c.componentId === id)) throw gone(`page ${hit.pageName}`);
            page.page.componentConfig = list.filter((c) => c.componentId !== id);
            page.chartCondition = (page.chartCondition ?? []).filter((c) => c.chartId !== id);
            if (page.page.groupConfig) page.page.groupConfig = ungroup(page.page.groupConfig, id) as Json[];
          },
          `delete ${id}`,
        )
      : await ctx.session.editReport(
          reportId,
          (d) => {
            const list = (d.report.componentConfig ?? []) as Json[];
            if (!list.some((c) => c.componentId === id)) throw gone('the report level');
            d.report.componentConfig = list.filter((c) => c.componentId !== id);
            d.chartCondition = (d.chartCondition ?? []).filter((c) => c.chartId !== id);
          },
          `delete ${id}`,
        );
    const where = hit.page ? `page "${hit.pageName}"` : 'the report level (every page)';
    const body = ctx.dryRun
      ? `Would delete ${what} from ${where}.`
      : `Deleted ${what} from ${where}. Report version ${res.version}.${res.snapshot ? ` To undo, restore revision ${res.snapshot} (version_restore).` : ''}`;
    return { ...text(body), audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: id } };
  },
});
