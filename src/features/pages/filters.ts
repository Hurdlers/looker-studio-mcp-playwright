import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { fieldConcept, resolveField } from '../../core/components.js';
import type { SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import type { Json } from './model.js';

const clauseShape = {
  field: z.string().trim().min(1).describe('조건에 쓸 필드의 화면 이름 또는 ID.'),
  condition: z.string().trim().min(1).describe('문자 조건: equals, in, contains, starts_with, regexp_contains, regexp_match. 숫자 비교: gt, gte, lt, lte, between. 빈 값은 is_null. 편집기 표시 이름도 받습니다.'),
  values: z.array(z.union([z.string(), z.number()])).optional().describe('조건 값. between은 두 개, is_null은 생략합니다.'),
  exclude: z.boolean().optional().describe('true이면 조건에 맞는 행을 제외합니다. 기본은 포함입니다.'),
};

export const filtersInput = z.array(z.object({
  name: z.string().trim().min(1).describe('필터 이름. 같은 이름이 있으면 기존 필터를 사용합니다.'),
  field: clauseShape.field.optional(),
  condition: clauseShape.condition.optional(),
  values: clauseShape.values,
  exclude: clauseShape.exclude,
  clauses: z.array(z.array(z.object(clauseShape))).optional().describe('바깥 묶음은 AND, 각 묶음 안의 조건은 OR로 연결합니다.'),
})).describe('페이지 또는 리포트에 덧붙일 필터. 이름만 주면 저장된 필터를 재사용합니다.');

export type FilterSpec = z.infer<typeof filtersInput>[number];
type Clause = z.infer<z.ZodObject<typeof clauseShape>>;
type ClauseInput = { [K in keyof Clause]?: Clause[K] | undefined };

const codes: Record<string, string> = {
  equals: 'EQ', '=': 'EQ', equalto: 'EQ', equaltoequal: 'EQ',
  contains: 'PT', startswith: 'BW', regexpmatch: 'RM', regexpcontains: 'RC',
  in: 'IN', isin: 'IN', isnull: 'NU',
  gt: 'GT', '>': 'GT', greaterthan: 'GT',
  gte: 'GTE', '>=': 'GTE', greaterthanorequalto: 'GTE',
  lt: 'LT', '<': 'LT', lessthan: 'LT',
  lte: 'LTE', '<=': 'LTE', lessthanorequalto: 'LTE', between: 'BT',
};

function conditionCode(value: string): string {
  const key = /^[=<>]+$/.test(value.trim()) ? value.trim() : value.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s_-]+/g, '');
  const code = codes[key];
  if (!code) throw new LookerError('invalid', `Unknown filter condition "${value}". Choices: between, is_null, in, equals, contains, gt, gte, lt, lte, starts_with, regexp_contains, regexp_match.`);
  return code;
}

function checkClause(clause: ClauseInput): string {
  if (!clause.field?.trim() || !clause.condition?.trim())
    throw new LookerError('invalid', 'A filter clause needs both field and condition.');
  const code = conditionCode(clause.condition);
  const count = clause.values?.length ?? 0;
  if ((code === 'NU' && count !== 0) || (code === 'BT' && count !== 2) || (code === 'IN' && count < 1) || (!['NU', 'BT', 'IN'].includes(code) && count !== 1))
    throw new LookerError('invalid', `Filter condition ${clause.condition} needs ${code === 'NU' ? 'no values' : code === 'BT' ? 'two values' : code === 'IN' ? 'at least one value' : 'one value'}.`);
  return code;
}

export function validateFilters(specs: FilterSpec[]): void {
  for (const spec of specs) {
    if (spec.clauses !== undefined) {
      if (spec.field !== undefined || spec.condition !== undefined || spec.values !== undefined || spec.exclude !== undefined)
        throw new LookerError('invalid', 'Give clauses or a single field condition, not both.');
      if (!spec.clauses.length || spec.clauses.some((group) => !group.length))
        throw new LookerError('invalid', 'Filter clauses need at least one nonempty group.');
      spec.clauses.flat().forEach(checkClause);
    } else if (spec.field !== undefined || spec.condition !== undefined || spec.values !== undefined || spec.exclude !== undefined) checkClause(spec);
  }
}

export function filterEntries(doc: ReportDoc): Json[] {
  return (doc.report.resource as Json | undefined)?.filter?.entry ?? [];
}

export function buildDefinition(spec: FilterSpec, fields: SourceField[]): Json {
  const expression = (clause: ClauseInput): Json => {
    const code = checkClause(clause);
    const field = resolveField(fields, clause.field!);
    const numeric = field.semanticType !== undefined ? [12, 13, 14, 15, 28, 33].includes(field.semanticType) : [1, 4, 5, 6, 10, 11, 12].includes(field.aggregation);
    const values = clause.values ?? [];
    const numbers = numeric ? values.map((v) => typeof v === 'number' ? v : v.trim() ? Number(v) : NaN) : [];
    if (numbers.some((v) => !Number.isFinite(v))) throw new LookerError('invalid', `Filter field "${field.name}" needs numeric values.`);
    const concept = fieldConcept(field);
    return { filterExpression: {
      include: clause.exclude !== true,
      conceptType: field.kind === 'metric' ? 1 : 0,
      concept: { ns: 't0', name: concept.name },
      filterConditionType: code,
      stringValues: numeric ? [] : values.map(String),
      numberValues: numbers,
      queryTimeTransformation: concept.queryTimeTransformation,
    } };
  };
  const join = (key: 'and' | 'or', definitions: Json[]): Json => definitions.length === 1 ? definitions[0]! : { [key]: { filterDefinitions: definitions } };
  return spec.clauses ? join('and', spec.clauses.map((group) => join('or', group.map(expression)))) : expression(spec);
}

export function newFilterKey(): string {
  return `filter${randomBytes(5).toString('hex')}`;
}
