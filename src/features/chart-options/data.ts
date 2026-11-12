import { z } from 'zod';

import { blankTemplate, RECORD_COUNT, resolveField, setSlot, template } from '../../core/components.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { fromMapValue, toMapValue } from '../../core/mapvalue.js';
import { applyControlFields } from '../controls/update.js';
import { CHART_TYPES, PROPERTIES, chartProperty, controlSourceField, definitions, fieldsFor, findConcept, invalid, makeConcept, matchSlot, nameOf, prop, requireListControl, slotConcepts, slotsFor, sortConcept, sourceOf, usedConcepts, type Json } from './common.js';
import { fieldsInput, labelsInput, sortsInput } from './inputs.js';

export const chartTypeUpdater: ComponentUpdater = {
  key: 'chart_type', types: CHART_TYPES,
  input: z.string().min(1).describe('새 차트 종류. chart_add의 type과 같은 이름입니다. 막대 방향·누적 방식 변경은 기존 설정을 유지합니다. 다른 종류로 바꾸면 제목·카드 배경·데이터 설정을 유지하고 종류별 스타일은 초기화합니다.'),
  apply: ({ component }, value, ctx) => {
    const kind = ctx.ext.chartKind(String(value));
    if (!kind) throw invalid(`Unknown chart type "${value}". Choices: ${ctx.ext.chartKinds().map((entry) => entry.key).join(', ')}.`);
    const preset = kind.preset ?? 'default';
    if (component.type === kind.type && (component.preset ?? 'default') === preset) return;
    // The bar variants differ only in orientation and stacking. Replacing
    // their whole property block would discard the user's title and palette.
    if (component.type === 'simple-barchart' && kind.type === component.type) {
      Object.assign(chartProperty(component), {
        orientation: preset.startsWith('vertical') ? 1 : 0,
        showStack: preset.includes('stacked'),
        show100Stack: preset.endsWith('-100'),
      });
      component.preset = preset;
      return;
    }
    const fresh = blankTemplate(template(kind.type, kind.preset));
    const previous = prop(component);
    const next = prop(fresh);
    for (const key of ['dataset', 'dimensions', 'metrics', 'breakdownConfig', 'sort', 'filters', 'dateRangeDimension', 'dateDuration', 'compareDateDuration', 'inheritFilters', 'dsRequiredFilters', 'row'])
      if (previous[key] !== undefined) next[key] = structuredClone(previous[key]);
    const oldStyle = previous[PROPERTIES[String(component.type)]!];
    const newStyle = next[PROPERTIES[kind.type]!];
    if (oldStyle && newStyle)
      for (const key of ['chartTitleProperty', 'backgroundAndBorderProperty'])
        if (oldStyle[key] !== undefined) newStyle[key] = structuredClone(oldStyle[key]);
    component.type = kind.type;
    component.preset = preset;
    component.propertyConfig = { ...(component.propertyConfig ?? {}), componentProperty: next };
    return 'Chart-specific styles were reset for the new type; the title, card background and data settings were preserved.';
  },
};

export const titleUpdater: ComponentUpdater = {
  key: 'title', types: CHART_TYPES,
  input: z.string().describe('차트 제목. 빈 문자열이면 제목을 숨깁니다. 기존 글꼴과 제목 스타일은 유지합니다.'),
  apply: ({ component }, value) => {
    const property = chartProperty(component);
    property.chartTitleProperty = { ...(property.chartTitleProperty ?? {}),
      chartTitleText: String(value), chartTitleShowTitle: Boolean(String(value).trim()), chartTitleAutoGenerateText: false };
  },
  read: (component) => {
    const title = prop(component)[PROPERTIES[String(component.type)]!]?.chartTitleProperty;
    return title?.chartTitleText === undefined ? undefined : title.chartTitleShowTitle === false ? '' : title.chartTitleText;
  },
};

