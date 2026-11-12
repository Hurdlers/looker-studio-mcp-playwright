import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import type { Position } from '../../core/components.js';
import { componentId, fieldConcept, formulaConcept, place, resolveField, setSlot } from '../../core/components.js';
import { resolveSource, type ResolvedSource, type SourceField } from '../../core/datasource.js';
import { isDryRun } from '../../core/dryrun.js';
import { explain, LookerError } from '../../core/errors.js';
import type { ChartKind, ComponentUpdater, Extensions } from '../../core/extensions.js';
import { listPages, pageArg, pageComponents, pageSize, resolvePage } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import type { Rap } from '../../looker/rap.js';
import {
  AGGREGATIONS,
  allowedAggregations,
  defaultAggregation,
  findSlot,
  kindLabel,
  propertyKey,
  reportIdInput,
  reportIdOf,
  slotNames,
  slotsOf,
  type AggregationName,
  type Json,
  type Slot,
} from './common.js';
import { asSource, BLEND_DATASET_TYPE, blendsOf, findBlend, type PickedSource } from './blend-source.js';

// chart_add: a chart made in one save. The chart kind (chart-types-a/b,
// community) builds the component from its template; chart-core resolves the
// data source and fields first, then puts the fields in their slots, the
// breakdown, the Setup slots, the title, the size and place, and the options
// other groups add (filters, date range, style…), and saves the page once.
//
// What a kind's build(spec, ctx) gets as `spec`: chart_add's parsed input
// (type, dimensions, metrics, breakdown, fields, title, and any other key),
// plus
//   spec.concepts.dimensions  concepts for `dimensions`, in order
//   spec.concepts.metrics     concepts for `metrics`, aggregation and label applied
//   spec.concepts.breakdown   the breakdown concept, when given
//   spec.fields_of            { dimensions: SourceField[], metrics: SourceField[] } (types, for checks)
// A kind that puts these concept objects in its own slots (scatter's
// x_metric, a pivot's rows) keeps them there; when it leaves the primary
// slots empty chart-core fills them. ctx is { datasourceId, fields }.

const MAX_POS = 20_000;
const MIN_SIZE = 10;

// Chart kinds that take a breakdown dimension (chart_add type keys, compared
// without case, spaces, _ and -).
const BREAKDOWN_KINDS = new Set(
  [
    'time_series',
    'smoothed_time_series',
    'column',
    'stacked_column',
    'stacked_100_column',
    'bar',
    'stacked_bar',
    'stacked_100_bar',
    'line',
    'smoothed_line',
    'area',
    'stacked_area',
    'stacked_100_area',
    'combo',
    'stacked_combo',
    'sparkline',
    'histogram',
  ].map(norm),
);

// Rows the editor asks for by default, by component type.
const DEFAULT_ROWS: Record<string, number> = {
  'simple-geomap': 5000,
  'google-map': 3500,
  'simple-table': 100,
  'simple-barchart': 10,
  'simple-piechart': 10,
  'simple-combochart': 500,
  'simple-scatterchart': 1000,
};

// Chart types whose breakdown needs the primary dimension in breakdownConfig
// too (Looker answers 400 code 3 otherwise; area charts do without it).
const BREAKDOWN_WITH_PRIMARY = new Set(['simple-barchart', 'simple-combochart']);

// chart_add's own keys: an updater with one of these keys is not offered.
const OWN_KEYS = ['report_id', 'type', 'page', 'data_source', 'dimensions', 'metrics', 'breakdown', 'fields', 'title', 'position'];

const metricInput = z.object({
  field: z.string().min(1).describe('Field name as shown in the data source (sessions) or its id (_sessions_).'),
  aggregation: z
    .enum(Object.keys(AGGREGATIONS) as [AggregationName, ...AggregationName[]])
    .optional()
    .describe(
      "How to aggregate it in this chart. Defaults to the field's own default aggregation. Number fields take any; text and date fields take count or count_distinct; for fields that aggregate themselves (Record Count, calculated fields with SUM(...) etc.), omit aggregation.",
    ),
  calculation: z.enum(['none', 'percent_of_total']).optional().describe('Result calculation applied after aggregation; percent_of_total displays each value as its share of the total.'),
  relative_to_base: z.boolean().optional().describe('Use the base value for the result calculation. Requires calculation.'),
  bypass_filters: z.boolean().optional().describe('Ignore canvas filters for the result calculation. Requires calculation.'),
  label: z.string().optional().describe('Name shown for this metric in the chart (empty keeps the field name).'),
});

