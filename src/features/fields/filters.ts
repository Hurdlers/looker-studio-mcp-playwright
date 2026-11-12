import { z } from 'zod';

import { resolveSource } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc, WriteResult } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { filterDefinition } from '../chart-options/filters.js';
import { filtersInput } from '../chart-options/inputs.js';
import { reportIdOf } from '../data-sources/inputs.js';
import { id, invalid, nonempty, reportInput, type Json } from './common.js';

const entries = (doc: ReportDoc): Json[] => (doc.report.resource as Json | undefined)?.filter?.entry ?? [];
function find(doc: ReportDoc, name: string): Json {
  const list = entries(doc), hits = list.filter((e) => e.value.name === name);
  if (!hits.length) throw new LookerError('not_found', `No filter "${name}". Available filters: ${list.map((e) => e.value.name).join(', ') || '(none)'}.`);
  if (hits.length > 1) throw invalid(`Several filters are named "${name}". Give them different names before editing.`);
  return hits[0]!;
}

// Return every actual filter list, including nested groups. Only lists named
// filters are visited; other arrays and filter definitions remain untouched.
function references(root: Json): Array<{ object: Json; before: string[] }> {
  const lists: Array<{ object: Json; before: string[] }> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const object = node as Json;
    if (Array.isArray(object.filters)) lists.push({ object, before: [...object.filters] });
    for (const [key, child] of Object.entries(object)) if (key !== 'filters') walk(child);
  };
  walk(root);
  return lists;
}

async function deleteFilter(ctx: ToolContext, reportId: string, doc: ReportDoc, name: string, key: string): Promise<WriteResult> {
  const changed: Array<{ pageId: string; page: Json }> = [];
  try {
    for (const page of doc.page) {
      if (!references(page.page).some((r) => r.before.includes(key))) continue;
      await ctx.session.editPage(reportId, page.pageId, (p) => {
        for (const r of references(p.page)) r.object.filters = r.before.filter((k) => k !== key);
      }, `remove filter ${name} references`);
      changed.push({ pageId: page.pageId, page: structuredClone(page.page) });
    }
    return await ctx.session.editReport(reportId, (d) => {
      const current = find(d, name);
      if (current.key !== key) throw invalid('The filter changed while deleting. Read the filters and try again.');
      for (const r of references(d.report)) r.object.filters = r.before.filter((k) => k !== key);
      const filter = (d.report.resource as Json).filter;
      filter.entry = entries(d).filter((e) => e.key !== key);
    }, `delete filter ${name}`);
  } catch (error) {
    let failed = false;
    for (const saved of changed.reverse()) {
      try {
        await ctx.session.editPage(reportId, saved.pageId, (p) => {
          // Reinsert only references removed by this operation. Keep unrelated
          // edits made since then and match owners by component id or scope.
          const restore = (old: Json, fresh: Json) => {
            if (Array.isArray(old.filters) && old.filters.includes(key)) {
              const current = (fresh.filters ??= []) as string[];
              if (!current.includes(key)) current.splice(Math.min(old.filters.indexOf(key), current.length), 0, key);
            }
            for (const [k, v] of Object.entries(old)) {
              if (k === 'filters' || !v || typeof v !== 'object') continue;
              if (Array.isArray(v)) {
                for (let i = 0; i < v.length; i++) {
                  const item = v[i];
                  if (!item || typeof item !== 'object') continue;
                  const list = fresh[k] as Json[] | undefined;
                  const target = item.componentId ? list?.find((x) => x.componentId === item.componentId) : list?.[i];
                  if (target) restore(item, target);
                }
              } else if (fresh[k] && typeof fresh[k] === 'object') restore(v, fresh[k]);
            }
          };
          restore(saved.page, p.page);
        }, `undo filter ${name} references`);
      } catch { failed = true; }
    }
    if (failed) throw new LookerError('format_changed', `Filter deletion failed and some page references could not be restored. Read the report and restore its prior revision. Cause: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export const reportFilterEdit = defineTool({
  name: 'report_filter_edit', title: 'Edit a saved report filter',
  description: 'Changes, duplicates or deletes a saved report filter by its exact name. Use a name alone inside filter to rename while keeping all existing conditions.',
  input: {
    report_id: reportInput, name: nonempty('목록에 보이는 기존 필터 이름. 대소문자까지 같아야 합니다.'),
    action: z.enum(['edit', 'duplicate', 'delete']).describe('edit은 수정, duplicate는 복제, delete는 삭제입니다.'),
    filter: filtersInput.element.optional().describe('edit에 필요한 새 이름과 조건. 이름만 주면 기존 조건을 보존합니다.'),
  },
  write: true,
  run: async (ctx, a) => {
    if (a.action === 'edit' ? !a.filter : a.filter !== undefined) throw invalid(a.action === 'edit' ? 'Editing requires filter with a name and optional conditions.' : 'filter is only accepted when action is edit.');
    const reportId = reportIdOf(a.report_id), doc = await ctx.session.load(reportId), found = find(doc, a.name);
    let result: WriteResult, response: string;
    if (a.action === 'delete') {
      result = await deleteFilter(ctx, reportId, doc, a.name, found.key);
      response = `Deleted filter "${a.name}".`;
    } else if (a.action === 'duplicate') {
      const key = id('filter');
      let name = `Copy of ${a.name}`, suffix = 2;
      while (entries(doc).some((e) => e.value.name === name)) name = `Copy of ${a.name} (${suffix++})`;
      result = await ctx.session.editReport(reportId, (d) => {
        const original = find(d, a.name);
        if (entries(d).some((e) => e.key === key)) return;
        entries(d).push({ key, value: { ...structuredClone(original.value), name } });
      }, `duplicate filter ${a.name}`);
      response = `Duplicated filter as "${name}" (${key}).`;
    } else {
      const spec = a.filter!;
      const hasConditions = ['field', 'condition', 'values', 'exclude', 'clauses'].some((k) => (spec as Json)[k] !== undefined);
      if (!hasConditions && spec.name === a.name) return text(`Nothing changed in filter "${a.name}".`);
      if (entries(doc).some((e) => e.key !== found.key && e.value.name === spec.name)) throw invalid(`A filter named "${spec.name}" already exists. Choose another name.`);
      const definition = hasConditions ? filterDefinition(spec, (await resolveSource(ctx.rap, doc, found.value.datasourceId)).fields) : undefined;
      result = await ctx.session.editReport(reportId, (d) => {
        const current = find(d, a.name);
        if (current.key !== found.key) throw invalid('The filter changed while editing. Read the filters and try again.');
        current.value.name = spec.name;
        if (definition) current.value.filterDefinition = structuredClone(definition);
      }, `edit filter ${a.name}`);
      response = `Updated filter "${spec.name}".`;
    }
    return { ...text(response), audit: { reportId, version: result.version, ...(result.snapshot ? { snapshot: result.snapshot } : {}) } };
  },
});
