import type { Field } from '../../core/bigquery.js';

// How BigQuery answers read back in a tool's text.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}

// TABLE → table, MATERIALIZED_VIEW → materialized view.
export function kindLabel(type: string | undefined): string {
  return (type ?? 'TABLE').toLowerCase().replace(/_/g, ' ');
}

// A cell as its type says: integers as numbers (strings outside the safe
// range), floats, booleans, TIMESTAMP (seconds) as ISO text, RECORD as an
// object and REPEATED as a list of converted values.
export function typedCell(field: Field, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (field.mode === 'REPEATED' && Array.isArray(v)) return v.map((x) => typedCell({ ...field, mode: 'NULLABLE' }, x));
  if ((field.type === 'RECORD' || field.type === 'STRUCT') && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const f of field.fields ?? []) out[f.name] = typedCell(f, (v as Record<string, unknown>)[f.name]);
    return out;
  }
  const s = String(v);
  switch (field.type) {
    case 'INTEGER':
    case 'INT64': {
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    case 'FLOAT':
    case 'FLOAT64': {
      const n = Number(s);
      return Number.isNaN(n) && s !== 'NaN' ? s : n;
    }
    case 'BOOLEAN':
    case 'BOOL':
      return s === 'true';
    case 'TIMESTAMP': {
      const ms = Number(s) * 1000;
      return Number.isFinite(ms) ? new Date(ms).toISOString() : s;
    }
    default:
      return s;
  }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

// A Markdown table of the rows (already typed with typedCell).
export function markdownTable(fields: Field[], rows: Array<Record<string, unknown>>): string {
  const head = `| ${fields.map((f) => cellText(f.name)).join(' | ')} |`;
  const rule = `|${fields.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${fields.map((f) => cellText(r[f.name])).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

// One schema field per line, sub-fields of a RECORD indented below it.
export function fieldLines(fields: Field[], depth = 0): string[] {
  return fields.flatMap((f) => {
    const mode = f.mode && f.mode !== 'NULLABLE' ? ` ${f.mode}` : '';
    const about = f.description ? ` — ${f.description}` : '';
    return [`${'  '.repeat(depth)}- ${f.name} ${f.type}${mode}${about}`, ...fieldLines(f.fields ?? [], depth + 1)];
  });
}
