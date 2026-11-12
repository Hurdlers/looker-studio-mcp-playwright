import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { dataRequests } from '../../core/check.js';
import { fieldConcept } from '../../core/components.js';
import { editDatasource, resolveSource, type ResolvedSource, type SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import { text, type ToolContext } from '../../core/tool.js';
import { reportIdOf } from '../data-sources/inputs.js';

export type Json = Record<string, any>;
export const nonempty = (description: string) => z.string().trim().min(1).describe(description);
export const reportInput = nonempty('리포트 ID 또는 Looker Studio 주소.');
export const sourceInput = nonempty('데이터 소스의 별칭, 이름 또는 ID. 하나뿐이면 생략할 수 있습니다.').optional();
export const valueInput = z.union([z.string(), z.number().finite()]);
export const invalid = (message: string) => new LookerError('invalid', message);
export const id = (prefix: string) => `${prefix}${randomBytes(5).toString('hex')}`;
export const numeric = (field: SourceField) => field.semanticType !== undefined
  ? [12, 13, 14, 15, 28, 33].includes(field.semanticType)
  : [1, 4, 5, 6, 10, 11, 12].includes(field.aggregation);

export async function sourceFor(ctx: ToolContext, report: string, source?: string) {
  const reportId = reportIdOf(report);
  const doc = await ctx.session.load(reportId);
  return { reportId, doc, source: await resolveSource(ctx.rap, doc, source) };
}

export function uniqueName(fields: SourceField[], name: string): void {
  if (fields.some((f) => f.name.toLowerCase() === name.toLowerCase()))
    throw invalid(`A field named "${name}" already exists. Choose another name.`);
}

// The same query envelope as a chart, with a formula or aggregate as its only
// column. Formula validation needs the transformation, not a SQL expression.
export function requestFor(doc: ReportDoc, source: ResolvedSource, concept: Json): Json {
  const component = {
    componentId: 'formula_validation', type: 'kpi-metric', datasourceId: source.datasourceId,
    conceptDefs: [concept], propertyConfig: { componentProperty: { metrics: { labeledConcepts: [{ value: { conceptNames: [concept.name] } }] } } },
  };
  return dataRequests(doc.shareable.id, {
    pageId: doc.page[0]?.pageId ?? '', page: { componentConfig: [component] },
  }, Intl.DateTimeFormat().resolvedOptions().timeZone, undefined)[0]!.request;
}

export async function validate(ctx: ToolContext, doc: ReportDoc, source: ResolvedSource, formula: string, name: string, bucket?: Json): Promise<Json> {
  const concept: Json = { name: id('qt_'), namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceType: 1, textFormula: formula } } };
  if (bucket) concept.queryTimeTransformation.dataTransformation.bucketedFieldConfig = bucket;
  const result = await ctx.rap.call<Json | string>('validateFormula', {
    dataRequest: requestFor(doc, source, concept), detectDatatype: true, allowAutoDetectInFormula: true,
  });
  if (!result || typeof result !== 'object' || !result.column) {
    const message = typeof result === 'string' ? result : result?.errorStatus?.message ?? result?.errorMessage ?? result?.message ?? JSON.stringify(result);
    throw invalid(`Formula was rejected: ${message}. Correct the formula and try again.`);
  }
  return result.column as Json;
}

export async function appendField(ctx: ToolContext, reportId: string, source: ResolvedSource, name: string, formula: string, column: Json, bucket?: Json) {
  const fieldId = id('calc_');
  await editDatasource(ctx.rap, reportId, source.datasourceId, (ds) => {
    const block = ds.datasourceBlock as Json;
    if ((block.fields as Json[]).some((f) => String(f.outputName).toLowerCase() === name.toLowerCase()))
      throw invalid(`A field named "${name}" already exists. Choose another name.`);
    block.fields.push({ ...structuredClone(column), field: { ns: 't0', name: fieldId }, outputName: name,
      textFormula: formula, frontendTextFormula: formula, ...(bucket ? { bucketedFieldConfig: bucket } : {}) });
  }, `add field ${name}`);
  return text(`Added field "${name}" (${fieldId}) to ${source.alias}.`);
}

export async function aggregate(ctx: ToolContext, doc: ReportDoc, source: ResolvedSource, field: SourceField, aggregation: number): Promise<number> {
  const concept = fieldConcept(field, { aggregation }) as Json;
  const response = await ctx.rap.call<Json>('batchedDataV2', { dataRequest: [requestFor(doc, source, concept)] });
  const answer = response.dataResponse?.[0];
  if (answer?.errorStatus) throw invalid(`Cannot read the range of "${field.name}": ${JSON.stringify(answer.errorStatus)}.`);
  const table = answer?.dataSubset?.[0]?.dataset?.tableDataset;
  const column = table?.column?.[0];
  const cell = column?.nullIndex?.includes(0) ? undefined
    : column?.doubleColumn?.values?.[0] ?? column?.longColumn?.values?.[0] ?? column?.stringColumn?.values?.[0];
  if (cell === undefined || cell === null || cell === '' || !Number.isFinite(Number(cell)))
    throw invalid(`No numeric range was returned for "${field.name}". Give min and max explicitly.`);
  return Number(cell);
}
