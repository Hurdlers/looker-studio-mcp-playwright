import { LookerError } from '../../core/errors.js';

// The local read-only check that runs before any SQL goes to BigQuery
// (bq_query_run, its dry run, bq_view_create). A single GoogleSQL statement
// that starts with SELECT or WITH is a query: it cannot insert, change or drop
// anything. So the rule is "one statement, starting with SELECT or WITH",
// checked on the SQL with comments, strings and quoted names blanked out.
// Column or table names that happen to be keywords (update, load, delete) do
// not matter; only the reserved words CREATE and MERGE, which cannot be
// names, are refused wherever they appear.

// The SQL with comments (--, #, /* */), string literals (quoted, raw, bytes,
// triple-quoted) and `quoted names` replaced by spaces. Same length as the
// input, newlines kept, so positions line up with the original.
export function blankNoise(sql: string): string {
  const out = sql.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if ((c === '-' && next === '-') || c === '#') {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end < 0 ? sql.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      const stop = quotedEnd(sql, i, c !== '`' && isRaw(sql, i));
      blank(i, stop);
      i = stop;
    } else i++;
  }
  return out.join('');
}

// Whether the literal starting at i has an r prefix (r'…', rb'…', br'…').
function isRaw(sql: string, i: number): boolean {
  const prefix = /([A-Za-z]{1,2})$/.exec(sql.slice(Math.max(0, i - 3), i))?.[1] ?? '';
  const before = sql[i - prefix.length - 1];
  return /^(r|rb|br)$/i.test(prefix) && !(before && /[A-Za-z0-9_]/.test(before));
}

// Index just past the literal or quoted name starting at i (or the end).
function quotedEnd(sql: string, i: number, raw: boolean): number {
  const q = sql[i]!;
  const triple = q !== '`' && sql.startsWith(q.repeat(3), i);
  const close = triple ? q.repeat(3) : q;
  let k = i + close.length;
  while (k < sql.length) {
    if (sql[k] === '\\' && !raw) {
      k += 2;
      continue;
    }
    if (sql.startsWith(close, k)) return k + close.length;
    if (!triple && q !== '`' && sql[k] === '\n') return k;
    k++;
  }
  return sql.length;
}

const REFUSAL =
  'Only one read-only query runs here: a single statement starting with SELECT or WITH. To keep a query in BigQuery, save it as a view with bq_view_create.';

// Throws unless the SQL is one SELECT/WITH statement (one trailing semicolon
// allowed). Returns the SQL without that semicolon, for embedding in DDL.
export function readOnlySql(sql: string): string {
  const bare = blankNoise(sql);
  if (!bare.trim()) throw new LookerError('invalid', 'The SQL is empty (or only comments).');
  const last = bare.trimEnd();
  const end = last.endsWith(';') ? last.length - 1 : -1;
  const body = end >= 0 ? bare.slice(0, end) : bare;
  if (body.includes(';')) throw new LookerError('refused', `The SQL holds more than one statement. ${REFUSAL}`);
  const first = /^[\s(]*([A-Za-z_]+)/.exec(body)?.[1]?.toUpperCase();
  if (first !== 'SELECT' && first !== 'WITH')
    throw new LookerError('refused', `The SQL starts with ${first ?? 'something other than a keyword'}. ${REFUSAL}`);
  const reserved = /\b(CREATE|MERGE)\b/i.exec(body)?.[1];
  if (reserved) throw new LookerError('refused', `The SQL uses ${reserved.toUpperCase()}. ${REFUSAL}`);
  return (end >= 0 ? sql.slice(0, end) + sql.slice(end + 1) : sql).trimEnd();
}
