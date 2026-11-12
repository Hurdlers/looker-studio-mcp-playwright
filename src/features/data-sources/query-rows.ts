import { LookerError } from '../../core/errors.js';

type Json = Record<string, any>;
const invalid = () => new LookerError('format_changed', 'The data response has an unsupported or incomplete table format. No rows were returned.');
const TYPES = ['stringColumn', 'longColumn', 'doubleColumn', 'boolColumn', 'dateColumn', 'datetimeColumn'] as const;

// Values omit NULL cells; nullIndex addresses the original, uncompressed rows.
// Keep integer strings intact instead of rounding values above MAX_SAFE_INTEGER.
export function queryRows(table: Json, names: string[], limit: number) {
  const size = table.size;
  if (!Number.isSafeInteger(size) || size < 0) throw invalid();
  const count = Math.min(size, limit);
  const columns = names.map(name => {
    if (size === 0) return [];
    const matches = (table.columnInfo ?? []).flatMap((info: Json, index: number) => info.ns === 't0' && info.name === name ? [index] : []);
    if (matches.length !== 1) throw invalid();
    const column = table.column?.[matches[0]];
    if (!column || !Array.isArray(column.nullIndex ?? [])) throw invalid();
    const nulls = new Set<number>(column.nullIndex ?? []);
    if (nulls.size !== (column.nullIndex ?? []).length || [...nulls].some(i => !Number.isSafeInteger(i) || i < 0 || i >= size)) throw invalid();
    const kinds = TYPES.filter(type => column[type] !== undefined);
    if (kinds.length > 1 || (!kinds.length && nulls.size !== size)) throw invalid();
    const kind = kinds[0];
    const values = kind ? column[kind].values : [];
    if (!Array.isArray(values) || values.length !== size - nulls.size) throw invalid();
    let cursor = 0;
    return Array.from({ length: count }, (_, row) => {
      if (nulls.has(row)) return null;
      const value = values[cursor++];
      if (kind === 'longColumn') {
        if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
        if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
        throw invalid();
      }
      if (kind === 'doubleColumn' && (typeof value !== 'number' || !Number.isFinite(value))) throw invalid();
      if (kind === 'boolColumn' && typeof value !== 'boolean') throw invalid();
      if (['stringColumn', 'dateColumn', 'datetimeColumn'].includes(kind!) && typeof value !== 'string') throw invalid();
      return value;
    });
  });
  const total = table.totalCount;
  const totalCount = typeof total === 'string' && /^\d+$/.test(total) ? total
    : typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : undefined;
  const rows = Array.from({ length: count }, (_, row) => columns.map(column => column[row]));
  return { rows, returned_count: count, ...(totalCount !== undefined ? { total_count: totalCount } : {}),
    truncated: size > limit || (totalCount !== undefined && BigInt(totalCount) > BigInt(count)) ? true : totalCount === undefined ? null : false };
}