export const fieldsUpdater: ComponentUpdater = {
  key: 'fields', input: fieldsInput, types: [...CHART_TYPES, 'dimension-filter'],
  apply: async (target, value, ctx) => {
    const c = target.component;
    if (c.type === 'dimension-filter') return applyControlFields(target, value as Record<string, string[]>, ctx);
    const available = slotsFor(c, ctx);
    const input = value as Record<string, string[]>;
    const fields = await fieldsFor(target, ctx);
    const before = structuredClone(definitions(c));
    const p = prop(c);
    const pivot = c.type === 'pivot-table' ? (p.pivotTableProperty ??= {}).pivotDisplayConfig ??= {} : undefined;
    const primary = slotConcepts(c, { kind: 'dimensions', key: 'primary' });
    const rowCount = pivot?.row?.length || primary.length;
    let pivotRows = primary.slice(0, rowCount);
    let pivotColumns = primary.slice(rowCount);
    for (const [title, refs] of Object.entries(input)) {
      const slot = matchSlot(available, title);
      if (slot.max !== undefined && refs.length > slot.max) throw invalid(`"${title}" accepts at most ${slot.max} fields.`);
      const current = slotConcepts(c, slot);
      const concepts = refs.map((ref) => {
        const field = resolveField(fields, ref);
        const existing = current.find((entry) => sourceOf(entry) === field.id);
        if (existing) return existing;
        const concept = makeConcept(field, slot.kind === 'metrics');
        if (slot.aggregation !== undefined) concept.queryTimeTransformation.dataTransformation.aggregation = slot.aggregation;
        return concept;
      });
      if (pivot && slot.kind === 'dimensions' && slot.key === 'primary') {
        if (slot.pivotColumns) pivotColumns = concepts; else pivotRows = concepts;
      } else setSlot(c, slot.kind, slot.key, concepts);
      if (slot.breakdown) {
        const old = (p.breakdownConfig ?? []).filter((entry: Json) => !current.some((concept) => concept.name === entry.conceptName));
        const metric = usedConcepts(c, 'metrics')[0];
        p.breakdownConfig = [...old, ...concepts.map((concept) => ({ conceptName: concept.name, row: 10, sort: { sortDir: 1, ...(metric ? { sortColumn: metric.name } : {}) }, includeBreakdownOthers: true }))];
      }
    }
    if (pivot) {
      setSlot(c, 'dimensions', 'primary', [...pivotRows, ...pivotColumns]);
      const sorted = (concept: Json): Json => ({ sort: [{ sortColumn: concept.name, sortDir: 0 }] });
      pivot.row = pivotRows.map(sorted);
      pivot.col = pivotColumns.map(sorted);
      pivot.hierarchy ??= [];
    }
    const references = JSON.stringify({ property: p, pageConditions: target.page.chartCondition, reportConditions: target.doc.chartCondition });
    for (const concept of before)
      if (!definitions(c).some((entry) => entry.name === concept.name) && references.includes(`"${concept.name}"`)) definitions(c).push(concept);
  },
  read: (component) => {
    const p = prop(component);
    const out: Record<string, string[]> = {};
    for (const which of ['dimensions', 'metrics'] as const)
      for (const entry of p[which]?.labeledConcepts ?? []) {
        const title = entry.key === 'primary' ? which === 'dimensions' ? 'Dimension' : 'Metric' : entry.key === 'breakdown' ? 'Breakdown dimension' : entry.key;
        out[title] = slotConcepts(component, { kind: which, key: entry.key }).map((concept) => sourceOf(concept) ?? nameOf(concept));
      }
    return out;
  },
};

export const labelsUpdater: ComponentUpdater = {
  key: 'labels', input: labelsInput, types: [...CHART_TYPES, 'dimension-filter'],
  apply: async (target, value, ctx) => {
    requireListControl(target.component, 'labels');
    const changes = value as Record<string, string>;
    const plan: Array<[Json, string]> = [];
    for (const [ref, text] of Object.entries(changes)) {
      let concept: Json;
      if (target.component.type === 'dimension-filter') {
        const available = usedConcepts(target.component);
        const count = ref.toLowerCase() === 'record count' ? available.find((entry) => sourceOf(entry) === RECORD_COUNT) : undefined;
        const field = count ? undefined : await controlSourceField(target, ref, ctx);
        const selected = count ?? (field ? available.find((entry) => sourceOf(entry) === field.id) : findConcept(target.component, ref));
        if (!selected) throw invalid(`No displayed control field "${ref}" to label.`);
        plan.push([selected, text]);
        continue;
      }
      try {
        concept = findConcept(target.component, ref);
      }
      catch {
        const field = resolveField(await fieldsFor(target, ctx), ref);
        const matching = usedConcepts(target.component).filter((entry) => sourceOf(entry) === field.id);
        if (!matching.length) throw invalid(`No field "${ref}" in this chart. Its fields: ${usedConcepts(target.component).map(nameOf).join(', ')}.`);
        concept = matching[0]!;
      }
      plan.push([concept, text]);
    }
    for (const [concept, text] of plan) ((concept.queryTimeTransformation ??= {}).displayTransformation ??= {}).displayName = text;
    if (target.component.type === 'dimension-filter' && target.component.preset === 'control-open-list' && target.component.behavior) {
      const behavior = fromMapValue(target.component.behavior) as Json;
      for (const action of behavior?.onSelect ?? []) {
        const current = action.init?.dConcept;
        const changed = plan.find(([concept]) => concept.name === current?.name);
        if (changed) action.init.dConcept = structuredClone(changed[0]);
      }
      target.component.behavior = toMapValue(behavior, target.component.behavior);
    }
  },
  read: (component) => Object.fromEntries(usedConcepts(component).flatMap((concept) => sourceOf(concept) ? [[sourceOf(concept)!, nameOf(concept)]] : [])),
};

