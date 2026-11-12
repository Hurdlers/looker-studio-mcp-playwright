import { LookerError } from '../core/errors.js';
import type { ToolContext } from '../core/tool.js';

// Checks on a custom query before Looker Studio sees it: one SELECT (or WITH)
// statement, the connector parameters it uses switched on, and a BigQuery dry
// run that passes. Nothing here changes anything.

export interface QueryParams {
  dateRange?: boolean;
  viewerEmail?: boolean;
}

const DATE_PARAMS = ['DS_START_DATE', 'DS_END_DATE'] as const;
const EMAIL_PARAM = 'DS_USER_EMAIL';

// Stand-in values for the dry run: Looker Studio passes dates as YYYYMMDD
// text and the viewer's email as text.
const SAMPLE: Record<string, string> = { DS_START_DATE: '20240101', DS_END_DATE: '20240101', DS_USER_EMAIL: 'viewer@example.com' };

// The query without comments, string literals and quoted names, for looking at
// its shape (statement separators, keywords, @parameters).
function bare(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(--|#)[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
}

// Throws invalid unless the text is one SELECT or WITH statement.
export function checkSelect(sql: string): void {
  const body = bare(sql).trim().replace(/;\s*$/, '');
  if (!body) throw new LookerError('invalid', 'The sql is empty: give one SELECT statement.');
  if (body.includes(';'))
    throw new LookerError('invalid', 'The sql holds more than one statement: a custom query is a single SELECT (or WITH … SELECT).');
  if (!/^\(*\s*(select|with)\b/i.test(body))
    throw new LookerError('invalid', 'A custom query must be one SELECT (or WITH … SELECT) statement; it cannot change data or tables.');
}

// The Looker Studio parameters (@DS_START_DATE, @DS_END_DATE, @DS_USER_EMAIL)
// the query uses.
export function usedParams(sql: string): string[] {
  const text = bare(sql);
  return [...DATE_PARAMS, EMAIL_PARAM].filter((p) => new RegExp(`@${p}\\b`, 'i').test(text));
}

// Throws invalid when the query uses a parameter that is not switched on.
export function checkParams(sql: string, params: QueryParams, hint: { date: string; email: string }): void {
  const used = usedParams(sql);
  const dates = used.filter((p) => p !== EMAIL_PARAM);
  if (dates.length && !params.dateRange)
    throw new LookerError('invalid', `The query uses ${dates.map((p) => `@${p}`).join(' and ')}, which only work with ${hint.date}.`);
  if (used.includes(EMAIL_PARAM) && !params.viewerEmail)
    throw new LookerError('invalid', `The query uses @${EMAIL_PARAM}, which only works with ${hint.email}.`);
}

// The project a query runs in when none is given: the configured billing
// project, then the credentials' own.
export async function defaultProject(ctx: ToolContext): Promise<string | undefined> {
  return ctx.config.bigquery.billingProject ?? (await ctx.google.projectId().catch(() => undefined));
}

const API = 'https://bigquery.googleapis.com/bigquery/v2';

// Dry-runs the query in BigQuery (costs nothing). A query that uses Looker
// Studio parameters gets sample values for them, as named parameters. A
// rejected query fails as invalid with BigQuery's own words.
export async function dryRunQuery(ctx: ToolContext, project: string, sql: string, params: QueryParams = {}): Promise<void> {
  const used = usedParams(sql);
  if (params.dateRange) {
    for (const name of DATE_PARAMS) if (!used.includes(name)) used.push(name);
    used.sort((a, b) => [...DATE_PARAMS, EMAIL_PARAM].indexOf(a) - [...DATE_PARAMS, EMAIL_PARAM].indexOf(b));
  }
  if (!used.length) {
    const { statementType } = await ctx.bigquery.dryRun(project, sql);
    if (statementType && statementType !== 'SELECT')
      throw new LookerError('invalid', `BigQuery reads this as a ${statementType} statement: a custom query must be a SELECT.`);
    return;
  }
  // The shared BigQuery client takes no query parameters yet, so this one
  // request goes out from here.
  const location = ctx.config.bigquery.location;
  const body = {
    query: sql,
    useLegacySql: false,
    dryRun: true,
    parameterMode: 'NAMED',
    queryParameters: used.map((name) => ({ name, parameterType: { type: 'STRING' }, parameterValue: { value: SAMPLE[name] } })),
    ...(location ? { location } : {}),
  };
  const token = await ctx.google.token();
  let res: Response;
  try {
    res = await fetch(`${API}/projects/${encodeURIComponent(project)}/queries`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LookerError('busy', `Could not reach BigQuery to check the query (${err instanceof Error ? err.message : String(err)}); try again.`);
  }
  const answer = (await res.json().catch(() => ({}))) as { error?: { message?: string }; statementType?: string };
  if (res.ok) {
    if (answer.statementType && answer.statementType !== 'SELECT')
      throw new LookerError('invalid', `BigQuery reads this as a ${answer.statementType} statement: a custom query must be a SELECT.`);
    return;
  }
  const message = answer.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 404) throw new LookerError('not_found', `BigQuery: ${message}.`);
  if (res.status === 401 || res.status === 403) throw new LookerError('refused', `BigQuery: ${message}.`);
  if (res.status === 429 || res.status >= 500) throw new LookerError('busy', `BigQuery is busy (${res.status}); try again in a minute.`);
  throw new LookerError('invalid', `BigQuery rejected the query: ${message}`);
}
