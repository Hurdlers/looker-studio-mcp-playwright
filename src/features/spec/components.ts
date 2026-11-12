import { isDeepStrictEqual } from 'node:util';

import { template } from '../../core/components.js';
import { blockFields } from '../../core/datasource.js';
import type { ChartKind } from '../../core/extensions.js';
import { fromMapValue } from '../../core/mapvalue.js';
import { DATE_PRESETS, parseDuration } from '../chart-options/dates.js';
import { boxOf, listPages } from '../../core/page.js';
import { getPath, labelKey, readStyle } from '../../core/style.js';
import type { ToolContext } from '../../core/tool.js';
import { fieldFormatIssue } from '../chart-options/formats.js';
import { category } from './plan.js';
import { AGGREGATIONS, color, decodeHtml, fieldName, filterSpecs, property, sourceOf } from './reverse.js';
import { diagnostic, invalid, type Json, type Source, type State } from './model.js';

export type StyleDepth = 'none' | 'main' | 'all';
const MAIN = /^(background|background color|border color|border radius|border weight|border shadow|add border shadow|opacity|show data labels|show legend|display legend|legend position)$/i;
const SHAPES: Record<number, string> = { 1: 'circle', 2: 'rectangle', 3: 'triangle', 4: 'arrow_right', 5: 'arrow_up', 6: 'heart', 7: 'diamond', 8: 'star', 9: 'pentagon', 10: 'octagon', 11: 'cylinder', 12: 'hexagon', 13: 'callout', 14: 'arrow_left', 15: 'arrow_down' };
const CONTROL_PRESETS: Record<string, string> = { default: 'drop_down', 'control-open-list': 'fixed_size_list', 'control-textbox': 'input_box', 'control-search-all': 'advanced_filter', 'control-slider': 'slider', 'control-checkbox': 'checkbox' };

function styleOf(ctx: ToolContext, component: Json, depth: StyleDepth, dedicated: string[]): Json | undefined {
  if (depth === 'none') return undefined;
  const labels = ctx.ext.styleLabels(component.type, component.preset);
  const values = readStyle(component, labels);
  // The editor defaults table row numbers to true when the native property
  // is absent. The creation template may explicitly choose false instead.
  if (component.type === 'simple-table' && values['Row numbers'] === undefined) values['Row numbers'] = true;
  // A missing native hideCompare hides the comparison label; new cards may explicitly show it.
  if (component.type === 'kpi-metric' && values['Hide comparison label'] === undefined) values['Hide comparison label'] = true;
  const tableColumns = Object.fromEntries(([['Metric', 'metrics'], ['Dimension', 'dimensions']] as const).map(([kind, slot]) =>
    [kind, (property(component)[slot]?.labeledConcepts ?? []).flatMap((item: Json) => item.value?.conceptNames ?? []).length]));
  const dedicatedPaths = new Set(labels.filter((label) => dedicated.some((name) => name.toLowerCase() === label.label.toLowerCase())).map((label) => `${label.root === true}:${label.path}`));
  let defaults: Json = {};
  try { defaults = readStyle(template(component.type, component.preset), labels); } catch { /* A legacy component can still have known style labels. */ }
  const out: Json = {};
  labels.forEach((label, index) => {
    // Native table definitions reserve settings for unused dimension and metric columns.
    // Only export the active columns; do not turn defaults into extra slots.
    const tableColumn = /\.table(Metric|Dimension)Property\[(\d+)\]/.exec(`.${label.path}`);
    if (component.type === 'simple-table' && tableColumn && Number(tableColumn[2]) >= tableColumns[tableColumn[1]!]) return;
    const raw = getPath(component, label.root ? label.path : `propertyConfig.componentProperty.${label.path}`) as Json | undefined;
    const key = labelKey(labels, index);
    const emptyAutomaticArray = label.auto && label.kind === 'number-array' && Array.isArray(raw) && raw.length === 0;
    const value = emptyAutomaticArray ? 'Auto' : values[key] ?? (label.auto && raw === undefined ? 'Auto' : undefined);
    if (label.label === 'Border shadow' && labels.some((item) => item.label === 'Add border shadow' && item.path === label.path)) return;
    if (value === undefined || dedicatedPaths.has(`${label.root === true}:${label.path}`)) return;
    const transparent = raw?.color === 'transparent' || raw?.opacity === 0 || value === 'transparent';
    if (transparent && depth !== 'all') return;
    if (depth === 'main' && (!MAIN.test(label.label) || isDeepStrictEqual(value, defaults[key]))) return;
    out[key] = raw?.color === 'transparent' ? 'transparent' : transparent ? value : color(value);
  });
  return Object.keys(out).length ? out : undefined;
}

