import type { Rap, RapOutcome, RapRequest } from '../looker/rap.js';
import { getReportBody } from '../looker/reports.js';
import { BigQueryClient, type QueryOptions } from './bigquery.js';
import { WRITES } from './guard.js';
import { ReportSession, type PageDoc, type ReportDoc } from './session.js';
import type { ToolContext } from './tool.js';

// A context that runs tools without changing anything, for validation (batch
// and spec tools check every step first) and for the dry_run setting. Writes
// are recorded instead of sent and answered as if they worked; reads are sent
// once and then answered from a cache. Saves are applied to the cached report,
// so a later step reads what an earlier one would have saved.

type Json = Record<string, any>;

export interface RecordedWrite {
  // A Looker Studio endpoint, or "bigquery.ddl" / "bigquery.deleteTable".
  endpoint: string;
  body: unknown;
}

export interface DryRun {
  ctx: ToolContext;
  writes: RecordedWrite[];
}

// Endpoints that change something: the guard's list and anything named like it.
const WRITE_NAME = /^(create|update|delete|publish|restore|claim|copy|upload|rename|persist|convert|grant)/;

export function isWrite(endpoint: string): boolean {
  return endpoint in WRITES || WRITE_NAME.test(endpoint);
}

// Ids of the reports a dry run "makes" (createTempReport, persistTempReport,
// copyReport): report ids in form, so parseReportId takes them, and getReport
// answers them from the dry run's own copy. The first is DRY_RUN_REPORT.
export const DRY_RUN_PAGE = 'dry-run-page';
export function dryRunReportId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
export const DRY_RUN_REPORT = dryRunReportId(1);

export function dryRunContext(ctx: ToolContext): DryRun {
  const writes: RecordedWrite[] = [];
  const rap = new DryRap(ctx.rap, writes);
  const bigquery = new DryBigQuery(ctx.bigquery, writes);
  return {
    writes,
    ctx: { ...ctx, rap, bigquery, session: new ReportSession(rap, { snapshots: false }), dryRun: true },
  };
}

// Whether this Rap only records writes (a dry run): code that reads back
// what it wrote must skip that check, the write never happened.
export function isDryRun(rap: Rap): boolean {
  return rap instanceof DryRap;
}

interface Save {
  endpoint: string;
  body: Json;
  version: string;
}

export class DryRap implements Rap {
  // Answers received, by request; and requests on their way, so two callers
  // asking the same thing at once send it once.
  private readonly answers = new Map<string, unknown>();
  private readonly pending = new Map<string, Promise<unknown>>();
  // Every report save so far, replayed on a report read for the first time
  // later (another getReport body is another cache entry).
  private readonly saves: Save[] = [];
  // Reports the dry run made, by id.
  private readonly made = new Map<string, ReportDoc>();
  private readonly sources = new Map<string, Json>();
  private count = 0;

  constructor(
    private readonly inner: Rap,
    readonly writes: RecordedWrite[],
  ) {}

