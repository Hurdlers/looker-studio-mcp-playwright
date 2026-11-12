import { blankTemplate, fieldConcept, RECORD_COUNT, resolveField, setSlot, template, type BuildContext } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import type { ChartKind } from '../../core/extensions.js';

type Json = Record<string, any>;
type Kind = 'dimensions' | 'metrics';

// The editor's named Setup inputs, including aliases that refer to the same
// input. Bounds describe the resulting input after fields overrides defaults.
export interface SetupSlot {
  title: string;
  aliases?: string[];
  kind: Kind;
  key: string;
  min?: number;
  max?: number;
  aggregation?: number;
  breakdown?: true;
}

export interface ExtendedKind extends ChartKind {
  validate(spec: Json): void;
  slots: SetupSlot[];
}

interface Definition {
  key: string;
  type: string;
  preset?: string;
  title: string;
  slots: SetupSlot[];
  dimensionKey?: string;
  metricKeys?: string[];
  repeatedMetricKey?: string;
  noMetrics?: boolean;
  noDimensions?: boolean;
  breakdown?: boolean;
  seriesType?: number;
  countMetric?: boolean;
}

const dim = (min = 1, max = 1): SetupSlot => ({ title: 'Dimension', kind: 'dimensions', key: 'primary', min, max });
const metric = (min = 1, max = 1): SetupSlot => ({ title: 'Metric', kind: 'metrics', key: 'primary', min, max });
const breakdown: SetupSlot = {
  title: 'Breakdown dimension', aliases: ['Breakdown'], kind: 'dimensions', key: 'breakdown', max: 1, breakdown: true,
};

const mapSlots: SetupSlot[] = [
  { title: 'Location', kind: 'dimensions', key: 'primary', max: 1 },
  { title: 'Color dimension', kind: 'dimensions', key: 'bubble_color', max: 1 },
  { title: 'Tooltip', kind: 'dimensions', key: 'tooltip', max: 1 },
  { title: 'Location fields', aliases: ['Point'], kind: 'dimensions', key: 'connect_with', max: 10 },
  { title: 'Size', aliases: ['Size metric', 'Weight', 'Weight metric', 'Thickness', 'Thickness metric'], kind: 'metrics', key: 'size', max: 1 },
  { title: 'Color metric', kind: 'metrics', key: 'bubble_color', max: 1 },
  { title: 'Geospatial field', kind: 'metrics', key: 'geography', max: 1, aggregation: 16 },
  { title: 'Additional Layer Metric', kind: 'metrics', key: 'additional_layer_metric', max: 1 },
];

const scatterSlots: SetupSlot[] = [
  dim(),
  { title: 'Metric - X axis', aliases: ['X-axis metric', 'X metric'], kind: 'metrics', key: 'x_metric', min: 1, max: 1 },
  { title: 'Metric - Y axis', aliases: ['Y-axis metric', 'Y metric'], kind: 'metrics', key: 'y_metric', min: 1, max: 1 },
  { title: 'Bubble size metric', aliases: ['Bubble size'], kind: 'metrics', key: 'bubble_size', max: 1 },
];

const timelineSlots: SetupSlot[] = [
  { title: 'Row label', kind: 'dimensions', key: 'rowLabel', min: 1, max: 1 },
  { title: 'Bar label', kind: 'dimensions', key: 'barLabel', max: 1 },
  { title: 'Start time', kind: 'dimensions', key: 'startTime', min: 1, max: 1 },
  { title: 'End time', kind: 'dimensions', key: 'endTime', max: 1 },
  { title: 'Duration', kind: 'dimensions', key: 'duration', max: 1 },
  { title: 'Tooltip', kind: 'dimensions', key: 'tooltip', max: 1 },
];

function map(key: string, title: string, preset: string, dimensionKey: string, metricKeys: string[]): Definition {
  return { key, title, type: 'google-map', preset, slots: mapSlots, dimensionKey, metricKeys };
}

