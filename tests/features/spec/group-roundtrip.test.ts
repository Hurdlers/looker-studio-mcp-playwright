import { describe, expect, it } from 'vitest';

import { fromMapValue } from '../../../src/core/mapvalue.js';
import { resultText, text, type Tool } from '../../../src/core/tool.js';
import { textAdd } from '../../../src/features/static/text.js';
import { CREATED, fake, ORIGINAL, SOURCE, specification, type Json } from './fake.js';

const pageOf = (doc: Json): Json => doc.page[0].page;
const group = (key: string, components: number[], children: string[] = []) => ({
  key, components, children, inherit_filters: true, control_state_passthrough: false,
});
const plainSpec = () => ({
  ...specification(), pages: [{ name: 'Overview', components: [
    { component: 'text', text: 'First', position: { left: 20, top: 20, width: 200, height: 40 } },
    { component: 'text', text: 'Second', position: { left: 20, top: 80, width: 200, height: 40 } },
  ], groups: [group('local', [0, 1])] }],
});
const parseResult = (result: Awaited<ReturnType<ReturnType<typeof fake>['run']>>): Json => JSON.parse(resultText(result));

// Group keys and native IDs are local identities. Compare membership and
// hierarchy instead of assuming an exporter retains their incidental order.
function stable(value: unknown): string {
  const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])])) : v;
  return JSON.stringify(normalize(value));
}
function topology(groups: Json[]): string[] {
  const byKey = new Map(groups.map(g => [g.key, g]));
  const describe = (g: Json): Json => ({
    components: [...g.components].sort((a, b) => a - b),
    children: (g.children ?? []).map((key: string) => describe(byKey.get(key)!)).map((v: Json) => stable(v)).sort(),
    ...(Object.hasOwn(g, 'inherit_filters') ? { inherit_filters: g.inherit_filters } : {}),
    ...(Object.hasOwn(g, 'control_state_passthrough') ? { control_state_passthrough: g.control_state_passthrough } : {}),
    ...(g.attributes && Object.keys(g.attributes).length ? { attributes: g.attributes } : {}),
    ...(g.appearance && Object.keys(g.appearance).length ? { appearance: g.appearance } : {}),
  });
  return groups.map(g => stable(describe(g))).sort();
}

async function sectionSource() {
  const f = fake();
  f.original.shareable.name = '[looker-studio-mcp-lab-1] grouped periods';
  const input = {
    report_id: ORIGINAL, template_id: 'common-overview-section',
    bindings: { metric: { field: 'value', aggregation: 'sum' }, date: 'day', dimension: 'category' },
    texts: { title: 'Period section' },
  };
  const first = parseResult(await f.run('component_template_add', { ...input, position: { left: 20, top: 20 }, date_range: '2026-11-01..2026-11-07' }));
  const second = parseResult(await f.run('component_template_add', { ...input, position: { left: 20, top: 1000 }, date_range: '2026-11-01..2026-11-03' }));
  await f.add('text_add', { text: 'Parent group label', position: { left: 20, top: 2000, width: 300, height: 40 } });
  const page = pageOf(f.original);
  // Preserve absence as well as true/false; it can mean native inheritance.
  const secondGroup = page.groupConfig.find((g: Json) => g.groupId === second.group_id);
  delete secondGroup.propertyConfig.groupProperty.inheritFilters;
  delete secondGroup.propertyConfig.groupProperty.controlStatePassThrough;
  page.groupConfig.push({
    groupId: 'g-source-parent', componentId: [page.componentConfig.at(-1).componentId],
    childGroupId: [first.group_id, second.group_id], conceptDefs: [],
    propertyConfig: { groupProperty: { inheritFilters: false, controlStatePassThrough: true, filters: [], sectionType: 0 } },
    attributeConfig: { groupAttribute: { left: 12, top: 34 } },
  });
  return f;
}

