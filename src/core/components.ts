import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import type { SourceField } from './datasource.js';
import { LookerError } from './errors.js';
import { fromMapValue, toMapValue } from './mapvalue.js';

// Building blocks for components. A component starts from a template: a
// component the editor made, with its data taken out (blankTemplate). Templates
// live in fixtures/templates/<type>[.<preset>].json (shared) and
// fixtures/<group>/templates/<type>[.<preset>].json (added by a feature group).

type Json = Record<string, any>;

export interface Position {
  left: number;
  top: number;
  width: number;
  height: number;
}

// What a builder knows about the data source a chart reads.
export interface BuildContext {
  datasourceId: string;
  fields: SourceField[];
}

// Turns a tool's input into a component (a chart type, a control, …).
export type Builder<S> = (spec: S, ctx: BuildContext) => Json;

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

// The data source's own "Record Count" field, which some data sources provide.
export const RECORD_COUNT = 'datastudio_record_count_system_field_id_98323387';

// A preset (shape-star, horizontal-stacked…) has its own file,
// <type>.<preset>.json, when its JSON differs from the type's. Without one the
// type's file is used, with the preset asked for.
export function template(type: string, preset?: string, root = FIXTURES): Json {
  const dirs = [join(root, 'templates'), ...groupDirs(root)];
  const own = preset ? [`${fileName(type)}.${fileName(preset)}.json`] : [];
  const file = [...own, `${fileName(type)}.json`].flatMap((n) => dirs.map((d) => join(d, n))).find(existsSync);
  if (!file) throw new LookerError('invalid', `No template for component type "${type}"${preset ? ` (${preset})` : ''}.`);
  const c: Json = { ...(JSON.parse(readFileSync(file, 'utf8')) as Json), componentId: componentId() };
  if (preset) c.preset = preset;
  return c;
}

function groupDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'templates')
    .map((d) => join(root, d.name, 'templates'));
}

// Community types are URLs (gs://…/funnel): keep them usable as file names.
function fileName(type: string): string {
  return type.replace(/^gs:\/\//, '').replace(/[^a-zA-Z0-9-]+/g, '_');
}

// Strips what ties a component to its report: data source, fields, sorting,
// filters, date settings, rows per page, and the starting state of its
// behavior (sorting, cross-filtering) that names the report's fields.
// Styling stays.
export function blankTemplate(component: Json): Json {
  const c = structuredClone(component);
  delete c.datasourceId;
  c.componentId = 'cd-template';
  c.conceptDefs = [];
  const p = c.propertyConfig?.componentProperty ?? {};
  for (const key of ['dataset', 'dateRangeDimension', 'dateDuration', 'compareDateDuration', 'row']) delete p[key];
  for (const key of ['dimensions', 'metrics'])
    if (p[key]?.labeledConcepts)
      p[key].labeledConcepts = p[key].labeledConcepts.map((lc: Json) => ({ ...lc, value: { conceptNames: [] } }));
  for (const key of ['sort', 'breakdownConfig', 'filters']) if (key in p) p[key] = [];
  const pivot = p.pivotTableProperty?.pivotDisplayConfig;
  if (pivot) for (const key of ['row', 'col', 'hierarchy']) if (key in pivot) pivot[key] = [];
  if (c.behavior) c.behavior = blankBehavior(c.behavior);
  return c;
}

// Keeps each behavior action (cross-filtering on, sorting allowed) and the
// shape of its starting state, but empties what in it names fields or chart
// concepts: init.sortOptions {sortData: [...], isNewSortConfig: true} becomes
// {sortData: [], isNewSortConfig: true}, as in a chart the editor just made.
// The behavior is written back only when something was emptied, in its own
// number forms.
function blankBehavior(behavior: Json): Json {
  const plain = fromMapValue(behavior);
  if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return behavior;
  let changed = false;
  for (const actions of Object.values(plain))
    for (const action of Array.isArray(actions) ? actions : [])
      if (action && typeof action === 'object' && !Array.isArray(action) && action.init && typeof action.init === 'object')
        changed = unname(action.init as Json) || changed;
  return changed ? toMapValue(plain, behavior) : behavior;
}

const NAMES_FIELD = /"(?:qt_|sourceFieldName|_[a-z0-9_]+_")/i;

