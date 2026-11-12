import { randomBytes } from 'node:crypto';

import { fieldConcept, resolveField } from '../../core/components.js';
import type { SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { CHART_TYPES, fieldsFor, invalid, numeric, prop, type Json } from './common.js';
import { filtersInput, type ClauseSpec, type FilterSpec } from './inputs.js';

const conditionCodes: Record<string, string> = {
  equals: 'EQ', equalto: 'EQ', '=': 'EQ', contains: 'PT', startswith: 'BW', regexpmatch: 'RM', regexpcontains: 'RC',
  in: 'IN', isin: 'IN', isnull: 'NU', gt: 'GT', '>': 'GT', greaterthan: 'GT', gte: 'GTE', '>=': 'GTE', greaterthanorequalto: 'GTE',
  lt: 'LT', '<': 'LT', lessthan: 'LT', lte: 'LTE', '<=': 'LTE', lessthanorequalto: 'LTE', between: 'BT',
};

export function normalizeCondition(text: string): string {
  return /^[=<>]+$/.test(text.trim()) ? text.trim() : text.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s_-]+/g, '');
}

function conditionCode(text: string): string {
  const code = conditionCodes[normalizeCondition(text)];
  if (!code) throw invalid(`Unknown filter condition "${text}". Choices: between, in, is_null, equals, contains, gt, gte, lt, lte, starts_with, regexp_contains, regexp_match.`);
  return code;
}

function expression(clause: { [K in keyof ClauseSpec]?: ClauseSpec[K] | undefined }, fields: SourceField[]): Json {
  if (!clause.field?.trim() || !clause.condition?.trim()) throw invalid('A filter condition needs both field and condition.');
  const code = conditionCode(clause.condition);
  const values = clause.values ?? [];
  const required = code === 'NU' ? 0 : code === 'BT' ? 2 : 1;
  if ((code === 'IN' && !values.length) || (code !== 'IN' && values.length !== required))
    throw invalid(`${clause.condition} needs ${code === 'IN' ? 'one or more values' : required === 0 ? 'no values' : `${required} value(s)`}.`);
  const field = resolveField(fields, clause.field);
  const isNumber = numeric(field);
  const numbers = isNumber ? values.map((value) => typeof value === 'number' ? value : value.trim() ? Number(value) : NaN) : [];
  if (numbers.some((value) => !Number.isFinite(value))) throw invalid(`"${field.name}" needs numeric filter values.`);
  const concept = fieldConcept(field);
  return { filterExpression: {
    include: clause.exclude !== true, conceptType: field.kind === 'metric' ? 1 : 0,
    concept: { ns: 't0', name: concept.name }, filterConditionType: code,
    stringValues: isNumber ? [] : values.map(String), numberValues: numbers,
    queryTimeTransformation: concept.queryTimeTransformation,
  } };
}

export function filterDefinition(spec: FilterSpec, fields: SourceField[]): Json {
  if (spec.clauses !== undefined) {
    if (spec.field !== undefined || spec.condition !== undefined || spec.values !== undefined || spec.exclude !== undefined)
      throw invalid('Give clauses or a single field condition, not both.');
    if (!spec.clauses.length || spec.clauses.some((group) => !group.length)) throw invalid('Each filter clause group must contain a condition.');
    const join = (key: 'and' | 'or', list: Json[]): Json => list.length === 1 ? list[0]! : { [key]: { filterDefinitions: list } };
    return join('and', spec.clauses.map((group) => join('or', group.map((clause) => expression(clause, fields)))));
  }
  return expression(spec, fields);
}

export const filterUpdater: ComponentUpdater = {
  key: 'filters', input: filtersInput, types: CHART_TYPES, touchesReport: true,
  apply: async (target, value, ctx) => {
    const specs = value as FilterSpec[];
    const resource = (target.doc.report.resource ??= {}) as Json;
    const entries: Json[] = resource.filter?.entry ?? [];
    const datasourceId = target.component.datasourceId ?? prop(target.component).dataset?.datasetId;
    if (!datasourceId || prop(target.component).dataset?.datasetType === 2) throw invalid('Filters need a chart with a direct data source.');
    const prepared = [...entries];
    const keys: string[] = [...(prop(target.component).filters ?? [])];
    const warnings: string[] = [];
    for (const spec of specs) {
      const existing = prepared.find((entry) => entry.value.name === spec.name && entry.value.datasourceId === datasourceId);
      if (existing) {
        if (!keys.includes(existing.key)) keys.push(existing.key);
        if (spec.field !== undefined || spec.condition !== undefined || spec.clauses !== undefined)
          warnings.push(`Filter "${spec.name}" already exists and was reused without changing its conditions.`);
        continue;
      }
      if (spec.field === undefined && spec.condition === undefined && spec.clauses === undefined && spec.values === undefined)
        throw new LookerError('not_found', `No filter "${spec.name}" for this data source. Existing filters: ${prepared.filter((entry) => entry.value.datasourceId === datasourceId).map((entry) => entry.value.name).join(', ') || '(none)'}. Give field and condition to create one.`);
      const definition = filterDefinition(spec, await fieldsFor(target, ctx));
      const key = `filter${randomBytes(5).toString('hex')}`;
      prepared.push({ key, value: { name: spec.name, datasourceId, version: 3, filterDefinition: definition } });
      keys.push(key);
    }
    if (prepared.length !== entries.length) resource.filter = { ...(resource.filter ?? {}), entry: prepared };
    prop(target.component).filters = keys;
    return warnings.length ? `Warning: ${warnings.join(' ')}` : undefined;
  },
  read: (component, doc) => {
    const entries = (doc.report.resource as Json | undefined)?.filter?.entry ?? [];
    return (prop(component).filters ?? []).flatMap((key: string) => {
      const found = entries.find((entry: Json) => entry.key === key);
      return found ? [{ name: found.value.name }] : [];
    });
  },
};
