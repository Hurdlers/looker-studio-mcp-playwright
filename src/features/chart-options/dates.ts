import { z } from 'zod';

import { fieldConcept, resolveField } from '../../core/components.js';
import type { SourceField } from '../../core/datasource.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { CHART_TYPES, definitions, fieldsFor, invalid, prop, requireListControl, requireType, sourceOf, type Json } from './common.js';

const duration = (su: number, start: number, eu: number, end: number): Json => ({ startOffsetUnit: su, startOffset: start, endOffsetUnit: eu, endOffset: end });
export const DATE_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 36, 37, 38, 39, 40]);
const isDate = (field: SourceField): boolean => field.semanticType !== undefined && DATE_TYPES.has(field.semanticType);
function dateConcept(component: Json, field: SourceField): Json {
  let concept = definitions(component).find((entry) => sourceOf(entry) === field.id &&
    [undefined, 0].includes(entry.queryTimeTransformation?.dataTransformation?.aggregation));
  if (!concept) { concept = fieldConcept(field); definitions(component).push(concept); }
  return concept;
}
export const DATE_PRESETS: Record<string, Json | undefined> = {
  'Auto date range': undefined, Today: duration(3, 0, 3, 0), Yesterday: duration(3, 1, 3, 1),
  ...Object.fromEntries([7, 14, 28, 30].map((days) => [`Last ${days} days`, duration(3, days, 3, 1)])),
  'Last week (starts Sunday)': duration(4, 1, 4, 1), 'Last week (starts Monday)': duration(5, 1, 5, 1),
  'Last month': duration(6, 1, 6, 1), 'Last quarter': duration(7, 1, 7, 1), 'Last year': duration(8, 1, 8, 1),
  'This week (starts Sunday)': duration(4, 0, 4, 0), 'This week to date (starts Sunday)': duration(4, 0, 3, 1),
  'This week (starts Monday)': duration(5, 0, 5, 0), 'This week to date (starts Monday)': duration(5, 0, 3, 1),
  'This month': duration(6, 0, 6, 0), 'This month to date': duration(6, 0, 3, 1),
  'This quarter': duration(7, 0, 7, 0), 'This quarter to date': duration(7, 0, 3, 1),
  'This year': duration(8, 0, 8, 0), 'This year to date': duration(8, 0, 3, 1),
};

export function parseDuration(input: string): Json | undefined {
  const fixed = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(input);
  if (fixed) {
    const valid = (text: string): boolean => {
      const date = new Date(`${text}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
    };
    if (!valid(fixed[1]!) || !valid(fixed[2]!) || fixed[1]! > fixed[2]!) throw invalid(`Invalid date range "${input}": use real dates with the start on or before the end.`);
    return { startAnchor: fixed[1]!.replaceAll('-', ''), endAnchor: fixed[2]!.replaceAll('-', '') };
  }
  const found = Object.keys(DATE_PRESETS).find((name) => name.toLowerCase() === input.toLowerCase());
  if (!found) throw invalid(`Unknown date range "${input}". Choices: ${Object.keys(DATE_PRESETS).join(', ')}; or YYYY-MM-DD..YYYY-MM-DD.`);
  return DATE_PRESETS[found] ? structuredClone(DATE_PRESETS[found]) : undefined;
}

export const dateRangeUpdater: ComponentUpdater = {
  key: 'date_range', types: CHART_TYPES,
  input: z.string().describe('차트 기간. Last 7 days 등의 프리셋, Auto date range, 또는 YYYY-MM-DD..YYYY-MM-DD 고정 기간.'),
  apply: async (target, value, ctx) => {
    const p = prop(target.component);
    const next = parseDuration(value as string);
    if (next === undefined) { delete p.dateDuration; return; }
    if (!p.dateRangeDimension) {
      const fields = await fieldsFor(target, ctx);
      const field = fields.find(isDate);
      if (!field) throw invalid('This data source has no date field for date_range. Add a date field or leave the range automatic.');
      p.dateRangeDimension = dateConcept(target.component, field).name;
    }
    p.dateDuration = next;
  },
  read: (component) => {
    const config = prop(component).dateDuration;
    if (!config) return undefined;
    if (config.startAnchor && config.endAnchor) {
      const format = (date: string) => date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      return `${format(String(config.startAnchor))}..${format(String(config.endAnchor))}`;
    }
    return Object.keys(DATE_PRESETS).find((key) => DATE_PRESETS[key] && JSON.stringify(DATE_PRESETS[key]) === JSON.stringify(config));
  },
};

export const dateRangeDimensionUpdater: ComponentUpdater = {
  key: 'date_range_dimension', types: [...CHART_TYPES, 'dimension-filter'],
  input: z.string().trim().min(1).describe('기간 필드의 이름 또는 ID. Date 및 Date & Time 필드만 받습니다. None은 기간 필드와 고정·기본 기간을 제거하며, date_range와 함께 지정하면 마지막에 적용합니다.'),
  apply: async (target, value, ctx) => {
    requireListControl(target.component, 'date_range_dimension');
    const p = prop(target.component);
    if (String(value).toLowerCase() === 'none') { delete p.dateRangeDimension; delete p.dateDuration; return; }
    const field = resolveField(await fieldsFor(target, ctx), String(value));
    if (!isDate(field)) throw invalid(`"${field.name}" is not a Date or Date & Time field for date_range_dimension.`);
    p.dateRangeDimension = dateConcept(target.component, field).name;
  },
  read: (component) => {
    const concept = definitions(component).find((entry) => entry.name === prop(component).dateRangeDimension);
    return concept ? sourceOf(concept) : undefined;
  },
};

const compareTypes = ['kpi-metric', 'simple-table', 'simple-linechart', 'simple-combochart', 'simple-barchart', 'simple-areachart'];
export const comparisonUpdater: ComponentUpdater = {
  key: 'comparison', types: CHART_TYPES,
  input: z.string().describe('비교 기간. Previous period, Previous year, None 중 하나.'),
  apply: ({ component }, value) => {
    requireType(component, compareTypes, 'comparison');
    const text = String(value).toLowerCase();
    if (!['previous period', 'previous year', 'none'].includes(text)) throw invalid('comparison choices: Previous period, Previous year, None.');
    if (text === 'none') delete prop(component).compareDateDuration;
    else prop(component).compareDateDuration = { anchorType: 1, config: duration(text === 'previous year' ? 8 : 9, 1, text === 'previous year' ? 8 : 9, 1) };
  },
  read: (component) => {
    const config = prop(component).compareDateDuration?.config;
    return config?.startOffsetUnit === 9 ? 'Previous period' : config?.startOffsetUnit === 8 ? 'Previous year' : undefined;
  },
};
