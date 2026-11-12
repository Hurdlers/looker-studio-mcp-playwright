import { isDeepStrictEqual } from 'node:util';

import { dryRunContext } from '../../core/dryrun.js';
import { boxOf, resolvePage } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { resultText, runTool, text, type ToolContext, type ToolResult } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { isCommonTemplate } from './common.js';
import { isComposition, type CompositionInput } from './composition.js';
import { invalid } from './store.js';
import { fitPageCanvas } from './canvas.js';

type Json = Record<string, any>;
export interface UpdateTemplateInput extends CompositionInput {
  component_id?: string | undefined;
  group_id?: string | undefined;
}
interface Target { components: Json[]; group?: Json; }

function references(value: unknown, ids: Set<string>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some(v => references(v, ids));
  return !!value && typeof value === 'object' && Object.values(value).some(v => references(v, ids));
}
function targetOf(doc: ReportDoc, page: PageDoc, input: UpdateTemplateInput): Target {
  const all = (page.page.componentConfig ?? []) as Json[], groups = (page.page.groupConfig ?? []) as Json[];
  if (new Set(all.map(c => c.componentId)).size !== all.length || new Set(groups.map(g => g.groupId)).size !== groups.length)
    throw invalid('Duplicate target-page identifiers prevent a safe update.');
  const group = input.group_id ? groups.find(g => g.groupId === input.group_id) : undefined;
  if (input.group_id && !group) throw invalid(`No group ${input.group_id} on the selected page.`);
  const ids: string[] = group ? group.componentId ?? [] : [input.component_id!];
  if (!ids.length || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length)
    throw invalid('The target group has empty or duplicate membership.');
  const components = ids.map(id => {
    const found = all.find(c => c.componentId === id);
    if (!found) throw invalid(`Target component ${id} is missing from the selected page.`);
    return found;
  });
  const selected = new Set(ids);
  const slots = all.flatMap((c, i) => selected.has(c.componentId) ? [i] : []);
  if (group && slots[slots.length - 1]! - slots[0]! + 1 !== slots.length)
    throw invalid('The group is interleaved with unrelated page elements. Keep its members together before replacing the template so stacking order is preserved.');
  if (groups.some(g => g !== group && ((g.componentId ?? []).some((id: string) => selected.has(id)) || (g.childGroupId ?? []).includes(input.group_id))))
    throw invalid('The target belongs to another group or shares members. Update an independent, flat composition.');
  if (group) {
    const p = group.propertyConfig?.groupProperty ?? {}, a = group.attributeConfig?.groupAttribute ?? {};
    if ((group.childGroupId ?? []).length || group.datasourceId || group.conceptDefs?.length || p.filters?.length || p.dateRangeDimension || Object.keys(p.dataset ?? {}).length)
      throw invalid('Nested groups and group-bound data sources, fields or filters cannot be updated as a common composition.');
    const supported = new Set(['filters', 'inheritFilters', 'controlStatePassThrough', 'backgroundAndBorderProperty', 'groupAlignment', 'sectionType', 'dataset', 'dateRangeDimension']);
    if (Object.keys(p).some(k => !supported.has(k)) || Object.keys(group).some(k => !['groupId', 'componentId', 'childGroupId', 'conceptDefs', 'propertyConfig', 'attributeConfig', 'datasourceId'].includes(k)))
      throw invalid('Unsupported group settings prevent a safe composition update.');
    if (Object.keys(group.propertyConfig ?? {}).some(k => k !== 'groupProperty') || Object.keys(group.attributeConfig ?? {}).some(k => k !== 'groupAttribute') || Object.keys(a).some(k => !['left', 'top', 'width', 'height', 'rotation', 'flipHorizontal', 'flipVertical'].includes(k)))
      throw invalid('Unsupported group attributes prevent a safe composition update.');
    if (a.rotation || a.flipHorizontal || a.flipVertical) throw invalid('Rotated or flipped groups cannot be laid out as a common composition.');
  }
  if ((page.chartCondition ?? []).some(c => selected.has(String(c.chartId))))
    throw invalid('The target has conditional formatting. Remove or update those rules explicitly before replacing its template configuration.');
  // External lines, actions or other native references must not silently point
  // at a removed member or at a member whose analytical meaning has changed.
  const outside = structuredClone(doc);
  const outsidePage = outside.page.find(p => p.pageId === page.pageId)!;
  outsidePage.page.componentConfig = all.filter(c => !selected.has(c.componentId));
  outsidePage.page.groupConfig = groups.filter(g => g !== group);
  if (references(outside, new Set([...ids, ...(group ? [group.groupId] : [])])))
    throw invalid('Other report content references this target. Update those references explicitly before replacing the template.');
  return { components, ...(group ? { group } : {}) };
}
function replaceStrings(value: any, replacements: Map<string, string>): any {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map(v => replaceStrings(v, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceStrings(v, replacements)]));
  return value;
}
function role(c: Json): string {
  const link = c.propertyConfig?.componentProperty?.buttonProperty?.internalLink;
  return `${c.type}:${c.preset ?? ''}${c.type === 'button' ? `:${link ?? ''}` : ''}`;
}
function retainIds(built: Json[], existing: Json[], single: boolean): Json[] {
  const remaining = [...existing];
  return built.map(component => {
    const index = single ? 0 : remaining.findIndex(c => role(c) === role(component));
    const old = index < 0 ? undefined : remaining.splice(index, 1)[0];
    if (!old) return structuredClone(component);
    const replacements = new Map<string, string>([[component.componentId, old.componentId]]);
    const prior = old.conceptDefs ?? [];
    for (const [i, definition] of (component.conceptDefs ?? []).entries()) {
      const previous = prior[i];
      if (typeof definition.name === 'string' && typeof previous?.name === 'string') replacements.set(definition.name, previous.name);
      if (typeof definition.id === 'string' && typeof previous?.id === 'string') replacements.set(definition.id, previous.id);
    }
    const next = replaceStrings(component, replacements);
    if (old.alias !== undefined) next.alias = old.alias;
    // The service materializes automatic table row heights as an empty array.
    // Keep that equivalent native representation instead of saving it away on
    // every otherwise-identical section update. Nonempty explicit heights reset.
    const oldRows = old.propertyConfig?.componentProperty?.tableProperty?.rowsHeight;
    const table = next.propertyConfig?.componentProperty?.tableProperty;
    if (Array.isArray(oldRows) && oldRows.length === 0 && table && table.rowsHeight === undefined) table.rowsHeight = [];
    const alias = old.attributeConfig?.componentAttribute?.alias;
    if (alias !== undefined) ((next.attributeConfig ??= {}).componentAttribute ??= {}).alias = alias;
    return next;
  });
}