  async call<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number, mode?: RapRequest['mode']): Promise<T> {
    if (isWrite(endpoint)) return (await this.write(endpoint, body)) as T;
    const own = this.ownRead(endpoint, body);
    if (own) return own as T;
    if (this.mixedSourceList(endpoint, body)) {
      const input = body as Json;
      const ids = input.shareableIds as string[];
      const remote = await this.call<Json>(endpoint, { ...input, shareableIds: ids.filter((id) => !this.sources.has(id)) }, timeoutMs, mode);
      const local = this.ownRead(endpoint, { ...input, shareableIds: ids.filter((id) => this.sources.has(id)) })!;
      const byId = new Map<string, Json>(([...(remote.datasourceInfo ?? []), ...local.datasourceInfo] as Json[]).map((info) => [info.shareableConfig.id, info]));
      return { ...remote, datasourceInfo: ids.flatMap((id) => byId.has(id) ? [byId.get(id)] : []) } as T;
    }
    const key = cacheKey(endpoint, body, mode);
    if (!this.answers.has(key)) {
      let asked = this.pending.get(key);
      if (!asked) {
        asked = this.inner.call<unknown>(endpoint, body, timeoutMs, mode).finally(() => this.pending.delete(key));
        this.pending.set(key, asked);
      }
      const value = await asked;
      if (!this.answers.has(key)) this.answers.set(key, this.received(endpoint, value));
    }
    // A copy, so a caller changing the answer does not change the cache.
    return structuredClone(this.answers.get(key)) as T;
  }

  async callMany<T = unknown>(requests: RapRequest[], opts?: { concurrency?: number; timeoutMs?: number }): Promise<RapOutcome<T>[]> {
    const mixed = new Map<RapRequest, RapOutcome<T>>();
    for (const r of requests.filter((r) => this.mixedSourceList(r.endpoint, r.body))) {
      try { mixed.set(r, { ok: true, value: await this.call<T>(r.endpoint, r.body, opts?.timeoutMs, r.mode) }); }
      catch (error) { mixed.set(r, { ok: false, status: (error as { status?: number }).status ?? 0, error: error instanceof Error ? error.message : String(error) }); }
    }
    const fresh = requests.filter(
      (r) => !mixed.has(r) && !isWrite(r.endpoint) && !this.ownRead(r.endpoint, r.body) && !this.answers.has(cacheKey(r.endpoint, r.body, r.mode)),
    );
    const got = fresh.length ? await this.inner.callMany<unknown>(fresh, opts) : [];
    const failed = new Map<RapRequest, RapOutcome<T>>();
    fresh.forEach((r, k) => {
      const o = got[k]!;
      if (o.ok) this.answers.set(cacheKey(r.endpoint, r.body, r.mode), this.received(r.endpoint, o.value));
      else failed.set(r, o as RapOutcome<T>);
    });
    const out: RapOutcome<T>[] = [];
    for (const r of requests) {
      if (mixed.has(r)) out.push(mixed.get(r)!);
      else if (isWrite(r.endpoint)) out.push({ ok: true, value: (await this.write(r.endpoint, r.body)) as T });
      else
        out.push(
          failed.get(r) ?? {
            ok: true,
            value: (this.ownRead(r.endpoint, r.body) ?? structuredClone(this.answers.get(cacheKey(r.endpoint, r.body, r.mode)))) as T,
          },
        );
    }
    return out;
  }

  // getReport of a report the dry run made: answered from its copy.
  private ownReport(endpoint: string, body: unknown): { reportConfig: ReportDoc } | undefined {
    const doc = endpoint === 'getReport' ? this.made.get(String((body as Json | undefined)?.reportId)) : undefined;
    return doc ? { reportConfig: structuredClone(doc) } : undefined;
  }

  private ownRead(endpoint: string, body: unknown): Json | undefined {
    const input = (body ?? {}) as Json;
    const source = this.sources.get(input.datasourceId);
    if (endpoint === 'getBlockDatasource' && source) return structuredClone(source);
    if (endpoint === 'getSchema' && source) {
      const columns: Json[] = (source.draft ?? source.published)?.datasourceBlock?.fields ?? [];
      const schema: Json = { dimensions: [], metrics: [] };
      for (const column of columns) {
        const kind = column.defaultAggregationType ? 'metrics' : 'dimensions';
        schema[kind].push({ name: column.field.name, semanticInfo: structuredClone(column.outputSemanticInfo ?? {}) });
      }
      return { schema };
    }
    if (endpoint === 'getDatasourceList' && Array.isArray(input.shareableIds) && input.shareableIds.length && input.shareableIds.every((id: string) => this.sources.has(id)))
      return { datasourceInfo: input.shareableIds.map((id: string) => ({ shareableConfig: { id, name: (this.sources.get(id)!.draft ?? this.sources.get(id)!.published)?.datasourceBlock?.name ?? 'Data source' }, isEmbedded: !!this.sources.get(id)!.embeddedInReportId })) };
    return this.ownReport(endpoint, body);
  }

  private mixedSourceList(endpoint: string, body: unknown): boolean {
    const ids = (body as Json | undefined)?.shareableIds;
    return endpoint === 'getDatasourceList' && Array.isArray(ids) && ids.some((id: string) => this.sources.has(id)) && ids.some((id: string) => !this.sources.has(id));
  }

  // A report read for the first time gets the saves made to it so far.
  private received(endpoint: string, value: unknown): unknown {
    const doc = (value as { reportConfig?: ReportDoc } | undefined)?.reportConfig;
    if (endpoint === 'getReport' && doc?.shareable)
      for (const s of this.saves) if (s.body.reportId === doc.shareable.id) applySave(doc, s.endpoint, s.body, s.version);
    return value;
  }

  // Records the write, applies a save to the cached and made reports, and
  // answers the way Looker Studio does.
  private async write(endpoint: string, body: unknown): Promise<unknown> {
    this.writes.push({ endpoint, body: structuredClone(body) });
    const b = (body ?? {}) as Json;
    const version = `dry-run-${++this.count}`;
    if (typeof b.reportId === 'string' && SAVES.has(endpoint)) {
      this.saves.push({ endpoint, body: structuredClone(b), version });
      for (const [key, answer] of this.answers) {
        const doc = (answer as { reportConfig?: ReportDoc } | undefined)?.reportConfig;
        if (doc && key.startsWith('getReport ') && doc.shareable.id === b.reportId) applySave(doc, endpoint, b, version);
      }
      const own = this.made.get(b.reportId);
      if (own) applySave(own, endpoint, b, version);
    }
    switch (endpoint) {
      case 'updatePage':
      case 'updateReport':
      case 'updateReportNavigationInfo':
        return { version };
      case 'createNamedRevision':
        return { revisionNumber: version };
      case 'createBlockDatasource': {
        const datasource = { ...structuredClone(b.datasource ?? {}), datasourceId: `dry-run-datasource-${this.count}` };
        this.sources.set(datasource.datasourceId, { draft: structuredClone(datasource), embeddedInReportId: b.reportId ?? '' });
        return { datasource };
      }
      case 'renameDatasource': {
        const source = await this.call<Json>('getBlockDatasource', { datasourceId: b.datasourceId });
        for (const state of [source.draft, source.published]) {
          if (state?.datasourceBlock) state.datasourceBlock.name = b.title;
        }
        this.sources.set(b.datasourceId, source);
        return null;
      }
      case 'publishDatasource': {
        const id = b.draft?.datasourceId;
        if (typeof id === 'string') {
          const source = this.sources.get(id) ?? await this.call<Json>('getBlockDatasource', { datasourceId: id });
          source.published = structuredClone(b.draft);
          delete source.draft;
          this.sources.set(id, source);
        }
        return {};
      }
      // A new report: blank (create) or the source's copy (copyReport, which
      // answers the URL it lands on).
      case 'createTempReport':
        return { reportConfig: blankReport(`dry-run-temp-${this.count}`, String(b.reportTitle ?? 'Untitled report')) };
      case 'persistTempReport':
        return { reportConfig: structuredClone(this.make(blankReport('', String(b.reportName ?? 'Untitled report')))) };
      case 'copyReport': {
        const source = typeof b.reportId === 'string' ? (await this.call<{ reportConfig?: ReportDoc }>('getReport', getReportBody(b.reportId, true))).reportConfig : undefined;
        const doc = this.make(source ?? blankReport('', 'Copy'));
        const replacements: Record<string, string> = typeof b.datasourceMap === 'string' ? JSON.parse(b.datasourceMap) : b.datasourceMap ?? {};
        for (const alias of doc.report.resource?.datasourceAlias ?? []) {
          const original = alias.datasourceId;
          if (replacements[original] && replacements[original] !== original) continue;
          const block = await this.call<Json>('getBlockDatasource', { datasourceId: original });
          if (block.embeddedInReportId !== b.reportId) continue;
          const id = `dry-run-datasource-copy-${this.count}-${this.sources.size + 1}`;
          const copied = structuredClone(block);
          copied.embeddedInReportId = doc.shareable.id;
          for (const key of ['draft', 'published']) if (copied[key]) copied[key].datasourceId = id;
          this.sources.set(id, copied);
          replacements[original] = id;
        }
        const replace = (value: unknown): void => {
          if (!value || typeof value !== 'object') return;
          for (const [key, child] of Object.entries(value)) {
            if ((key === 'datasourceId' || key === 'datasetId') && typeof child === 'string' && replacements[child])
              (value as Json)[key] = replacements[child];
            else replace(child);
          }
        };
        replace(doc);
        doc.shareable.name = `Copy of ${source?.shareable.name ?? 'report'}`;
        return { url: `https://lookerstudio.google.com/reporting/${doc.shareable.id}/edit` };
      }
      default:
        return {};
    }
  }

  private make(doc: ReportDoc): ReportDoc {
    const made = structuredClone(doc);
    made.shareable = { ...made.shareable, id: dryRunReportId(this.made.size + 1) };
    made.version = `dry-run-${this.count}`;
    this.made.set(made.shareable.id, made);
    return made;
  }
}