const positionInput = z
  .object({
    left: z.number().int().optional().describe('Pixels from the left edge of the page, 0 to 20000.'),
    top: z.number().int().optional().describe('Pixels from the top of the page, 0 to 20000.'),
    width: z.number().int().optional().describe('Width in pixels, 10 to 20000.'),
    height: z.number().int().optional().describe('Height in pixels, 10 to 20000.'),
  })
  .describe(
    'Where the chart goes and its size. Without left and top it goes 40 px from the left, 20 px below the lowest component on the page (kept within the page height). Without width and height a scorecard is 140x80 and other charts 380x280.',
  );

// The updaters other groups give that make sense for a chart.
function chartUpdaters(ext: Extensions): ComponentUpdater[] {
  const chartTypes = new Set(ext.chartKinds().map((k) => k.type));
  return ext.updaters().filter((u) => !OWN_KEYS.includes(u.key) && (!u.types || u.types.some((t) => chartTypes.has(t))));
}

export const chartAdd = defineTool({
  name: 'chart_add',
  title: 'Add a chart',
  description:
    'Adds a chart to a report page in a single save: picks the chart type, data source, dimensions, metrics (with aggregation, result calculation and label), breakdown dimension, extra Setup slots, title, position and size, plus any options listed below such as filters, date range and style. ' +
    'Use it to build a report from scratch or add a chart next to others; use component_update to change a chart afterwards and component_inspect to see how one is set up. ' +
    'Every check runs before anything is saved (field names, how many fields the type takes, allowed aggregations, slot titles), so a failed call leaves the report as it was. ' +
    'Fields are matched by the name shown in the data source or by id. A breakdown works only on time series, line, column, bar, area and combo charts. ' +
    'Style values: colors as "#RRGGBB" or {color, opacity}; percentages as "80%" (a bare number above 1 is a percent, from 0 to 1 already divided). ' +
    'An undo point is saved first (version_restore). Returns the new component_id; check the result with report_render.',
  input: (ext) => ({
    report_id: reportIdInput,
    type: ext.chartKindInput('Chart type, e.g. table, scorecard, column, bar, time_series, pie, pivot_table, scatter.'),
    page: pageArg.optional().describe('Page id or the name shown in the page list (or its number from 1). Defaults to the first page.'),
    data_source: z
      .string()
      .optional()
      .describe(
        "The report's data source to read: its name as listed, its alias (ds1) or id; or a blend in the report by its name. Defaults to the only data source, or to the one added last.",
      ),
    dimensions: z.array(z.string()).default([]).describe('Dimension fields, in order (for a pivot table, the row dimensions).'),
    metrics: z.array(metricInput).default([]).describe('Metric fields, in order.'),
    breakdown: z.string().optional().describe('Breakdown dimension field, splitting each bar, line or area by its values.'),
    fields: z
      .record(z.string(), z.array(z.string()))
      .optional()
      .describe(
        'More Setup slots by their title in the editor, each a list of fields, e.g. {"Column dimension": ["date"]} for a pivot table, {"Sparkline": ["date"]} or {"Target metric": ["goal"]} for a scorecard, {"Metric - X axis": [...], "Metric - Y axis": [...], "Bubble size metric": [...]} for a scatter chart. component_inspect shows the titles a chart has.',
      ),
    title: z.string().optional().describe('Chart title shown above the chart (empty: no title).'),
    position: positionInput.optional(),
    ...Object.fromEntries(chartUpdaters(ext).map((u) => [u.key, u.input.optional()])),
  }),
  write: true,
  run: async (ctx, a) => {
    const args = a as unknown as ChartArgs;
    const reportId = reportIdOf(args.report_id);
    const kind = ctx.ext.chartKind(args.type);
    if (!kind) {
      const keys = ctx.ext.chartKinds().map((k) => k.key);
      throw new LookerError('invalid', keys.length ? `No chart type "${args.type}". Types: ${keys.join(', ')}.` : 'No chart types are installed in this server.');
    }
    checkPosition(args.position);
    if (kind.creationTool && kind.creationTool !== 'chart_add')
      throw new LookerError('invalid', `Use ${kind.creationTool} to add a ${kind.key} visualization.`);
    kind.validate?.(args);
    const doc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, args.page);
    const source = await pickSource(ctx.rap, doc, args.data_source);
    const made = await buildChart(ctx, doc, pageId, kind, source, args);
    const { component, warnings, notes, work } = made;
    const id = String(component.componentId);
    const pageName = listPages(doc).find((p) => p.pageId === pageId)?.name ?? pageId;
    const box = (component.attributeConfig?.componentAttribute ?? {}) as Position;
    const where = `page "${pageName}" (${pageId}) at left ${box.left}, top ${box.top}, ${box.width}x${box.height}`;

    const workPage = work.page.find((p) => p.pageId === pageId)!;
    const conditions = (workPage.chartCondition ?? []).filter((c) => c.chartId === id);
    const savePage = (page: { page: Json; chartCondition?: Json[] }): void => {
      const list = (page.page.componentConfig ??= []) as Json[];
      if (list.some((c) => c.componentId === id)) return;
      list.push(structuredClone(component));
      if (conditions.length) page.chartCondition = [...(page.chartCondition ?? []).filter((c) => c.chartId !== id), ...structuredClone(conditions)];
    };
    const label = `add chart ${kind.key}`;
    const res = made.touchesReport
      ? await ctx.session.editReportThenPage(
          reportId,
          pageId,
          {
            report: (d) => {
              d.report = structuredClone(work.report);
              d.chartCondition = structuredClone(work.chartCondition ?? []);
            },
            page: savePage,
          },
          label,
        )
      : await ctx.session.editPage(reportId, pageId, savePage, label);

    if (!ctx.dryRun && !isDryRun(ctx.rap)) await checkSaved(ctx, reportId, id, kind);

    const lines = [
      `${ctx.dryRun ? 'Would add' : 'Added'} ${kindLabel(ctx.ext, component)} ${id} on ${where}, reading ${source.blend ? `blend "${source.name}" (${source.blend})` : `data source "${source.name}" (${source.alias || source.datasourceId})`}.`,
      ...(ctx.dryRun ? [] : [`Report version ${res.version}.${res.snapshot ? ` To undo, restore revision ${res.snapshot} (version_restore).` : ''}`]),
      ...warnings.map((w) => `Warning: ${w}`),
      ...notes,
      ...(ctx.dryRun ? [] : ['Look at it with report_render.']),
    ];
    return {
      ...text(lines.join('\n')),
      audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `${kind.key} ${id}` },
    };
  },
});

