import { isDeepStrictEqual } from 'node:util';
import type { PageDoc } from '../../core/session.js';
import type { ToolContext } from '../../core/tool.js';
import { resolvePage } from '../../core/page.js';
import { groupId } from '../layout/model.js';
import { invalid, type Action, type Json, type SpecGroup } from './model.js';

type Restore = NonNullable<Action['groupsRestore']>;

export function validateRestoreAction(action: Action): void {
  const restore = action.groupsRestore;
  if (!restore || action.tool !== 'component_arrange' || !restore.groups.length) throw invalid('Invalid internal group restoration action.');
  const indices = new Set<number>();
  for (const member of restore.members) {
    if (!Number.isInteger(member.index) || member.index < 0 || indices.has(member.index)) throw invalid('Invalid or duplicate group component binding.');
    if ((member.componentId === undefined) === (member.ref === undefined)) throw invalid('A group member needs exactly one existing ID or generated reference.');
    if (member.ref !== undefined && !Number.isInteger(member.ref)) throw invalid('Invalid generated group member reference.');
    if (member.componentId !== undefined && !member.componentId) throw invalid('An existing group member needs a component ID.');
    indices.add(member.index);
  }
  for (const group of restore.groups) for (const index of group.components) if (!indices.has(index)) throw invalid(`Group "${group.key}" has no component binding for index ${index}.`);
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalized(v)]));
}
function groupSettings(group: Json): Json {
  const p = group.propertyConfig?.groupProperty ?? {};
  const appearance: Json = {};
  for (const key of ['sectionType', 'groupAlignment', 'backgroundAndBorderProperty']) if (p[key] !== undefined) appearance[key] = p[key];
  return { ...(p.inheritFilters !== undefined ? { inherit_filters: p.inheritFilters } : {}),
    ...(p.controlStatePassThrough !== undefined ? { control_state_passthrough: p.controlStatePassThrough } : {}),
    attributes: group.attributeConfig?.groupAttribute ?? {}, appearance };
}
function wantedSettings(group: SpecGroup): Json {
  return { ...(group.inherit_filters !== undefined ? { inherit_filters: group.inherit_filters } : {}),
    ...(group.control_state_passthrough !== undefined ? { control_state_passthrough: group.control_state_passthrough } : {}),
    attributes: group.attributes ?? {}, appearance: group.appearance ?? {} };
}
function sameIds(a: unknown, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
}
function compatible(group: Json, wanted: SpecGroup, members: string[], children: string[]): boolean {
  const p = group.propertyConfig?.groupProperty ?? {};
  const allowed = new Set(['filters', 'inheritFilters', 'controlStatePassThrough', 'backgroundAndBorderProperty', 'groupAlignment', 'sectionType', 'dataset', 'dateRangeDimension']);
  return Object.keys(p).every(key => allowed.has(key)) && !p.dateRangeDimension && !Object.keys(p.dataset ?? {}).length &&
    !(group.conceptDefs?.length) && !group.datasourceId && !(p.filters?.length) &&
    sameIds(group.componentId ?? [], members) && sameIds(group.childGroupId ?? [], children) &&
    isDeepStrictEqual(normalized(groupSettings(group)), normalized(wantedSettings(wanted)));
}

/** Resolves the complete desired forest before saving. Existing groups are
 * reused only when membership, hierarchy and scoped settings match exactly. */
