import { z } from 'zod';

import { fieldConcept } from '../../core/components.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { CHART_TYPES, definitions, fieldsFor, invalid, nameOf, prop, sourceOf, usedConcepts, type Json } from './common.js';

// Query transformation IDs differ from semantic type IDs. Each entry also
// lists the source precisions offered by the editor for that transformation.
const DATE_TRANSFORMS = {
  Year: { id: 1, semantic: 6, from: [3, 2, 1, 36, 37] },
  'Year Quarter': { id: 2, semantic: 40, from: [3, 2, 1, 36, 37] },
  'Year Month': { id: 3, semantic: 3, from: [2, 1, 36, 37] },
  'Year Week': { id: 4, semantic: 4, from: [2, 1, 36, 37] },
  Date: { id: 5, semantic: 2, from: [1, 36, 37] },
  'Date Hour': { id: 6, semantic: 1, from: [36, 37] },
  'Date Hour Minute': { id: 7, semantic: 36, from: [37] },
  'Date & Time': { id: 8, semantic: 37, from: [] },
  Quarter: { id: 9, semantic: 39, from: [3, 2, 1, 36, 37] },
  Month: { id: 10, semantic: 7, from: [3, 2, 1, 36, 37] },
  Week: { id: 11, semantic: 8, from: [2, 1, 36, 37] },
  'Month Day': { id: 12, semantic: 38, from: [2, 1, 36, 37] },
  'Day of week': { id: 13, semantic: 5, from: [2, 1, 36, 37] },
  Day: { id: 14, semantic: 9, from: [2, 1, 36, 37] },
  Hour: { id: 15, semantic: 10, from: [1, 36, 37] },
  Minute: { id: 16, semantic: 11, from: [36, 37] },
};
const DATE_TYPES = new Set(Object.values(DATE_TRANSFORMS).map((entry) => entry.semantic));
const granularity = z.enum(['Auto', ...Object.keys(DATE_TRANSFORMS)] as [string, ...string[]]);
export const fieldFormatsInput = z.array(z.strictObject({
  field: z.string().trim().min(1).describe('Current chart field label or field ID. Use a unique label when a source field appears more than once.'),
  kind: z.enum(['dimension', 'metric']).optional().describe('Restrict the reference to a dimension or metric when needed.'),
  date_granularity: granularity.optional().describe('Chart-only date grouping. Auto restores the source precision; the source and date-range filter are unchanged.'),
  display_format: z.string().min(1).max(128).refine((value) => value.trim().length > 0, 'A format cannot be blank.').nullable().optional()
    .describe('Chart field format pattern, such as y.MM or 0.00%. null removes an explicit pattern.'),
}).refine((entry) => entry.date_granularity !== undefined || entry.display_format !== undefined, 'Give date_granularity or display_format.'))
  .max(100).describe('Chart-level grouping and display patterns for selected fields. Does not change the data source.');
type Format = z.infer<typeof fieldFormatsInput>[number];

function reference(component: Json, entry: Format): Json {
  const list = usedConcepts(component, entry.kind === 'dimension' ? 'dimensions' : entry.kind === 'metric' ? 'metrics' : undefined);
  const key = entry.field.toLowerCase();
  const named = list.filter((concept) => nameOf(concept).toLowerCase() === key);
  const matches = named.length ? named : list.filter((concept) => concept.name === entry.field || sourceOf(concept)?.toLowerCase() === key);
  if (matches.length !== 1) throw invalid(`Field format reference "${entry.field}" ${matches.length ? 'is ambiguous; use a unique chart label' : 'is not a field used by this chart'}.`);
  return matches[0]!;
}

export function fieldFormatIssue(concept: Json, component?: Json): string | undefined {
  const query = concept.queryTimeTransformation ?? {};
  const config = query.dataTransformation?.transformationConfig;
  const type = config?.transformationType;
  if (type !== undefined && type !== 0 && !Object.values(DATE_TRANSFORMS).some((entry) => entry.id === type))
    return `date transformation ${type} is not supported by field_formats`;
  if (config && Object.entries(config).some(([key, value]) => key !== 'transformationType' && value !== undefined && value !== null && value !== false && value !== 0))
    return 'additional transformation options cannot be recreated by field_formats';
  const format = query.displayTransformation?.displayFormat;
  if (format !== undefined && format !== '' && (typeof format !== 'string' || !format.trim() || format.length > 128))
    return 'the native display format cannot be represented by field_formats';
  if (component && (type || format)) for (const which of ['dimensions', 'metrics'] as const) {
    const list = usedConcepts(component, which);
    if (list.some((entry) => entry.name === concept.name) && list.filter((entry) => nameOf(entry).toLowerCase() === nameOf(concept).toLowerCase()).length > 1)
      return `field format label "${nameOf(concept)}" is ambiguous`;
  }
  return undefined;
}