// Writes that change a report's own document.
const SAVES = new Set(['updatePage', 'updateReport', 'updateReportNavigationInfo', 'createPages', 'deletePages']);

function blankReport(id: string, name: string): ReportDoc {
  return {
    shareable: { id, name },
    version: 'dry-run-0',
    report: {},
    navigationInfo: { navItems: [{ page: { pageId: DRY_RUN_PAGE, displayName: 'Page 1' } }] },
    page: [{ pageId: DRY_RUN_PAGE, version: 'dry-run-0', page: { componentConfig: [] } }],
  };
}

function cacheKey(endpoint: string, body: unknown, mode?: string): string {
  return `${endpoint} ${mode ?? 'json'} ${JSON.stringify(body)}`;
}

function applySave(doc: ReportDoc, endpoint: string, b: Json, version: string): void {
  switch (endpoint) {
    case 'updatePage': {
      const page = doc.page?.find((p) => p.pageId === b.pageId);
      const r = b.pageRequest as Json | undefined;
      if (!page || !r) return;
      page.version = version;
      page.chartCondition = r.chartCondition ?? [];
      for (const key of ['componentConfig', 'groupConfig', 'conceptDefs', 'propertyConfig', 'attributeConfig'])
        if (r[key] !== undefined) (page.page as Json)[key] = structuredClone(r[key]);
      return;
    }
    case 'updateReport': {
      doc.version = version;
      const r = b.reportRequest as Json | undefined;
      if (typeof b.reportName === 'string') doc.shareable.name = b.reportName;
      if (!r) return;
      doc.chartCondition = r.chartCondition ?? [];
      for (const key of ['componentConfig', 'conceptDefs', 'propertyConfig', 'attributeConfig', 'resource'])
        if (r[key] !== undefined) (doc.report as Json)[key] = structuredClone(r[key]);
      return;
    }
    case 'updateReportNavigationInfo':
      doc.version = version;
      if (b.navigationInfo) doc.navigationInfo = structuredClone(b.navigationInfo);
      return;
    case 'createPages':
      doc.version = version;
      for (const p of (b.pages ?? []) as Array<Json & { pageId: string; page: PageDoc['page']; displayName?: string }>) {
        (doc.page ??= []).push({ pageId: p.pageId, version, page: structuredClone(p.page ?? {}), chartCondition: p.chartCondition ?? [] });
      }
      {
        // Top-level pages at position.index; in a section, at the end.
        const items = ((doc.navigationInfo ??= {}).navItems ??= []);
        const at = b.position?.sectionId === undefined && typeof b.position?.index === 'number' ? b.position.index : items.length;
        const added = ((b.pages ?? []) as Json[]).map((p) => ({ page: { pageId: p.pageId as string, displayName: (p.displayName ?? p.pageId) as string } }));
        items.splice(Math.min(at, items.length), 0, ...added);
      }
      return;
    case 'deletePages': {
      doc.version = version;
      const gone = new Set((b.pageIds ?? []) as string[]);
      doc.page = (doc.page ?? []).filter((p) => !gone.has(p.pageId));
      if (doc.navigationInfo?.navItems) doc.navigationInfo.navItems = doc.navigationInfo.navItems.filter((n) => !gone.has(n.page?.pageId ?? ''));
      return;
    }
  }
}