// The native percentage toggle can change without updating the preset name.
// Select the matching existing creation kind so recreation keeps its meaning.
function recreationKind(ctx: ToolContext, component: Json): ChartKind | undefined {
  const propertyName = ({ 'simple-barchart': 'barChartProperty', 'simple-areachart': 'areaChartProperty' } as Record<string, string>)[component.type];
  const config = propertyName ? property(component)[propertyName] : undefined;
  if (config?.show100Stack !== true) return ctx.ext.kindOf(component);
  const vertical = component.type === 'simple-barchart' && (config.orientation ?? (component.preset?.startsWith('vertical') ? 1 : 0)) === 1;
  return ctx.ext.kindOf({ ...component, preset: vertical ? 'vertical-stacked-100' : 'horizontal-stacked-100' });
}

function dataSource(component: Json, state: State): Source | undefined {
  const id = component.datasourceId ?? property(component).dataset?.datasetId;
  return state.sources.find((source) => source.id === id);
}

function chartFields(ctx: ToolContext, component: Json, source: Source | undefined, slots?: ChartKind['slots']): Json {
  const p = property(component), definitions: Json[] = component.conceptDefs ?? [];
  const resolve = (name: string) => definitions.find((entry) => entry.name === name);
  const name = (concept?: Json) => sourceOf(concept) ? fieldName(source, sourceOf(concept)!) : concept?.name ?? '';
  const primary = (kind: string, key: string) => (p[kind]?.labeledConcepts?.find((slot: Json) => slot.key === key)?.value?.conceptNames ?? []).map(resolve).filter(Boolean) as Json[];
  const out: Json = { dimensions: [], metrics: [] };
  const metric = (concept: Json): Json => {
    const transformation = concept.queryTimeTransformation?.dataTransformation ?? {};
    const display = concept.queryTimeTransformation?.displayTransformation?.displayName;
    const result = concept.resultTransformation;
    return { field: name(concept), ...(AGGREGATIONS[transformation.aggregation] !== undefined ? { aggregation: AGGREGATIONS[transformation.aggregation] } : {}), ...(display && display !== name(concept) ? { label: display } : {}),
      ...(result ? { calculation: result.analyticalFunction === 1 ? 'percent_of_total' : 'none', relative_to_base: result.isRelativeToBase ?? false, bypass_filters: result.bypassCanvasFilters ?? false } : {}) };
  };
  const labels: Json = {};
  const kinds = slots ?? ctx.ext.kindOf(component)?.slots;
  const dimSlots: Json[] = p.dimensions?.labeledConcepts ?? [], metricSlots: Json[] = p.metrics?.labeledConcepts ?? [];
  const primaryDimKey = dimSlots.some((slot) => slot.key === 'primary') ? 'primary' : kinds?.find((slot) => slot.kind === 'dimensions')?.key;
  const primaryMetricKey = metricSlots.some((slot) => slot.key === 'primary') ? 'primary' : kinds?.find((slot) => slot.kind === 'metrics')?.key;
  if (primaryDimKey !== undefined) out.dimensions = primary('dimensions', primaryDimKey).map((concept) => {
    const field = name(concept), display = concept.queryTimeTransformation?.displayTransformation?.displayName;
    if (display && field !== display) labels[field] = display;
    return field;
  });
  if (primaryMetricKey !== undefined) out.metrics = primary('metrics', primaryMetricKey).map(metric);
  // chart_add accepts scatter metrics positionally. Setup fields accept only
  // names, so exporting Y/size there would discard their aggregation and label.
  const scatterMetricKeys = component.type === 'simple-scatterchart' ? ['x_metric', 'y_metric', 'bubble_size'] : [];
  if (scatterMetricKeys.length) out.metrics = scatterMetricKeys.flatMap((key) => primary('metrics', key).map(metric));
  if (Object.keys(labels).length) out.labels = labels;
  const fields: Json = {};
  for (const which of ['dimensions', 'metrics']) for (const slot of p[which]?.labeledConcepts ?? []) {
    if (which === 'metrics' && scatterMetricKeys.includes(slot.key)) continue;
    if ((which === 'dimensions' ? primaryDimKey : primaryMetricKey) === slot.key) continue;
    const concepts = primary(which, slot.key);
    if (!concepts.length) continue;
    if (which === 'dimensions' && slot.key === 'breakdown') {
      if (concepts[0]?.queryTimeTransformation?.dataTransformation?.textFormula !== '""') out.breakdown = name(concepts[0]);
    }
    else fields[kinds?.find((item) => item.kind === which && item.key === slot.key)?.title ?? slot.key] = concepts.map(name);
  }
  const pivot = p.pivotTableProperty?.pivotDisplayConfig;
  if (component.type === 'pivot-table' && pivot?.col?.length) {
    const columns = pivot.col.length;
    fields['Column dimension'] = out.dimensions.slice(-columns); out.dimensions = out.dimensions.slice(0, -columns);
  }
  if (Object.keys(fields).length) out.fields = fields;
  const sorts: Json[] = p.sort ?? [];
  if (sorts.length) {
    const first = sorts[0]!;
    const sortName = (concept: Json | undefined) => concept?.queryTimeTransformation?.displayTransformation?.displayName ?? name(concept);
    out.sort_by = sortName(resolve(first.sortColumn)); out.sort_ascending = first.sortDir === 0;
    if (sorts.length > 1) out.sorts = sorts.slice(1).map((sort) => ({ field: sortName(resolve(sort.sortColumn)), ascending: sort.sortDir === 0 }));
  }
  return out;
}