interface MetricArg {
  field: string;
  aggregation?: AggregationName;
  label?: string;
  calculation?: 'none' | 'percent_of_total';
  relative_to_base?: boolean;
  bypass_filters?: boolean;
}

interface ChartArgs {
  report_id: string;
  type: string;
  page?: string | number;
  data_source?: string;
  dimensions: string[];
  metrics: MetricArg[];
  breakdown?: string;
  fields?: Record<string, string[]>;
  title?: string;
  position?: Partial<Position>;
  [key: string]: unknown;
}

function checkPosition(p: Partial<Position> | undefined): void {
  if (!p) return;
  for (const key of ['left', 'top'] as const) {
    const v = p[key];
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > MAX_POS))
      throw new LookerError('invalid', `position.${key} must be a whole number of pixels from 0 to ${MAX_POS}, not ${v}.`);
  }
  for (const key of ['width', 'height'] as const) {
    const v = p[key];
    if (v !== undefined && (!Number.isInteger(v) || v < MIN_SIZE || v > MAX_POS))
      throw new LookerError('invalid', `position.${key} must be a whole number of pixels from ${MIN_SIZE} to ${MAX_POS}, not ${v}.`);
  }
}

// The data source a new chart reads: by name, alias or id; else the only one,
// or the one added last (as the editor gives a new chart). A blend is found
// by its name (or entry key) too; when a data source and a blend both fit,
// the one whose name matches exactly (case included) wins.
export async function pickSource(rap: Rap, doc: ReportDoc, name?: string): Promise<PickedSource> {
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  const blends = blendsOf(doc);
  const given = name?.trim() ? name : undefined;
  const hit = given ? findBlend(blends, given) : undefined;
  if (given && !hit) {
    const want = given.trim().toLowerCase();
    const same = blends.filter((b) => b.name.trim().toLowerCase() === want);
    if (same.length > 1)
      throw new LookerError('invalid', `${same.length} blends are named like "${given}" (${same.map((b) => `"${b.name}" ${b.key}`).join(', ')}): give the exact name or the key.`);
  }
  if (hit && !aliases.length) return asSource(hit.blend);
  const wanted = given ?? (aliases.length > 1 ? aliases[aliases.length - 1]!.alias : undefined);
  let source: ResolvedSource | undefined;
  try {
    source = await resolveSource(rap, doc, wanted);
  } catch (err) {
    const e = explain(err);
    const missing = e?.code === 'not_found' && given !== undefined && /No data source/.test(e.message);
    if (missing && hit) return asSource(hit.blend);
    if (missing) {
      const listed = blends.length ? ` Blends: ${blends.map((b) => `"${b.name}"`).join(', ')}.` : '';
      throw new LookerError('invalid', `${e!.message}${listed} Add it with datasource_add first, or name one of these.`);
    }
    throw err;
  }
  if (!hit) return source;
  const ref = given!.trim();
  const sourceExact = source.name === given || source.alias === ref || source.datasourceId === ref;
  if (sourceExact && !hit.exact) return source;
  if (hit.exact && !sourceExact) return asSource(hit.blend);
  throw new LookerError(
    'invalid',
    `Both data source "${source.name}" (${source.alias}) and blend "${hit.blend.name}" (${hit.blend.key}) fit "${given}": give the alias ${source.alias} for the data source or the key ${hit.blend.key} for the blend.`,
  );
}

