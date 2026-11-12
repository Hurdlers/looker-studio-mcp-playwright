import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import type { SourceField } from '../../core/datasource.js';
import { AGGREGATIONS, allowedAggregations, AUTO, type AggregationName } from '../chart-core/common.js';

type Json = Record<string, any>;
export const metricPatchInput = z.object({
  from: z.string().trim().min(1).describe('바꿀 기존 측정항목의 소스 필드 이름 또는 고유 ID.'),
  to: z.string().trim().min(1).describe('같은 데이터 소스에서 새로 사용할 필드 이름 또는 고유 ID.'),
  aggregation: z.enum(Object.keys(AGGREGATIONS) as [AggregationName, ...AggregationName[]]).optional().describe('새 집계. 생략하면 호환되는 기존 집계를 유지하며 Auto 필드는 집계를 생략해야 합니다.'),
  format: z.enum(['preserve', 'source']).optional().describe('preserve는 기존 단위·표시 형식 유지, source는 새 소스의 단위 사용. 단위가 달라지면 명시해야 합니다. 비중 열의 퍼센트 표현은 유지합니다.'),
}).strict();
export type MetricPatch = z.infer<typeof metricPatchInput>;
export interface MetricPatchIssue {
  code: string;
  message: string;
  change?: number;
  concept?: string;
  candidates?: Array<{ id: string; name: string }>;
}
export interface MetricPatchPlan {
  component: Json;
  issues: MetricPatchIssue[];
  matched: number[];
  changed_concepts: string[];
  notes: string[];
}
const significant = (v: unknown): boolean => v !== undefined && v !== null && v !== false && v !== 0 && v !== ''
  && (!Array.isArray(v) || v.length > 0) && (typeof v !== 'object' || v === null || Object.keys(v).length > 0);
