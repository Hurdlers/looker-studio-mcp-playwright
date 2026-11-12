import { GoogleAuth } from 'google-auth-library';

import { adcTokenSource, type TokenSource } from '../bigquery/access.js';
import type { BigQueryConfig } from '../config.js';
import { LookerError } from './errors.js';

// BigQuery's REST API with the user's Application Default Credentials. Looker
// Studio is not involved: these calls go from this process to Google directly.
// Rate-limited, failed (5xx) and unreachable requests are retried. The token
// is never logged or returned.
// query() only reads: a statement that would change something (DML, DDL,
// scripts) is refused before it runs, and goes through ddl(), which the
// write tools use and a dry run records instead of sending.

const API = 'https://bigquery.googleapis.com/bigquery/v2';

// The label on views this server makes (D19). deleteTable removes only views
// that carry it.
export const CREATED_BY = { key: 'created_by', value: 'looker-studio-mcp' } as const;

// Who the credentials belong to, for connection_check.
export interface GoogleAccount extends TokenSource {
  projectId(): Promise<string | undefined>;
  // The service account's or user's email, when it can be read.
  email(): Promise<string | undefined>;
}

export function adcAccount(): GoogleAccount {
  const tokens = adcTokenSource();
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return {
    token: () => tokens.token(),
    projectId: () => tokens.projectId(),
    async email() {
      const own = await auth.getCredentials().then((c) => c.client_email, () => undefined);
      if (own) return own;
      // A user's ADC carries the userinfo.email scope.
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${await tokens.token()}` },
      }).catch(() => undefined);
      const body = res?.ok ? ((await res.json()) as { email?: string }) : undefined;
      return body?.email;
    },
  };
}

export interface Field {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: Field[];
}

export interface TableResource {
  type?: string;
  description?: string;
  numRows?: string;
  location?: string;
  labels?: Record<string, string>;
  schema?: { fields?: Field[] };
  view?: { query?: string };
  materializedView?: { query?: string };
  [key: string]: unknown;
}

export interface QueryOptions {
  maxRows?: number;
  maxBytesBilled?: number;
  location?: string;
  // How long one request waits for the job before asking again.
  waitMs?: number;
  // How long the job may run in all (default 10 minutes); it is then
  // cancelled and the call fails as busy.
  deadlineMs?: number;
}

export interface QueryResult {
  fields: Field[];
  // One plain object per row: RECORD columns become objects, REPEATED arrays.
  // Values are as BigQuery sends them (numbers and dates as strings).
  rows: Array<Record<string, unknown>>;
  totalRows: number;
  bytesProcessed: number;
  cacheHit: boolean;
  jobId?: string;
  location?: string;
}

export interface BigQueryOptions {
  fetch?: typeof fetch;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface QueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: Field[] };
  rows?: Array<{ f: Array<{ v: unknown }> }>;
  totalRows?: string;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
  // Errors and warnings met so far; a failed job has status.errorResult.
  errors?: Array<{ message?: string }>;
  pageToken?: string;
  statementType?: string;
}

export class BigQueryClient {
  private readonly fetch: typeof fetch;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly tokens: TokenSource,
    readonly config: BigQueryConfig = { maxRows: 500, maxBytesBilled: 1_000_000_000 },
    opts: BigQueryOptions = {},
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.retries = opts.retries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // Datasets of a project; hidden ones (starting with _) are left out.
  async listDatasets(project: string): Promise<Array<{ id: string; location?: string }>> {
    const items = await this.pages<{ datasets?: Array<{ datasetReference: { datasetId: string }; location?: string }> }>(
      `${API}/projects/${enc(project)}/datasets?all=false`,
      (p) => p.datasets ?? [],
    );
    return items.map((d) => ({ id: d.datasetReference.datasetId, ...(d.location ? { location: d.location } : {}) }));
  }

  // Tables, views and the like; type as BigQuery says it (TABLE, VIEW, …).
  async listTables(project: string, dataset: string): Promise<Array<{ id: string; type: string }>> {
    const items = await this.pages<{ tables?: Array<{ tableReference: { tableId: string }; type?: string }> }>(
      `${API}/projects/${enc(project)}/datasets/${enc(dataset)}/tables?maxResults=1000`,
      (p) => p.tables ?? [],
    );
    return items.map((t) => ({ id: t.tableReference.tableId, type: t.type ?? 'TABLE' }));
  }

  async getTable(project: string, dataset: string, table: string): Promise<TableResource> {
    return this.request<TableResource>('GET', `${API}/projects/${enc(project)}/datasets/${enc(dataset)}/tables/${enc(table)}`);
  }

  // Deletes a view this server made (labelled CREATED_BY); anything else is
  // refused, tables always.
  async deleteTable(project: string, dataset: string, table: string): Promise<void> {
    await this.deletable(project, dataset, table);
    await this.request('DELETE', `${API}/projects/${enc(project)}/datasets/${enc(dataset)}/tables/${enc(table)}`);
  }

  // Throws refused unless deleteTable may remove this table.
  async deletable(project: string, dataset: string, table: string): Promise<void> {
    const t = await this.getTable(project, dataset, table);
    if (t.type !== 'VIEW' || t.labels?.[CREATED_BY.key] !== CREATED_BY.value)
      throw new LookerError(
        'refused',
        `${project}.${dataset}.${table} is a ${t.type ?? 'table'} without the label ${CREATED_BY.key}: ${CREATED_BY.value}: only views this server made can be deleted.`,
      );
  }

  // Runs a read-only query (SELECT) and waits for it. Rows are capped at
  // maxRows (config default). Anything else is refused before it runs: a dry
  // run tells the statement type first.
  async query(project: string, sql: string, opts: QueryOptions = {}): Promise<QueryResult> {
    const { statementType } = await this.dryRun(project, sql, opts);
    if (statementType !== 'SELECT')
      throw new LookerError(
        'refused',
        `Only SELECT queries run here; this is a ${statementType ?? 'statement of unknown type'}. Changes go through the write tools.`,
      );
    const maxRows = opts.maxRows ?? this.config.maxRows;
    const first = await this.request<QueryResponse>('POST', `${API}/projects/${enc(project)}/queries`, {
      query: sql,
      useLegacySql: false,
      maxResults: maxRows,
      maximumBytesBilled: String(opts.maxBytesBilled ?? this.config.maxBytesBilled),
      timeoutMs: opts.waitMs ?? 30_000,
      dryRun: false,
      ...this.where(opts),
    });
    const done = await this.finish(project, first, maxRows, opts);
    const fields = done.schema?.fields ?? [];
    return {
      fields,
      rows: (done.rows ?? []).slice(0, maxRows).map((r) => rowObject(fields, r)),
      totalRows: Number(done.totalRows ?? 0),
      bytesProcessed: Number(done.totalBytesProcessed ?? first.totalBytesProcessed ?? 0),
      cacheHit: done.cacheHit === true,
      ...(done.jobReference?.jobId ? { jobId: done.jobReference.jobId } : {}),
      ...(done.jobReference?.location ? { location: done.jobReference.location } : {}),
    };
  }

  // Checks a statement without running it: errors come back as `invalid`;
  // otherwise the bytes it would read and its type (SELECT, CREATE_VIEW,
  // DELETE, SCRIPT…). Costs nothing.
  async dryRun(
    project: string,
    sql: string,
    opts: Pick<QueryOptions, 'location'> = {},
  ): Promise<{ bytesProcessed: number; statementType?: string }> {
    const res = await this.request<QueryResponse>('POST', `${API}/projects/${enc(project)}/queries`, {
      query: sql,
      useLegacySql: false,
      dryRun: true,
      ...this.where(opts),
    });
    return { bytesProcessed: Number(res.totalBytesProcessed ?? 0), ...(res.statementType ? { statementType: res.statementType } : {}) };
  }

  // Runs a statement that changes something (CREATE OR REPLACE VIEW …) and
  // waits until it is done. For the write tools only. Bytes billed are capped
  // like a query's (CREATE TABLE AS SELECT reads data).
  async ddl(
    project: string,
    sql: string,
    opts: Pick<QueryOptions, 'location' | 'waitMs' | 'deadlineMs' | 'maxBytesBilled'> = {},
  ): Promise<{ jobId?: string }> {
    const first = await this.request<QueryResponse>('POST', `${API}/projects/${enc(project)}/queries`, {
      query: sql,
      useLegacySql: false,
      maximumBytesBilled: String(opts.maxBytesBilled ?? this.config.maxBytesBilled),
      timeoutMs: opts.waitMs ?? 30_000,
      ...this.where(opts),
    });
    const done = await this.finish(project, first, 0, opts);
    return done.jobReference?.jobId ? { jobId: done.jobReference.jobId } : {};
  }

  private where(opts: { location?: string }): { location?: string } {
    const location = opts.location ?? this.config.location;
    return location ? { location } : {};
  }

  // Asks again until the job is complete, for deadlineMs at most (then the
  // job is cancelled: busy). `errors` may hold warnings too, so a job counts
  // as failed (invalid) only when the job itself says so (status.errorResult).
  private async finish(
    project: string,
    res: QueryResponse,
    maxRows: number,
    opts: Pick<QueryOptions, 'waitMs' | 'deadlineMs'>,
  ): Promise<QueryResponse> {
    const waitMs = opts.waitMs ?? 30_000;
    const until = Date.now() + (opts.deadlineMs ?? 600_000);
    let at = res;
    while (!at.jobComplete) {
      const job = at.jobReference;
      if (!job?.jobId) throw new LookerError('format_changed', 'BigQuery answered a query without a job id.');
      if (Date.now() >= until) {
        const loc = job.location ? `?location=${enc(job.location)}` : '';
        await this.request('POST', `${API}/projects/${enc(project)}/jobs/${enc(job.jobId)}/cancel${loc}`).catch(() => undefined);
        throw new LookerError('busy', `BigQuery job ${job.jobId} was still running after ${Math.round((opts.deadlineMs ?? 600_000) / 1000)} s and was cancelled.`);
      }
      const wait = Math.max(1, Math.min(waitMs, until - Date.now()));
      const ask = new URLSearchParams({ maxResults: String(maxRows), timeoutMs: String(wait) });
      if (job.location) ask.set('location', job.location);
      at = { jobReference: job, ...(await this.request<QueryResponse>('GET', `${API}/projects/${enc(project)}/queries/${enc(job.jobId)}?${ask}`)) };
    }
    if (at.errors?.length) {
      const job = at.jobReference;
      const q = job?.location ? `?location=${enc(job.location)}` : '';
      const status = job?.jobId
        ? (await this.request<{ status?: { errorResult?: { message?: string } } }>('GET', `${API}/projects/${enc(project)}/jobs/${enc(job.jobId)}${q}`)).status
        : { errorResult: at.errors[0] };
      if (status?.errorResult)
        throw new LookerError('invalid', `BigQuery: ${[status.errorResult, ...at.errors].map((e) => e.message).filter((m, i, all) => m && all.indexOf(m) === i).join('; ')}`);
    }
    return at;
  }

  private async pages<P>(url: string, items: (page: P) => any[]): Promise<any[]> {
    const out: any[] = [];
    let token: string | undefined;
    do {
      const page = await this.request<P & { nextPageToken?: string }>('GET', token ? `${url}&pageToken=${enc(token)}` : url);
      out.push(...items(page));
      token = page.nextPageToken;
    } while (token);
    return out;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.token();
      let res: Response;
      try {
        res = await this.fetch(url, {
          method,
          headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        // No answer at all (network down, DNS, reset): worth another try.
        if (attempt < this.retries) {
          await this.sleep(1_000 * 2 ** attempt);
          continue;
        }
        const why = err instanceof Error ? err.message : String(err);
        throw new LookerError('busy', `BigQuery ${method} ${url.replace(API, '').split('?')[0]}: could not reach BigQuery (${why}); check the network and try again.`);
      }
      if (res.ok) return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T;
      const retry = res.status === 429 || res.status >= 500;
      if (retry && attempt < this.retries) {
        await this.sleep(1_000 * 2 ** attempt);
        continue;
      }
      const message = await res
        .json()
        .then((b: { error?: { message?: string } }) => b.error?.message, () => undefined)
        .catch(() => undefined);
      const what = `BigQuery ${method} ${url.replace(API, '').split('?')[0]}`;
      if (res.status === 404) throw new LookerError('not_found', `${what}: ${message ?? 'not found'}.`);
      if (res.status === 403 || res.status === 401) throw new LookerError('refused', `${what}: ${message ?? 'permission denied'}.`);
      if (retry) throw new LookerError('busy', `${what}: BigQuery is busy (${res.status}); try again in a minute.`);
      throw new LookerError('invalid', `${what}: ${message ?? `HTTP ${res.status}`}`);
    }
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

// Rows come as {f: [{v}]} in schema order; RECORD cells hold {f} again and
// REPEATED cells a list of {v}.
function rowObject(fields: Field[], row: { f: Array<{ v: unknown }> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  fields.forEach((field, i) => (out[field.name] = cell(field, row.f[i]?.v)));
  return out;
}

function cell(field: Field, v: unknown): unknown {
  if (field.mode === 'REPEATED' && Array.isArray(v))
    return v.map((x) => cell({ ...field, mode: 'NULLABLE' }, (x as { v: unknown }).v));
  if ((field.type === 'RECORD' || field.type === 'STRUCT') && v && typeof v === 'object')
    return rowObject(field.fields ?? [], v as { f: Array<{ v: unknown }> });
  return v;
}