const definitions: Definition[] = [
  { key: 'sparkline', title: 'Sparkline chart', type: 'simple-linechart', preset: 'sparkline', slots: [dim(), metric(1, 20), breakdown], dimensionKey: 'primary', repeatedMetricKey: 'primary', breakdown: true },
  { key: 'histogram', title: 'Histogram', type: 'simple-histogram', slots: [dim(), breakdown], dimensionKey: 'primary', noMetrics: true, countMetric: true, breakdown: true },
  { key: 'geo', title: 'Geo chart', type: 'simple-geomap', slots: [dim(), metric()], dimensionKey: 'primary', repeatedMetricKey: 'primary' },
  map('bubble_map', 'Bubble map', 'default', 'primary', ['size', 'bubble_color']),
  map('filled_map', 'Filled map', 'choropleth', 'primary', ['bubble_color']),
  map('heatmap_map', 'Heatmap', 'with-heatmap-layer', 'primary', ['size']),
  map('line_map', 'Line map', 'line-map', 'primary', ['size']),
  map('connection_map', 'Connection map', 'connection_map', 'connect_with', ['size']),
  map('combo_map', 'Combo map', 'combo_map', 'primary', ['bubble_color', 'additional_layer_metric']),
  {
    key: 'treemap', title: 'Treemap', type: 'simple-treemap', dimensionKey: 'primary', repeatedMetricKey: 'primary',
    slots: [dim(1, 5), metric(), { title: 'Color dimension', kind: 'dimensions', key: 'color', max: 1 }, { title: 'Color metric', kind: 'metrics', key: 'color', max: 1 }, { title: 'Secondary label', kind: 'metrics', key: 'secondaryLabel', max: 1 }],
  },
  { key: 'gauge', title: 'Gauge', type: 'gauge-viz', slots: [metric()], noDimensions: true, repeatedMetricKey: 'primary' },
  { key: 'gauge_ranges', title: 'Gauge with ranges', type: 'gauge-viz', preset: 'with-ranges', slots: [metric()], noDimensions: true, repeatedMetricKey: 'primary' },
  { key: 'bullet', title: 'Bullet chart', type: 'bulletchart', slots: [metric()], noDimensions: true, repeatedMetricKey: 'primary' },
  { key: 'bubble', title: 'Bubble chart', type: 'simple-scatterchart', preset: 'bubble', slots: scatterSlots, dimensionKey: 'primary', metricKeys: ['x_metric', 'y_metric', 'bubble_size'] },
  { key: 'boxplot', title: 'Boxplot chart', type: 'simple-combochart', preset: 'boxplot', slots: [dim(), metric(5, 5)], dimensionKey: 'primary', repeatedMetricKey: 'primary', seriesType: 2 },
  { key: 'candlestick', title: 'Candlestick chart', type: 'simple-combochart', preset: 'candlesticks', slots: [dim(), metric(4, 4)], dimensionKey: 'primary', repeatedMetricKey: 'primary', seriesType: 3 },
  {
    key: 'sankey', title: 'Sankey', type: 'simple-sankey', dimensionKey: 'primary', repeatedMetricKey: 'sankey_weight',
    slots: [dim(2, 2), { title: 'Weight dimension', kind: 'dimensions', key: 'sankey_weight', max: 1 }, { title: 'Weight metric', aliases: ['Metric'], kind: 'metrics', key: 'sankey_weight', min: 1, max: 1 }],
  },
  { key: 'waterfall', title: 'Waterfall', type: 'simple-waterfall', slots: [dim(), metric()], dimensionKey: 'primary', repeatedMetricKey: 'primary' },
  { key: 'timeline', title: 'Timeline', type: 'simple-timeline', slots: timelineSlots, noDimensions: true, noMetrics: true },
  { key: 'funnel', title: 'Funnel chart smoothed bar', type: 'simple-funnel', slots: [dim(), metric()], dimensionKey: 'primary', repeatedMetricKey: 'primary' },
  { key: 'funnel_stepped', title: 'Funnel chart stepped bar', type: 'simple-funnel', preset: 'stepped-bar', slots: [dim(), metric()], dimensionKey: 'primary', repeatedMetricKey: 'primary' },
  { key: 'funnel_triangle', title: 'Funnel chart inverted triangle', type: 'simple-funnel', preset: 'inverted-triangle', slots: [dim(), metric()], dimensionKey: 'primary', repeatedMetricKey: 'primary' },
];

interface Ref {
  field: string;
  // Reuse the concepts chart_add has already resolved (including its labels
  // and chosen aggregation), unless fields explicitly replaces that input.
  concept?: Json;
}
type Assignment = Map<string, Ref[]>;
const slotId = (slot: Pick<SetupSlot, 'kind' | 'key'>): string => `${slot.kind}.${slot.key}`;