describe('component group specification roundtrip', () => {
  it('rebinds nested groups and keeps distinct control periods on one recreated source', async () => {
    const f = await sectionSource();
    const source = structuredClone(f.original);
    const originalPage = pageOf(source);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].groups).toHaveLength(3);
    expect(exported.spec.pages[0].components.filter((c: Json) => c.component === 'chart').every((c: Json) => c.project_theme === true)).toBe(true);
    expect(exported.text).not.toContain('does not preserve component groups');
    const encodedGroups = JSON.stringify(exported.spec.pages[0].groups);
    for (const g of originalPage.groupConfig) expect(encodedGroups).not.toContain(g.groupId);
    for (const c of originalPage.componentConfig) expect(encodedGroups).not.toContain(c.componentId);

    const applied = await f.run('report_spec_apply', { spec: exported.spec, name: 'Restored grouped periods' });
    expect(applied.isError, resultText(applied)).toBe(false);
    const restored = f.reports[CREATED]!;
    const restoredPage = pageOf(restored);
    expect(restoredPage.componentConfig).toHaveLength(originalPage.componentConfig.length);
    expect(restoredPage.groupConfig).toHaveLength(3);
    const oldGroupIds = new Set(originalPage.groupConfig.map((g: Json) => g.groupId));
    const newIds = new Set(restoredPage.componentConfig.map((c: Json) => c.componentId));
    const newGroups = new Set(restoredPage.groupConfig.map((g: Json) => g.groupId));
    for (const g of restoredPage.groupConfig) {
      expect(oldGroupIds.has(g.groupId)).toBe(false);
      expect((g.componentId ?? []).every((id: string) => newIds.has(id))).toBe(true);
      expect((g.childGroupId ?? []).every((id: string) => newGroups.has(id))).toBe(true);
    }
    const dates = (page: Json) => page.componentConfig.filter((c: Json) => c.type === 'simple-daterangepicker')
      .map((c: Json) => JSON.stringify(fromMapValue(c.behavior))).sort();
    expect(dates(restoredPage)).toEqual(dates(originalPage));
    expect(dates(restoredPage).join()).toContain('20261107');
    expect(dates(restoredPage).join()).toContain('20261103');
    const charts = restoredPage.componentConfig.filter((c: Json) => ['kpi-metric', 'simple-linechart', 'simple-table'].includes(c.type));
    expect(charts).toHaveLength(6);
    for (const c of charts) {
      const p = c.propertyConfig.componentProperty;
      if (c.type === 'simple-linechart') expect(p.lineChartProperty.seriesProperty[0].seriesColor).toBeUndefined();
      if (c.type === 'simple-table') expect(p.tableProperty.headerColor).toBeUndefined();
    }
    expect(charts.every((c: Json) => c.propertyConfig.componentProperty.dateDuration === undefined)).toBe(true);
    expect(new Set(charts.map((c: Json) => c.datasourceId)).size).toBe(1);
    expect(charts.every((c: Json) => c.datasourceId !== SOURCE && f.sources[c.datasourceId]?.reportId === CREATED)).toBe(true);
    for (const chart of charts) {
      const dateRole = chart.propertyConfig.componentProperty.dateRangeDimension;
      const dateConcept = chart.conceptDefs.find((c: Json) => c.name === dateRole);
      expect(dateConcept.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
    }
    const roundtrip = await f.exportSpec({ report_id: CREATED, style: 'all' });
    expect(topology(roundtrip.spec.pages[0].groups)).toEqual(topology(exported.spec.pages[0].groups));
    expect(f.original).toEqual(source);
  });

  it('keeps matching existing group IDs and membership unchanged on repeated apply', async () => {
    const f = await sectionSource();
    const spec = (await f.exportSpec()).spec;
    const before = structuredClone(pageOf(f.original));
    f.clear();
    const once = await f.run('report_spec_apply', { report_id: ORIGINAL, spec });
    expect(once.isError, resultText(once)).toBe(false);
    expect(pageOf(f.original)).toEqual(before);
    expect(f.writes()).toEqual([]);
    const twice = await f.run('report_spec_apply', { report_id: ORIGINAL, spec });
    expect(twice.isError, resultText(twice)).toBe(false);
    expect(pageOf(f.original)).toEqual(before);
    expect(f.writes()).toEqual([]);
  });

  it('does not borrow an unrelated target source when a single-source grouped spec omits data_source', async () => {
    const f = await sectionSource();
    const spec = (await f.exportSpec()).spec;
    const groupedCharts = spec.pages[0].components.filter((c: Json) => c.component === 'chart');
    expect(groupedCharts.length).toBeGreaterThan(0);
    expect(groupedCharts.every((c: Json) => c.data_source === undefined)).toBe(true);
    f.sources[SOURCE]!.name = 'Unrelated metrics';
    f.sources[SOURCE]!.block.datasourceBlock.name = 'Unrelated metrics';
    const before = structuredClone(pageOf(f.original));
    f.clear();
    await expect(f.run('report_spec_apply', { report_id: ORIGINAL, spec })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.writes()).toEqual([]);
    expect(pageOf(f.original)).toEqual(before);
  });

  it('rejects malformed membership before any report or source is created', async () => {
    const malformed = [
      [group('a', [2])],
      [group('a', [0, 0])],
      [group('a', [0]), group('b', [0])],
      [group('a', [0], ['missing'])],
      [group('a', [0], ['b']), group('b', [1], ['a'])],
      [group('a', [0]), group('a', [1])],
    ];
    for (const groups of malformed) {
      const f = fake(), spec = plainSpec();
      spec.pages[0]!.groups = groups;
      await expect(f.run('report_spec_apply', { spec })).rejects.toMatchObject({ code: 'invalid' });
      expect(f.writes()).toEqual([]);
    }
  });

  it('does not regroup ambiguous matches or members already owned by a different group', async () => {
    for (const ambiguous of [false, true]) {
      const f = fake();
      for (const item of plainSpec().pages[0]!.components) await f.add('text_add', { text: item.text, position: item.position });
      const page = pageOf(f.original);
      if (ambiguous) {
        const duplicate = structuredClone(page.componentConfig[0]); duplicate.componentId = 'cd-ambiguous'; page.componentConfig.push(duplicate);
      } else {
        page.groupConfig = [{ groupId: 'g-unrelated', componentId: [page.componentConfig[0].componentId], childGroupId: [], conceptDefs: [], propertyConfig: { groupProperty: { inheritFilters: true } }, attributeConfig: { groupAttribute: {} } }];
      }
      const before = structuredClone(page);
      f.clear();
      await expect(f.run('report_spec_apply', { report_id: ORIGINAL, spec: plainSpec() })).rejects.toMatchObject({ code: 'invalid' });
      expect(f.writes()).toEqual([]);
      expect(pageOf(f.original)).toEqual(before);
    }
  });

  it('never writes a partial group after one of its members fails to create', async () => {
    const failLate: Tool = { ...textAdd, run: async (ctx, args) => {
      if (!ctx.dryRun && args.text === 'Second') return { ...text('Deliberate runtime failure'), isError: true };
      return textAdd.run(ctx, args as never);
    } };
    const f = fake({ overrides: [failLate] });
    const result = await f.run('report_spec_apply', { spec: plainSpec(), continue_on_error: true });
    expect(result.isError).toBe(true);
    expect(pageOf(f.reports[CREATED]!).componentConfig).toHaveLength(1);
    expect(pageOf(f.reports[CREATED]!).groupConfig ?? []).toEqual([]);
    expect(resultText(result)).toMatch(/member.*not created|not created.*member/i);
  });

  it('refuses unsupported native group filters rather than exporting an unsafe flattened page', async () => {
    const f = fake();
    await f.add('text_add', { text: 'Member', position: { left: 20, top: 20, width: 200, height: 40 } });
    const page = pageOf(f.original);
    page.groupConfig = [{ groupId: 'g-filtered', componentId: [page.componentConfig[0].componentId], childGroupId: [], conceptDefs: [], propertyConfig: { groupProperty: { filters: ['unresolved-filter'] } }, attributeConfig: { groupAttribute: {} } }];
    f.clear();
    await expect(f.exportSpec()).rejects.toMatchObject({ code: 'invalid' });
    expect(f.writes()).toEqual([]);
  });

  it('continues to export and apply legacy group-free specifications', async () => {
    const f = fake();
    const spec = specification();
    spec.pages[0]!.components = [];
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).toBe(false);
    const exported = await f.exportSpec({ report_id: CREATED });
    expect(exported.spec.pages[0]).not.toHaveProperty('groups');
    expect(pageOf(f.reports[CREATED]!).groupConfig ?? []).toEqual([]);
  });
});