function conditionalFormats(component: Json, state: State): Json[] {
  const rules: Json[] = [state.doc, ...state.doc.page].flatMap((holder) => ((holder.chartCondition ?? []) as Json[]).filter((condition) => condition.chartId === component.componentId).flatMap((condition) => condition.conditionalFormat?.rule ?? []));
  const scales = rules.filter((rule) => rule.format?.scale).length;
  if (scales) state.notes.push(`${component.componentId}: ${scales} color scale rule(s) cannot be exported.`);
  const source = dataSource(component, state);
  const conceptName = (concept: Json) => fieldName(source, sourceOf(concept) ?? concept.name);
  const aliases: Json = { 1: 'equals', 2: 'not_equals', 3: 'gt', 4: 'gte', 5: 'lt', 6: 'lte', 7: 'contains', 8: 'not_contains', 9: 'starts_with', 10: 'is_null', 11: 'is_not_null', 12: 'regexp_match' };
  return rules.filter((rule) => rule.format?.single).flatMap((rule) => {
    const groups: Json[] = rule.conditionDefinition?.and?.conditionDefinition ?? [];
    const clauses = groups.map((group) => (group.or?.conditionDefinition ?? []).flatMap((definition: Json) => {
      const match = definition.matchCondition;
      if (!match) return [];
      const concept = match.input?.selector?.step?.find((step: Json) => step.field)?.field ?? match.field?.concept ?? match.field ?? match.concept ?? {};
      return [{ field: conceptName(concept), condition: aliases[match.type] ?? String(match.type), ...([10, 11].includes(match.type) ? {} : { value: String(match.value?.numberValue?.[0] ?? match.value?.stringValue?.[0] ?? '') }) }];
    }));
    if (!clauses.length) { state.notes.push(`${component.componentId}: a conditional rule has an unsupported condition and was omitted.`); return []; }
    const out: Json = { rules: clauses };
    for (const entry of rule.format.single.property ?? []) if (entry.value?.colorValue?.color) out[entry.key === 'color' ? 'font_color' : 'background_color'] = color(entry.value.colorValue.color);
    const steps: Json[] = rule.target?.target?.step ?? [];
    const target = steps.find((step) => step.field)?.field;
    if (target) out.apply_to = conceptName(target);
    return [out];
  });
}

