import { isDeepStrictEqual } from 'node:util';
import { dryRunContext } from '../../core/dryrun.js';
import { resolveSource } from '../../core/datasource.js';
import { resolvePage } from '../../core/page.js';
import { resultText, runTool, text, type ToolContext, type ToolResult } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { compositionTheme } from './theme-tokens.js';
import type { CommonInput } from './common.js';
import { isCommonTemplate } from './common.js';
import { planNavbar, navbarEntry, type NavbarInput } from './navbar.js';
import { planSection, sectionEntry, type SectionInput } from './section.js';
import { invalid } from './store.js';
import { fitPageCanvas } from './canvas.js';

type Json = Record<string, any>;
export interface CompositionInput extends CommonInput {
  navigation?: NavbarInput['navigation'] | undefined;
  section_options?: SectionInput['section_options'] | undefined;
}
export function isComposition(id: string): boolean { return ['common-overview-section', 'common-navbar'].includes(id); }
export function compositionEntries(query = '') {
  const q = query.trim().toLowerCase();
  return [sectionEntry(), navbarEntry()].filter(item => JSON.stringify(item).toLowerCase().includes(q));
}
/** Compile known page-only tools in an isolated context, then append the
 * compiled elements and their group in one page save. No partial section is
 * left behind when input validation fails, and existing page data is retained. */
export async function addComposition(ctx: ToolContext, input: CompositionInput): Promise<ToolResult> {
  if (input.sort_by !== undefined || input.sort_ascending !== undefined || input.field_formats !== undefined)
    throw invalid('sort_by, sort_ascending and field_formats apply to individual common charts, not compositions.');
  if (input.common_options !== undefined) throw invalid('Compositions use section_options or navigation, not common_options.');
  const reportId = parseReportId(input.report_id), before = await ctx.session.load(reportId);
  const pageId = resolvePage(before, input.page), originalPage = before.page.find(p => p.pageId === pageId)!;
  const tokens = compositionTheme(before);
  const betweenSections = input.section_options?.density === 'compact' ? 16 : 24;
  const position = input.position ?? { left: 24, top: Math.max(24, ...(originalPage.page.componentConfig ?? []).map(c => {
    const a = (c.attributeConfig as Json | undefined)?.componentAttribute ?? {}; return Number(a.top ?? 0) + Number(a.height ?? 0) + betweenSections;
  })) };
  let plan;
  if (input.template_id === 'common-navbar') {
    if (!input.navigation) throw invalid('common-navbar needs navigation.items.');
    if (Object.keys(input.bindings).length || input.data_source || input.date_range || input.section_options) throw invalid('Navigation accepts no data bindings, source, date range or section_options.');
    plan = planNavbar({ ...input, page: pageId, position, navigation: input.navigation, themeTokens: tokens }, before);
  } else {
    if (input.navigation) throw invalid('navigation applies only to common-navbar.');
    const source = await resolveSource(ctx.rap, before, input.data_source);
    plan = planSection({ ...input, page: pageId, position, data_source: source.datasourceId }, tokens);
  }
  const dry = dryRunContext(ctx).ctx;
  const beforeIds = new Set((originalPage.page.componentConfig ?? []).map(c => c.componentId));
  const beforeGroups = new Set((originalPage.page.groupConfig ?? []).map(g => g.groupId));
  const permitted = new Set(['shape_add', 'text_add', 'control_add', 'component_template_add']);
  for (const step of plan.steps) {
    if (!permitted.has(step.tool) || step.args.report_id !== input.report_id || resolvePage(before, step.args.page as string | number | undefined) !== pageId)
      throw invalid('Composition plans may add elements only to their target page.');
    if (step.tool === 'component_template_add' && !isCommonTemplate(String(step.args.template_id))) throw invalid('Nested compositions and saved recipes are not allowed in a common section.');
    const result = await runTool(dry, step.tool, step.args);
    const output = resultText(result);
    if (result.isError || /Not applied:/i.test(output)) throw invalid(`Composition step ${step.tool} failed: ${output}`);
  }
  const built = await dry.session.load(reportId), builtPage = built.page.find(p => p.pageId === pageId)!;
  const components = (builtPage.page.componentConfig ?? []).filter(c => !beforeIds.has(c.componentId));
  if (components.length < 2 || components.length > 50) throw invalid('Unexpected composition size.');
  await runTool(dry, 'component_arrange', { report_id: reportId, page: pageId, component_ids: components.map(c => c.componentId), action: 'group' });
  const grouped = await dry.session.load(reportId), groupedPage = grouped.page.find(p => p.pageId === pageId)!;
  if (!isDeepStrictEqual(before.report, grouped.report)) throw invalid('A composition unexpectedly changed report-level settings.');
  const groups = (groupedPage.page.groupConfig ?? []).filter(g => !beforeGroups.has(g.groupId));
  if (groups.length !== 1) throw invalid('A composition must produce exactly one local group.');
  for (const c of originalPage.page.componentConfig ?? []) if (!isDeepStrictEqual(c, groupedPage.page.componentConfig?.find(x => x.componentId === c.componentId))) throw invalid('A composition unexpectedly changed an existing component.');
  const canvas = fitPageCanvas(structuredClone(originalPage), before, [{ ...position, width: plan.width, height: plan.height }]);
  const summary = { template_id: input.template_id, report_id: reportId, page_id: pageId,
    validation: 'supported_pending_review', position, size: { width: plan.width, height: plan.height },
    component_count: components.length, component_ids: components.map(c => c.componentId), group_id: groups[0]!.groupId,
    notes: plan.notes, canvas,
    ...('navigation_items' in plan && 'current_page_id' in plan ? { navigation_items: plan.navigation_items, current_page_id: plan.current_page_id, navigation_layout: input.navigation?.layout ?? 'horizontal' } : {}),
  };
  if (input.preview) return text(JSON.stringify({ ...summary, saved: false, preview: true }, null, 2));
  const saved = await ctx.session.editPage(reportId, pageId, (page, doc) => {
    const ids = new Set((page.page.componentConfig ?? []).map(c => c.componentId));
    (page.page.componentConfig ??= []).push(...components.filter(c => !ids.has(c.componentId)).map(c => structuredClone(c)));
    const existing = new Set((page.page.groupConfig ?? []).map(g => g.groupId));
    (page.page.groupConfig ??= []).push(...groups.filter(g => !existing.has(g.groupId)).map(g => structuredClone(g)));
    fitPageCanvas(page, doc, [{ ...position, width: plan.width, height: plan.height }]);
  }, `add common composition ${input.template_id}`);
  return { ...text(JSON.stringify({ ...summary, saved: !ctx.dryRun, preview: ctx.dryRun, version: saved.version, undo_revision: saved.snapshot }, null, 2)),
    audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: `common composition ${input.template_id}` } };
}
