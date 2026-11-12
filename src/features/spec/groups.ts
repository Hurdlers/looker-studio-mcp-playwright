import type { PageDoc } from '../../core/session.js';
import { invalid, type Json, type SpecGroup } from './model.js';
import { validatePageGroups } from './group-schema.js';

const topKeys = new Set(['groupId', 'componentId', 'childGroupId', 'conceptDefs', 'propertyConfig', 'attributeConfig', 'datasourceId']);
const propertyKeys = new Set(['filters', 'inheritFilters', 'controlStatePassThrough', 'backgroundAndBorderProperty', 'groupAlignment', 'sectionType', 'dataset', 'dateRangeDimension']);
const attributeKeys = new Set(['top', 'left', 'width', 'height', 'rotation', 'flipHorizontal', 'flipVertical']);
const owns = (object: Json, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
function object(value: unknown, at: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${at}: expected an object.`);
  return value as Json;
}
function onlyKeys(value: Json, keys: ReadonlySet<string>, at: string): void {
  const unknown = Object.keys(value).filter(key => !keys.has(key));
  if (unknown.length) throw invalid(`${at}: unsupported group properties ${unknown.join(', ')}. They cannot be silently omitted.`);
}
function strings(value: unknown, at: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) throw invalid(`${at}: expected nonempty identifier strings.`);
  if (new Set(value).size !== value.length) throw invalid(`${at}: duplicate group membership.`);
  return value as string[];
}
function emptyArray(value: unknown): boolean { return value === undefined || (Array.isArray(value) && value.length === 0); }

/** Exports only portable page-local group membership and supported appearance.
 * Bound group filters/fields must be handled by a future semantic adapter;
 * refusing them is safer than silently broadening a section's data scope. */
export function exportGroups(page: PageDoc, exportedComponents: Json[], _notes?: string[]): SpecGroup[] | undefined {
  const raw = page.page.groupConfig ?? [];
  if (!raw.length) return undefined;
  const components = page.page.componentConfig ?? [];
  if (components.length !== exportedComponents.length) throw invalid(`Page ${page.pageId}: exported component indices are not aligned with the original page.`);
  const componentIndex = new Map<string, number>();
  for (const [index, component] of components.entries()) {
    if (typeof component.componentId !== 'string') continue;
    if (componentIndex.has(component.componentId)) throw invalid(`Page ${page.pageId}: duplicate component IDs prevent group export.`);
    componentIndex.set(component.componentId, index);
  }
  const keys = new Map<string, string>();
  for (const [index, value] of raw.entries()) {
    const group = object(value, `Page ${page.pageId} group ${index}`);
    if (typeof group.groupId !== 'string' || !group.groupId || keys.has(group.groupId)) throw invalid(`Page ${page.pageId}: missing or duplicate group ID.`);
    keys.set(group.groupId, `g${index + 1}`);
  }
  const out = raw.map((value, index): SpecGroup => {
    const group = value as Json, at = `Page ${page.pageId} group ${index + 1}`;
    onlyKeys(group, topKeys, at);
    if (group.datasourceId !== undefined && group.datasourceId !== '') throw invalid(`${at}: a group-bound data source is not portable yet.`);
    if (!emptyArray(group.conceptDefs)) throw invalid(`${at}: group-bound field definitions are not portable yet.`);
    const config = group.propertyConfig === undefined ? {} : object(group.propertyConfig, `${at}.propertyConfig`);
    onlyKeys(config, new Set(['groupProperty']), `${at}.propertyConfig`);
    const prop = config.groupProperty === undefined ? {} : object(config.groupProperty, `${at}.groupProperty`);
    onlyKeys(prop, propertyKeys, `${at}.groupProperty`);
    if (!emptyArray(prop.filters)) throw invalid(`${at}: group-level filters are not portable yet; exporting without them would change the data scope.`);
    if (prop.dataset !== undefined && Object.keys(object(prop.dataset, `${at}.dataset`)).length) throw invalid(`${at}: a group-bound dataset is not portable yet.`);
    if (prop.dateRangeDimension !== undefined && prop.dateRangeDimension !== '') throw invalid(`${at}: a group-bound date field is not portable yet.`);
    const key = keys.get(group.groupId)!;
    const members = strings(group.componentId, `${at}.componentId`).map(id => {
      const member = componentIndex.get(id);
      if (member === undefined) throw invalid(`${at}: member ${id} is not a component on this page.`);
      if (exportedComponents[member]!.component === 'other') throw invalid(`${at}: an unsupported component cannot be omitted from a restored group.`);
      return member;
    });
    const children = strings(group.childGroupId, `${at}.childGroupId`).map(id => {
      const child = keys.get(id);
      if (!child) throw invalid(`${at}: child group ${id} is not on this page.`);
      return child;
    });
    if (!members.length && !children.length) throw invalid(`${at}: an empty group cannot be restored.`);
    const result: SpecGroup = { key, components: members, children };
    for (const [native, portable] of [['inheritFilters', 'inherit_filters'], ['controlStatePassThrough', 'control_state_passthrough']] as const) {
      if (owns(prop, native)) {
        if (typeof prop[native] !== 'boolean') throw invalid(`${at}.${native}: expected a boolean.`);
        result[portable] = prop[native];
      }
    }
    const attrConfig = group.attributeConfig === undefined ? {} : object(group.attributeConfig, `${at}.attributeConfig`);
    onlyKeys(attrConfig, new Set(['groupAttribute']), `${at}.attributeConfig`);
    const attributes = attrConfig.groupAttribute === undefined ? {} : object(attrConfig.groupAttribute, `${at}.groupAttribute`);
    onlyKeys(attributes, attributeKeys, `${at}.groupAttribute`);
    if (Object.keys(attributes).length) result.attributes = structuredClone(attributes);
    const appearance = Object.fromEntries(['backgroundAndBorderProperty', 'groupAlignment', 'sectionType'].filter(name => owns(prop, name)).map(name => [name, structuredClone(prop[name])]));
    if (Object.keys(appearance).length) result.appearance = appearance;
    return result;
  });
  validatePageGroups({ components: exportedComponents, groups: out }, `Page ${page.pageId}`);
  return out;
}
