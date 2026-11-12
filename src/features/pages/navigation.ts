import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { listPages, pageArg } from '../../core/page.js';
import { defineTool, text } from '../../core/tool.js';
import { copyPage, mustFindNav, nameInput, pageIdOf, pageLines, reportIdInput, reportIdOf, saved } from './model.js';

export const pageList = defineTool({
  name: 'page_list',
  title: 'List report pages',
  description: 'Lists page names, ids, section names and viewer visibility in navigation order. Use it before choosing a page to change; a one-page report keeps its actual page name.',
  input: { report_id: reportIdInput },
  write: false,
  run: async (ctx, a) => text(pageLines(await ctx.session.load(reportIdOf(a.report_id)))),
});

export const pageAdd = defineTool({
  name: 'page_add',
  title: 'Add an empty page',
  description: 'Appends an empty page and returns its name, id and position. Use it to start a new report section; duplicate names are allowed and the returned id always identifies the new page.',
  input: { report_id: reportIdInput, name: nameInput },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const res = await ctx.session.createPages(reportId, [{ displayName: a.name }]);
    const doc = await ctx.session.load(reportId);
    const page = listPages(doc).find((p) => p.pageId === res.pageIds[0]);
    return saved(reportId, res, `Added ${page?.number ?? listPages(doc).length}. ${a.name} (${res.pageIds[0]}).`);
  },
});

export const pageRename = defineTool({
  name: 'page_rename',
  title: 'Rename a page',
  description: 'Changes the name shown for a page in the report navigation. Use a page id when several pages have the same name; renaming works directly even when the report has one page.',
  input: { report_id: reportIdInput, page: pageArg, name: nameInput },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const pageId = pageIdOf(await ctx.session.load(reportId), a.page);
    const res = await ctx.session.editNavigation(reportId, (items) => { mustFindNav(items, pageId).item.page!.displayName = a.name; }, 'rename page');
    return saved(reportId, res, `Renamed page ${pageId} to "${a.name}".`);
  },
});

export const pageEdit = defineTool({
  name: 'page_edit',
  title: 'Change page order or visibility',
  description: 'Deletes or duplicates a page, changes its viewer visibility, or moves it in the navigation. Use page_list to choose the target; moves stay within its section, a report retains at least one page, and hiding must leave another page visible.',
  input: {
    report_id: reportIdInput,
    page: pageArg,
    action: z.enum(['delete', 'duplicate', 'hide', 'show', 'move_up', 'move_down', 'move_top', 'move_bottom']).describe('페이지 삭제, 복제, 보기 화면에서 숨김·표시 또는 같은 섹션 안에서 순서 이동.'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = pageIdOf(doc, a.page);
    const pages = listPages(doc);
    const page = pages.find((p) => p.pageId === pageId)!;
    const location = mustFindNav(doc.navigationInfo?.navItems ?? [], pageId);
    if (a.action !== 'duplicate' && pages.length < 2)
      throw new LookerError('invalid', 'A report needs another page before this action. Add one with page_add.');

    let res;
    let message: string;
    if (a.action === 'delete') {
      res = await ctx.session.deletePages(reportId, [pageId]);
      message = `Deleted page "${page.name}" (${pageId}).`;
    } else if (a.action === 'duplicate') {
      const original = doc.page.find((p) => p.pageId === pageId)!;
      const copy = copyPage(original);
      const name = `Copy of ${page.name}`;
      res = await ctx.session.createPages(reportId, [{ displayName: name, ...copy }], { index: location.index + 1, ...(location.sectionId ? { sectionId: location.sectionId } : {}) }, 'duplicate page');
      message = `Duplicated page "${page.name}" as "${name}" (${res.pageIds[0]}).`;
    } else if (a.action === 'hide' || a.action === 'show') {
      const hide = a.action === 'hide';
      if (!!page.hidden === hide) return text(`Page "${page.name}" is already ${hide ? 'hidden' : 'visible'}.\n${pageLines(doc)}`);
      if (hide && pages.filter((p) => !p.hidden).length < 2)
        throw new LookerError('invalid', 'At least one page must remain visible. Show another page before hiding this one.');
      res = await ctx.session.editNavigation(reportId, (items, fresh) => {
        const target = mustFindNav(items, pageId).item.page!;
        if (hide && !target.hiddenFromViewer && listPages(fresh).filter((p) => !p.hidden).length < 2)
          throw new LookerError('invalid', 'At least one page must remain visible. Show another page first.');
        if (hide) target.hiddenFromViewer = true;
        else delete target.hiddenFromViewer;
      }, `${a.action} page`);
      message = `Page "${page.name}" is now ${hide ? 'hidden from viewers' : 'visible to viewers'}.`;
    } else {
      const at = location.index;
      const last = location.items.length - 1;
      const target = a.action === 'move_up' ? Math.max(0, at - 1) : a.action === 'move_down' ? Math.min(last, at + 1) : a.action === 'move_top' ? 0 : last;
      if (target === at) return text(`Page "${page.name}" is already at the ${target === 0 ? 'top' : 'bottom'} of its section.\n${pageLines(doc)}`);
      const before = location.items[target]!;
      res = await ctx.session.editNavigation(reportId, (items) => {
        const here = mustFindNav(items, pageId);
        const anchor = here.items.findIndex((item) => before.page
          ? item.page?.pageId === before.page.pageId
          : before.section?.sectionId
            ? item.section?.sectionId === before.section.sectionId
            : JSON.stringify(item) === JSON.stringify(before));
        if (anchor < 0) throw new LookerError('version_conflict', 'The page order changed meanwhile. Read page_list and try the move again.');
        const [moved] = here.items.splice(here.index, 1);
        here.items.splice(anchor, 0, moved!);
      }, 'move page');
      message = `Moved page "${page.name}" within its section.`;
    }
    return saved(reportId, res, `${message}\n${pageLines(await ctx.session.load(reportId))}`);
  },
});
