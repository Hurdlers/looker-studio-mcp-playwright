import { fieldConcept, RECORD_COUNT, resolveField } from '../../core/components.js';
import { sourceFields, type SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ChartKind, UpdateTarget } from '../../core/extensions.js';
import type { ToolContext } from '../../core/tool.js';

export type Json = Record<string, any>;
export type Slot = NonNullable<ChartKind['slots']>[number];

export const PROPERTIES: Record<string, string> = {
  'simple-table': 'tableProperty', 'kpi-metric': 'kpiMetricProperty', 'simple-linechart': 'lineChartProperty',
  'simple-barchart': 'barChartProperty', 'simple-combochart': 'comboChartProperty', 'simple-areachart': 'areaChartProperty',
  'simple-piechart': 'pieChartProperty', 'pivot-table': 'pivotTableProperty', 'simple-scatterchart': 'scatterChartProperty',
  'simple-histogram': 'histogramProperty', 'simple-geomap': 'geoMapProperty', 'google-map': 'googleMapProperty',
  'simple-treemap': 'treeMapProperty', 'gauge-viz': 'gaugeVizProperty', bulletchart: 'bulletChartProperty',
  'simple-sankey': 'sankeyProperty', 'simple-waterfall': 'waterfallProperty', 'simple-timeline': 'timelineProperty',
  'simple-funnel': 'funnelProperty',
};

export const CHART_TYPES = Object.keys(PROPERTIES);
export const invalid = (message: string): LookerError => new LookerError('invalid', message);
export const prop = (c: Json): Json => ((c.propertyConfig ??= {}).componentProperty ??= {});
export function chartProperty(c: Json): Json {
  const key = PROPERTIES[String(c.type)];
  if (!key) throw invalid(`A ${c.type} component has no chart settings.`);
  return (prop(c)[key] ??= {});
}
export function requireType(c: Json, types: string[], option: string): void {
  if (!types.includes(String(c.type))) throw invalid(`${option} is unavailable for ${c.type}.`);
}
export function requireListControl(c: Json, option: string): void {
  if (c.type !== 'dimension-filter') return;
  if (prop(c).dimensionFilterProperty?.controlParameter)
    throw invalid(`${option} is unavailable for parameter controls.`);
  if (!['default', 'control-open-list'].includes(c.preset ?? 'default'))
    throw invalid(`${option} is available only for drop_down and fixed_size_list field controls.`);
}
export function hex(value: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw invalid(`Use a color with six hex digits, such as #1A73E8, instead of ${JSON.stringify(value)}.`);
  return value.toUpperCase();
}

const fieldCache = new WeakMap<object, Promise<SourceField[]>>();
export async function fieldsFor(target: UpdateTarget, ctx: ToolContext): Promise<SourceField[]> {
  let pending = fieldCache.get(target.component);
  if (!pending) {
    const id = target.component.datasourceId ?? prop(target.component).dataset?.datasetId;
    if (!id || prop(target.component).dataset?.datasetType === 2)
      throw invalid('This setting needs fields from a data source; select a data source before applying it.');
    pending = sourceFields(ctx.rap, String(id), { reportId: target.doc.shareable.id });
    fieldCache.set(target.component, pending);
  }
  return pending;
}

export const definitions = (c: Json): Json[] => (c.conceptDefs ??= []);
export const nameOf = (concept: Json): string => String(concept.queryTimeTransformation?.displayTransformation?.displayName ?? concept.queryTimeTransformation?.dataTransformation?.sourceFieldName ?? concept.name);
export const sourceOf = (concept: Json): string | undefined => concept.queryTimeTransformation?.dataTransformation?.sourceFieldName;
export const numeric = (field: SourceField): boolean => field.semanticType !== undefined ? [12, 13, 14, 15, 28, 33].includes(field.semanticType) : [1, 4, 5, 6, 10, 11, 12].includes(field.aggregation);
export const metricAggregation = (field: SourceField): number | undefined => field.aggregation === 7 ? undefined : numeric(field) ? field.aggregation : 3;

export function makeConcept(field: SourceField, asMetric: boolean): Json {
  const aggregation = asMetric ? metricAggregation(field) : undefined;
  return fieldConcept(field, aggregation !== undefined ? { aggregation } : {});
}

export function usedConcepts(c: Json, which?: 'dimensions' | 'metrics'): Json[] {
  const p = prop(c);
  const names = new Set((which ? [which] : ['dimensions', 'metrics']).flatMap((kind) => (p[kind]?.labeledConcepts ?? []).flatMap((slot: Json) => slot.value?.conceptNames ?? [])));
  return definitions(c).filter((concept) => names.has(concept.name));
}

export function findConcept(c: Json, ref: string, list = usedConcepts(c)): Json {
  const normalized = ref.trim().toLowerCase();
  const concept = list.find((entry) => nameOf(entry) === ref) ?? list.find((entry) => nameOf(entry).toLowerCase() === normalized) ??
    list.find((entry) => entry.name === ref || sourceOf(entry) === ref || sourceOf(entry)?.toLowerCase() === `_${normalized}_` || sourceOf(entry)?.toLowerCase() === normalized);
  if (!concept) throw invalid(`No field "${ref}" in this chart. Its fields: ${list.map(nameOf).join(', ')}.`);
  return concept;
}

