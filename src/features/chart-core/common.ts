import { z } from 'zod';

import type { SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { Extensions } from '../../core/extensions.js';
import { listPages } from '../../core/page.js';
import type { PageDoc, ReportDoc } from '../../core/session.js';
import { parseReportId } from '../../looker/view.js';

// What the chart-core tools share: the report input, finding a component by
// id anywhere in a report, naming a component's kind, the chart's own
// property block, aggregations, and the Setup slots of each chart type.

export type Json = Record<string, any>;

export const reportIdInput = z.string().min(1).describe('Report id, or a Looker Studio report URL that contains /reporting/<id>.');

export function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}

// ---- Components ---------------------------------------------------------------

export interface Located {
  component: Json;
  // Undefined for a report-level component (shown on every page).
  page?: PageDoc;
  pageName: string;
}

// A component by id on any page or at report level.
export function locate(doc: ReportDoc, componentId: string): Located | undefined {
  const names = new Map(listPages(doc).map((p) => [p.pageId, p.name]));
  for (const page of doc.page) {
    const component = (page.page.componentConfig ?? []).find((c) => c.componentId === componentId);
    if (component) return { component: component as Json, page, pageName: names.get(page.pageId) ?? page.pageId };
  }
  const component = (doc.report.componentConfig ?? []).find((c) => c.componentId === componentId);
  return component ? { component: component as Json, pageName: 'report level' } : undefined;
}

export function allComponentIds(doc: ReportDoc): string[] {
  return [...doc.page.flatMap((p) => p.page.componentConfig ?? []), ...(doc.report.componentConfig ?? [])].map((c) => String(c.componentId));
}

export function notFound(doc: ReportDoc, componentId: string): LookerError {
  const ids = allComponentIds(doc);
  const shown = ids.slice(0, 30).join(', ');
  return new LookerError(
    'not_found',
    `No component "${componentId}" in report ${doc.shareable.id}. ${ids.length ? `Its components: ${shown}${ids.length > 30 ? ', …' : ''}` : 'It has no components'} (component_list shows them by page).`,
  );
}

// How lists name a component: the chart_add type and the editor's name when a
// chart kind is registered for it ("stacked_bar (Stacked bar chart)"),
// otherwise the component type with its preset.
export function kindLabel(ext: Extensions, component: Json): string {
  const kind = ext.kindOf(component);
  if (kind) return kind.title ? `${kind.key} (${kind.title})` : kind.key;
  const preset = component.preset && component.preset !== 'default' ? ` ${component.preset}` : '';
  return `${component.type ?? 'unknown'}${preset}`;
}

// The block that holds a chart's own settings (title, style), e.g.
// barChartProperty for simple-barchart.
const PROPERTY_KEYS: Record<string, string> = {
  'simple-table': 'tableProperty',
  'kpi-metric': 'kpiMetricProperty',
  'simple-linechart': 'lineChartProperty',
  'simple-barchart': 'barChartProperty',
  'simple-piechart': 'pieChartProperty',
  'simple-combochart': 'comboChartProperty',
  'simple-areachart': 'areaChartProperty',
  'pivot-table': 'pivotTableProperty',
  'simple-scatterchart': 'scatterChartProperty',
};

export function propertyKey(component: Json): string | undefined {
  const known = PROPERTY_KEYS[String(component.type)];
  if (known) return known;
  const p = component.propertyConfig?.componentProperty ?? {};
  return Object.keys(p).find((k) => /[a-z]Property$/.test(k) && p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]));
}

// ---- Aggregations ---------------------------------------------------------------

// The editor's aggregation numbers.
export const AGGREGATIONS = {
  none: 0,
  avg: 1,
  count: 2,
  count_distinct: 3,
  max: 4,
  min: 5,
  sum: 6,
} as const;
export type AggregationName = keyof typeof AGGREGATIONS;

const AGGREGATION_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Average',
  2: 'Count',
  3: 'Count Distinct',
  4: 'Max',
  5: 'Min',
  6: 'Sum',
  7: 'Auto',
  10: 'Median',
  11: 'Variance',
  12: 'Standard Deviation',
};

export function aggregationLabel(n: number): string {
  return AGGREGATION_LABELS[n] ?? `aggregation ${n}`;
}

// Auto: the field aggregates itself (Record Count, a calculated field with
// SUM(...) in it) and cannot be aggregated again.
export const AUTO = 7;

// Number, currency, percent and the other number semantic types.
const NUMBER_TYPES = new Set([33, 12, 13, 14, 15]);
// Text, dates, geo, boolean, URL …: everything that is not a number.
const NUMBER_DEFAULTS = new Set([1, 4, 5, 6, 10, 11, 12]);

export function isNumeric(field: SourceField): boolean {
  if (field.semanticType !== undefined) return NUMBER_TYPES.has(field.semanticType);
  return NUMBER_DEFAULTS.has(field.aggregation);
}

// The aggregations a field takes as a chart metric.
export function allowedAggregations(field: SourceField): AggregationName[] {
  if (field.aggregation === AUTO) return [];
  if (isNumeric(field)) return Object.keys(AGGREGATIONS) as AggregationName[];
  return ['count', 'count_distinct'];
}

// The aggregation a metric gets when none is asked for: the field's default;
// none at all for an Auto field; Count Distinct for a text field (a text
// value cannot be summed).
export function defaultAggregation(field: SourceField): number | undefined {
  if (field.aggregation === AUTO) return undefined;
  if (!isNumeric(field) && (field.aggregation === 0 || NUMBER_DEFAULTS.has(field.aggregation))) return AGGREGATIONS.count_distinct;
  return field.aggregation;
}

// ---- Setup slots ------------------------------------------------------------------