interface Built {
  component: Json;
  warnings: string[];
  notes: string[];
  // The report as the options left it (filters may live at report level).
  work: ReportDoc;
  touchesReport: boolean;
}

// Everything up to the save: no request is sent from here on except the
// reads an option may need.
async function buildChart(
  ctx: ToolContext,
  doc: ReportDoc,
  pageId: string,
  kind: ChartKind,
  source: PickedSource,
  args: ChartArgs,
): Promise<Built> {
  const fields = source.fields;
  const warnings: string[] = [];
  const dimFields = args.dimensions.map((ref) => field(fields, ref, 'dimensions'));
  const metricFields = args.metrics.map((m) => field(fields, m.field, 'metrics'));
  const dims = dimFields.map((f) => fieldConcept(f));
  const metrics = args.metrics.map((m, i) => metricConcept(metricFields[i]!, m));
  const breakdown = args.breakdown !== undefined ? fieldConcept(field(fields, args.breakdown, 'breakdown')) : undefined;

  const spec: Json = {
    ...structuredClone(args),
    concepts: { dimensions: dims, metrics, ...(breakdown ? { breakdown } : {}) },
    fields_of: { dimensions: dimFields, metrics: metricFields },
  };
  const component = kind.build(spec, { datasourceId: source.datasourceId, fields });
  component.type ??= kind.type;
  component.preset ??= kind.preset ?? 'default';
  const taken = new Set(pageComponents(doc, pageId).map((c) => c.componentId));
  for (const p of doc.page) for (const c of p.page.componentConfig ?? []) taken.add(c.componentId);
  if (typeof component.componentId !== 'string' || !/^cd-[0-9a-f]{10}$/.test(component.componentId) || taken.has(component.componentId))
    component.componentId = componentId();
  const p = ((component.propertyConfig ??= {}).componentProperty ??= {});
  if (source.blend) {
    // A blend chart has no datasourceId of its own (see blend-source.ts).
    delete component.datasourceId;
    p.dataset = { datasetType: BLEND_DATASET_TYPE, datasetId: source.blend };
  } else {
    component.datasourceId = source.datasourceId;
    p.dataset = { datasetType: 1, datasetId: source.datasourceId };
  }
  component.conceptDefs ??= [];

  placeFields(component, dims, metrics);
  const slotted = applySlots(component, fields, args.fields, ctx.ext);
  const bd = breakdown ?? slotted.breakdown;
  if (breakdown && slotted.breakdown) throw new LookerError('invalid', 'Give the breakdown once: either `breakdown` or fields {"Breakdown dimension": [...]}.');
  if (bd && !BREAKDOWN_KINDS.has(norm(kind.key)))
    throw new LookerError('invalid', `A ${kind.key} chart takes no breakdown dimension. Time series, line, column, bar, area and combo charts do.`);
  applyBreakdown(component, bd, metrics);
  setTitle(component, args.title);
  if (p.row === undefined && DEFAULT_ROWS[component.type] !== undefined) p.row = DEFAULT_ROWS[component.type];
  const box = placement(doc, pageId, component, args.position);
  place(component, box);
  const canvas = pageSize(doc, pageId);
  if (box.left + box.width > canvas.width || box.top + box.height > canvas.height)
    warnings.push(`The chart reaches past the page (${canvas.width}x${canvas.height}): part of it is hidden until the page grows (page_settings_update).`);

  // Options other groups add (filters, date range, style, …), applied to a
  // copy of the report with the chart on its page.
  const work = structuredClone(doc);
  const workPage = work.page.find((x) => x.pageId === pageId)!;
  (workPage.page.componentConfig ??= []).push(component);
  const notes: string[] = [];
  let touchesReport = false;
  for (const u of chartUpdaters(ctx.ext)) {
    const value = args[u.key];
    if (value === undefined) continue;
    if (u.types && !u.types.includes(component.type))
      throw new LookerError('invalid', `${u.key} does not apply to a ${kind.key} chart (${component.type}).`);
    const note = await u.apply({ component, page: workPage, doc: work }, value, ctx);
    if (typeof note === 'string' && note) notes.push(note);
    touchesReport ||= Boolean(u.touchesReport);
  }
  workPage.page.componentConfig = (workPage.page.componentConfig ?? []).filter((c) => c !== component);
  touchesReport &&= !isDeepStrictEqual(work.report, doc.report) || !isDeepStrictEqual(work.chartCondition, doc.chartCondition);
  return { component, warnings, notes, work, touchesReport };
}

