import { readConnectorColumns } from '../../connectors/registry.js';
import type { Column } from '../../connectors/types.js';
import type { ToolContext } from '../../core/tool.js';
import { typeLabel } from './types.js';

export type { Column } from '../../connectors/types.js';

// Reading a data source's columns again from its connection (getColumns, the
// call that lists them when a source is made) and folding them into the data
// source: new columns become fields, columns that are gone take their fields
// with them, and a column whose type changed takes its new type. Calculated
// fields stay, and so do the names and aggregations given to fields.

type Json = Record<string, any>;

export interface ColumnChanges {
  added: string[];
  removed: string[];
  retyped: string[];
}

export function changed(c: ColumnChanges): boolean {
  return c.added.length + c.removed.length + c.retyped.length > 0;
}

// The columns the connection has now. `connectorBlockConfig` is the data
// source's own (blocks[0]), changed or not.
export async function readColumns(ctx: ToolContext, connectorBlockConfig: Json): Promise<Column[]> {
  return readConnectorColumns(ctx, connectorBlockConfig);
}

const display = (f: Column): string => f.outputName ?? f.field.name;

// Folds `columns` into the data source document `ds` (changed in place) and
// says what changed. Nothing is changed when nothing differs.
export function foldColumns(ds: Json, columns: Column[]): ColumnChanges {
  const connector = ds.blocks?.[0] as Json | undefined;
  const block = (ds.datasourceBlock ??= {}) as Json;
  const fields = (block.fields ?? []) as Column[];
  const fromConnection = new Set(((connector?.fields ?? []) as Column[]).map((c) => c.field.name));
  const fresh = new Map(columns.filter((c) => c.columnType === 1).map((c) => [c.field.name, c]));
  const have = new Set(fields.map((f) => f.field.name));
  // A field from the connection: listed in the connector block, or a plain
  // column (no formula). Calculated fields are the user's and stay.
  const isColumn = (f: Column): boolean => fromConnection.has(f.field.name) || !f.textFormula;
  const changes: ColumnChanges = { added: [], removed: [], retyped: [] };
  const kept: Column[] = [];
  for (const f of fields) {
    const now = fresh.get(f.field.name);
    if (!now) {
      if (isColumn(f)) changes.removed.push(display(f));
      else kept.push(f);
      continue;
    }
    if (now.dataType !== undefined && f.dataType !== undefined && now.dataType !== f.dataType && !f.textFormula) {
      const before = typeLabel(f.outputSemanticInfo?.semanticConfig?.[0]?.semanticType);
      const after = typeLabel(now.outputSemanticInfo?.semanticConfig?.[0]?.semanticType);
      changes.retyped.push(`${display(f)} (${before} → ${after})`);
      kept.push({ ...f, dataType: now.dataType, ...(now.outputSemanticInfo ? { outputSemanticInfo: now.outputSemanticInfo } : {}) });
    } else kept.push(f);
  }
  for (const c of fresh.values())
    if (!have.has(c.field.name)) {
      changes.added.push(display(c));
      kept.push({ ...c, field: { ...c.field, simpleName: c.field.simpleName ?? c.field.name } });
    }
  if (!changed(changes)) return changes;
  block.fields = kept;
  if (connector) connector.fields = columns.filter((c) => c.mutableVersion);
  return changes;
}

export function describeChanges(c: ColumnChanges): string {
  if (!changed(c)) return 'no new fields';
  return [
    c.added.length ? `new fields: ${c.added.join(', ')}` : 'no new fields',
    ...(c.removed.length ? [`removed fields: ${c.removed.join(', ')}`] : []),
    ...(c.retyped.length ? [`type changed: ${c.retyped.join(', ')}`] : []),
  ].join('; ');
}
