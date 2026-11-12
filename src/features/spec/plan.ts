import { isDeepStrictEqual } from 'node:util';
import { fromMapValue } from '../../core/mapvalue.js';
import { parseDuration } from '../chart-options/dates.js';
import { chartKinds as basicKinds } from '../chart-types-a/kinds.js';
import { chartKinds as extendedKinds } from '../chart-types-b/kinds.js';
import { SHAPES } from '../static/shape.js';
import { AGGREGATIONS, decodeHtml, filterSpecs } from './reverse.js';
import { boxOf, listPages } from '../../core/page.js';
import { COMPONENT_TOOLS, invalid, sourceArgs, sourceName, type Action, type Json, type Plan, type Spec, type State } from './model.js';
import { overridesDiffer } from './source-fields.js';

export function category(component: Json): string {
  const type = component.type;
  if (type === 'simple-description') return 'text';
  if (type === 'generic-shape' || type === 'shape') return 'shape';
  if (type === 'arrow') return 'line';
  if (type === 'image-component') return 'image';
  if (type === 'framed-external-content') return 'embed';
  if (/^(?:gs|google):\/\//.test(type)) return 'community';
  if (['dimension-filter', 'dimension-control', 'simple-daterangepicker', 'data-control', 'button'].includes(type)) return 'control';
  return 'chart';
}

function specBox(component: Json): Json | undefined {
  if (component.component === 'line' && component.from && component.to) return { left: Math.min(component.from.x, component.to.x), top: Math.min(component.from.y, component.to.y), width: Math.abs(component.to.x - component.from.x), height: Math.abs(component.to.y - component.from.y) };
  return component.position;
}

function matches(component: Json, wanted: Json): boolean {
  const box = specBox(wanted);
  if (!box || category(component) !== wanted.component) return false;
  const actual = boxOf(component) as unknown as Json;
  return ['left', 'top', 'width', 'height'].every((key) => box[key] === undefined || Math.abs(actual[key] - box[key]) <= 4);
}

// Group restoration cannot use the ordinary additive planner's loose visual
// match: a neighboring/different chart must never acquire another filter scope.
function strictGroupMatch(component: Json, wanted: Json, state: State): boolean {
  const box = specBox(wanted), actual = boxOf(component) as unknown as Json;
  if (!box || !['left', 'top', 'width', 'height'].every(k => typeof box[k] === 'number' && box[k] === actual[k])) return false;
  const p = component.propertyConfig?.componentProperty ?? {};
  if (wanted.component === 'text') return decodeHtml(p.descriptionProperty?.text ?? '').text === wanted.text;
  if (wanted.component === 'shape') {
    const expected = SHAPES[wanted.shape as keyof typeof SHAPES];
    return !!expected && (component.type === 'shape' ? wanted.shape === 'rectangle' : p.genericShapeProperty?.shapeType === expected.shapeType);
  }
  if (wanted.component === 'chart') {
    const kind = [...basicKinds, ...extendedKinds].find(k => k.key === wanted.type);
    if (!kind || kind.type !== component.type || (kind.preset && kind.preset !== (component.preset ?? 'default'))) return false;
  } else if (wanted.component === 'control') {
    const kinds: Record<string, string> = { button: 'button', 'simple-daterangepicker': 'date_range', 'dimension-control': 'dimension_control', 'data-control': 'data_control' };
    const presets: Record<string, string> = { default: 'drop_down', 'control-open-list': 'fixed_size_list', 'control-textbox': 'input_box', 'control-search-all': 'advanced_filter', 'control-slider': 'slider', 'control-checkbox': 'checkbox' };
    const kind = component.type === 'button' && component.preset === 'button-filter' ? 'preset_filter' : kinds[component.type] ?? presets[component.preset ?? 'default'];
    if (kind !== wanted.kind) return false;
    if (wanted.button?.page) {
      const page = listPages(state.doc).find(p => p.pageId === wanted.button.page || p.name === wanted.button.page);
      if (!page || p.buttonProperty?.internalLink !== page.pageId) return false;
    }
    if (wanted.button?.url && p.buttonProperty?.linkUrl !== wanted.button.url) return false;
  } else return false; // No reliable portable identity for uploads/unknown types.
  if (component.type === 'simple-daterangepicker') {
    const selections = ((fromMapValue(component.behavior) as Json | undefined)?.onSelect ?? []).filter((a: Json) => a.action === 'lego-change-date-range');
    if (selections.length !== 1) return false;
  }
  const duration = component.type === 'simple-daterangepicker'
    ? (fromMapValue(component.behavior) as Json | undefined)?.onSelect?.find((a: Json) => a.action === 'lego-change-date-range')?.init?.dateRange
    : p.dateDuration;
  const expectedDuration = wanted.date_range === undefined
    ? component.type === 'simple-daterangepicker' ? parseDuration('Last 7 days') : undefined
    : parseDuration(wanted.date_range);
  if (!isDeepStrictEqual(duration, expectedDuration)) return false;
  if ((p.dsRequiredFilters ?? []).length) return false;
  const filterState: State = { ...state, notes: [] };
  const actualFilters = filterSpecs(p.filters ?? [], filterState);
  // Unknown filter definitions cannot be treated as equivalent by name alone.
  if (filterState.notes.length || !isDeepStrictEqual(actualFilters, wanted.filters ?? [])) return false;
  const sourceId = component.datasourceId ?? p.dataset?.datasetId;
  const source = state.sources.find(s => s.id === sourceId);
  if (wanted.data_source && ![source?.name, source?.alias, source?.id].includes(wanted.data_source)) return false;
  const active = new Set([...(p.dimensions?.labeledConcepts ?? []), ...(p.metrics?.labeledConcepts ?? [])].flatMap((s: Json) => s.value?.conceptNames ?? []));
  if (p.dateRangeDimension) active.add(p.dateRangeDimension);
  const concepts: Json[] = (component.conceptDefs ?? []).filter((c: Json) => active.has(c.name));
  const names = (c: Json): Array<string | undefined> => {
    const id = c.queryTimeTransformation?.dataTransformation?.sourceFieldName;
    return [id, source?.fields.find(f => f.id === id)?.name];
  };
  const fieldRefs = [...(wanted.dimensions ?? []), ...Object.values(wanted.fields ?? {}).flat(),
    ...[wanted.field, wanted.breakdown, wanted.date_range_dimension].filter(v => typeof v === 'string')];
  if (!fieldRefs.every(field => concepts.some(c => names(c).includes(field)))) return false;
  if (wanted.date_range_dimension !== undefined) {
    const date = concepts.find(c => c.name === p.dateRangeDimension);
    if (!date || !names(date).includes(wanted.date_range_dimension)) return false;
  } else if (p.dateRangeDimension) return false;
  const metrics = [...(wanted.metrics ?? []), ...(wanted.metric ? [{ field: wanted.metric }] : [])];
  return metrics.every((metric: Json) => concepts.some(c => {
    const transformation = c.queryTimeTransformation?.dataTransformation ?? {};
    return names(c).includes(metric.field) &&
      (metric.aggregation === undefined || AGGREGATIONS[transformation.aggregation] === metric.aggregation) &&
      (metric.label === undefined || c.queryTimeTransformation?.displayTransformation?.displayName === metric.label) &&
      (c.resultTransformation?.analyticalFunction ?? 0) === (metric.calculation === 'percent_of_total' ? 1 : 0) &&
      (c.resultTransformation?.isRelativeToBase ?? false) === (metric.relative_to_base ?? false) &&
      (c.resultTransformation?.bypassCanvasFilters ?? false) === (metric.bypass_filters ?? false);
  }));
}

export function specToActions(spec: Spec, target: State | undefined, options: { fresh: boolean; applyTheme?: boolean; firstPageId?: string; allSources?: boolean } = { fresh: false }): Plan {
  const actions: Action[] = [], notes: string[] = [];
  // Negative references are page-local group members; nonnegative ones remain
  // reserved for existing report-level component promotion actions.
  let nextGroupComponentRef = -1;
  const push = (tool: string, args: Json, extra: Omit<Action, 'tool' | 'args'> = {}) => actions.push({ tool, args, ...extra });
  const fresh = options.fresh;
  const pages = target ? listPages(target.doc) : [];
  const sourceNames = new Set(target?.sources.map((source) => source.name) ?? []);
  if (spec.theme && Object.keys(spec.theme).length) {
    if (fresh || options.applyTheme) push('theme_update', spec.theme, { path: 'theme' });
    else notes.push('Theme and canvas were left unchanged.');
  }
  for (const [index, source] of spec.data_sources.entries()) {
    if (fresh && index === 0 && !options.allSources) continue;
    const name = sourceName(source);
    if (!fresh && sourceNames.has(name)) continue;
    push('datasource_add', sourceArgs(source), { path: `data_sources[${index}]` }); sourceNames.add(name);
  }
  const sources = target?.sources ?? [];
  for (const [index, source] of spec.data_sources.entries()) {
    const overrides: Json[] = source.field_overrides ?? [];
    if (!overrides.length) continue;
    const existing = sources.find((entry) => entry.name === sourceName(source));
    if (!fresh && existing) {
      if (overridesDiffer(existing, overrides)) notes.push(`Data source "${existing.name}" exists; differing field overrides were left unchanged.`);
      continue;
    }
    overrides.forEach((change, field) => push('field_update', { ...change, data_source: sourceName(source) }, { path: `data_sources[${index}].field_overrides[${field}]` }));
  }
  const findSource = (name?: string) => name ? sources.find((source) => [source.name, source.alias, source.id].includes(name)) : sources.length === 1 ? sources[0] : undefined;
  for (const [key, tool] of [['parameters', 'parameter_add'], ['calculated_fields', 'calculated_field_add'], ['group_fields', 'group_field_add'], ['bin_fields', 'bin_field_add']] as const) {
    for (const [index, item] of (spec[key] as Json[] ?? []).entries()) {
      const source = findSource(item.data_source);
      const parameters: Json[] = source?.block.resource?.parameterConfiguration?.parameters ?? [];
      const hasParameter = parameters.some((entry) => entry.key === item.id || entry.value?.parameterDisplayConfiguration?.displayName === item.name || entry.value?.parametersModifiedByRoles?.some((role: Json) => role.value?.name === item.name));
      if (!fresh && source && (source.fields.some((field) => field.name === item.name) || hasParameter)) continue;
      if (key === 'calculated_fields') {
        const { type, aggregation, ...calculation } = item;
        push(tool, calculation, { path: `${key}[${index}]` });
        if (type !== undefined || aggregation !== undefined)
          push('field_update', { field: item.name, ...(item.data_source === undefined ? {} : { data_source: item.data_source }),
            ...(type === undefined ? {} : { type }), ...(aggregation === undefined ? {} : { aggregation }) }, { path: `${key}[${index}]` });
      } else push(tool, item, { path: `${key}[${index}]` });
    }
  }
  const blends: Json[] = (target?.doc.report.resource as Json | undefined)?.dataViewResource?.entry ?? [];
  for (const [index, blend] of (spec.blends as Json[] ?? []).entries()) {
    if (!fresh && blends.some((entry) => entry.value?.blockDatasource?.datasourceBlock?.name === blend.name)) continue;
    push('blend_create', blend, { path: `blends[${index}]` });
  }

  const used = new Set<string>();
  const pageTargets = spec.pages.map((page, index) => {
    const known = fresh ? undefined : pages.find((entry) => entry.name === page.name && !used.has(entry.pageId));
    if (known) used.add(known.pageId);
    return { known, pageId: fresh && index === 0 ? options.firstPageId ?? pages[0]?.pageId ?? 'spec-first-page' : known?.pageId };
  });
  // A button can link to a later page. Create those destinations before any
  // components, so link validation succeeds and component stacking is kept.
  const forwardLinks = spec.pages.some((page, i) => page.components.some((component) => component.component === 'control' && component.button?.page && spec.pages.findIndex((candidate) => candidate.name === component.button.page) > i));
  const precreated = new Set<number>();
  if (forwardLinks) {
    spec.pages.forEach((page, index) => {
      if (!pageTargets[index]!.pageId) { push('page_add', { name: page.name }, { producesPage: index, path: `pages[${index}]` }); precreated.add(index); }
    });
    notes.push('Link destination pages are created before their buttons.');
  }
  const pageExtra = (index: number): Omit<Action, 'tool' | 'args'> => pageTargets[index]!.pageId ? {} : { pageRef: index };
  const pageArgs = (index: number): Json => ({ page: pageTargets[index]!.pageId ?? `spec-page-${index + 1}` });
  spec.pages.forEach((page, index) => {
    const targetPage = pageTargets[index]!;
    if (fresh && index === 0) push('page_rename', { ...pageArgs(index), name: page.name }, { path: `pages[${index}]` });
    else if (!targetPage.known && !precreated.has(index)) push('page_add', { name: page.name }, { producesPage: index, path: `pages[${index}]` });
    const existing = targetPage.known ? target!.doc.page.find((entry) => entry.pageId === targetPage.known!.pageId)!.page.componentConfig ?? [] : [];
    const groupedIndices = new Set((page.groups ?? []).flatMap(group => group.components));
    const groupMembers: NonNullable<Action['groupsRestore']>['members'] = [];
    const reused = new Set<string>();
    for (const [componentIndex, originalComponent] of page.components.entries()) {
      const at = `pages[${index}].components[${componentIndex}]`;
      let component = originalComponent;
      const sourceBound = component.component === 'chart' || component.component === 'community' ||
        (component.component === 'control' && !['date_range', 'button', 'data_control'].includes(component.kind));
      if (groupedIndices.has(componentIndex) && sourceBound && component.data_source === undefined) {
        // An exported single-source spec leaves this implicit. Pin that source
        // for both creation and matching, rather than borrowing the target's
        // unrelated default source merely because its field names look alike.
        const source = spec.data_sources.length === 1 ? sourceName(spec.data_sources[0]!)
          : !spec.data_sources.length && target?.sources.length === 1 ? target.sources[0]!.name : undefined;
        if (source) component = { ...component, data_source: source };
        else if (target || spec.data_sources.length > 1) throw invalid(`${at}: a grouped data component needs an explicit data_source when its source is ambiguous.`);
        // The maximum-action static preflight has no target. Its later
        // target-aware plan performs the source-less-spec check above.
      }
      if (component.component === 'other') { notes.push(`Page "${page.name}", component ${componentIndex}: skipped ${component.panel ?? 'unknown component'}.`); continue; }
      const hits = fresh ? [] : existing.filter(entry => matches(entry, component));
      if (groupedIndices.has(componentIndex) && hits.length) {
        if (hits.length !== 1 || reused.has(String(hits[0]!.componentId)) || !strictGroupMatch(hits[0]!, component, target!))
          throw invalid(`${at}: existing group member matching is ambiguous or incompatible. Use a new report rather than regrouping existing content.`);
        const componentId = String(hits[0]!.componentId);
        reused.add(componentId); groupMembers.push({ index: componentIndex, componentId });
        continue;
      }
      if (hits.length) continue;
      if (!fresh && !specBox(component)) notes.push(`${at} has no position and is always added.`);
      const { component: kind, ...args } = component;
      const reference = groupedIndices.has(componentIndex) ? nextGroupComponentRef-- : undefined;
      if (reference !== undefined) groupMembers.push({ index: componentIndex, ref: reference });
      push(COMPONENT_TOOLS[kind] ?? String(kind), { ...args, ...pageArgs(index) }, { ...pageExtra(index), ...(reference === undefined ? {} : { producesComponent: reference }), path: at });
    }
    if (page.groups?.length) push('component_arrange', { ...pageArgs(index), action: 'group', component_ids: [] }, {
      ...pageExtra(index), path: `pages[${index}].groups`, groupsRestore: { groups: page.groups, members: groupMembers },
    });
    if (page.settings && Object.keys(page.settings).length) {
      if (!fresh && targetPage.known) notes.push(`Page "${page.name}" exists; its settings were left unchanged.`);
      else push('page_settings_update', { ...page.settings, scope: 'page', ...pageArgs(index) }, { ...pageExtra(index), path: `pages[${index}].settings` });
    }
  });
  spec.pages.forEach((page, index) => {
    if (page.hidden && (fresh || !pageTargets[index]!.known)) push('page_edit', { ...pageArgs(index), action: 'hide' }, { ...pageExtra(index), path: `pages[${index}].hidden` });
  });
  const reportComponents = target?.doc.report.componentConfig ?? [];
  for (const [index, component] of spec.report_components.entries()) {
    if (component.component === 'other') { notes.push(`Report component ${index}: skipped ${component.panel}.`); continue; }
    if (!fresh && reportComponents.some((entry) => matches(entry, component))) continue;
    const { component: kind, ...args } = component;
    push(COMPONENT_TOOLS[kind] ?? String(kind), { ...args, ...pageArgs(0) }, { ...pageExtra(0), producesComponent: index, path: `report_components[${index}]` });
    push('component_update', { component_id: `spec-component-${index}`, report_level: true }, { componentRef: index, path: `report_components[${index}]` });
  }
  if (spec.report_settings && Object.keys(spec.report_settings).length) {
    if (fresh) push('page_settings_update', { ...spec.report_settings, scope: 'report' }, { path: 'report_settings' });
    else notes.push('Report settings were left unchanged.');
  }
  return { actions, notes };
}