function slotNames(component: Json, kind: string): Set<string> {
  return new Set((component.propertyConfig?.componentProperty?.[kind]?.labeledConcepts ?? []).flatMap((slot: Json) => slot.value?.conceptNames ?? []));
}
function semantic(field: SourceField, aggregation: number | undefined): Json | undefined {
  if (aggregation === AGGREGATIONS.count || aggregation === AGGREGATIONS.count_distinct) return { semanticConfig: [{ semanticType: 33 }] };
  return field.outputSemanticInfo ? structuredClone(field.outputSemanticInfo)
    : field.semanticType === undefined ? undefined : { semanticConfig: [{ semanticType: field.semanticType }] };
}
function unit(info: Json | undefined): string | undefined {
  const config = info?.semanticConfig?.[0];
  if (config?.semanticType === undefined) return undefined;
  return `${config.semanticType}:${config.currencyOptions?.currencyCode ?? ''}`;
}
// Plain numeric precision/grouping can move with another numeric metric.
// Percent, currency, quoted units and unrecognized format syntax can carry
// meaning not represented by semanticType, so require an explicit decision.
function hasMeaningfulFormat(format: unknown): boolean {
  if (format === undefined || format === null || format === '') return false;
  if (typeof format !== 'string') return true;
  const parts = format.trim().split(';');
  return parts.length > 3 || parts.some(part => {
    const section = part.trim();
    const numeric = section.startsWith('(') && section.endsWith(')') ? section.slice(1, -1) : section;
    return !/^[+-]?[#0]+(?:,[#0]+)*(?:\.[#0]+)?(?:[Ee][+-]?[#0]+)?$/.test(numeric);
  });
}

/** Replace only source bindings of existing metric concepts. No slots, labels,
 * result calculations or presentation properties are rebuilt. */
export function planMetricPatch(component: Json, fields: SourceField[], changes: MetricPatch[]): MetricPatchPlan {
  const original = structuredClone(component), next = structuredClone(component);
  const issues: MetricPatchIssue[] = [], matched = changes.map(() => 0), changed_concepts: string[] = [], notes = new Set<string>();
  const resolve = (ref: string, change: number): SourceField | undefined => {
    const want = ref.trim().toLowerCase();
    const exact = fields.filter(f => f.id === ref);
    const named = exact.length ? exact : fields.filter(f => f.name.trim().toLowerCase() === want);
    const hits = named.length ? named : fields.filter(f => f.id.toLowerCase() === want || f.id.toLowerCase() === `_${want}_`);
    if (hits.length !== 1 || fields.filter(f => f.id === hits[0]?.id).length !== 1) {
      issues.push({ code: hits.length ? 'ambiguous_field' : 'field_not_found', change,
        message: `필드 "${ref}"를 고유하게 찾을 수 없습니다. 소스의 고유 필드 ID를 지정하세요.`, candidates: hits.map(({ id, name }) => ({ id, name })) });
      return undefined;
    }
    return hits[0];
  };
  const resolved = changes.map((change, index) => ({ change, index, from: resolve(change.from, index), to: resolve(change.to, index) }));
  const seen = new Set<string>();
  for (const item of resolved) if (item.from) {
    if (seen.has(item.from.id)) issues.push({ code: 'duplicate_replacement', change: item.index, message: `"${item.from.name}"의 교체를 한 번만 지정하세요.` });
    seen.add(item.from.id);
  }
  const metrics = slotNames(original, 'metrics'), dimensions = slotNames(original, 'dimensions');
  const date = original.propertyConfig?.componentProperty?.dateRangeDimension;
  const defs: Json[] = original.conceptDefs ?? [];
  for (const [index, concept] of defs.entries()) {
    if (!metrics.has(concept.name)) continue;
    const data = concept.queryTimeTransformation?.dataTransformation ?? {};
    const match = resolved.find(item => item.from?.id === data.sourceFieldName && item.to);
    if (!match?.from || !match.to) continue;
    matched[match.index]!++;
    const { change, from, to } = match;
    if (from.id === to.id && change.aggregation === undefined && change.format === undefined) continue;
    const fail = (code: string, message: string) => issues.push({ code, message, change: match.index, concept: concept.name });
    if (defs.filter(c => c.name === concept.name).length !== 1 || dimensions.has(concept.name) || date === concept.name) {
      fail('unsafe_concept', '측정항목이 다른 역할과 같은 내부 개념을 공유하므로 부분 교체할 수 없습니다.'); continue;
    }
    if (Object.entries(data).some(([key, value]) => !['sourceFieldName', 'aggregation'].includes(key) && significant(value))) {
      fail('unsafe_concept', '차트 내부 계산식이나 추가 변환이 있는 측정항목은 먼저 계산 규칙을 확인해야 합니다.'); continue;
    }
    const result = concept.resultTransformation ?? {};
    if (![undefined, 0, 1].includes(result.analyticalFunction)
      || Object.entries(result).some(([key, value]) => !['analyticalFunction', 'isRelativeToBase', 'bypassCanvasFilters'].includes(key) && significant(value))) {
      fail('unsafe_calculation', '지원하지 않는 결과 계산이 있어 측정항목을 부분 교체할 수 없습니다.'); continue;
    }
    let aggregation: number | undefined;
    if (to.aggregation === AUTO) {
      if (change.aggregation !== undefined) { fail('invalid_aggregation', `"${to.name}"는 Auto 필드입니다. aggregation을 생략하세요.`); continue; }
      aggregation = undefined;
      if (data.aggregation !== undefined) notes.add('새 Auto 필드에 집계가 중복되지 않도록 차트의 별도 집계를 제거했습니다.');
    } else {
      aggregation = change.aggregation === undefined ? data.aggregation ?? (from.aggregation === AUTO ? undefined : from.aggregation) : AGGREGATIONS[change.aggregation];
      if (aggregation === undefined || aggregation === AUTO) { fail('aggregation_required', `"${to.name}"에 적용할 집계를 지정하세요.`); continue; }
      if (!allowedAggregations(to).some(name => AGGREGATIONS[name] === aggregation)) {
        fail('invalid_aggregation', `기존 또는 지정 집계를 "${to.name}"에 적용할 수 없습니다. 가능한 집계: ${allowedAggregations(to).join(', ')}.`); continue;
      }
    }
    const percent = result.analyticalFunction === 1;
    const display = concept.queryTimeTransformation?.displayTransformation;
    const currentSemantic = display?.outputSemanticInfo ?? semantic(from, data.aggregation);
    const desiredSemantic = semantic(to, aggregation);
    if (!percent && change.format === undefined && from.id !== to.id && hasMeaningfulFormat(display?.displayFormat)) {
      fail('format_required', `"${from.name}"에 단위나 추가 의미가 있는 표시 형식이 있습니다. 새 지표에 format:source 또는 format:preserve를 지정하세요.`); continue;
    }
    if (!percent && change.format === undefined && (unit(currentSemantic) === undefined || unit(desiredSemantic) === undefined || unit(currentSemantic) !== unit(desiredSemantic))) {
      fail('format_required', `"${from.name}"와 "${to.name}"의 표시 단위가 다르거나 불명확합니다. format:source 또는 format:preserve를 지정하세요.`); continue;
    }
    const patched: Json = next.conceptDefs[index];
    const query = patched.queryTimeTransformation;
    query.dataTransformation.sourceFieldName = to.id;
    if (aggregation === undefined || (from.id === to.id && change.aggregation === undefined && data.aggregation === undefined)) delete query.dataTransformation.aggregation;
    else query.dataTransformation.aggregation = aggregation;
    if (!percent && change.format === 'source') {
      const d = query.displayTransformation ??= {};
      if (desiredSemantic === undefined) { fail('format_required', `"${to.name}"의 자료형이 불명확하여 소스 표시 형식을 적용할 수 없습니다.`); continue; }
      d.outputSemanticInfo = desiredSemantic;
      delete d.displayFormat;
    }
    if (!isDeepStrictEqual(concept, patched)) changed_concepts.push(concept.name);
  }
  if (changed_concepts.length) notes.add('기존 제목과 측정항목 라벨은 유지했습니다. 새 지표 이름을 표시하려면 별도로 라벨을 변경하세요.');
  return { component: issues.length ? original : next, issues, matched, changed_concepts: issues.length ? [] : changed_concepts, notes: issues.length ? [] : [...notes] };
}
