import { listPages } from '../../core/page.js';
import { parseReportId } from '../../looker/view.js';
import { resultText, runTool, text, type ToolContext } from '../../core/tool.js';
import { outlinePage, type PageOutlineToolInput } from './page-outline.js';
import { invalid } from './store.js';

type Json = Record<string, any>;
type PageSpec = Pick<PageOutlineToolInput, 'metrics' | 'dimensions' | 'cross' | 'trend' | 'include' | 'average_line'> & { name: string; title?: string | undefined; description?: string | undefined;
  /** Section of the report's page menu this page belongs to. Consecutive pages with the same section are grouped. */
  section?: string | undefined;
  /** Material icon names for the menu: the section's icon and this page's own icon. */
  section_icon?: string | undefined; icon?: string | undefined };
export interface ReportBuildInput {
  report_id: string; data_source?: string | undefined; date: string; date_range: string;
  comparison?: string | undefined; comparison_label?: string | undefined;
  /** One brand color for the whole report: theme accent, chart palette and the header band. */
  brand_color?: string | undefined;
  header?: { description?: string | undefined; band_color?: string | undefined; logo?: Json | undefined } | undefined;
  design?: Json | undefined;
  tabs?: boolean | undefined;
  pages: PageSpec[];
  preview?: boolean | undefined;
}

// Menu sections carry an icon. When none is given, pick one by what the section
// name is about; the words and icon names are generic, not taken from any report.
const SECTION_ICONS: Array<[RegExp, string]> = [
  [/개요|요약|현황|overview|summary/i, 'dashboard'],
  [/사용자|유저|회원|user|audience/i, 'face'],
  [/획득|유입|acquisition|traffic/i, 'groups'],
  [/행동|behavior|engagement/i, 'explore'],
  [/상품|product|item/i, 'shopping_cart'],
  [/주문|매출|구매|결제|revenue|sales|order|commerce/i, 'storefront'],
  [/재사용|재방문|재구매|리텐션|retention/i, 'trending_up'],
  [/광고|마케팅|캠페인|ads|marketing|campaign/i, 'campaign'],
];
const sectionIcon = (name: string) => SECTION_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? 'article';
const ICON_NAME = /^[a-z0-9_]{2,40}$/;

/** Builds several outlined pages in one call: makes the pages, links them with
 * tabs and composes each from its own metrics and breakdowns. Each page is its
 * own save, so a later failure leaves the earlier pages in place and says so. */