function field(fields: SourceField[], ref: string, what: string): SourceField {
  if (!ref.trim()) throw new LookerError('invalid', `An empty field name in ${what}.`);
  return resolveField(fields, ref);
}

export function metricConcept(f: SourceField, m: Omit<MetricArg, 'field'> = {}): Json {
  let aggregation: number | undefined;
  if (m.aggregation !== undefined) {
    const allowed = allowedAggregations(f);
    if (!allowed.includes(m.aggregation))
      throw new LookerError(
        'invalid',
        allowed.length
          ? `"${f.name}" cannot be aggregated with ${m.aggregation}: it takes ${allowed.join(', ')}.`
          : `"${f.name}" aggregates itself (Auto) and takes no aggregation: leave aggregation out.`,
      );
    aggregation = AGGREGATIONS[m.aggregation];
  } else aggregation = defaultAggregation(f);
  if (m.calculation === undefined && (m.relative_to_base !== undefined || m.bypass_filters !== undefined))
    throw new LookerError('invalid', 'Metric calculation flags require calculation.');
  const label = m.label?.trim() ? m.label : undefined;
  const concept = fieldConcept(f, { ...(label !== undefined ? { label } : {}), ...(aggregation !== undefined ? { aggregation } : {}) });
  if (m.calculation !== undefined) concept.resultTransformation = {
    analyticalFunction: m.calculation === 'percent_of_total' ? 1 : 0,
    isRelativeToBase: m.relative_to_base ?? false,
    bypassCanvasFilters: m.bypass_filters ?? false,
  };
  return concept;
}

function slotEntries(component: Json, kind: 'dimensions' | 'metrics'): Json[] {
  return (component.propertyConfig?.componentProperty?.[kind]?.labeledConcepts ?? []) as Json[];
}

// Puts the dimensions and metrics in the primary slots, unless the kind's
// builder already put them (or its own) somewhere.
function placeFields(component: Json, dims: Json[], metrics: Json[]): void {
  const inSlots = (kind: 'dimensions' | 'metrics') => new Set(slotEntries(component, kind).flatMap((lc) => (lc.value?.conceptNames ?? []) as string[]));
  const placed = (list: Json[], kind: 'dimensions' | 'metrics') => list.length > 0 && list.every((c) => inSlots(kind).has(c.name));
  const primaryDims = slotEntries(component, 'dimensions').find((lc) => lc.key === 'primary')?.value?.conceptNames ?? [];
  if (!placed(dims, 'dimensions') && !primaryDims.length && dims.length) setSlot(component, 'dimensions', 'primary', dims);
  const anyMetrics = slotEntries(component, 'metrics').some((lc) => lc.value?.conceptNames?.length);
  if (!placed(metrics, 'metrics') && !anyMetrics && metrics.length) setSlot(component, 'metrics', 'primary', metrics);
  // Concepts a builder named in a slot but left out of conceptDefs.
  const now = JSON.stringify(component.propertyConfig ?? {});
  const defs = component.conceptDefs as Json[];
  for (const c of [...dims, ...metrics]) if (now.includes(`"${c.name}"`) && !defs.some((d) => d.name === c.name)) defs.push(c);
}