/** Recompile the desired built-in recipe in isolation, then replace only the
 * explicit target in one page save. Optional recipe inputs use creation defaults;
 * this is deliberately not an inferred patch of an unknown native component. */
export async function updateTemplate(ctx: ToolContext, input: UpdateTemplateInput): Promise<ToolResult> {
  const composition = isComposition(input.template_id);
  if (!composition && !isCommonTemplate(input.template_id)) throw invalid('Only built-in common templates support template updates.');
  if (Boolean(input.component_id) === Boolean(input.group_id) || composition !== Boolean(input.group_id))
    throw invalid('Give group_id for a composition, or component_id for one common chart, but not both.');
  const reportId = parseReportId(input.report_id), before = await ctx.session.load(reportId);
  // Without page, locate the explicit target rather than defaulting to page one.
  const candidates = before.page.filter(p => input.group_id ? p.page.groupConfig?.some(g => g.groupId === input.group_id) : p.page.componentConfig?.some(c => c.componentId === input.component_id));
  if (candidates.length !== 1) throw invalid('The target must identify exactly one page-local component or group.');
  const pageId = input.page === undefined ? candidates[0]!.pageId : resolvePage(before, input.page);
  const original = before.page.find(p => p.pageId === pageId)!;
  const target = targetOf(before, original, input);
  if (!composition && !ctx.ext.kindOf(target.components[0]!)) throw invalid('component_id must identify a chart; use group_id for a composition.');
  const boxes = target.components.map(c => boxOf(c));
  const left = Math.min(...boxes.map(b => b.left)), top = Math.min(...boxes.map(b => b.top));
  const position = input.position ?? { left, top };
  const size = input.size ?? { width: Math.max(...boxes.map(b => b.left + b.width)) - left, height: Math.max(...boxes.map(b => b.top + b.height)) - top };
  const sources = [...new Set(target.components.map(c => c.datasourceId).filter((id): id is string => typeof id === 'string' && !!id))];
  const dataSource = input.data_source ?? (sources.length === 1 ? sources[0] : undefined);
  if (input.template_id !== 'common-navbar' && !dataSource) throw invalid('The target source is missing or ambiguous. Give data_source explicitly for this update.');
  const dry = dryRunContext(ctx).ctx, selected = new Set(target.components.map(c => c.componentId));
  const dryBefore = await dry.session.load(reportId);
  if (!isDeepStrictEqual(original.page, dryBefore.page.find(p => p.pageId === pageId)?.page) || !isDeepStrictEqual(before.report, dryBefore.report) || !isDeepStrictEqual(before.navigationInfo, dryBefore.navigationInfo))
    throw invalid('The report changed while preparing this update. Read the target and retry.');
  await dry.session.editPage(reportId, pageId, p => {
    p.page.componentConfig = (p.page.componentConfig ?? []).filter(c => !selected.has(c.componentId));
    if (target.group) p.page.groupConfig = (p.page.groupConfig ?? []).filter(g => g.groupId !== target.group!.groupId);
  }, 'prepare template update');
  const { component_id: _component, group_id: _group, ...recipe } = input;
  const result = await runTool(dry, 'component_template_add', { ...recipe, ...(dataSource ? { data_source: dataSource } : {}), page: pageId, position, size, preview: false });
  if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid(`Template update preflight failed: ${resultText(result)}`);
  const after = await dry.session.load(reportId), compiledPage = after.page.find(p => p.pageId === pageId)!;
  if (!isDeepStrictEqual(before.report, after.report)) throw invalid('A template update cannot change report-level settings.');
  const originalIds = new Set((original.page.componentConfig ?? []).map(c => c.componentId));
  const created = (compiledPage.page.componentConfig ?? []).filter(c => !originalIds.has(c.componentId)) as Json[];
  if ((!composition && created.length !== 1) || (composition && (created.length < 2 || created.length > 50))) throw invalid('Unexpected number of compiled template members.');
  const components = retainIds(created, target.components, !composition);
  const nextGroup = target.group ? structuredClone(target.group) : undefined;
  if (nextGroup) {
    nextGroup.componentId = components.map(c => c.componentId);
    const attributes = nextGroup.attributeConfig?.groupAttribute;
    if (attributes) for (const [key, value] of Object.entries({ ...position, ...size })) if (key in attributes) attributes[key] = value;
  }
  const fitted = structuredClone(original);
  const canvas = fitPageCanvas(fitted, before, [{ ...position, ...size }]);
  const unchanged = isDeepStrictEqual(target.components, components) && isDeepStrictEqual(target.group, nextGroup)
    && isDeepStrictEqual(original.page.attributeConfig, fitted.page.attributeConfig);
  const summary = { template_id: input.template_id, report_id: reportId, page_id: pageId, position, size, canvas,
    component_ids: components.map(c => c.componentId), component_count: components.length,
    ...(nextGroup ? { group_id: nextGroup.groupId } : {}), unchanged,
    notes: ['전체 구성 입력입니다. 생략한 제목·기간·분석 옵션은 템플릿 기본값을 사용하고, 위치와 크기만 생략 시 기존 값을 유지합니다.'],
  };
  if (input.preview || unchanged) return text(JSON.stringify({ ...summary, saved: false, preview: !!input.preview || !!ctx.dryRun }, null, 2));
  const saved = await ctx.session.editPage(reportId, pageId, (page, doc) => {
    const current = targetOf(doc, page, input);
    if (!isDeepStrictEqual(target, current) || !isDeepStrictEqual(before.report, doc.report) || !isDeepStrictEqual(before.navigationInfo, doc.navigationInfo))
      throw invalid('The target or its report settings changed while preparing the update. Read it and retry.');
    const list = page.page.componentConfig ?? [], at = list.findIndex(c => selected.has(c.componentId));
    const untouched = list.filter(c => !selected.has(c.componentId));
    // Preserve the target's existing stacking position among other content.
    const insertion = list.slice(0, at).filter(c => !selected.has(c.componentId)).length;
    untouched.splice(insertion, 0, ...structuredClone(components));
    page.page.componentConfig = untouched;
    if (nextGroup) page.page.groupConfig = (page.page.groupConfig ?? []).map(g => g.groupId === nextGroup.groupId ? structuredClone(nextGroup) : g);
    fitPageCanvas(page, doc, [{ ...position, ...size }]);
  }, `update common template ${input.template_id}`);
  return { ...text(JSON.stringify({ ...summary, saved: !ctx.dryRun, preview: !!ctx.dryRun, version: saved.version, undo_revision: saved.snapshot }, null, 2)),
    audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: `update common template ${input.template_id}` } };
}
