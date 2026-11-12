import { isDeepStrictEqual } from 'node:util';

import { AGGREGATIONS, aggregationLabel, parseType, typeLabel } from '../data-sources/types.js';
import type { Json, Source } from './model.js';

function typeInput(config: Json, name: string, notes: string[]): string | undefined {
  const type = config.semanticType === 12 && config.currencyOptions?.currencyCode
    ? `Currency > ${config.currencyOptions.currencyCode}` : typeLabel(config.semanticType);
  try {
    if (parseType(type).semanticType === config.semanticType) return type;
  } catch { /* An unknown semantic type must be reported, not guessed. */ }
  notes.push(`${name}: semanticType ${config.semanticType} cannot be reproduced by field_update.`);
  return undefined;
}

function extraSemantic(config: Json | undefined): Json {
  if (!config) return {};
  const { semanticType: _type, currencyOptions, ...extra } = config;
  if (currencyOptions) {
    const { currencyCode: _code, ...options } = currencyOptions;
    if (Object.keys(options).length) extra.currencyOptions = options;
  }
  return extra;
}

function connectorColumns(source: Source): Json[] {
  return (source.block.blocks ?? []).filter((block: Json) => block.connectorBlockConfig).flatMap((block: Json) => block.fields ?? []);
}

function usesSheets(source: Source): boolean {
  return (source.block.blocks ?? []).some((block: Json) => block.connectorBlockConfig?.connectorConfig?.datasourceType === 8);
}

// Sheets immutable names are column letters, while newly connected public
// fields use headers and generated IDs. The connector keeps the original
// header even when the output field has been renamed in Looker Studio.
function sheetHeader(column: Json | undefined): string | undefined {
  for (const value of [column?.outputName, column?.mutableVersion?.label])
    if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

const headerKey = (value: string): string => value.trim().toLowerCase();

export function exportFieldOverrides(source: Source, notes: string[]): Json[] {
  const connectors = connectorColumns(source);
  const sheets = usesSheets(source);
  const out: Json[] = [];
  for (const column of source.block.datasourceBlock.fields ?? []) {
    if (column.field?.name?.startsWith('datastudio_') || column.bucketedFieldConfig || (!column.immutableVersion && column.createdBy !== 1 && column.createdBy !== 3)) continue;
    const original = column.immutableVersion?.name;
    const baseline = connectors.find((field) => original ? field.field?.name === original : field.mutableVersion?.name === column.field?.name || field.field?.name === column.field?.name);
    const physical = sheets ? sheetHeader(baseline) : original ?? baseline?.field?.name;
    if (!physical) {
      notes.push(sheets
        ? `${source.name}.${column.outputName}: its original Sheets header is unavailable; field overrides were omitted.`
        : `${source.name}.${column.outputName}: its automatic field has no readable connector column and cannot be recreated.`);
      continue;
    }
    if (sheets && connectors.filter((entry) => headerKey(sheetHeader(entry) ?? '') === headerKey(physical)).length !== 1) {
      notes.push(`${source.name}.${column.outputName}: Sheets header "${physical}" is ambiguous; field overrides were omitted.`);
      continue;
    }
    const changes: Json = { field: physical };
    if (column.outputName && column.outputName !== (sheets ? physical : baseline?.outputName ?? physical)) changes.name = column.outputName;
    const semantic = column.outputSemanticInfo?.semanticConfig?.[0], previous = baseline?.outputSemanticInfo?.semanticConfig?.[0];
    if (semantic && (semantic.semanticType !== previous?.semanticType || semantic.currencyOptions?.currencyCode !== previous?.currencyOptions?.currencyCode)) {
      const type = typeInput(semantic, `${source.name}.${column.outputName}`, notes);
      if (type) changes.type = type;
    }
    if (semantic && !isDeepStrictEqual(extraSemantic(semantic), extraSemantic(previous))) notes.push(`${source.name}.${column.outputName}: semantic options ${JSON.stringify(extraSemantic(semantic))} (connector ${JSON.stringify(extraSemantic(previous))}) cannot be set through field_update; preservation depends on the new connector schema.`);
    if ((column.outputSemanticInfo?.semanticConfig?.length ?? 0) > 1) notes.push(`${source.name}.${column.outputName}: additional semantic configurations cannot be reproduced by field_update.`);
    const aggregation = column.defaultAggregationType ?? 0;
    if (aggregation !== (baseline?.defaultAggregationType ?? 0)) {
      const name = aggregationLabel(aggregation);
      if (Object.hasOwn(AGGREGATIONS, name)) changes.aggregation = name;
      else notes.push(`${source.name}.${column.outputName}: default aggregation ${aggregation} cannot be reproduced by field_update.`);
    }
    if (Object.keys(changes).length > 1) out.push(changes);
  }
  return out;
}

export function overridesDiffer(source: Source, overrides: Json[]): boolean {
  return overrides.some((change) => {
    let column: Json | undefined;
    if (usesSheets(source)) {
      const connectors = connectorColumns(source).filter((entry) => headerKey(sheetHeader(entry) ?? '') === headerKey(change.field));
      if (connectors.length !== 1) return true;
      const connector = connectors[0]!;
      column = (source.block.datasourceBlock.fields as Json[]).find((field) =>
        field.immutableVersion?.name === connector.field?.name || field.field?.name === connector.mutableVersion?.name);
    } else column = (source.block.datasourceBlock.fields as Json[]).find((field) => field.immutableVersion?.name === change.field);
    const field = usesSheets(source)
      ? source.fields.find((field) => field.id === column?.field?.name)
      : source.fields.find((field) => field.id === column?.field?.name || field.id === change.field || field.id === `_${change.field}_` || field.name === change.field);
    if (!field || (change.name !== undefined && change.name !== field.name)) return true;
    if (change.aggregation !== undefined && AGGREGATIONS[change.aggregation as keyof typeof AGGREGATIONS] !== field.aggregation) return true;
    if (change.type !== undefined) {
      const semantic = parseType(change.type), current = field.outputSemanticInfo?.semanticConfig as Json[] | undefined;
      if (semantic.semanticType !== field.semanticType || semantic.currencyOptions?.currencyCode !== current?.[0]?.currencyOptions?.currencyCode) return true;
    }
    return false;
  });
}