// fields {"Slot title": [...]}: the Setup slots by title. Returns the
// breakdown when it came as a slot.
function applySlots(component: Json, fields: SourceField[], input: Record<string, string[]> | undefined, ext: Extensions): { breakdown?: Json } {
  if (!input) return {};
  const slots = slotsOf(component, ext);
  const titles = slots.map((s) => `"${s.title}"`).join(', ');
  let breakdown: Json | undefined;
  let rows: Json[] | undefined;
  let cols: Json[] | undefined;
  const plan: Array<[Slot, Json[]]> = [];
  for (const [title, refs] of Object.entries(input)) {
    if (!title.trim()) throw new LookerError('invalid', `An empty slot title in fields. This chart's slots: ${titles}.`);
    const slot = findSlot(slots, title);
    if (!slot) throw new LookerError('invalid', `No Setup slot "${title}" in a ${component.type} chart. Its slots: ${titles}.`);
    if (slot.max !== undefined && refs.length > slot.max)
      throw new LookerError('invalid', `Slot "${slot.title}" takes at most ${slot.max} field${slot.max === 1 ? '' : 's'}, not ${refs.length}.`);
    const concepts = refs.map((ref) => {
      const f = field(fields, ref, `slot "${slot.title}"`);
      if (slot.aggregation !== undefined) return fieldConcept(f, { aggregation: slot.aggregation });
      return slot.kind === 'metrics' ? metricConcept(f) : fieldConcept(f);
    });
    if (slot.breakdown) breakdown = concepts[0];
    else if (slot.pivotColumns) cols = concepts;
    else if (component.type === 'pivot-table' && slot.kind === 'dimensions' && slot.key === 'primary') rows = concepts;
    else plan.push([slot, concepts]);
  }
  for (const [slot, concepts] of plan) setSlot(component, slot.kind, slot.key, concepts);
  if (rows || cols) pivotSlots(component, rows, cols);
  return breakdown ? { breakdown } : {};
}

// A pivot table keeps row then column dimensions in dimensions.primary; the
// number of pivotDisplayConfig.row and .col entries splits them.
function pivotSlots(component: Json, rows: Json[] | undefined, cols: Json[] | undefined): void {
  const defs = component.conceptDefs as Json[];
  const byName = (n: string) => defs.find((d) => d.name === n) ?? { name: n };
  const rowSlot = findSlot(slotsOf(component), 'Row dimension')!;
  const colSlot = findSlot(slotsOf(component), 'Column dimension')!;
  const r = rows ?? slotNames(component, rowSlot).map(byName);
  const c = cols ?? slotNames(component, colSlot).map(byName);
  setSlot(component, 'dimensions', 'primary', [...r, ...c].filter((x) => x.queryTimeTransformation || defs.some((d) => d.name === x.name)));
  const p = component.propertyConfig.componentProperty;
  const pivot = ((p.pivotTableProperty ??= {}).pivotDisplayConfig ??= {});
  const old = (list: Json[] | undefined, name: string) => (list ?? []).find((e) => e?.sort?.[0]?.sortColumn === name);
  const entry = (list: Json[] | undefined) => (x: Json) => old(list, x.name) ?? { sort: [{ sortDir: 0, sortColumn: x.name }] };
  pivot.row = r.map(entry(pivot.row));
  pivot.col = c.map(entry(pivot.col));
  pivot.hierarchy ??= [];
}