// One field slot of the editor's Setup panel ("Dimension", "Sparkline",
// "Metric - X axis") and where its fields go.
export interface Slot {
  title: string;
  aliases?: string[];
  kind: 'dimensions' | 'metrics';
  key: string;
  max?: number;
  aggregation?: number;
  // Pivot table column dimensions: after the row dimensions in
  // dimensions.primary, counted by pivotDisplayConfig.col.
  pivotColumns?: true;
  // The breakdown dimension: also needs a breakdownConfig entry.
  breakdown?: true;
}

const DIMENSION: Slot = { title: 'Dimension', kind: 'dimensions', key: 'primary' };
const METRIC: Slot = { title: 'Metric', kind: 'metrics', key: 'primary' };
const BREAKDOWN: Slot = { title: 'Breakdown dimension', aliases: ['Breakdown'], kind: 'dimensions', key: 'breakdown', max: 1, breakdown: true };

const SLOTS: Record<string, Slot[]> = {
  'simple-table': [DIMENSION, METRIC],
  'simple-barchart': [DIMENSION, BREAKDOWN, METRIC],
  'simple-linechart': [DIMENSION, BREAKDOWN, METRIC],
  'simple-combochart': [DIMENSION, BREAKDOWN, METRIC],
  'simple-areachart': [DIMENSION, BREAKDOWN, METRIC],
  'simple-piechart': [DIMENSION, METRIC],
  'pivot-table': [
    { title: 'Row dimension', aliases: ['Dimension'], kind: 'dimensions', key: 'primary' },
    { title: 'Column dimension', kind: 'dimensions', key: 'primary', pivotColumns: true },
    METRIC,
  ],
  'simple-scatterchart': [
    DIMENSION,
    { title: 'Metric - X axis', aliases: ['X-axis metric', 'X metric'], kind: 'metrics', key: 'x_metric', max: 1 },
    { title: 'Metric - Y axis', aliases: ['Y-axis metric', 'Y metric'], kind: 'metrics', key: 'y_metric', max: 1 },
    { title: 'Bubble size metric', aliases: ['Bubble size'], kind: 'metrics', key: 'bubble_size', max: 1 },
  ],
};

const KPI_SLOTS = (dimensionMode: boolean): Slot[] => [
  dimensionMode
    ? { title: 'Primary field', kind: 'dimensions', key: 'primary', max: 1 }
    : { title: 'Metric', aliases: ['Primary field'], kind: 'metrics', key: 'primary', max: 1 },
  { title: 'Sparkline', kind: 'dimensions', key: 'sparkline', max: 1 },
  { title: 'Target metric', aliases: ['Target'], kind: 'metrics', key: 'target', max: 1 },
];

// The slots of a component: from the table for the chart types the editor
// shows Setup titles for, otherwise one per labeledConcepts key the
// component has ("primary" is Dimension / Metric, "tooltip" is Tooltip).
export function slotsOf(component: Json, ext?: Extensions): Slot[] {
  const custom = ext?.kindOf(component)?.slots;
  if (custom) return custom;
  if (component.type === 'kpi-metric') return KPI_SLOTS(component.preset === 'dimension-mode');
  const known = SLOTS[String(component.type)];
  if (known) return known;
  const p = component.propertyConfig?.componentProperty ?? {};
  const out: Slot[] = [];
  for (const kind of ['dimensions', 'metrics'] as const)
    for (const lc of (p[kind]?.labeledConcepts ?? []) as Json[]) {
      const key = String(lc.key);
      if (key === 'primary') out.push(kind === 'dimensions' ? DIMENSION : METRIC);
      else if (key === 'breakdown' && kind === 'dimensions') out.push(BREAKDOWN);
      else out.push({ title: titleOf(key, kind), kind, key });
    }
  return out;
}

function titleOf(key: string, kind: 'dimensions' | 'metrics'): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  const title = words ? words[0]!.toUpperCase() + words.slice(1) : kind === 'dimensions' ? 'Dimension' : 'Metric';
  return /^\d+$/.test(key) ? `${kind === 'dimensions' ? 'Dimension' : 'Metric'} ${key}` : title;
}

// A slot by its title (case and surrounding spaces ignored, whole title).
export function findSlot(slots: Slot[], title: string): Slot | undefined {
  const want = title.trim().toLowerCase();
  return slots.find((s) => [s.title, ...(s.aliases ?? [])].some((t) => t.toLowerCase() === want));
}

export function slotNames(component: Json, slot: Slot): string[] {
  const p = component.propertyConfig?.componentProperty ?? {};
  const entry = ((p[slot.kind]?.labeledConcepts ?? []) as Json[]).find((lc) => lc.key === slot.key);
  const names: string[] = entry?.value?.conceptNames ?? [];
  if (component.type !== 'pivot-table' || slot.key !== 'primary' || slot.kind !== 'dimensions') return names;
  // Pivot tables keep rows then columns in one list.
  const rows = (p.pivotTableProperty?.pivotDisplayConfig?.row ?? []).length || names.length;
  return slot.pivotColumns ? names.slice(rows) : names.slice(0, rows);
}

// "sessions (Sum)" for a metric, the name for a dimension.
export function conceptText(concept: Json | undefined, fields: SourceField[] = []): string {
  if (!concept) return '?';
  const t = concept.queryTimeTransformation ?? {};
  const source = t.dataTransformation?.sourceFieldName;
  const name = t.displayTransformation?.displayName ?? fields.find((f) => f.id === source)?.name ?? source ?? concept.name;
  const formula = t.dataTransformation?.textFormula;
  const agg = t.dataTransformation?.aggregation;
  const how = formula ? `formula ${formula}` : agg !== undefined && agg !== AUTO ? aggregationLabel(agg) : '';
  return how ? `${name} (${how})` : String(name);
}