export async function controlSourceField(target: UpdateTarget, ref: string, ctx: ToolContext): Promise<SourceField | undefined> {
  const fields = await fieldsFor(target, ctx);
  try { return resolveField(fields, ref); }
  catch { return undefined; }
}

// Sorting must not pick the first of two analytical uses of one source field.
// Prefer visible chart roles to auxiliary concepts (such as the raw date
// filter copied from a weekly displayed dimension), then require uniqueness.
function existingSortConcept(c: Json, ref: string): Json | undefined {
  const normalized = ref.trim().toLowerCase();
  const used = usedConcepts(c);
  const usedNames = new Set(used.map(concept => concept.name));
  for (const list of [used, definitions(c).filter(concept => !usedNames.has(concept.name))]) {
    const exact = list.filter(concept => nameOf(concept) === ref);
    const labels = exact.length ? exact : list.filter(concept => nameOf(concept).toLowerCase() === normalized);
    const ids = list.filter(concept => concept.name === ref);
    const matches = labels.length ? labels : ids.length ? ids : list.filter(concept =>
      sourceOf(concept)?.toLowerCase() === normalized || sourceOf(concept)?.toLowerCase() === `_${normalized}_`);
    if (matches.length > 1) throw invalid(`Sort reference "${ref}" is ambiguous; use a unique chart label for the intended field and aggregation.`);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

export async function sortConcept(target: UpdateTarget, ref: string, ctx: ToolContext): Promise<Json> {
  const c = target.component;
  if (c.type === 'dimension-filter' && [RECORD_COUNT.toLowerCase(), 'record count'].includes(ref.trim().toLowerCase())) {
    const current = definitions(c).find((entry) => sourceOf(entry) === RECORD_COUNT);
    if (current) return current;
    const count = fieldConcept({ id: RECORD_COUNT, name: 'Record Count', dataType: 3, aggregation: 7 });
    definitions(c).push(count);
    return count;
  }
  if (c.type === 'dimension-filter') {
    const field = await controlSourceField(target, ref, ctx);
    if (field) {
      const current = definitions(c).find((entry) => sourceOf(entry) === field.id);
      if (current) return current;
      const concept = makeConcept(field, field.kind === 'metric' || numeric(field));
      definitions(c).push(concept);
      return concept;
    }
  }
  const existing = existingSortConcept(c, ref);
  if (existing) return existing;
  // No chart match: a sort may introduce an undisplayed source field. An
  // ambiguous existing match above must never fall through to this default.
  const field = resolveField(await fieldsFor(target, ctx), ref);
  const concept = makeConcept(field, field.kind === 'metric' || numeric(field));
  definitions(c).push(concept);
  return concept;
}

const dimension: Slot = { title: 'Dimension', kind: 'dimensions', key: 'primary' };
const metric: Slot = { title: 'Metric', kind: 'metrics', key: 'primary' };
const breakdown: Slot = { title: 'Breakdown dimension', aliases: ['Breakdown'], kind: 'dimensions', key: 'breakdown', max: 1, breakdown: true };

export function slotsFor(c: Json, ctx: ToolContext): Slot[] {
  const provided = ctx.ext.kindOf(c)?.slots;
  if (provided) return provided;
  if (c.type === 'kpi-metric') return [
    c.preset === 'dimension-mode' ? { ...dimension, title: 'Primary field', max: 1 } : { ...metric, aliases: ['Primary field'], max: 1 },
    { title: 'Sparkline', kind: 'dimensions', key: 'sparkline', max: 1 }, { title: 'Target metric', aliases: ['Target'], kind: 'metrics', key: 'target', max: 1 },
  ];
  if (c.type === 'pivot-table') return [
    { ...dimension, title: 'Row dimension', aliases: ['Dimension'] },
    { ...dimension, title: 'Column dimension', pivotColumns: true }, metric,
  ];
  if (c.type === 'simple-scatterchart') return [dimension,
    { title: 'Metric - X axis', aliases: ['X-axis metric', 'X metric'], kind: 'metrics', key: 'x_metric', max: 1 },
    { title: 'Metric - Y axis', aliases: ['Y-axis metric', 'Y metric'], kind: 'metrics', key: 'y_metric', max: 1 },
    { title: 'Bubble size metric', aliases: ['Bubble size'], kind: 'metrics', key: 'bubble_size', max: 1 },
  ];
  return [dimension, metric, ...(['simple-barchart', 'simple-linechart', 'simple-combochart', 'simple-areachart'].includes(c.type) ? [breakdown] : [])];
}

export function matchSlot(slots: Slot[], title: string): Slot {
  const normalized = title.trim().toLowerCase();
  const slot = slots.find((entry) => [entry.title, ...(entry.aliases ?? [])].some((alias) => alias.toLowerCase() === normalized));
  if (!slot) throw invalid(`No Setup input "${title}". Choices: ${slots.map((entry) => entry.title).join(', ')}.`);
  return slot;
}

export function slotConcepts(c: Json, slot: Pick<Slot, 'kind' | 'key'>): Json[] {
  const names: string[] = prop(c)[slot.kind]?.labeledConcepts?.find((entry: Json) => entry.key === slot.key)?.value?.conceptNames ?? [];
  return names.flatMap((name) => definitions(c).find((concept) => concept.name === name) ?? []);
}