export async function buildReport(ctx: ToolContext, input: ReportBuildInput) {
  const names = input.pages.map(page => page.name.trim());
  for (const page of input.pages) for (const icon of [page.icon, page.section_icon]) if (icon !== undefined && !ICON_NAME.test(icon)) throw invalid(`"${icon}" is not a Material icon name such as home, dashboard or people.`);
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw invalid('Give each page a different name.');
  const reportId = parseReportId(input.report_id);
  const outlineInput = (page: PageSpec): PageOutlineToolInput => ({ report_id: reportId, data_source: input.data_source, date: input.date, date_range: input.date_range,
    comparison: input.comparison, comparison_label: input.comparison_label, metrics: page.metrics, dimensions: page.dimensions, cross: page.cross,
    trend: page.trend, include: page.include, average_line: page.average_line });
  const outline = async (page: PageSpec, extra: Partial<PageOutlineToolInput> = {}) => JSON.parse(resultText(await outlinePage(ctx, { ...outlineInput(page), ...extra }))) as Json;
  const describe = (name: string, plan: Json) => ({ name, observed: plan.observed, regions: plan.regions, notes: plan.notes });

  // A preview or a configured dry run plans every page and writes nothing.
  if (input.preview || ctx.dryRun) {
    const pages = [];
    for (const page of input.pages) pages.push(describe(page.name.trim(), await outline(page)));
    return text(JSON.stringify({ report_id: reportId, saved: false, preview: true, pages,
      next: 'preview 없이 다시 호출하면 페이지를 만들고 구성합니다.' }, null, 2));
  }

  const before = await ctx.session.load(reportId);
  const existing = listPages(before);
  if (existing.some(page => names.some(name => name.toLowerCase() === page.name.trim().toLowerCase())))
    throw invalid('A page with one of these names already exists. Use other names, or rebuild that page with component_page_add and replace.');
  const emptyOnly = existing.length === 1 && !(before.page.find(p => p.pageId === existing[0]!.pageId)?.page.componentConfig?.length);
  // Check every page's fields and value counts before anything is written.
  for (const page of input.pages) await outline(page);

  // The brand color goes to the theme first: chart colors and table shading are read from it when each page is composed.
  if (input.brand_color) {
    const themed = await runTool(ctx, 'theme_update', { report_id: reportId, settings: { 'Brand color': input.brand_color } });
    if (themed.isError) throw invalid(`Could not apply the brand color: ${resultText(themed).slice(0, 200)}`);
  }
  const band = input.header?.band_color ?? input.brand_color;
  const pageIds: string[] = [];
  for (const [index, name] of names.entries()) {
    if (index === 0 && emptyOnly) {
      // A new report starts with one empty page: use it instead of leaving it behind.
      const renamed = await runTool(ctx, 'page_rename', { report_id: reportId, page: existing[0]!.pageId, name });
      if (renamed.isError) throw invalid(`Could not name the first page: ${resultText(renamed).slice(0, 200)}`);
      pageIds.push(existing[0]!.pageId);
      continue;
    }
    const known = new Set(listPages(await ctx.session.load(reportId)).map(page => page.pageId));
    const added = await runTool(ctx, 'page_add', { report_id: reportId, name });
    if (added.isError) throw invalid(`Could not add page "${name}": ${resultText(added).slice(0, 200)}`);
    const created = listPages(await ctx.session.load(reportId)).find(page => !known.has(page.pageId));
    if (!created) throw invalid(`Page "${name}" was not found after it was added.`);
    pageIds.push(created.pageId);
  }
  // The report's own page menu is the navigation. Group the new pages into its sections.
  const sections = input.pages.map(page => page.section?.trim() || undefined);
  const icons = input.pages.map((page, index) => page.icon ?? (index === 0 && !sections[0] ? 'home' : undefined));
  if (sections.some(Boolean) || icons.some(Boolean)) {
    await ctx.session.editNavigation(reportId, items => {
      const mine = new Map(pageIds.map((id, index) => [id, index]));
      const kept = items.filter(item => !(item.page && mine.has(item.page.pageId)));
      const pageItem = (index: number) => {
        const item = items.find(entry => entry.page?.pageId === pageIds[index]) ?? { page: { pageId: pageIds[index]!, displayName: names[index]! } };
        if (icons[index]) (item.page as Json).icon = { matIcon: icons[index] };
        return item;
      };
      const grouped: typeof items = [];
      sections.forEach((section, index) => {
        const last = grouped.at(-1);
        if (!section) grouped.push(pageItem(index));
        else if (last?.section && last.section.displayName === section && sections[index - 1] === section) last.section.navItems!.push(pageItem(index));
        else grouped.push({ section: { sectionId: `stx_${Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`, displayName: section,
          icon: { matIcon: input.pages[index]!.section_icon ?? sectionIcon(section) }, navItems: [pageItem(index)] } });
      });
      items.splice(0, items.length, ...kept, ...grouped);
    }, 'arrange pages in the page menu');
  }
  // In-page tabs are an extra, for moving between sibling pages: the pages of one section, or all pages when no sections are given.
  const tabsFor = (index: number) => {
    if (!input.tabs) return undefined;
    const siblings = names.map((label, i) => ({ label, page: pageIds[i]!, section: sections[i] })).filter(entry => entry.section === sections[index]);
    return siblings.length > 1 ? { items: siblings.map(({ label, page }) => ({ label, page })) } : undefined;
  };

  const built: Json[] = [];
  for (const [index, page] of input.pages.entries()) {
    const header = { title: page.title?.trim() || names[index]!, ...(page.description ?? input.header?.description ? { description: page.description ?? input.header?.description } : {}),
      ...(band ? { band_color: band } : {}), ...(input.header?.logo ? { logo: input.header.logo } : {}) };
    try {
      const tabs = tabsFor(index);
      const plan = await outline(page, { page: pageIds[index]!, header, ...(tabs ? { tabs } : {}), ...(input.design ? { design: input.design } : {}) });
      const result = await runTool(ctx, 'component_page_add', plan.page_add);
      if (result.isError) throw invalid(resultText(result).slice(0, 400));
      const saved = JSON.parse(resultText(result)) as Json;
      built.push({ ...describe(names[index]!, plan), page_id: pageIds[index], ...(sections[index] ? { section: sections[index], section_icon: input.pages[index]!.section_icon ?? sectionIcon(sections[index]!) } : {}), ...(icons[index] ? { icon: icons[index] } : {}), tabs: Boolean(tabs), component_count: saved.component_count, canvas: saved.canvas, ...(saved.logo ? { logo: saved.logo } : {}) });
    } catch (error) {
      // Earlier pages are already saved; report exactly where the build stopped.
      return text(JSON.stringify({ report_id: reportId, saved: 'partial', built, failed: { name: names[index], page_id: pageIds[index], error: String((error as Error)?.message ?? error).slice(0, 400) },
        not_built: names.slice(index + 1).map((name, offset) => ({ name, page_id: pageIds[index + 1 + offset] })),
        next: '실패한 페이지와 남은 페이지는 비어 있습니다. 입력을 고쳐 component_page_outline과 component_page_add로 그 페이지만 구성하세요.' }, null, 2));
    }
  }
  return text(JSON.stringify({ report_id: reportId, saved: true, navigation: sections.some(Boolean) ? 'page menu with sections' : 'page menu', pages: built,
    next: 'report_check로 차트 데이터를 점검하고 report_render로 각 페이지를 확인하세요.' }, null, 2));
}
