import { boxOf, listPages, pageArg, resolvePage } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import { defineTool, text } from '../../core/tool.js';
import { kindLabel, reportIdInput, reportIdOf, type Json } from './common.js';

// The groups a component belongs to. The group format is not pinned down
// yet, so a group is any groupConfig entry whose JSON names the component.
export function groupsOf(page: { page: { groupConfig?: Json[] } } | undefined, componentId: string): string[] {
  return (page?.page.groupConfig ?? []).flatMap((g, i) =>
    JSON.stringify(g).includes(`"${componentId}"`) ? [String(g.groupId ?? g.id ?? g.componentId ?? `group ${i + 1}`)] : [],
  );
}

function line(ext: Parameters<typeof kindLabel>[0], c: Json, extra: string[]): string {
  const b = boxOf(c);
  return `- ${c.componentId}: ${kindLabel(ext, c)}, left ${Math.round(b.left)}, top ${Math.round(b.top)}, ${Math.round(b.width)}x${Math.round(b.height)}${
    extra.length ? ` (${extra.join('; ')})` : ''
  }`;
}

export const componentList = defineTool({
  name: 'component_list',
  title: 'List components on a page',
  description:
    "Lists every component on one page with its component_id, kind (the chart_add type and the editor's name when known, else the component type) and box (left, top, width, height in pixels). " +
    'Use it to find the component_id that component_inspect, component_update and component_delete take. ' +
    'Report-level components (shown on every page) come first, marked "report-level"; components in a group show the group id. ' +
    'The order is the saved stacking order, back to front. Reads only, from the latest draft, so it also shows unpublished changes.',
  input: {
    report_id: reportIdInput,
    page: pageArg.optional().describe('Page id or the name shown in the page list (or its number from 1). Defaults to the first page.'),
  },
  write: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc: ReportDoc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, a.page);
    const page = doc.page.find((p) => p.pageId === pageId);
    const name = listPages(doc).find((p) => p.pageId === pageId)?.name ?? pageId;
    const own = (page?.page.componentConfig ?? []) as Json[];
    const shared = (doc.report.componentConfig ?? []) as Json[];
    if (!own.length && !shared.length) return text(`Page "${name}" (${pageId}) is empty: no components.`);
    const lines = [
      `${own.length + shared.length} component${own.length + shared.length === 1 ? '' : 's'} on page "${name}" (${pageId}), back to front:`,
      ...shared.map((c) => line(ctx.ext, c, ['report-level'])),
      ...own.map((c) => line(ctx.ext, c, groupsOf(page, String(c.componentId)).map((g) => `group ${g}`))),
    ];
    return text(lines.join('\n'));
  },
});
