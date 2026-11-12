import { blankTemplate, componentId, fieldConcept, RECORD_COUNT, resolveField, setSlot, template, type BuildContext } from '../../core/components.js';
import type { SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ChartKind } from '../../core/extensions.js';
import type { Registration, VisualizationConfig, Json } from './registration.js';

export interface SetupSlot {
  id: string;
  title: string;
  kind: 'dimensions' | 'metrics';
  key: string;
  min: number;
  max?: number;
}
export interface MetricInput { field: string; aggregation?: string; label?: string }
export interface FieldInput { dimensions: string[]; metrics: MetricInput[]; fields?: Record<string, string[]> }

export function setupSlots(config: VisualizationConfig): SetupSlot[] {
  const count = { dimensions: 0, metrics: 0 };
  return (config.data ?? []).flatMap((section) => (section.elements ?? []).flatMap((element): SetupSlot[] => {
    if (!['DIMENSION', 'METRIC'].includes(element.type)) return [];
    if (!element.id || !element.label) throw new LookerError('format_changed', 'A visualization field input is missing its id or label.');
    const kind = element.type === 'DIMENSION' ? 'dimensions' : 'metrics';
    const options = Array.isArray(element.options) ? {} : element.options ?? {};
    return [{ id: element.id, title: element.label, kind, key: String(count[kind]++), min: options.min ?? 0, ...(options.max !== undefined ? { max: options.max } : {}) }];
  }));
}

const AGGREGATIONS: Record<string, number> = { none: 0, avg: 1, count: 2, count_distinct: 3, max: 4, min: 5, sum: 6 };
const numeric = (field: SourceField) => field.semanticType !== undefined ? [12, 13, 14, 15, 28, 33].includes(field.semanticType) : [1, 4, 5, 6, 10, 11, 12].includes(field.aggregation);
const countField: SourceField = { id: RECORD_COUNT, name: 'Record Count', dataType: 5, aggregation: 7, semanticType: 33 };

function field(fields: SourceField[], ref: string): SourceField {
  return ref.trim().toLowerCase() === 'record count' || ref === RECORD_COUNT ? fields.find((entry) => entry.id === RECORD_COUNT) ?? countField : resolveField(fields, ref);
}

export function metricConcept(source: SourceField, input: MetricInput): Json {
  const allowed = source.aggregation === 7 ? [] : numeric(source) ? Object.keys(AGGREGATIONS) : ['count', 'count_distinct'];
  if (input.aggregation !== undefined && !allowed.includes(input.aggregation))
    throw new LookerError('invalid', `Metric "${source.name}" accepts ${allowed.length ? allowed.join(', ') : 'no explicit aggregation (it is Auto)'}. Leave aggregation out or choose one of these.`);
  const aggregation = input.aggregation !== undefined ? AGGREGATIONS[input.aggregation] : source.aggregation === 7 ? undefined : numeric(source) ? source.aggregation : 3;
  return fieldConcept(source, { ...(aggregation !== undefined ? { aggregation } : {}), ...(input.label !== undefined ? { label: input.label } : {}) });
}

export function buildCommunity(registration: Registration, input: FieldInput, ctx: BuildContext): Json {
  const component = blankTemplate(template(registration.vizId === 'gs://dscv/public/sunburst\u00a0sunburst_v1' ? registration.vizId : 'google://devrel/gauge'));
  component.componentId = componentId();
  component.type = registration.vizId;
  component.preset = 'default';
  component.datasourceId = ctx.datasourceId;
  component.keyConfig = { display: { keyConfig: [] } };
  const property = component.propertyConfig.componentProperty;
  property.dataset = { datasetType: 1, datasetId: ctx.datasourceId };
  property.dimensions = { labeledConcepts: [] };
  property.metrics = { labeledConcepts: [] };
  property.thirdPartyVizProperty = { keyConfig: [], isMigrated: true };
  property.componentPropertyMigrationStatus = 2;
  const slots = setupSlots(registration.config);
  const assigned = new Map<SetupSlot, Json[]>();
  const explicit = new Set<SetupSlot>();
  const primary = (kind: 'dimensions' | 'metrics'): SetupSlot => {
    const pattern = kind === 'dimensions' ? /^(dimension|row dimension)/i : /^(metric|primary field)/i;
    const slot = slots.find((entry) => entry.kind === kind && pattern.test(entry.title));
    if (!slot) throw new LookerError('invalid', `This visualization has no standard ${kind} input. Use fields with its titles: ${slots.filter((entry) => entry.kind === kind).map((entry) => entry.title).join(', ') || '(none)'}.`);
    return slot;
  };
  if (input.dimensions.length) {
    const slot = primary('dimensions');
    assigned.set(slot, input.dimensions.map((ref) => fieldConcept(field(ctx.fields, ref)))); explicit.add(slot);
  }
  if (input.metrics.length) {
    const slot = primary('metrics');
    assigned.set(slot, input.metrics.map((spec) => metricConcept(field(ctx.fields, spec.field), spec))); explicit.add(slot);
  }
  for (const [title, refs] of Object.entries(input.fields ?? {})) {
    const slot = slots.find((entry) => entry.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (!slot) throw new LookerError('invalid', `No Setup input "${title}" in this visualization. Choices: ${slots.map((entry) => entry.title).join(', ')}.`);
    const concepts = refs.map((ref) => {
      const resolved = field(ctx.fields, ref);
      const previous = assigned.get(slot)?.find((concept) => concept.queryTimeTransformation.dataTransformation.sourceFieldName === resolved.id);
      return previous ?? (slot.kind === 'dimensions' ? fieldConcept(resolved) : metricConcept(resolved, { field: ref }));
    });
    assigned.set(slot, concepts); explicit.add(slot);
  }
  for (const slot of slots) {
    let concepts = assigned.get(slot) ?? [];
    if (!explicit.has(slot) && slot.min > 0) {
      const candidates = slot.kind === 'metrics'
        ? [ctx.fields.find((entry) => entry.id === RECORD_COUNT) ?? countField, ...ctx.fields.filter((entry) => entry.id !== RECORD_COUNT && numeric(entry))]
        : [...ctx.fields.filter((entry) => entry.kind === 'dimension' || !numeric(entry)), ...ctx.fields.filter((entry) => entry.kind !== 'dimension' && numeric(entry))];
      concepts = candidates.slice(0, slot.min).map((entry) => slot.kind === 'dimensions' ? fieldConcept(entry) : metricConcept(entry, { field: entry.id }));
    }
    if (concepts.length < slot.min || (slot.max !== undefined && concepts.length > slot.max))
      throw new LookerError('invalid', `Setup input "${slot.title}" needs ${slot.min} to ${slot.max ?? 'any number of'} fields; received ${concepts.length}.`);
    setSlot(component, slot.kind, slot.key, concepts);
  }
  const metric = component.conceptDefs.find((concept: Json) => property.metrics.labeledConcepts.some((slot: Json) => slot.value.conceptNames.includes(concept.name)));
  property.sort = metric ? [{ sortColumn: metric.name, sortDir: 1 }] : [];
  return component;
}

export function chartKindMetadata(registration: Pick<Registration, 'vizId' | 'name' | 'config'>, key: string): ChartKind & { creationTool: string } {
  return {
    key, type: registration.vizId, preset: 'default', title: registration.name, creationTool: 'community_viz_add',
    slots: setupSlots(registration.config),
    validate: () => { throw new LookerError('invalid', 'Use community_viz_add for this visualization so its registration and data-access consent are checked first.'); },
    build: () => { throw new LookerError('invalid', 'This visualization is created with community_viz_add.'); },
  };
}