function referenceLineNotes(component: Json, state: State): void {
  for (const [propertyName, config] of Object.entries(property(component))) {
    const lines: Json[] = (config as Json | undefined)?.referenceLineProperty ?? [];
    lines.forEach((line, index) => {
      if (line.referenceLineNumberValue === undefined && line.referenceLineDateValue === undefined && line.referenceLineMetric === undefined && line.referenceLineParameter === undefined && line.referenceLineType !== 1 && line.referenceLineType !== 2) return;
      const changes: string[] = [];
      if (line.referenceLineShowLabel === false) changes.push('referenceLineShowLabel=false (creation uses true)');
      if (line.referenceLineShowValueInLabel === true) changes.push('referenceLineShowValueInLabel=true (creation uses false)');
      if (line.referenceLineStyle !== undefined && line.referenceLineStyle !== 0) changes.push(`referenceLineStyle=${line.referenceLineStyle} (creation uses 0)`);
      if (line.referenceLineColor?.opacity !== undefined && line.referenceLineColor.opacity !== 1) changes.push(`referenceLineColor.opacity=${line.referenceLineColor.opacity} (creation uses 1)`);
      if (changes.length) state.notes.push(`${component.componentId}: ${propertyName}.referenceLineProperty[${index}] cannot preserve ${changes.join('; ')}.`);
    });
  }
}

// A date picker stores its initial period in its interaction behavior, not
// chart.dateDuration. Export Auto explicitly so the creation fixture cannot
// replace it with Last 7 days. Refuse unknown periods rather than broadening scope.
function pickerRange(ctx: ToolContext, component: Json, state: State): string {
  const behavior = fromMapValue(component.behavior) as Json | undefined;
  const actions = (behavior?.onSelect ?? []).filter((entry: Json) => entry.action === 'lego-change-date-range');
  if (actions.length !== 1) throw invalid(`${component.componentId}: the date picker's initial state cannot be represented.`);
  const config = actions[0].init?.dateRange;
  if (config === undefined) return 'Auto date range';
  const preset = Object.entries(DATE_PRESETS).find(([, value]) => value !== undefined && isDeepStrictEqual(value, config));
  if (preset) return preset[0];
  const value = ctx.ext.updater('date_range')?.read?.({ type: 'simple-table', propertyConfig: { componentProperty: { dateDuration: config } } }, state.doc);
  if (typeof value === 'string') {
    try { if (isDeepStrictEqual(parseDuration(value), config)) return value; } catch { /* fall through to explicit refusal */ }
  }
  throw invalid(`${component.componentId}: unsupported date picker initial range; it cannot be silently omitted.`);
}

