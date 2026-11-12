import { z } from 'zod';

import { resolveField } from '../../core/components.js';
import { defineTool } from '../../core/tool.js';
import { normalizeCondition } from '../chart-options/filters.js';
import { aggregate, appendField, invalid, nonempty, numeric, reportInput, sourceFor, sourceInput, uniqueName, validate, valueInput, type Json } from './common.js';

const codes: Record<string, number> = {
  equals: 1, equalto: 1, '=': 1, contains: 2, startswith: 3, between: 5,
  gte: 6, '>=': 6, greaterthanorequalto: 6, gt: 7, '>': 7, greaterthan: 7,
  lte: 8, '<=': 8, lessthanorequalto: 8, lt: 9, '<': 9, lessthan: 9,
  isnull: 10, regexpmatch: 11, regexpcontains: 12, in: 15, isin: 15,
};

export const groupFieldAdd = defineTool({
  name: 'group_field_add', title: 'Add a grouped field',
  description: 'Creates a data source field that labels matching values as named groups. Use ordered rules for categories and optionally name the remaining values.',
  input: {
    report_id: reportInput, data_source: sourceInput, field: nonempty('그룹으로 묶을 원본 필드 이름 또는 ID.'), name: nonempty('새 그룹 필드 이름.'),
    groups: z.array(z.object({ name: nonempty('그룹에 붙일 이름.'), condition: nonempty('in, equals, between 등의 조건 또는 편집기 라벨.').default('in'),
      values: z.array(valueInput).default([]).describe('비교 값. between은 두 개, is_null은 빈 목록입니다.'),
      exclude: z.boolean().default(false).describe('true이면 조건에 맞지 않는 값을 이 그룹으로 묶습니다.'),
    })).min(1).describe('앞에서부터 평가할 그룹 규칙.'),
    other_group: nonempty('어느 규칙에도 맞지 않는 값의 그룹 이름.').optional(),
  },
  write: true,
  run: async (ctx, a) => {
    const buckets: Json[] = a.groups.map((group, i) => {
      const code = codes[normalizeCondition(group.condition)];
      if (code === undefined) throw invalid(`Unknown group condition "${group.condition}". Use in, equals, contains, starts_with, between, gte, gt, lte, lt, is_null, regexp_match or regexp_contains.`);
      const required = code === 10 ? 0 : code === 5 ? 2 : 1;
      if ((code === 15 && !group.values.length) || (code !== 15 && group.values.length !== required))
        throw invalid(`${group.condition} needs ${code === 15 ? 'one or more values' : `${required} value(s)`}.`);
      return { id: i, displayName: group.name, filterConfig: { include: !group.exclude, values: group.values, filterConditionType: code } };
    });
    if (a.other_group) buckets.push({ id: buckets.length, displayName: a.other_group, isRemainingValues: true });
    const { reportId, doc, source } = await sourceFor(ctx, a.report_id, a.data_source);
    uniqueName(source.fields, a.name);
    const field = resolveField(source.fields, a.field);
    const bucket = { sort: 1, sourceField: field.id, customGroups: { buckets } };
    const column = await validate(ctx, doc, source, field.id, a.name, bucket);
    return appendField(ctx, reportId, source, a.name, field.id, column, bucket);
  },
});

export const binFieldAdd = defineTool({
  name: 'bin_field_add', title: 'Add a binned field',
  description: 'Divides a numeric data source field into equal width intervals. Use explicit bounds or let the source supply either missing end of the range.',
  input: { report_id: reportInput, data_source: sourceInput, field: nonempty('구간으로 나눌 숫자 필드 이름 또는 ID.'), name: nonempty('새 구간 필드 이름.'),
    size: z.number().finite().positive().describe('구간의 너비. 0보다 커야 합니다.'),
    min: z.number().finite().optional().describe('첫 구간의 시작값. 생략하면 원본 최솟값을 읽습니다.'),
    max: z.number().finite().optional().describe('마지막 구간의 끝값. 생략하면 원본 최댓값을 읽습니다.'),
  },
  write: true,
  run: async (ctx, a) => {
    if (a.min !== undefined && a.max !== undefined && a.min >= a.max) throw invalid('min must be smaller than max.');
    const { reportId, doc, source } = await sourceFor(ctx, a.report_id, a.data_source);
    uniqueName(source.fields, a.name);
    const field = resolveField(source.fields, a.field);
    if (!numeric(field)) throw invalid(`"${field.name}" is not numeric. Choose a numeric field.`);
    const min = a.min ?? await aggregate(ctx, doc, source, field, 5);
    let max = a.max ?? await aggregate(ctx, doc, source, field, 4);
    // A constant column still has one useful bin. Only expand an inferred
    // upper bound; explicitly supplied limits remain authoritative.
    if (a.max === undefined && min === max) max = min + a.size;
    if (!Number.isFinite(max) || min >= max) throw invalid('The range is empty or reversed. Give min smaller than max.');
    const bucket = { sort: 0, sourceField: field.id, uniformBinConfig: { labelType: 1, min, max, size: a.size, binRemaining: true } };
    const column = await validate(ctx, doc, source, field.name, a.name, bucket);
    return appendField(ctx, reportId, source, a.name, field.name, column, bucket);
  },
});