export const fieldFormatsUpdater: ComponentUpdater = {
  key: 'field_formats', types: CHART_TYPES, input: fieldFormatsInput,
  apply: async (target, value, ctx) => {
    const entries = value as Format[];
    const fields = entries.some((entry) => entry.date_granularity !== undefined) ? await fieldsFor(target, ctx) : [];
    const dimensions = new Set(usedConcepts(target.component, 'dimensions').map((concept) => concept.name));
    const seen = new Set<string>();
    // Resolve and validate every entry before changing any concept.
    const plans = entries.map((entry) => {
      const concept = reference(target.component, entry);
      if (seen.has(concept.name)) throw invalid(`Field "${entry.field}" has more than one format entry.`);
      seen.add(concept.name);
      const field = fields.find((candidate) => candidate.id === sourceOf(concept));
      const date = entry.date_granularity && entry.date_granularity !== 'Auto'
        ? DATE_TRANSFORMS[entry.date_granularity as keyof typeof DATE_TRANSFORMS] : undefined;
      if (entry.date_granularity !== undefined) {
        if (!dimensions.has(concept.name) || !field || !DATE_TYPES.has(field.semanticType ?? -1))
          throw invalid(`"${entry.field}" must be a date dimension for date_granularity.`);
        if (date && field.semanticType !== date.semantic && !date.from.includes(field.semanticType!))
          throw invalid(`"${entry.field}" cannot be grouped as ${entry.date_granularity} from its source date precision.`);
      }
      return { entry, concept, field, date };
    });
    for (const { entry, concept, field, date } of plans) {
      const query = concept.queryTimeTransformation ??= {};
      const display = query.displayTransformation ??= {};
      if (entry.date_granularity !== undefined) {
        // Creation may reuse the displayed dimension as the date filter.
        // Split that reference before grouping so date bounds still use
        // the source precision rather than the chart's month/year buckets.
        if (prop(target.component).dateRangeDimension === concept.name) {
          const range = fieldConcept(field!);
          definitions(target.component).push(range);
          prop(target.component).dateRangeDimension = range.name;
        }
        const data = query.dataTransformation ??= {};
        if (!date || date.semantic === field!.semanticType) delete data.transformationConfig;
        else data.transformationConfig = { transformationType: date.id };
        const semantic: Json = structuredClone(field!.outputSemanticInfo ?? {});
        const configs = Array.isArray(semantic.semanticConfig) ? semantic.semanticConfig : [];
        semantic.semanticConfig = [{ ...configs[0], semanticType: date?.semantic ?? field!.semanticType }, ...configs.slice(1)];
        display.outputSemanticInfo = semantic;
        delete display.displayFormat;
      }
      if (entry.display_format === null) delete display.displayFormat;
      else if (entry.display_format !== undefined) display.displayFormat = entry.display_format;
    }
  },
  read: (component) => {
    const output: Json[] = [];
    for (const [which, kind] of [['dimensions', 'dimension'], ['metrics', 'metric']] as const) for (const concept of usedConcepts(component, which)) {
      const issue = fieldFormatIssue(concept, component); if (issue) throw invalid(issue);
      const query = concept.queryTimeTransformation ?? {};
      const type = query.dataTransformation?.transformationConfig?.transformationType;
      const date = Object.entries(DATE_TRANSFORMS).find(([, entry]) => entry.id === type)?.[0];
      const format = query.displayTransformation?.displayFormat;
      if (date || (typeof format === 'string' && format.length)) output.push({ field: nameOf(concept), kind,
        ...(date ? { date_granularity: date } : {}), ...(typeof format === 'string' && format.length ? { display_format: format } : {}) });
    }
    return output.length ? output : undefined;
  },
};
