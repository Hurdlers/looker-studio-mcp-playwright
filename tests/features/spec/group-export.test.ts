import { describe, expect, it } from 'vitest';
import type { PageDoc } from '../../../src/core/session.js';
import { exportGroups } from '../../../src/features/spec/groups.js';

const elements = [{ componentId: 'cd-one', type: 'simple-description' }, { componentId: 'cd-two', type: 'simple-description' }];
const converted = [{ component: 'text', text: 'one' }, { component: 'text', text: 'two' }];
const group = (groupId: string, componentId: string[], childGroupId: string[] = []) => ({
  groupId, componentId, childGroupId, conceptDefs: [],
  propertyConfig: { groupProperty: { filters: [], inheritFilters: true, controlStatePassThrough: false, sectionType: 0 } },
  attributeConfig: { groupAttribute: {} },
});
const page = (groups: unknown[]): PageDoc => ({ pageId: 'page-one', page: { componentConfig: structuredClone(elements), groupConfig: groups as Record<string, unknown>[] } });

describe('portable component group export', () => {
  it('omits absent groups and replaces native identities with local indices and keys', () => {
    expect(exportGroups(page([]), converted)).toBeUndefined();
    const source = page([group('g-private', ['cd-two', 'cd-one'])]);
    const before = structuredClone(source);
    expect(exportGroups(source, converted)).toEqual([{
      key: 'g1', components: [1, 0], children: [], inherit_filters: true, control_state_passthrough: false,
      appearance: { sectionType: 0 },
    }]);
    expect(source).toEqual(before);
  });
  it('retains nesting, explicit false and omitted flags without inventing defaults', () => {
    const outer = group('g-outer', [], ['g-inner']);
    const inner = { groupId: 'g-inner', componentId: ['cd-one', 'cd-two'], childGroupId: [] };
    outer.propertyConfig.groupProperty.inheritFilters = false;
    const output = exportGroups(page([outer, inner]), converted)!;
    expect(output[0]).toMatchObject({ components: [], children: ['g2'], inherit_filters: false, control_state_passthrough: false });
    expect(output[1]).toEqual({ key: 'g2', components: [0, 1], children: [] });
  });
  it('rejects missing members, cycles and multiple direct owners', () => {
    expect(() => exportGroups(page([group('a', ['missing'])]), converted)).toThrow(/not a component/);
    expect(() => exportGroups(page([group('a', [], ['b']), group('b', [], ['a'])]), converted)).toThrow(/cycle/);
    expect(() => exportGroups(page([group('a', ['cd-one']), group('b', ['cd-one'])]), converted)).toThrow(/duplicate group ownership/);
  });
  it('refuses bound filters and fields instead of exporting an unfiltered group', () => {
    const a = group('a', ['cd-one', 'cd-two']);
    (a.propertyConfig.groupProperty.filters as string[]).push('filter-original');
    expect(() => exportGroups(page([a]), converted)).toThrow(/group-level filters/);
    const b = { ...group('b', ['cd-one']), datasourceId: 'private-source' };
    expect(() => exportGroups(page([b]), converted)).toThrow(/group-bound data source/);
    const c = { ...group('c', ['cd-one']), conceptDefs: [{ name: 'original-field' }] };
    expect(() => exportGroups(page([c]), converted)).toThrow(/group-bound field/);
  });
  it('does not silently drop unsupported group members or arbitrary appearance properties', () => {
    expect(() => exportGroups(page([group('a', ['cd-one'])]), [{ component: 'other' }, converted[1]!])).toThrow(/unsupported component/);
    const a = group('a', ['cd-one']);
    (a.attributeConfig.groupAttribute as Record<string, unknown>).sourceId = 'private-source';
    expect(() => exportGroups(page([a]), converted)).toThrow(/unsupported group properties/);
    const b = group('b', ['cd-one']);
    (b.propertyConfig.groupProperty as Record<string, unknown>).backgroundAndBorderProperty = { background: { color: '#FFFFFF', sourceId: 'private-source' } };
    expect(() => exportGroups(page([b]), converted)).toThrow();
  });
});