// Empties the parts of a starting state that name fields: lists become [],
// objects are emptied the same way inside, other values go. True when
// something changed.
function unname(state: Json): boolean {
  let changed = false;
  for (const [key, v] of Object.entries(state)) {
    if (!NAMES_FIELD.test(JSON.stringify(v))) continue;
    changed = true;
    if (Array.isArray(v)) state[key] = [];
    else if (v && typeof v === 'object') unname(v as Json);
    else delete state[key];
  }
  return changed;
}

// Puts concepts into one slot of a chart (dimensions or metrics, key
// "primary", "breakdown", "tooltip"…), replacing what the slot held, and keeps
// conceptDefs in step: new concepts are added, ones nothing uses any more go.
export function setSlot(component: Json, kind: 'dimensions' | 'metrics', key: string, concepts: Json[]): Json {
  const p = ((component.propertyConfig ??= {}).componentProperty ??= {});
  const slot = ((p[kind] ??= {}).labeledConcepts ??= []) as Json[];
  const names = concepts.map((x) => x.name as string);
  const entry = slot.find((lc) => lc.key === key);
  const before: string[] = entry?.value?.conceptNames ?? [];
  if (entry) entry.value = { ...entry.value, conceptNames: names };
  else slot.push({ key, value: { conceptNames: names } });
  // A concept given again under its name replaces the old definition (new
  // aggregation or label).
  const defs = (component.conceptDefs ??= []) as Json[];
  for (const x of concepts) {
    const at = defs.findIndex((d) => d.name === x.name);
    if (at >= 0) defs[at] = x;
    else defs.push(x);
  }
  const used = JSON.stringify(p);
  component.conceptDefs = defs.filter((d) => !before.includes(d.name) || names.includes(d.name) || used.includes(`"${d.name}"`));
  return component;
}

export function componentId(): string {
  return `cd-${randomBytes(5).toString('hex')}`;
}

export function conceptName(): string {
  return `qt_${randomBytes(5).toString('hex')}`;
}

export function place(component: Json, position: Position): Json {
  const attr = ((component.attributeConfig ??= {}).componentAttribute ??= {});
  Object.assign(attr, position);
  return component;
}

// A field of the data source as a chart dimension (no aggregation) or metric.
export function fieldConcept(field: SourceField, opts: { label?: string; aggregation?: number } = {}): Json {
  const name = conceptName();
  return {
    id: `t0.${name}`,
    name,
    namespace: 't0',
    queryTimeTransformation: {
      dataTransformation: { sourceFieldName: field.id, ...(opts.aggregation !== undefined ? { aggregation: opts.aggregation } : {}) },
      displayTransformation: {
        displayName: opts.label ?? field.name,
        ...(field.outputSemanticInfo ? { outputSemanticInfo: structuredClone(field.outputSemanticInfo) }
          : field.semanticType !== undefined ? { outputSemanticInfo: { semanticConfig: [{ semanticType: field.semanticType }] } } : {}),
      },
    },
  };
}

// A chart-level formula such as SUM(t0._pageviews_) / SUM(t0._sessions_).
// outputType is the result's data type (2 = number).
export function formulaConcept(formula: string, label: string, outputType = 2): Json {
  const name = conceptName();
  return {
    id: `t0.${name}`,
    name,
    namespace: 't0',
    queryTimeTransformation: {
      dataTransformation: {
        sourceFieldName: name,
        aggregation: 7,
        textFormula: formula,
        sourceType: 1,
        frontendTextFormula: formula,
        formulaOutputDataType: outputType,
      },
      displayTransformation: { displayName: label },
    },
  };
}

// Finds a field by id (_sessions_) or by the name people see (sessions),
// ignoring case; the error lists what there is.
export function resolveField(fields: SourceField[], ref: string): SourceField {
  const want = ref.trim().toLowerCase();
  const hit =
    fields.find((f) => f.id === ref) ??
    fields.find((f) => f.name.toLowerCase() === want) ??
    fields.find((f) => f.id.toLowerCase() === want || f.id.toLowerCase() === `_${want}_`);
  if (hit) return hit;
  const names = fields.map((f) => f.name).slice(0, 40).join(', ');
  throw new LookerError('invalid', `No field "${ref}" in the data source. Fields: ${names}${fields.length > 40 ? ', …' : ''}`);
}
