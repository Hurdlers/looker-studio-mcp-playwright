import { expectedPageAfterAppearance, assertPageAnalysisPreserved } from './analysis-preservation.js';
import { planReportAppearance, reportAppearanceMinimumWidth } from './report-appearance.js';
import { isDeepStrictEqual } from 'node:util';

import { dryRunContext } from '../../core/dryrun.js';
import { boxOf, listPages, pageSize, resolvePage } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { resultText, runTool, text, type ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { compositionTheme, contrastRatio } from './theme-tokens.js';
import { planAnalysisRegions, type AnalysisRegion } from './analysis-regions.js';
import { planPageHeader, type PageHeaderInput } from './page-header.js';
import { commonEntries, type CommonInput } from './common.js';
import { commonLayoutHeight, COMMON_LAYOUTS, type CommonLayoutFamily, type DesignDensity } from './layout.js';
import { planPageLayout, type PageLayoutPlan } from './page-layout.js';
import { planSection, type SectionInput } from './section.js';
import type { NavbarInput } from './navbar.js';
import { invalid } from './store.js';
import { preparePageControls, compilePageControls, type PageControls } from './page-controls.js';

type Json = Record<string, any>;
export interface PageItem extends Omit<CommonInput, 'report_id' | 'page' | 'position' | 'size' | 'preview'> {
  key: string;
  span?: number | undefined;
  height?: number | undefined;
  section_options?: SectionInput['section_options'];
}
export interface RegionDesign { surface?: 'outlined' | 'plain' | undefined; heading?: 'plain' | 'band' | undefined;
  /** Page-level only: header fill of detail and cross tables. */
  table_header?: 'text' | 'accent' | undefined }
export interface PageAddInput {
  report_id: string;
  page?: string | number | undefined;
  width?: number | undefined;
  columns?: number | undefined;
  gap?: number | undefined;
  padding?: number | undefined;
  density?: DesignDensity | undefined;
  appearance?: 'outlined-report' | undefined;
  fit_height?: boolean | undefined;
  header?: PageHeaderInput | undefined;
  controls?: PageControls | undefined;
  content_frame?: { title: string } | undefined;
  items?: PageItem[] | undefined;
  regions?: Array<AnalysisRegion & { design?: RegionDesign | undefined }> | undefined;
  design?: RegionDesign | undefined;
  sidebar?: { width?: number | undefined; title?: string | undefined; navigation: Pick<NavbarInput['navigation'], 'items'> } | undefined;
  /** Page tabs in a row under the header. */
  tabs?: Pick<NavbarInput['navigation'], 'items'> | undefined;
  preview?: boolean | undefined;
  /** Rebuild a page that already has content. Everything on it is removed and the new composition saved in its place. */
  replace?: { confirm_page_name: string } | undefined;
}
function requireEmpty(doc: ReportDoc, page: PageDoc, replacing = false) {
  if (!replacing && ((page.page.componentConfig?.length ?? 0) || (page.page.groupConfig?.length ?? 0) || (page.chartCondition?.length ?? 0)))
    throw invalid('Automatic page composition needs an empty page. Choose or create an empty page, or pass replace with the page name to rebuild this one; existing content is not rearranged.');
  if (doc.report.componentConfig?.length) throw invalid('Report-level components may overlap the layout. Use a report without report-level components.');
}

/** Compile an entire empty page using existing component tools. The only live
 * save includes all elements, groups and the final page dimensions together. */
export async function addComponentPage(ctx: ToolContext, input: PageAddInput) {
  if ((input.items !== undefined) === (input.regions !== undefined)) throw invalid('Supply exactly one of items or regions.');
  if (input.regions && input.content_frame) throw invalid('Regions already have their own frames; content_frame cannot be combined with regions.');
  if (input.design && !input.regions) throw invalid('design applies only to regions.');
  const reportId = parseReportId(input.report_id), before = await ctx.session.load(reportId);
  const pageId = resolvePage(before, input.page), original = before.page.find(p => p.pageId === pageId)!;
  const replacing = input.replace !== undefined;
  if (input.replace) {
    // The page name is repeated as a deliberate confirmation, as for deleting a report.
    const name = listPages(before).find(p => p.pageId === pageId)?.name ?? '';
    if (input.replace.confirm_page_name.trim() !== name.trim()) throw invalid(`replace.confirm_page_name must equal the current page name "${name}". Nothing was changed.`);
  }
  requireEmpty(before, original, replacing);
  const previousSize = pageSize(before, pageId), width = input.width ?? (input.regions ? 1500 : previousSize.width);
  const compact = input.density === 'compact', fitHeight = input.fit_height ?? compact;
  const columns = input.columns ?? 2, gap = input.gap ?? (compact ? 16 : 24), padding = input.padding ?? 24;
  const originalItems = input.regions ? input.regions.flatMap(region => region.items) : input.items!;
  let items = originalItems.map(item => input.density === undefined ? item : item.template_id === 'common-overview-section'
    ? { ...item, section_options: { density: input.density, ...item.section_options } }
    : { ...item, common_options: { density: input.density, ...item.common_options } });
  if (input.content_frame || input.regions) items = items.map(item => item.template_id === 'common-overview-section' ? item
    : { ...item, common_options: { surface: 'plain', ...item.common_options } });
  if (input.appearance) items = items.map(item => {
    // Validate the profile for every child before compiling any dry components.
    planReportAppearance(item.template_id, compositionTheme(before), item.common_options);
    if (item.template_id !== 'common-detail-table') return item;
    const rows = item.common_options?.visible_rows ?? 5;
    const minimum = 96 + rows * 32;
    if (item.height !== undefined && item.height < minimum) throw invalid(`Table ${item.key} needs at least ${minimum}px for outlined-report and ${rows} visible rows.`);
    const height = item.height ?? Math.max(minimum, commonLayoutHeight('detail-table', item.common_options?.density, rows));
    return { ...item, height, common_options: { ...item.common_options, visible_rows: rows } };
  });
  const controls = input.controls ? await preparePageControls(ctx, before, input.controls, items) : undefined;
  if (controls) items = controls.items;
  const headerLeft = padding + (input.sidebar ? (input.sidebar.width ?? 240) + gap : 0);
  const headerWidth = width - headerLeft - padding;
  const minimumWidths = new Map<string, number>();
  // A compared table shows a change column beside every value column. Reserve
  // room for all of them so the block layout gives the table its own row when
  // a shared row would cut the numbers short.
  for (const item of items) {
    if (item.template_id !== 'common-detail-table' || !item.common_options?.comparison) continue;
    const values = ['metric', 'metric_2', 'metric_3', 'metric_4'].filter(key => item.bindings[key] !== undefined).length + (item.common_options.percent_of_total ? 1 : 0);
    minimumWidths.set(item.key, Math.min(headerWidth - (input.regions ? 48 : input.content_frame ? 32 : 0), 150 + 150 + (values - 1) * 100 + values * 105));
  }
  if (input.appearance) for (const item of items) {
    const minimum = reportAppearanceMinimumWidth(item.template_id, item.common_options);
    if (minimum === undefined) continue;
    const available = headerWidth - (input.regions ? 48 : input.content_frame ? 32 : 0);
    if (available < minimum) throw invalid(`Annotated line ${item.key} needs at least ${minimum}px of chart width for outlined-report. Widen the canvas or explicitly set show_values:false.`);
    minimumWidths.set(item.key, minimum);
  }
  const headerPlan = planPageHeader({ left: headerLeft, top: padding, width: headerWidth, gap,
    header: input.header, controls: controls?.controls });
  const controlPlan = headerPlan.controls;
  // Page tabs take one row between the header and the content.
  const TAB_ROW = 56;
  const headerHeight = headerPlan.height + (input.tabs ? TAB_ROW + gap : 0);
  const frameTitle = input.content_frame?.title.trim();
  if (input.content_frame && !frameTitle) throw invalid('The content frame needs a nonempty title.');
  const frameInset = input.content_frame ? 16 : 0;
  const frameTitleHeight = frameTitle ? frameTitle.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length * 18 / Math.max(1, headerWidth - 32))), 0) * 24 : 0;
  const frameHeader = frameTitle ? frameInset * 2 + frameTitleHeight : 0;
  const sidebarMinimum = input.sidebar
    ? Math.max(fitHeight ? 96 : 720, fitHeight ? 0 : previousSize.height - 2 * padding, (input.sidebar.title?.trim() ? 80 : 16) + input.sidebar.navigation.items.length * 44 + (input.sidebar.navigation.items.length - 1) * 8 + 16)
    : undefined;
  let regionPlan: ReturnType<typeof planAnalysisRegions> | undefined;
  let layout: PageLayoutPlan;
  if (input.regions) {
    let itemOffset = 0;
    const normalized = input.regions.map(region => {
      const regionItems = items.slice(itemOffset, itemOffset + region.items.length);
      itemOffset += region.items.length;
      return { ...region, items: regionItems };
    });
    const bandKeys = new Set(input.regions.filter(region => (region.design?.heading ?? input.design?.heading) === 'band').map(region => region.key));
    regionPlan = planAnalysisRegions({ regions: normalized, width: headerWidth, left: headerLeft, top: padding + headerHeight, gap, minimumWidths, bandKeys });
    const bodyHeight = Math.max(regionPlan.height, sidebarMinimum ?? 0);
    layout = { width, height: padding * 2 + headerHeight + bodyHeight, columns: 1,
      items: regionPlan.regions.flatMap(region => region.items), notes: regionPlan.notes,
      ...(input.sidebar ? { sidebar: { position: { left: padding, top: padding + headerHeight },
        size: { width: input.sidebar.width ?? 240, height: bodyHeight } } } : {}) };
  } else {
    const entries = commonEntries();
    const measurements = items.map(item => {
      const section = item.template_id === 'common-overview-section';
      const family = entries.find(e => e.template_id === item.template_id)?.structure_family as CommonLayoutFamily | undefined;
      if (!section && !family) throw invalid(`Unsupported page item ${item.template_id}. Use a built-in common chart or overview section.`);
      const policy = family ? COMMON_LAYOUTS[family] : undefined;
      return { key: item.key, span: item.span ?? (section ? columns : 1), height: item.height ?? (family ? commonLayoutHeight(family, item.common_options?.density, item.common_options?.visible_rows) : 1),
        min_width: Math.max(policy?.minimum.width ?? 600, minimumWidths.get(item.key) ?? 0) };
    });
    const geometry = { width: width - frameInset * 2, columns, gap, padding, header_height: headerHeight + frameHeader,
      ...(input.sidebar ? { sidebar_width: input.sidebar.width ?? 240, sidebar_min_height: sidebarMinimum } : {}) };
    const widths = planPageLayout({ ...geometry, items: measurements });
    for (const [index, item] of items.entries()) {
      if (item.template_id !== 'common-overview-section') continue;
      const allocation = widths.items[index]!;
      const measured = planSection({ ...item, report_id: reportId, page: pageId, position: { left: 0, top: 0 },
        size: { width: allocation.size.width, ...(item.height === undefined ? {} : { height: item.height }) } });
      measurements[index]!.height = measured.height;
    }
    layout = planPageLayout({ ...geometry, items: measurements });
    if (input.content_frame) {
      layout.width = width;
      layout.height += frameInset;
      for (const item of layout.items) item.position.left += frameInset;
      if (layout.sidebar) layout.sidebar.size.height = layout.height - 2 * padding;
    }
  }
  const frame = input.content_frame ? { left: headerLeft, top: padding + headerHeight, width: headerWidth,
    height: Math.max(...layout.items.map(item => item.position.top + item.size.height)) + frameInset - padding - headerHeight } : undefined;
  const canvas = { width: layout.width, height: fitHeight ? layout.height : Math.max(previousSize.height, layout.height) };
  if (canvas.height > 20_000) throw invalid('The page height exceeds 20000 pixels. Split the content across pages.');
  const dry = dryRunContext(ctx).ctx;
  const dryBefore = await dry.session.load(reportId);
  if (!isDeepStrictEqual(before.report, dryBefore.report) || !isDeepStrictEqual(original.page, dryBefore.page.find(p => p.pageId === pageId)?.page))
    throw invalid('The report changed while planning the page. Read it and retry.');
  const replaced = { components: original.page.componentConfig?.length ?? 0, groups: original.page.groupConfig?.length ?? 0 };
  // Compile on a cleared copy of the page; the live page is untouched until the single save.
  if (replacing) await dry.session.editPage(reportId, pageId, page => { page.page.componentConfig = []; page.page.groupConfig = []; page.chartCondition = []; }, 'clear page for rebuild');
  const compiled: Json[] = [];
  async function compile(key: string, args: Record<string, unknown>) {
    const result = await runTool(dry, 'component_template_add', { ...args, report_id: reportId, page: pageId, preview: false });
    if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid(`Page item ${key} failed: ${resultText(result)}`);
    const output = JSON.parse(resultText(result));
    if (input.appearance && key !== '$sidebar' && key !== '$tabs') {
      const tokens = compositionTheme(before);
      const style = planReportAppearance(String(args.template_id), tokens, args.common_options as CommonInput['common_options'], output.size);
      // A brand-colored table header for the whole page; a table's own presentation choice still wins.
      if (input.design?.table_header === 'accent' && 'Header background color' in style && (args.common_options as { presentation?: { table_header?: string } } | undefined)?.presentation?.table_header === undefined) {
        style['Header background color'] = tokens.accent; style['Header font color'] = tokens.activeText;
      }
      for (const componentId of output.component_ids as string[]) {
        const styleBefore = (await dry.session.load(reportId)).page.find(page => page.pageId === pageId)!;
        const expected = expectedPageAfterAppearance(styleBefore, componentId, style);
        const styled = await runTool(dry, 'component_update', { report_id: reportId, page: pageId, component_id: componentId, style });
        if (styled.isError || /Not applied:/i.test(resultText(styled))) throw invalid(`Page item ${key} appearance failed: ${resultText(styled)}`);
        const styleAfter = (await dry.session.load(reportId)).page.find(page => page.pageId === pageId)!;
        assertPageAnalysisPreserved(expected, styleAfter);
      }
    }
    compiled.push({ key, template_id: args.template_id, position: output.position, size: output.size,
      component_ids: output.component_ids, ...(output.notes ? { notes: output.notes } : {}), ...(output.design_rules ? { design_rules: output.design_rules } : {}), ...(output.group_id ? { group_id: output.group_id } : {}) });
  }
  if (frame && frameTitle) {
    const { background } = compositionTheme(before);
    const steps = [
      { tool: 'shape_add', args: { shape: 'rectangle', position: frame, background, border_radius: compact ? 10 : 16, style: { 'Border weight': 'None', 'Border shadow': false } } },
      { tool: 'text_add', args: { text: frameTitle, font_size: 18, bold: true, position: { left: frame.left + frameInset, top: frame.top + frameInset, width: frame.width - 2 * frameInset, height: frameTitleHeight } } },
    ];
    for (const step of steps) {
      const result = await runTool(dry, step.tool, { ...step.args, report_id: reportId, page: pageId });
      if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid('The content frame could not be compiled.');
    }
  }
  if (regionPlan) {
    const theme = compositionTheme(before);
    for (const region of regionPlan.regions) {
      const design = { surface: 'outlined', heading: 'plain', ...input.design, ...input.regions!.find(r => r.key === region.key)?.design };
      const band = design.heading === 'band';
      const bandBox = { left: region.box.left + 1, top: region.box.top + 1, width: region.box.width - 2,
        height: region.titleBox.top + region.titleBox.height + 8 - region.box.top };
      const steps: Array<{ tool: string; args: Record<string, unknown> }> = [
        { tool: 'shape_add', args: { shape: 'rectangle', position: region.box, background: theme.background, border_radius: 8,
          style: { 'Border weight': design.surface === 'outlined' ? '1' : 'None', 'Border color': theme.text, 'Border shadow': false } } },
        ...(band ? [{ tool: 'shape_add', args: { shape: 'rectangle', position: bandBox, background: theme.text,
          style: { 'Border weight': 'None', 'Border shadow': false } } }] : []),
        { tool: 'text_add', args: { text: region.title, font_size: 20, bold: true, color: band ? theme.background : theme.text,
          style: { Font: theme.font }, position: region.titleBox } },
      ];
      for (const step of steps) {
        const result = await runTool(dry, step.tool, { ...step.args, report_id: reportId, page: pageId });
        if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid(`Region ${region.key} could not be compiled: ${resultText(result)}`);
      }
    }
  }
  const headerTheme = compositionTheme(before);
  const bandColor = input.header?.band_color?.toUpperCase();
  // On a brand band, use white or the theme text, whichever reads better.
  const bandText = bandColor ? (contrastRatio('#FFFFFF', bandColor) >= contrastRatio(headerTheme.text, bandColor) ? '#FFFFFF' : headerTheme.text) : undefined;
  if (headerPlan.panel) {
    const result = await runTool(dry, 'shape_add', { report_id: reportId, page: pageId, shape: 'rectangle',
      position: headerPlan.panel, background: bandColor ?? headerTheme.background, border_radius: 8,
      style: { 'Border weight': bandColor ? 'None' : '1', 'Border color': headerTheme.muted, 'Border shadow': false } });
    if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid('The filter header could not be compiled.');
  }
  for (const entry of [...headerPlan.texts, ...(headerPlan.scope ? [headerPlan.scope] : [])]) {
    const result = await runTool(dry, 'text_add', { report_id: reportId, page: pageId, text: entry.text,
      position: entry.box, font_size: entry.fontSize, bold: entry.bold,
      ...(headerPlan.panel ? { color: bandText ?? (entry === headerPlan.scope ? headerTheme.muted : headerTheme.text), style: { Font: headerTheme.font } } : {}) });
    if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid('The page header could not be compiled.');
  }
  if (controls && controlPlan) await compilePageControls(dry, reportId, pageId, controls.controls, controlPlan);
  if (input.tabs) await compile('$tabs', { template_id: 'common-navbar', bindings: {}, navigation: { ...input.tabs, layout: 'horizontal', align: 'start' },
    position: { left: headerLeft, top: padding + headerPlan.height }, size: { width: headerWidth, height: TAB_ROW } });
  if (input.sidebar && layout.sidebar) {
    await compile('$sidebar', { template_id: 'common-navbar', bindings: {}, texts: { title: input.sidebar.title ?? '' },
      navigation: { ...input.sidebar.navigation, layout: 'vertical' }, ...layout.sidebar });
  }
  for (const [index, item] of items.entries()) {
    const { key, span: _span, height: _height, ...recipe } = item;
    await compile(key, { ...recipe, ...layout.items[index]! });
  }
  const after = await dry.session.load(reportId), built = after.page.find(p => p.pageId === pageId)!;
  if (!isDeepStrictEqual(before.report, after.report) || !isDeepStrictEqual(before.navigationInfo, after.navigationInfo)
    || !isDeepStrictEqual(before.page.filter(p => p.pageId !== pageId), after.page.filter(p => p.pageId !== pageId)))
    throw invalid('Page composition unexpectedly changed content outside its target page.');
  const components = built.page.componentConfig ?? [], groups = built.page.groupConfig ?? [];
  if (controls) {
    const chartIds = new Set(compiled.filter(item => item.key !== '$sidebar' && item.key !== '$tabs').flatMap(item => item.component_ids as string[]));
    for (const component of components) if (chartIds.has(String(component.componentId))) {
      const properties = (component.propertyConfig as Json | undefined)?.componentProperty;
      if (properties) delete properties.dateDuration;
    }
  }
  for (const component of components) {
    const box = boxOf(component);
    if (box.left < padding || box.top < padding || box.left + box.width > canvas.width - padding || box.top + box.height > canvas.height - padding)
      throw invalid(`Compiled component ${component.componentId} exceeds its page margins.`);
  }
  const regionSummary = regionPlan?.regions.map(region => ({ key: region.key, kind: region.kind, title: region.title,
    position: { left: region.box.left, top: region.box.top }, size: { width: region.box.width, height: region.box.height },
    design: { surface: 'outlined', heading: 'plain', ...input.design, ...input.regions!.find(r => r.key === region.key)?.design },
    items: region.items.map(item => compiled.find(child => child.key === item.key)) }));
  const summary = { ...(input.appearance ? { appearance: input.appearance } : {}), ...(regionSummary ? { regions: regionSummary } : {}), report_id: reportId, page_id: pageId, canvas, columns: layout.columns, items: compiled,
    component_count: components.length, group_count: groups.length, header_height: headerHeight, ...(controls ? { header_layout: headerPlan.inline ? 'inline' : 'stacked' } : {}), controls_count: controlPlan?.entries.length ?? 0, fit_height: fitHeight, notes: layout.notes };
  if (input.preview) return text(JSON.stringify({ ...summary, saved: false, preview: true }, null, 2));
  const saved = await ctx.session.editPage(reportId, pageId, (page, doc) => {
    requireEmpty(doc, page, replacing);
    if (!isDeepStrictEqual(original.page, page.page) || !isDeepStrictEqual(original.chartCondition, page.chartCondition)
      || !isDeepStrictEqual(before.report, doc.report) || !isDeepStrictEqual(before.navigationInfo, doc.navigationInfo))
      throw invalid('The destination changed after preflight. Read it and retry.');
    page.page.componentConfig = structuredClone(components);
    page.page.groupConfig = structuredClone(groups);
    if (replacing) page.chartCondition = structuredClone(built.chartCondition ?? []);
    const attributes = (((page.page.attributeConfig ??= {}) as Json).pageAttribute ??= {});
    attributes.width = canvas.width; attributes.height = canvas.height;
  }, replacing ? 'rebuild automatically arranged component page' : 'add automatically arranged component page');
  // The logo is an upload, so it follows the page save as its own step. A
  // failed upload leaves the saved page intact and is reported, not hidden.
  let logo: Record<string, unknown> | undefined;
  if (input.header?.logo && headerPlan.logo && !ctx.dryRun) {
    const result = await runTool(ctx, 'image_add', { report_id: reportId, page: pageId, image: input.header.logo.image,
      ...(input.header.logo.alt_text ? { alt_text: input.header.logo.alt_text } : {}), position: headerPlan.logo,
      // A logo is not a card: no theme surface, border or shadow around it.
      style: { Background: 'transparent', 'Border weight': 'None', 'Border shadow': false } });
    logo = result.isError || /Not applied:/i.test(resultText(result)) ? { added: false, position: headerPlan.logo, error: resultText(result).slice(0, 300) } : { added: true, position: headerPlan.logo };
  }
  return { ...text(JSON.stringify({ ...summary, ...(logo ? { logo } : {}), ...(replacing ? { replaced } : {}), saved: !ctx.dryRun, preview: !!ctx.dryRun, version: saved.version, undo_revision: saved.snapshot }, null, 2)),
    audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: 'automatic component page' } };
}