// BigQuery reads go through; DDL and deletes are recorded.
class DryBigQuery extends BigQueryClient {
  constructor(
    private readonly inner: BigQueryClient,
    private readonly writes: RecordedWrite[],
  ) {
    super({ token: async () => '' }, inner.config);
  }

  override listDatasets(project: string) {
    return this.inner.listDatasets(project);
  }

  override listTables(project: string, dataset: string) {
    return this.inner.listTables(project, dataset);
  }

  override getTable(project: string, dataset: string, table: string) {
    return this.inner.getTable(project, dataset, table);
  }

  override query(project: string, sql: string, opts?: QueryOptions) {
    return this.inner.query(project, sql, opts);
  }

  override dryRun(project: string, sql: string, opts?: Pick<QueryOptions, 'location'>) {
    return this.inner.dryRun(project, sql, opts);
  }

  override deletable(project: string, dataset: string, table: string) {
    return this.inner.deletable(project, dataset, table);
  }

  override async ddl(project: string, sql: string): Promise<{ jobId?: string }> {
    this.writes.push({ endpoint: 'bigquery.ddl', body: { project, sql } });
    return {};
  }

  // Checked like the real one (a read), then recorded.
  override async deleteTable(project: string, dataset: string, table: string): Promise<void> {
    await this.inner.deletable(project, dataset, table);
    this.writes.push({ endpoint: 'bigquery.deleteTable', body: { project, dataset, table } });
  }
}
