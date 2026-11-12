import { readFileSync } from 'node:fs';

import type { ChartCheck } from '../../core/check.js';
import { safeText, type Json } from './common.js';

interface Card { title?: string; description?: string }
const cards = JSON.parse(readFileSync(new URL('../../../fixtures/verify/error-cards.json', import.meta.url), 'utf8')) as {
  category: Record<string, Card>; reason: Record<string, Card>; fallback: Required<Card>;
};

export type Problem = 'loading' | 'no data' | 'configuration' | 'data set' | 'consent' | 'error';

export function classify(title: string): Problem {
  if (/consent required/i.test(title)) return 'consent';
  if (/too many rows|data set|data source|system error|query|bigquery|user configuration/i.test(title)) return 'data set';
  if (/invalid|configuration|missing fields/i.test(title)) return 'configuration';
  return 'error';
}

export function errorCard(status: Json): Required<Card> {
  return {
    ...cards.fallback,
    ...cards.category[String(status.errorCategory ?? status.category)],
    ...cards.reason[String(status.reason)],
    ...(typeof status.title === 'string' ? { title: status.title } : {}),
    ...(typeof status.description === 'string' ? { description: status.description } : {}),
  };
}

export function problemFor(check: ChartCheck, component: Json, raw: Json | undefined, timeoutSeconds: number, timedOut = false): { kind: Problem; message: string; details?: string } | undefined {
  if (check.timedOut || timedOut) return { kind: 'loading', message: `Still loading after ${timeoutSeconds} seconds (no answer in time).` };
  if (check.error?.startsWith('fields not in the data source:')) {
    const missingDimension = dimensionMissing(component, check.error);
    return { kind: 'configuration', message: `${missingDimension ? 'Invalid dimension' : 'Invalid metric'}: ${safeText(check.error)}` };
  }
  const answer = raw?.dataResponse?.[0] as Json | undefined;
  const status = answer?.errorStatus as Json | undefined;
  if (status) {
    const card = errorCard(status);
    const details = errorDetails(raw!);
    return { kind: classify(card.title), message: safeText(`${card.title}: ${card.description}`), ...(details ? { details } : {}) };
  }
  if (!check.ok) return { kind: 'error', message: safeText(check.error ?? 'The data request failed.') };
  if (check.rows === 1 && nullAggregate(component, answer)) return { kind: 'no data', message: 'aggregate metric is NULL; the request returned no usable metric values.' };
  if (check.rows === 0 && component.type !== 'kpi-metric') return { kind: 'no data', message: 'No data: the request returned no rows.' };
  return undefined;
}

function nullAggregate(component: Json, answer: Json | undefined): boolean {
  const table = answer?.dataSubset?.[0]?.dataset?.tableDataset;
  if (!table) return false;
  // Some connectors omit totalCount. A numeric size of one still proves
  // the scalar shape; explicit counts must agree, as before.
  const scalarShape = table.totalCount === undefined
    ? table.size === 1
    : [1, '1'].includes(table.totalCount) && [1, '1'].includes(table.size);
  if (!scalarShape) return false;
  if (!Array.isArray(table.columnInfo) || !Array.isArray(table.column)) return false;
  const p = component.propertyConfig?.componentProperty ?? {};
  const names = (slot: Json | undefined): string[] => Array.isArray(slot?.labeledConcepts)
    ? slot.labeledConcepts.flatMap((entry: Json) => Array.isArray(entry.value?.conceptNames) ? entry.value.conceptNames.filter((name: unknown) => typeof name === 'string') : []) : [];
  const metrics = names(p.metrics);
  if (!metrics.length || names(p.dimensions).length) return false;
  // NULL masks prove the absence of scalar values; missing value arrays do not.
  return metrics.every((name) => {
    const matching = table.columnInfo.flatMap((info: Json, i: number) => info?.ns === 't0' && info.name === name ? [i] : []);
    if (matching.length !== 1) return false;
    const column = table.column[matching[0]];
    return Array.isArray(column?.nullIndex) && column.nullIndex.includes(0);
  });
}

function dimensionMissing(component: Json, error: string): boolean {
  const names = new Set<string>(((component.propertyConfig?.componentProperty?.dimensions?.labeledConcepts ?? []) as Json[]).flatMap((slot) => slot.value?.conceptNames ?? []));
  return ((component.conceptDefs ?? []) as Json[]).some((concept) => names.has(concept.name) && typeof concept.queryTimeTransformation?.dataTransformation?.sourceFieldName === 'string' && error.includes(concept.queryTimeTransformation.dataTransformation.sourceFieldName));
}

export function errorDetails(raw: Json): string {
  const answer = raw.dataResponse?.[0] ?? {};
  const status = answer.errorStatus ?? {};
  const parts: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v.trim() && !parts.includes(v.trim())) parts.push(v.trim());
  };
  add(status.endUserMessage);
  const messages = (v: unknown): void => {
    if (typeof v === 'string') add(v);
    else if (Array.isArray(v)) v.forEach(messages);
    else if (v && typeof v === 'object') {
      const o = v as Json;
      for (const [key, value] of Object.entries(o))
        if (['message', 'errorMessage', 'endUserMessage', 'debugMessage', 'error', 'errors', 'errorStream', 'details'].includes(key) || typeof value === 'object') messages(value);
    }
  };
  messages(status.errorDetails);
  const metas = [...(answer.responseMetaSet?.responseMetas ?? []), ...(raw.responseMetaSet?.responseMetas ?? [])] as Json[];
  for (const meta of metas) messages(meta.bqResponseMeta?.helixJobStatus?.errorStream);
  if (status.uniqueErrorCode) add(`Error ID: ${status.uniqueErrorCode}`);
  return safeText(parts.join(' / '));
}