function plan(def: Definition, spec: Json): Assignment {
  const dimensions: string[] = spec.dimensions ?? [];
  const metrics: Json[] = spec.metrics ?? [];
  const titles = def.slots.map((s) => s.title).join(', ');
  const fail = (message: string): never => { throw new LookerError('invalid', `${def.key}: ${message} Setup inputs: ${titles}.`); };
  if (def.noDimensions && dimensions.length) fail('Use fields with the Setup input titles instead of dimensions.');
  if (def.noMetrics && metrics.length) fail('This chart accepts no metrics.');
  if (spec.breakdown !== undefined && !def.breakdown) fail('This chart accepts no breakdown dimension.');
  const out: Assignment = new Map(def.slots.map((s) => [slotId(s), []]));
  if (def.dimensionKey)
    out.set(`dimensions.${def.dimensionKey}`, dimensions.map((field, i) => ({ field, ...(spec.concepts?.dimensions?.[i] ? { concept: spec.concepts.dimensions[i] } : {}) })));
  if (def.metricKeys && metrics.length > def.metricKeys.length) fail(`At most ${def.metricKeys.length} metrics fit the default inputs; use fields to name another input.`);
  for (const [i, m] of metrics.entries()) {
    const key = def.repeatedMetricKey ?? def.metricKeys?.[i];
    if (key) {
      const id = `metrics.${key}`;
      const list = out.get(id) ?? [];
      list.push({ field: String(m.field), ...(spec.concepts?.metrics?.[i] ? { concept: spec.concepts.metrics[i] } : {}) });
      out.set(id, list);
    }
  }
  if (spec.breakdown !== undefined)
    out.set('dimensions.breakdown', [{ field: spec.breakdown, ...(spec.concepts?.breakdown ? { concept: spec.concepts.breakdown } : {}) }]);
  const assigned = new Set<string>();
  for (const [title, refs] of Object.entries(spec.fields ?? {}) as Array<[string, string[]]>) {
    const normalized = title.trim().toLowerCase();
    const slot = def.slots.find((s) => [s.title, ...(s.aliases ?? [])].some((x) => x.toLowerCase() === normalized));
    if (!slot) fail(`No Setup input named "${title}".`);
    const id = slotId(slot!);
    if (assigned.has(id)) fail(`Input "${slot!.title}" was given twice through different titles.`);
    assigned.add(id);
    if (slot!.breakdown && spec.breakdown !== undefined) fail('Give the breakdown once, either as breakdown or through fields.');
    out.set(id, refs.map((field) => ({ field })));
  }
  for (const slot of def.slots) {
    const count = out.get(slotId(slot))?.length ?? 0;
    if (count < (slot.min ?? 0) || count > (slot.max ?? Infinity)) {
      const bounds = slot.min === slot.max ? `exactly ${slot.min}` : `${slot.min ?? 0} to ${slot.max ?? 'any number of'}`;
      fail(`Input "${slot.title}" needs ${bounds} fields; received ${count}.`);
    }
  }
  if (def.type === 'google-map' && ![...out.values()].some((list) => list.length)) fail('Give at least one location or metric through dimensions, metrics or fields.');
  return out;
}

const aggregations: Record<string, number> = { none: 0, avg: 1, count: 2, count_distinct: 3, max: 4, min: 5, sum: 6 };
const numericSemanticTypes = new Set([33, 12, 13, 14, 15]);

function conceptFor(ref: Ref, slot: SetupSlot, ctx: BuildContext, spec: Json): Json {
  const field = resolveField(ctx.fields, ref.field);
  let concept: Json;
  if (ref.concept) concept = structuredClone(ref.concept);
  else {
    const given = (spec.metrics ?? []).find((m: Json) => m.field === ref.field) as Json | undefined;
    const metricDefault = field.aggregation === 7 ? undefined : field.semanticType !== undefined && !numericSemanticTypes.has(field.semanticType) ? 3 : field.aggregation;
    const aggregation = slot.aggregation ?? (slot.kind === 'metrics' ? (given?.aggregation !== undefined ? aggregations[String(given.aggregation)] : metricDefault) : undefined);
    concept = fieldConcept(field, { ...(aggregation !== undefined ? { aggregation } : {}), ...(given?.label !== undefined ? { label: given.label } : {}) });
  }
  if (slot.aggregation !== undefined) concept.queryTimeTransformation.dataTransformation.aggregation = slot.aggregation;
  if (field.outputSemanticInfo)
    concept.queryTimeTransformation.displayTransformation.outputSemanticInfo = structuredClone(field.outputSemanticInfo);
  else if (field.semanticType !== undefined)
    concept.queryTimeTransformation.displayTransformation.outputSemanticInfo = { semanticConfig: [{ semanticType: field.semanticType }] };
  return concept;
}

function build(def: Definition, spec: Json, ctx: BuildContext): Json {
  const assignments = plan(def, spec);
  const component = blankTemplate(template(def.type, def.preset ?? 'default'));
  component.type = def.type;
  component.preset = def.preset ?? 'default';
  component.datasourceId = ctx.datasourceId;
  const property = component.propertyConfig.componentProperty;
  property.dataset = { datasetType: 1, datasetId: ctx.datasourceId };
  for (const slot of def.slots) setSlot(component, slot.kind, slot.key, (assignments.get(slotId(slot)) ?? []).map((ref) => conceptFor(ref, slot, ctx, spec)));
  if (def.countMetric)
    setSlot(component, 'metrics', 'primary', [fieldConcept({ id: RECORD_COUNT, name: 'Record Count', dataType: 5, aggregation: 6 }, { aggregation: 6 })]);
  if (def.seriesType !== undefined) {
    const combo = (property.comboChartProperty ??= {});
    combo.seriesProperty = Array.from({ length: 20 }, (_, i) => ({ ...(combo.seriesProperty?.[i] ?? {}), seriesType: def.seriesType }));
  }
  return component;
}

export const chartKinds: ExtendedKind[] = definitions.map((def) => ({
  key: def.key,
  type: def.type,
  preset: def.preset ?? 'default',
  title: def.title,
  slots: def.slots,
  validate: (spec) => { plan(def, spec); },
  build: (spec, ctx) => build(def, spec, ctx),
}));

export function setupSlots(component: Json): SetupSlot[] {
  return chartKinds.find((kind) => kind.type === component.type && kind.preset === (component.preset ?? 'default'))?.slots ?? [];
}