export async function exportComponent(ctx: ToolContext, component: Json, state: State, depth: StyleDepth, valueColorsUsed: Set<string>): Promise<Json> {
  const type = category(component), p = property(component), position = boxOf(component);
  const out: Json = { component: type, position };
  let source = dataSource(component, state);
  const sourceId = component.datasourceId ?? p.dataset?.datasetId;
  if (['chart', 'control', 'community'].includes(type)) {
    if (state.sources.length > 1 && source) out.data_source = source.name;
    if (p.dataset?.datasetType === 2) {
      const blend: Json = ((state.doc.report.resource as Json | undefined)?.dataViewResource?.entry ?? []).find((entry: Json) => entry.key === sourceId)?.value?.blockDatasource;
      if (blend) {
        out.data_source = blend.datasourceBlock.name;
        source = { id: sourceId, alias: '', name: blend.datasourceBlock.name, block: blend, fields: blockFields({ published: blend }) };
      }
    }
    if (p.filters?.length) out.filters = filterSpecs(p.filters, state);
    const range = component.type === 'simple-daterangepicker' ? pickerRange(ctx, component, state) : ctx.ext.updater('date_range')?.read?.(component, state.doc);
    if (range !== undefined) out.date_range = range;
    const date = (component.conceptDefs ?? []).find((entry: Json) => entry.name === p.dateRangeDimension);
    if (sourceOf(date)) out.date_range_dimension = fieldName(source, sourceOf(date)!);
    else if (p.dateRangeDimension) state.notes.push(`${component.componentId}: date range field ${p.dateRangeDimension} has no readable source reference.`);
  }
  let dedicated: string[] = [];
  if (type === 'text') {
    const desc = p.descriptionProperty ?? {}, decoded = decodeHtml(desc.text ?? '');
    Object.assign(out, { text: decoded.text, ...decoded.format });
    if (decoded.mixed) state.notes.push(`${component.componentId}: mixed text formatting was reduced to the first format.`);
    if (/<a\b/i.test(desc.text ?? '')) state.notes.push(`${component.componentId}: text links are unsupported and were omitted.`);
    if (decoded.font && depth === 'all') out.style = { Font: decoded.font };
    const background = color(desc.backgroundAndBorderProperty?.background);
    if (background !== undefined) out.background = background;
    dedicated = ['Background', 'Font size', 'Font color'];
  } else if (type === 'shape') {
    const shape = p.genericShapeProperty ?? p.shapeProperty ?? {}, bab = shape.backgroundAndBorderProperty ?? {};
    out.shape = component.type === 'shape' ? 'rectangle' : SHAPES[shape.shapeType] ?? 'rectangle';
    if (color(bab.background) !== undefined) out.background = color(bab.background);
    if (color(bab.border?.color) !== undefined) out.border_color = color(bab.border.color);
    if (bab.border?.radius > 0 && out.shape === 'rectangle') out.border_radius = bab.border.radius;
    if (bab.background?.gradientSpec) state.notes.push(`${component.componentId}: gradient fill cannot be represented by a single color.`);
    dedicated = ['Background', 'Border color', 'Border radius'];
  } else if (type === 'line') {
    const line = p.arrowProperty ?? {}, from = line.terminals?.start ?? {}, to = line.terminals?.end ?? {};
    delete out.position; out.from = { x: from.left, y: from.top }; out.to = { x: to.left, y: to.top };
    if (line.strokeColor?.color) out.color = color(line.strokeColor);
    if (line.strokeStyle !== undefined) out.border_style = ['Solid', 'Dashed', 'Dotted', 'Double'][line.strokeStyle];
    for (const end of ['start', 'end']) if (line[`${end}HeadStyle`]) out[end] = ['None', 'Pointer', 'Circle', 'Diamond'][line[`${end}HeadStyle`]];
    dedicated = ['Stroke color', 'Border style'];
  } else if (type === 'embed') {
    if (!p.framedExternalContentProperty?.contentUrl) return { component: 'other', panel: 'URL embed (no URL)', position };
    out.url = p.framedExternalContentProperty.contentUrl; dedicated = ['URL'];
  } else if (type === 'control') {
    const kinds: Json = { 'simple-daterangepicker': 'date_range', 'dimension-control': 'dimension_control', button: component.preset === 'button-filter' ? 'preset_filter' : 'button', 'data-control': 'data_control' };
    out.kind = kinds[component.type] ?? CONTROL_PRESETS[component.preset ?? 'default'] ?? 'drop_down';
    if ((p.sort?.length ?? 0) > 1) {
      state.notes.push(`${component.componentId}: ${p.sort.length} control sorts cannot be recreated; the creation tool supports at most one. The component was retained as other.`);
      return { component: 'other', panel: 'Unsupported multiple control sorts', position };
    }
    const fields = chartFields(ctx, component, source);
    if (p.dimensionFilterProperty?.controlParameter?.parameterKey) out.field = p.dimensionFilterProperty.controlParameter.parameterKey;
    else if (fields.dimensions[0]) out.field = fields.dimensions[0];
    if (out.kind === 'dimension_control' && fields.dimensions.length > 1) out.fields = { Dimension: fields.dimensions };
    if (fields.metrics[0] && fields.metrics[0].field !== 'Record Count') out.metric = fields.metrics[0].field;
    const labels: Json = { ...fields.labels };
    for (const metric of fields.metrics) if (metric.label !== undefined) labels[metric.field] = metric.label;
    if (Object.keys(labels).length) {
      if (['drop_down', 'fixed_size_list'].includes(out.kind)) out.labels = labels;
      else state.notes.push(`${component.componentId}: field display labels are not supported by ${out.kind} and were omitted.`);
    }
    if (p.sort?.length) out.sorts = p.sort.map((sort: Json) => {
      const concept = (component.conceptDefs ?? []).find((entry: Json) => entry.name === sort.sortColumn);
      return { field: fieldName(source, sourceOf(concept) ?? concept?.name ?? sort.sortColumn), ascending: sort.sortDir === 0 };
    });
    else if (Array.isArray(p.sort) && !p.sort.length && ['drop_down', 'fixed_size_list'].includes(out.kind)) out.sorts = [];
    const button = ctx.ext.updater('button')?.read?.(component, state.doc) as Json | undefined;
    if (button) {
      out.button = { ...button, ...(button.page ? { page: listPages(state.doc).find((page) => page.pageId === button.page)?.name ?? button.page } : {}) };
    }
  } else if (type === 'chart' || type === 'community') {
    const kind = recreationKind(ctx, component);
    if (!kind && type === 'chart') return { component: 'other', panel: component.type, position };
    const used = new Set<string>([p.dimensions, p.metrics].flatMap((slots: Json | undefined) => (slots?.labeledConcepts ?? []).flatMap((slot: Json) => slot.value?.conceptNames ?? [])));
    for (const concept of component.conceptDefs ?? []) {
      if (!used.has(concept.name)) continue;
      const result = concept.resultTransformation, running = concept.queryTimeTransformation?.dataTransformation?.analyticalFunctionType;
      const aggregation = concept.queryTimeTransformation?.dataTransformation?.aggregation;
      const extra = result && Object.entries(result).find(([key, value]) => !['analyticalFunction', 'isRelativeToBase', 'bypassCanvasFilters'].includes(key) && value !== undefined && value !== false && value !== 0 && value !== null);
      const unsupported = result && ![undefined, 0, 1].includes(result.analyticalFunction) ? `resultTransformation.analyticalFunction ${result.analyticalFunction}` : running ? `dataTransformation.analyticalFunctionType ${running}` : aggregation !== undefined && aggregation !== 7 && AGGREGATIONS[aggregation] === undefined ? `dataTransformation.aggregation ${aggregation}` : extra ? `resultTransformation.${extra[0]} ${JSON.stringify(extra[1])}` : fieldFormatIssue(concept, component);
      if (unsupported) {
        state.notes.push(`${component.componentId}: ${unsupported} cannot be recreated; the component was retained as other.`);
        return { component: 'other', panel: `Unsupported calculation: ${unsupported}`, position };
      }
    }
    const expression = (component.conceptDefs ?? []).find((concept: Json) => used.has(concept.name) && concept.queryTimeTransformation?.dataTransformation?.sourceType === 1 && concept.queryTimeTransformation.dataTransformation.textFormula !== '""');
    if (expression) {
      state.notes.push(`${component.componentId}: its chart calculation is not accepted by the creation tool; the component was retained as other.`);
      return { component: 'other', panel: `Chart calculation ${expression.queryTimeTransformation?.displayTransformation?.displayName ?? expression.name}`, position };
    }
    let metadata;
    if (type === 'community') {
      try { metadata = await ctx.ext.componentMetadata(ctx, state.doc, component); }
      catch { state.notes.push(`${component.componentId}: community registration could not be read; its known metadata was used.`); }
    }
    Object.assign(out, chartFields(ctx, component, source, metadata?.slots));
    if (type === 'community') {
      const path = component.type.split('\u00a0')[0];
      if (kind?.creationTool && kind.creationTool !== 'community_viz_add') return { component: 'other', panel: `Creation tool ${kind.creationTool} is unavailable`, position };
      if (path.startsWith('google://') && kind?.title) out.name = kind.title; else out.manifest_path = path;
      for (const [which, pattern] of [['dimensions', /^(dimension|row dimension)/i], ['metrics', /^(metric|primary field)/i]] as const) {
        const slot = metadata?.slots?.find((item) => item.kind === which);
        if (slot && !pattern.test(slot.title) && out[which]?.length) {
          (out.fields ??= {})[slot.title] = out[which].map((item: unknown) => typeof item === 'string' ? item : (item as Json).field);
          out[which] = [];
        }
      }
      if (metadata?.style && depth !== 'none') {
        const controls = metadata.controls as Array<{ label?: string; defaultValue?: unknown }> | undefined;
        const style = Object.fromEntries(Object.entries(metadata.style).filter(([key, value]) => depth === 'all' || (MAIN.test(key.replace(/#\d+$/, '')) && !isDeepStrictEqual(value, controls?.find((control) => control.label === key)?.defaultValue))).map(([key, value]) => [key, color(value)]));
        if (Object.keys(style).length) out.style = style;
      }
      // Community sorting is one replacement list, unlike chart_add's first
      // sort plus secondary sorts.
      if (out.sort_by) { out.sorts = [{ field: out.sort_by, ascending: out.sort_ascending }, ...(out.sorts ?? [])]; delete out.sort_by; delete out.sort_ascending; }
      delete out.labels;
    } else out.type = kind!.key;
    const own = Object.values(p).find((value) => value && typeof value === 'object' && !Array.isArray(value) && (value as Json).chartTitleProperty) as Json | undefined;
    if (own?.chartTitleProperty?.chartTitleShowTitle && own.chartTitleProperty.chartTitleText) out.title = own.chartTitleProperty.chartTitleText;
    if (type === 'chart') {
      const publicMetric = (reference: string): string => {
        const concept = (component.conceptDefs ?? []).find((concept: Json) => used.has(concept.name) && concept.queryTimeTransformation?.displayTransformation?.displayName === reference)
          ?? (component.conceptDefs ?? []).find((concept: Json) => used.has(concept.name) && (sourceOf(concept) === reference || concept.name === reference));
        return concept?.queryTimeTransformation?.displayTransformation?.displayName ?? fieldName(source, sourceOf(concept) ?? reference);
      };
      for (const key of ['comparison', 'series', 'reference_lines', 'reference_bands', 'setup', 'field_formats', 'project_theme']) {
        if (key === 'project_theme' && depth === 'none') continue;
        const updater = ctx.ext.updater(key);
        if (updater?.types && !updater.types.includes(component.type)) continue;
        try {
          if (key === 'reference_lines') referenceLineNotes(component, state);
          let value = updater?.read?.(component, state.doc);
          if (['series', 'reference_lines'].includes(key) && Array.isArray(value)) value = value.map((entry: Json) => typeof entry.metric === 'string' ? { ...entry, metric: publicMetric(entry.metric) } : entry);
          if (key === 'field_formats' && Array.isArray(value)) value = value.map((entry: Json) => ({ ...entry, field: publicMetric(entry.field) }));
          if (value !== undefined && (!Array.isArray(value) || value.length)) out[key] = value;
        } catch (error) { state.notes.push(`${component.componentId}: ${key} could not be exported: ${diagnostic(error)}`); }
      }
      const formats = conditionalFormats(component, state); if (formats.length) out.conditional_formats = formats;
      if (!valueColorsUsed.has(sourceId ?? '')) {
        const colors = ctx.ext.updater('value_colors');
        if (!colors?.types || colors.types.includes(component.type)) {
          try { const value = colors?.read?.(component, state.doc); if (value && Object.keys(value as object).length) { out.value_colors = value; valueColorsUsed.add(sourceId ?? ''); } } catch { /* No color mappings for this component. */ }
        }
      }
    }
    dedicated = ['Title'];
  }
  const style = styleOf(ctx, component, depth, dedicated);
  if (style) out.style = { ...out.style, ...style };
  return out;
}