const primarySortApplied = new WeakSet<object>();
function primarySort(c: Json): Json[] {
  if (c.type === 'pivot-table') {
    const pivot = (prop(c).pivotTableProperty ??= {}).pivotDisplayConfig ??= {};
    if (!pivot.row?.length) {
      const first = slotConcepts(c, { kind: 'dimensions', key: 'primary' })[0];
      pivot.row = first ? [{ sort: [{ sortColumn: first.name, sortDir: 1 }] }] : [{}];
    }
    return (pivot.row[0].sort ??= []);
  }
  return (prop(c).sort ??= []);
}

const sortTypes = ['simple-table', 'kpi-metric', 'simple-linechart', 'simple-barchart', 'simple-combochart', 'simple-areachart', 'simple-piechart', 'pivot-table', 'simple-scatterchart', 'simple-treemap', 'simple-waterfall', 'simple-funnel'];
export const sortByUpdater: ComponentUpdater = {
  key: 'sort_by', types: sortTypes, input: z.string().trim().min(1).describe('첫 정렬 기준의 필드 이름 또는 ID. 피벗은 첫 행 차원의 정렬을 바꿉니다.'),
  apply: async (target, value, ctx) => {
    const concept = await sortConcept(target, String(value), ctx);
    const sorts = primarySort(target.component);
    sorts[0] = { sortColumn: concept.name, sortDir: 1 };
    primarySortApplied.add(target.component);
  },
  read: (c) => {
    const name = c.type === 'pivot-table' ? prop(c).pivotTableProperty?.pivotDisplayConfig?.row?.[0]?.sort?.[0]?.sortColumn : prop(c).sort?.[0]?.sortColumn;
    const concept = definitions(c).find((entry) => entry.name === name);
    return concept ? sourceOf(concept) ?? nameOf(concept) : undefined;
  },
};

export const sortAscendingUpdater: ComponentUpdater = {
  key: 'sort_ascending', types: sortTypes, input: z.boolean().describe('sort_by의 오름차순 여부. 기본은 내림차순이며 sort_by 없이 주면 바꾸지 않습니다.'),
  apply: ({ component }, value) => {
    if (primarySortApplied.has(component)) primarySort(component)[0]!.sortDir = value ? 0 : 1;
  },
  read: (c) => {
    const sort = c.type === 'pivot-table' ? prop(c).pivotTableProperty?.pivotDisplayConfig?.row?.[0]?.sort?.[0] : prop(c).sort?.[0];
    return sort ? sort.sortDir === 0 : undefined;
  },
};

export const sortsUpdater: ComponentUpdater = {
  key: 'sorts', input: sortsInput, types: [...CHART_TYPES, 'dimension-filter'],
  apply: async (target, value, ctx) => {
    const specs = value as Array<{ field: string; ascending?: boolean }>;
    if (target.component.type === 'dimension-filter') {
      requireListControl(target.component, 'sorts');
      if (specs.length > 1) throw invalid('A list control accepts at most one sort. Give one sort or [] to clear it.');
      const next: Json[] = [];
      for (const spec of specs) {
        const concept = await sortConcept(target, spec.field, ctx);
        if (next.some((sort) => sort.sortColumn === concept.name)) throw invalid(`Duplicate sort field "${spec.field}".`);
        next.push({ sortColumn: concept.name, sortDir: spec.ascending ? 0 : 1 });
      }
      prop(target.component).sort = next;
      return;
    }
    if (!specs.length) return;
    if (target.component.type !== 'simple-table') return 'Warning: this chart accepts one sort only; additional sorts were not applied.';
    const sorts = (prop(target.component).sort ??= []) as Json[];
    if (sorts.length + specs.length > 10) throw invalid('A table accepts at most ten sorts, including its existing sorts.');
    for (const spec of specs) sorts.push({ sortColumn: (await sortConcept(target, spec.field, ctx)).name, sortDir: spec.ascending ? 0 : 1 });
  },
  read: (c) => (c.type === 'dimension-filter' ? prop(c).sort ?? [] : (prop(c).sort ?? []).slice(1)).flatMap((sort: Json) => {
    const concept = definitions(c).find((entry) => entry.name === sort.sortColumn);
    return concept ? [{ field: sourceOf(concept) ?? nameOf(concept), ascending: sort.sortDir === 0 }] : [];
  }),
};