// The breakdown slot and its breakdownConfig (without it Looker answers 500
// code 13): 10 values, ordered by the first metric, descending, the rest as
// "Others". Area charts need a breakdown: without one they get a constant
// "" concept, as the editor saves them.
function applyBreakdown(component: Json, breakdown: Json | undefined, metrics: Json[]): void {
  const p = component.propertyConfig.componentProperty;
  const hasSlot = slotEntries(component, 'dimensions').some((lc) => lc.key === 'breakdown');
  let b = breakdown;
  if (!b && component.type === 'simple-areachart') {
    const current = slotEntries(component, 'dimensions').find((lc) => lc.key === 'breakdown')?.value?.conceptNames ?? [];
    if (current.length) return;
    b = formulaConcept('""', '""', 0);
    delete b.queryTimeTransformation.dataTransformation.aggregation;
    b.queryTimeTransformation.displayTransformation.outputSemanticInfo = { semanticConfig: [{ semanticType: 32 }] };
  }
  if (!b) {
    if (hasSlot && !(p.breakdownConfig ?? []).length) p.breakdownConfig = [];
    return;
  }
  setSlot(component, 'dimensions', 'breakdown', [b]);
  const metricName = metrics[0]?.name ?? firstMetricName(component);
  const own = {
    conceptName: b.name,
    row: 10,
    sort: { ...(metricName ? { sortColumn: metricName } : {}), sortDir: 1 },
    reverseSortOrder: false,
    includeBreakdownOthers: true,
  };
  const primary = slotEntries(component, 'dimensions').find((lc) => lc.key === 'primary')?.value?.conceptNames?.[0] as string | undefined;
  if (BREAKDOWN_WITH_PRIMARY.has(component.type) && primary) {
    p.breakdownConfig = [{ conceptName: primary, row: 100, sort: { sortDir: 0, sortColumn: primary } }, own];
    if (!(p.sort ?? []).length) p.sort = [{ sortDir: 0, sortColumn: primary }];
  } else p.breakdownConfig = [own];
}

function firstMetricName(component: Json): string | undefined {
  for (const lc of slotEntries(component, 'metrics')) if (lc.value?.conceptNames?.length) return lc.value.conceptNames[0];
  return undefined;
}

// The editor's "Chart title" group: shown, this text, not generated.
function setTitle(component: Json, title: string | undefined): void {
  if (!title?.trim()) return;
  const key = propertyKey(component);
  if (!key) throw new LookerError('invalid', `A ${component.type} component has no chart title.`);
  const prop = (component.propertyConfig.componentProperty[key] ??= {});
  prop.chartTitleProperty = { ...(prop.chartTitleProperty ?? {}), chartTitleShowTitle: true, chartTitleText: title, chartTitleAutoGenerateText: false };
}

// Size first (given, else the editor's default for the type), then the
// place: given, else 40 px from the left and 20 px below the lowest box on
// the page, kept within the page height.
export function placement(doc: ReportDoc, pageId: string, component: Json, given: Partial<Position> = {}): Position {
  const kpi = component.type === 'kpi-metric';
  const width = given.width ?? (kpi ? 140 : 380);
  const height = given.height ?? (kpi ? 80 : 280);
  const bottom = Math.max(0, ...pageComponents(doc, pageId).map((c) => {
    const a = c.attributeConfig?.componentAttribute ?? {};
    return (a.top ?? 0) + (a.height ?? 0);
  }));
  const canvas = pageSize(doc, pageId);
  const top = given.top ?? Math.min(bottom + 20, Math.max(0, canvas.height - 120));
  return { left: given.left ?? 40, top, width, height };
}

// Reads the report back: the chart must be there as the kind asked for.
async function checkSaved(ctx: ToolContext, reportId: string, id: string, kind: ChartKind): Promise<void> {
  const doc = await ctx.session.load(reportId);
  const saved = [...doc.page.flatMap((p) => p.page.componentConfig ?? []), ...(doc.report.componentConfig ?? [])].find((c) => c.componentId === id) as
    | Json
    | undefined;
  if (!saved)
    throw new LookerError('format_changed', `updatePage answered but chart ${id} is not in report ${reportId}: Looker Studio may have changed its internal API.`);
  const preset = saved.preset ?? 'default';
  if (saved.type !== kind.type || (kind.preset && preset !== kind.preset))
    throw new LookerError(
      'format_changed',
      `Chart ${id} was saved as ${saved.type} (${preset}) instead of ${kind.type} (${kind.preset ?? 'default'}): Looker Studio may have changed its internal API. Undo with version_restore.`,
    );
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}