function additionsFor(page: PageDoc, groups: SpecGroup[], members: Map<number, string>, proposedIds: Map<string, string>): Json[] {
  const components = new Set((page.page.componentConfig ?? []).map(c => String(c.componentId)));
  for (const id of members.values()) if (!components.has(id)) throw invalid(`A group member is missing from the target page: ${id}.`);
  const existing = (page.page.groupConfig ?? []) as Json[];
  if (existing.some(g => typeof g.groupId !== 'string' || !g.groupId) || new Set(existing.map(g => g.groupId)).size !== existing.length)
    throw invalid('The target page has missing or duplicate group IDs.');
  const byKey = new Map(groups.map(g => [g.key, g]));
  const mapped = new Map<string, string>(), additions: Json[] = [], visiting = new Set<string>();
  const resolve = (key: string): string => {
    const known = mapped.get(key); if (known) return known;
    const group = byKey.get(key); if (!group || visiting.has(key)) throw invalid('A group references a missing child or a cycle.');
    visiting.add(key);
    const childIds = group.children.map(resolve), componentIds = group.components.map(index => {
      const id = members.get(index); if (!id) throw invalid(`A group member was not created (component index ${index}).`); return id;
    });
    const hits = existing.filter(candidate => compatible(candidate, group, componentIds, childIds));
    if (hits.length > 1) throw invalid(`More than one existing group matches "${key}"; no groups were changed.`);
    const id = hits[0]?.groupId ?? proposedIds.get(key)!;
    if (!hits.length && existing.some(g => g.groupId === id)) throw invalid('A proposed group ID already exists; retry group restoration.');
    mapped.set(key, id); visiting.delete(key);
    if (!hits.length) additions.push({ groupId: id, componentId: componentIds, childGroupId: childIds, conceptDefs: [],
      propertyConfig: { groupProperty: { filters: [],
        ...(group.inherit_filters === undefined ? {} : { inheritFilters: group.inherit_filters }),
        ...(group.control_state_passthrough === undefined ? {} : { controlStatePassThrough: group.control_state_passthrough }),
        ...structuredClone(group.appearance ?? {}) } },
      attributeConfig: { groupAttribute: structuredClone(group.attributes ?? {}) },
    });
    return id;
  };
  for (const group of groups) resolve(group.key);
  // Never silently regroup pre-existing elements or change their filter scope.
  const desiredParent = new Map<string, string>();
  for (const group of groups) {
    const parent = mapped.get(group.key)!;
    for (const index of group.components) desiredParent.set(members.get(index)!, parent);
    for (const child of group.children) desiredParent.set(mapped.get(child)!, parent);
  }
  for (const [id, parent] of desiredParent) {
    const owners = existing.filter(g => (g.componentId ?? []).includes(id) || (g.childGroupId ?? []).includes(id));
    if (owners.some(g => g.groupId !== parent) || owners.length > 1) throw invalid(`Group restoration would change existing ownership of ${id}; no groups were changed.`);
  }
  // Desired roots must not inherit an unrelated existing parent group.
  for (const group of groups) {
    const id = mapped.get(group.key)!;
    if (!desiredParent.has(id) && existing.some(g => (g.childGroupId ?? []).includes(id))) throw invalid(`Group "${group.key}" already belongs to another group.`);
  }
  return additions;
}

export async function restoreGroups(ctx: ToolContext, reportId: string, pageRef: string | number | undefined, restore: Restore, captured: Map<number, string>): Promise<string> {
  const members = new Map<number, string>();
  for (const member of restore.members) {
    const id = member.componentId ?? captured.get(member.ref!);
    if (!id) throw invalid(`A group member was not created (component index ${member.index}). Group restoration was not saved.`);
    members.set(member.index, id);
  }
  if (new Set(members.values()).size !== members.size) throw invalid('Several spec components resolved to the same group member.');
  const doc = await ctx.session.load(reportId), pageId = resolvePage(doc, pageRef), page = doc.page.find(p => p.pageId === pageId)!;
  const proposed = new Map(restore.groups.map(g => [g.key, groupId()]));
  if (!additionsFor(page, restore.groups, members, proposed).length) return 'Component groups already match; nothing changed.';
  let count = 0;
  const saved = await ctx.session.editPage(reportId, pageId, target => {
    const additions = additionsFor(target, restore.groups, members, proposed);
    count = additions.length;
    (target.page.groupConfig ??= []).push(...additions);
  }, 'restore component groups');
  return `Restored ${count} component group(s) on page ${pageId} (version ${saved.version}).`;
}
