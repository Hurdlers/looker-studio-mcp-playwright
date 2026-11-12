import type { Rap, RapOutcome, RapRequest } from '../looker/rap.js';
import { blockFields, type BlockDatasource } from './datasource.js';
import type { PageDoc, ReportDoc } from './session.js';
import { fromMapValue } from './mapvalue.js';
import { LookerError } from './errors.js';

// Asks for the data of every chart on a page the way the page itself does
// (batchedDataV2) and reports the charts that get an error instead of data.
// No rendering involved, so it works with the tab in the background.
// A chart whose field is gone gets only "error 13" back: the editor's
// "invalid metric" comes from comparing the chart's fields with the data
// source's, which is done here too.
// Each request carries what narrows the chart's data, so a chart left empty by
// its filters counts 0 rows: its own filters and, unless it opts out
// (inheritFilters false), the page's and report's (report.resource.filter
// entries of the chart's data source); its date range (or the page's, then
// the report's) with its date range dimension; and its comparison range.
// Without a date range dimension the server ignores a date range, and so do we.

type Json = Record<string, any>;

export interface ChartCheck {
  componentId: string;
  type: string;
  ok: boolean;
  rows?: number;
  // Rows in the comparison date range, when the chart has one.
  compareRows?: number;
  // The date range asked for, as yyyyMMdd.
  dateRange?: { startDate: string; endDate: string };
  // How many filters narrowed the request.
  filters?: number;
  // On the report level (shown on every page) rather than on this page.
  reportLevel?: boolean;
  // No answer within the time allowed: the chart is still loading.
  timedOut?: boolean;
  error?: string;
}

export interface CheckOptions {
  // Time one chart may take (default 60 s).
  timeoutMs?: number;
  // Time the whole check may take; charts not asked by then are reported as
  // still loading. Default: timeoutMs for every three charts, plus one more.
  deadlineMs?: number;
  // Only these components.
  componentIds?: string[];
  // "Today" for relative date ranges.
  now?: Date;
  timezone?: string;
}

interface Concept {
  name: string;
  queryTimeTransformation?: { dataTransformation?: Json; displayTransformation?: { displayName?: string } };
}

interface Component {
  componentId: string;
  type: string;
  datasourceId?: string;
  conceptDefs?: Concept[];
  propertyConfig?: { componentProperty?: Json };
  behavior?: unknown;
}

export interface Duration {
  startOffsetUnit?: number;
  startOffset?: number;
  endOffsetUnit?: number;
  endOffset?: number;
  startAnchor?: string;
  endAnchor?: string;
}

// Previous period, previous year, fixed or advanced comparison.
export interface CompareDuration {
  anchorType?: number;
  config?: Duration;
}

export interface DataAsk {
  component: Component;
  request: Json;
  reportLevel: boolean;
}

function blendBlock(component: Component, doc?: ReportDoc): Json | undefined {
  const dataset = component.propertyConfig?.componentProperty?.dataset;
  if (dataset?.datasetType !== 2) return undefined;
  const entries = (doc?.report.resource as Json | undefined)?.dataViewResource?.entry ?? [];
  return entries.find((entry: Json) => entry.key === dataset.datasetId)?.value?.blockDatasource;
}

function blendQueries(block: Json): Json[] {
  const queries: Json[] = [];
  const visit = (node: Json | undefined): void => {
    if (typeof node?.query?.datasourceId === 'string') queries.push(node.query);
    if (node?.join) { visit(node.join.left); visit(node.join.right); }
  };
  for (const item of block.blocks ?? []) visit(item.treeQueryBlockConfig);
  return queries;
}

function blendQueryField(concept: Concept, block: Json): Json {
  const out = queryField(concept);
  const field = block.datasourceBlock?.fields?.find((column: Json) => column.field?.name === out.dataTransformation.sourceFieldName);
  const source = field?.queryTimeTransformation?.dataTransformation?.sourceFieldName;
  const index = blendQueries(block).findIndex((query) => query.concepts?.some((entry: Json) => (entry.id?.name ?? entry.name) === source));
  if (index >= 0) out.datasetNs = `d${index}`;
  return out;
}

// Where filters and date ranges go in a request: the main data (context c0)
// or the comparison (c1).
const ns = (context: number) => ({ datasetNs: 'd0', tableNs: 't0', contextNs: `c${context}` });

// Components that read data: a data source and at least one field. The doc
// gives the filters and the page's and report's date settings; without it
// the requests carry none.
export function dataRequests(
  reportId: string,
  page: PageDoc,
  timezone: string,
  doc?: ReportDoc,
  now = new Date(),
  componentIds?: string[],
): DataAsk[] {
  const own = (page.page.componentConfig ?? []) as unknown as Component[];
  const shared = ((doc?.report.componentConfig ?? []) as unknown as Component[]).map((c) => [c, true] as const);
  const out: DataAsk[] = [];
  for (const [c, reportLevel] of [...own.map((c) => [c, false] as const), ...shared]) {
    if (componentIds && !componentIds.includes(c.componentId)) continue;
    const p = c.propertyConfig?.componentProperty ?? {};
    const used = new Set(
      [p.dimensions, p.metrics].flatMap((l: Json | undefined) =>
        ((l?.labeledConcepts ?? []) as Json[]).flatMap((x) => (x.value?.conceptNames ?? []) as string[]),
      ),
    );
    const fields = (c.conceptDefs ?? []).filter((d) => used.has(d.name));
    const blend = blendBlock(c, doc);
    if ((!c.datasourceId && !blend) || !fields.length) continue;
    const encode = (concept: Concept) => blend ? blendQueryField(concept, blend) : queryField(concept);
    const sorts = (p.sort ?? []).flatMap((sort: Json) => {
      const concept = (c.conceptDefs ?? []).find((entry) => entry.name === sort.sortColumn);
      return concept ? [{ sortColumn: encode(concept), sortDir: sort.sortDir ?? 0 }] : [];
    });
    const narrow = doc ? narrowing(c, page, doc, now) : { filters: [], dateRanges: [], dims: [], contexts: 1 };
    out.push({
      component: c,
      reportLevel,
      request: {
        requestContext: {
          reportContext: { reportId, pageId: page.pageId, mode: 1, componentId: c.componentId, displayType: c.type },
          requestMode: 0,
        },
        datasetSpec: {
          dataset: (blend ? blendQueries(blend).map((query) => query.datasourceId as string) : [c.datasourceId!]).map((datasourceId) => ({ datasourceId, revisionNumber: 0, parameterOverrides: [] })),
          ...(blend ? { blendConfig: { blockDatasource: structuredClone(blend) } } : {}),
          queryFields: fields.map(encode),
          sortData: sorts,
          includeRowsCount: false,
          relatedDimensionMask: { addDisplay: false, addUniqueId: false, addLatLong: false },
          dsFilterOverrides: [],
          filters: narrow.filters,
          features: [],
          dateRanges: narrow.dateRanges,
          ...(narrow.dims.length ? { dateRangeDimensions: narrow.dims } : {}),
          contextNsCount: narrow.contexts,
          calculatedField: [],
          needGeocoding: false,
          geoFieldMask: [],
          multipleGeocodeFields: [],
          cacheOptions: {},
          timezone,
        },
      },
    });
  }
  return out;
}

function queryField(d: Concept): Json {
  return { name: d.name, datasetNs: 'd0', tableNs: 't0', dataTransformation: d.queryTimeTransformation?.dataTransformation ?? {} };
}

// Saved picker defaults are part of the viewer's initial query state. A
// grouped picker applies only to that group, never to a neighbouring section.
function pickerDuration(c: Component, page: PageDoc, doc: ReportDoc): Duration | undefined {
  const groups = (page.page.groupConfig ?? []) as Json[];
  const owners = groups.filter(g => (g.componentId ?? []).includes(c.componentId));
  if (owners.length > 1) throw new LookerError('invalid', 'A chart belongs to multiple groups; its date control scope is ambiguous.');
  const owner = owners[0];
  if (owner && ((owner.childGroupId ?? []).length || groups.some(g => (g.childGroupId ?? []).includes(owner.groupId))
    || owner.propertyConfig?.groupProperty?.controlStatePassThrough === true))
    throw new LookerError('invalid', 'Nested or pass-through date control scopes are not supported by this check. Set an explicit chart date range.');
  const members = owners[0] ? new Set<string>(owners[0].componentId ?? []) : undefined;
  const grouped = new Set(groups.flatMap(g => g.componentId ?? []));
  const controls = (page.page.componentConfig ?? []).filter(control =>
    control.type === 'simple-daterangepicker' && (members ? members.has(String(control.componentId)) : !grouped.has(control.componentId)));
  if (!members) controls.push(...(doc.report.componentConfig ?? []).filter(control => control.type === 'simple-daterangepicker'));
  const durations = controls.flatMap(control => {
    const behavior = fromMapValue(control.behavior) as Json | undefined;
    return (behavior?.onSelect ?? []).filter((a: Json) => a.action === 'lego-change-date-range' && a.init?.dateRange && Object.keys(a.init.dateRange).length)
      .map((a: Json) => a.init.dateRange as Duration);
  });
  if (durations.length > 1) throw new LookerError('invalid', 'Multiple date picker defaults apply to this chart; select an explicit chart date range before checking it.');
  return durations[0];
}

function narrowing(c: Component, page: PageDoc, doc: ReportDoc, now: Date, implicitDate = false) {
  const p = c.propertyConfig?.componentProperty ?? {};
  const sourceId = c.datasourceId ?? p.dataset?.datasetId;
  const pageProp = ((page.page.propertyConfig as Json | undefined)?.pageProperty ?? {}) as Json;
  const reportProp = ((doc.report.propertyConfig as Json | undefined)?.reportProperty ?? {}) as Json;
  const inherit = p.inheritFilters !== false;

  const entries = new Map(
    (((doc.report.resource as Json | undefined)?.filter?.entry ?? []) as Json[]).map((e) => [e.key as string, e.value as Json]),
  );
  const keys = [...new Set<string>([...(p.filters ?? []), ...(inherit ? [...(pageProp.filters ?? []), ...(reportProp.filters ?? [])] : [])])];
  const filters = keys.flatMap((key) => {
    const f = entries.get(key);
    if (!f?.filterDefinition || (f.datasourceId && f.datasourceId !== sourceId)) return [];
    return [{ filterDefinition: f.filterDefinition, dataSubsetNs: ns(0), version: f.version ?? 3 }];
  });

  // The date range dimension and range: the chart's own, else a page or
  // report setting made for the chart's data source.
  const levels = [
    { prop: p, defs: c.conceptDefs ?? [], mine: true },
    { prop: pageProp, defs: (page.page.conceptDefs ?? []) as unknown as Concept[], mine: pageProp.dataset?.datasetId === sourceId },
    { prop: reportProp, defs: (doc.report.conceptDefs ?? []) as unknown as Concept[], mine: reportProp.dataset?.datasetId === sourceId },
  ];
  const dimLevel = levels.find((l) => l.mine && l.prop.dateRangeDimension && l.defs.some((d) => d.name === l.prop.dateRangeDimension));
  const dim = dimLevel?.defs.find((d) => d.name === dimLevel.prop.dateRangeDimension);
  const explicit = p.dateDuration as Duration | undefined;
  const duration = explicit && Object.keys(explicit).length ? explicit : (dim || implicitDate ? pickerDuration(c, page, doc) : undefined)
    ?? [pageProp, reportProp].map((x) => x.dateDuration as Duration | undefined).find((d) => d && Object.keys(d).length)
    // Native GA4's required-period default is the 28 completed days.
    ?? (implicitDate ? { startOffsetUnit: 3, startOffset: 28, endOffsetUnit: 3, endOffset: 1 } : undefined);
  const main = (dim || implicitDate) && duration ? dateRange(duration, now) : undefined;
  const compare = main ? compareRange(p.compareDateDuration as CompareDuration | undefined, duration!, main, now) : undefined;
  return {
    filters,
    dateRanges: [
      ...(main ? [{ ...main, dataSubsetNs: ns(0) }] : []),
      ...(compare ? [{ ...compare, dataSubsetNs: ns(1) }] : []),
    ],
    dims: main && dim ? [queryField(dim)] : [],
    contexts: compare ? 2 : 1,
  };
}

// Shared by chart checks and read-only data exploration; never mutate the source.
export function adaptDataRequest(request: Json, source: Json): boolean {
  const block = source.draft ?? source.published;
  const configs = (block?.blocks ?? []).map((b: Json) => b.connectorBlockConfig?.connectorConfig);
  const ga4 = configs.some((c: Json | undefined) => c?.datasourceType === 1 && c.googleAnalyticsConnectorConfig?.isEnhanced === true);
  if (ga4) delete request.datasetSpec.dateRangeDimensions;
  return ga4;
}

export async function checkPage(rap: Rap, doc: ReportDoc, pageId: string, opts: CheckOptions = {}): Promise<ChartCheck[]> {
  const page = doc.page.find((p) => p.pageId === pageId);
  if (!page) return [];
  const timezone = opts.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/GMT');
  const asks = dataRequests(doc.shareable.id, page, timezone, doc, opts.now, opts.componentIds);
  if (!asks.length) return [];
  const sources = [...new Set(asks.flatMap((a) => a.component.datasourceId ? [a.component.datasourceId] : []))];
  const per = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + (opts.deadlineMs ?? per * (Math.ceil((asks.length + sources.length) / ASK_AT_ONCE) + 2));
  // Source metadata selects the date protocol and identifies fields before
  // any chart query. GA4 also requires a period for Auto-date charts.
  const early = sources.length ? await ask(rap, sources.map(datasourceId => ({ endpoint: 'getBlockDatasource', body: { datasourceId } })), per, Math.max(0, deadline - Date.now())) : [];
  const sourceResults = new Map(sources.map((id, i) => [id, early[i]]));
  for (const [id, outcome] of sourceResults) {
    if ((!outcome || typeof outcome !== 'object' || !outcome.ok)
      && asks.some(a => a.component.datasourceId === id && a.request.datasetSpec.dateRangeDimensions))
      throw new LookerError(outcome === 'timeout' || outcome === 'skipped' ? 'busy' : 'refused',
        `Could not read source ${id} to determine its date request format. No chart query was sent; retry source access before checking data.`);
  }
  for (const a of asks) {
    if (blendBlock(a.component, doc)) continue;
    const source = sourceResults.get(a.component.datasourceId ?? '');
    if (source && typeof source === 'object' && source.ok && adaptDataRequest(a.request, source.value)) {
      // GA4 controls use the property's implicit date field, so a grouped
      // picker still narrows them even without a date concept in their slots.
      const scoped = narrowing(a.component, page, doc, opts.now ?? new Date(), true);
      if (scoped.dateRanges.length) {
        a.request.datasetSpec.dateRanges = scoped.dateRanges;
        a.request.datasetSpec.contextNsCount = scoped.contexts;
      }
    }
  }
  const charts = asks.map((a) => ({ endpoint: 'batchedDataV2', body: { dataRequest: [a.request] } }));
  const res = await ask(rap, charts, per, Math.max(0, deadline - Date.now()));
  const fields = new Map(
    sources.map((id) => {
      const r = sourceResults.get(id);
      return [id, r && typeof r === 'object' && r.ok ? new Set(blockFields(r.value as BlockDatasource).map((f) => f.id)) : undefined] as const;
    }),
  );
  return asks.map((a, i) => {
    const blend = blendBlock(a.component, doc);
    const known = blend ? new Set(blockFields({ published: blend }).map((field) => field.id)) : fields.get(a.component.datasourceId as string);
    return judge(a, res[i], known, per);
  });
}

// One component, e.g. right after a tool saved it: the report is read again
// so the check sees what was saved. Undefined when the component reads no
// data (a text, a shape) or is not on the page.
export async function checkComponent(
  rap: Rap,
  load: (reportId: string) => Promise<ReportDoc>,
  reportId: string,
  pageId: string,
  componentId: string,
  opts: Omit<CheckOptions, 'componentIds'> = {},
): Promise<ChartCheck | undefined> {
  const doc = await load(reportId);
  return (await checkPage(rap, doc, pageId, { ...opts, componentIds: [componentId] }))[0];
}

// One line per check, for a tool's answer.
export function describeCheck(c: ChartCheck): string {
  if (c.timedOut) return `${c.componentId} (${c.type}): still loading — ${c.error}`;
  if (!c.ok) return `${c.componentId} (${c.type}): error — ${c.error}`;
  const compare = c.compareRows !== undefined ? `, ${c.compareRows} in the comparison range` : '';
  return `${c.componentId} (${c.type}): ${c.rows ?? 0} row${c.rows === 1 ? '' : 's'}${compare}${c.rows === 0 ? ' (no data)' : ''}`;
}

// What a request got: an answer, no answer in time ('timeout'), or not asked
// because the check's deadline passed ('skipped').
type Asked = RapOutcome<Json> | 'timeout' | 'skipped';

const ASK_AT_ONCE = 3;

// Requests three at a time (the page's own pace), each round trip with the
// per-request limit: the three run side by side, so one slow request is what
// runs out of time. When a round trip does, its requests are asked one at a
// time to tell the slow one apart; the rest keep their limits. Nothing is
// asked after the deadline. Only running out of time is handled here: a
// browser or tab failure fails the check.
async function ask(rap: Rap, requests: RapRequest[], perRequestMs: number, deadlineMs: number): Promise<Asked[]> {
  const until = Date.now() + deadlineMs;
  const once = async (rs: RapRequest[]): Promise<Asked[]> => {
    const left = until - Date.now();
    if (left <= 0) return rs.map(() => 'skipped');
    try {
      return await rap.callMany<Json>(rs, { concurrency: ASK_AT_ONCE, timeoutMs: Math.min(perRequestMs, left) });
    } catch (err) {
      if (!isTimeout(err)) throw err;
      return rs.map(() => 'timeout');
    }
  };
  const out: Asked[] = [];
  for (let i = 0; i < requests.length; i += ASK_AT_ONCE) {
    const chunk = requests.slice(i, i + ASK_AT_ONCE);
    const got = await once(chunk);
    if (chunk.length > 1 && got.every((g) => g === 'timeout')) for (const r of chunk) out.push(...(await once([r])));
    else out.push(...got);
  }
  return out;
}

// The browser's and the worker tab's "no answer in time" errors.
function isTimeout(err: unknown): boolean {
  return (err as { code?: unknown } | undefined)?.code === 'timeout';
}

function judge(a: DataAsk, r: Asked | undefined, known: Set<string> | undefined, timeoutMs: number): ChartCheck {
  const spec = a.request.datasetSpec as Json;
  const main = (spec.dateRanges as Json[]).find((d) => d.dataSubsetNs.contextNs === 'c0');
  const base: ChartCheck = {
    componentId: a.component.componentId,
    type: a.component.type,
    ok: false,
    ...(a.reportLevel ? { reportLevel: true } : {}),
    ...(spec.filters.length ? { filters: spec.filters.length } : {}),
    ...(main ? { dateRange: { startDate: main.startDate, endDate: main.endDate } } : {}),
  };
  const missing = missingFields(a.request, a.component, known);
  if (missing.length) return { ...base, error: `fields not in the data source: ${missing.join(', ')}` };
  if (r === 'timeout') return { ...base, timedOut: true, error: `no answer within ${Math.round(timeoutMs / 1000)} s` };
  if (r === 'skipped') return { ...base, timedOut: true, error: 'not asked: the check ran out of time' };
  if (!r?.ok) return { ...base, error: errorText(r?.error ?? 'no answer') };
  const answer = (r.value.dataResponse as Json[] | undefined)?.[0];
  const subsets = (answer?.dataSubset as Json[] | undefined) ?? [];
  const count = (s: Json | undefined) => {
    const table = s?.dataset?.tableDataset as Json | undefined;
    if (!table) return undefined;
    if (table.totalCount !== undefined && table.totalCount !== null) return Number(table.totalCount);
    // Some connectors return only the number of rows in this columnar batch.
    // A total, when supplied, still takes precedence over the batch size.
    return typeof table.size === 'number' && Number.isSafeInteger(table.size) && table.size >= 0 ? table.size : 0;
  };
  const rows = count(subsets[0]);
  if (rows !== undefined) {
    const compare = spec.contextNsCount > 1 ? count(subsets[1]) : undefined;
    return { ...base, ok: true, rows, ...(compare !== undefined ? { compareRows: compare } : {}) };
  }
  const status = answer?.errorStatus as Json | undefined;
  if (status && !/reasonStr|message/i.test(JSON.stringify(status)))
    return { ...base, error: `Looker Studio returned no data (error code ${String(status.code ?? '?')})` };
  return { ...base, error: errorText(JSON.stringify(answer ?? r.value).slice(0, 600)) };
}

// Plain fields (not formulas) the chart asks for that its data source lacks,
// as "label (field id)". Unknown when the data source could not be read.
function missingFields(request: Json, component: Component, known: Set<string> | undefined): string[] {
  if (!known) return [];
  const asked = ((request.datasetSpec as Json).queryFields as Array<{ name: string; dataTransformation: Json }>) ?? [];
  return asked.flatMap((q) => {
    const field = q.dataTransformation.sourceFieldName;
    if (typeof field !== 'string' || q.dataTransformation.textFormula || known.has(field)) return [];
    const label = component.conceptDefs?.find((d) => d.name === q.name)?.queryTimeTransformation?.displayTransformation?.displayName;
    return [label ? `${label} (${field})` : field];
  });
}

// The useful part of a Looker Studio error: its reason and user-facing message.
function errorText(raw: string): string {
  const reason = /"reasonStr":"([A-Z_]+)"/.exec(raw)?.[1];
  const message = /"(?:endUserMessage|message)":"([^"]{3,300})"/.exec(raw)?.[1];
  return [reason, message].filter(Boolean).join(': ') || raw.slice(0, 300);
}

// ---- Date ranges, worked out the way the editor does.
// Units: 3 day, 4 week from Sunday, 5 week from Monday, 6 month, 7 quarter,
// 8 year. An offset counts units back from today; an anchor (yyyyMMdd) is a
// fixed day.

export function dateRange(d: Duration, now = new Date()): { startDate: string; endDate: string } | undefined {
  if (!d || !Object.keys(d).length) return undefined;
  let start = bound(d.startOffsetUnit, d.startOffset ?? 0, d.startAnchor, true, now);
  const end = bound(d.endOffsetUnit, d.endOffset ?? 0, d.endAnchor, false, now);
  // "This month to date" on the 1st: today's month has no finished day yet,
  // so the range starts a unit earlier.
  if (
    d.startOffsetUnit &&
    d.startOffsetUnit !== 3 &&
    !d.startOffset &&
    !d.startAnchor &&
    d.endOffsetUnit === 3 &&
    (d.endOffset ?? 0) <= 1 &&
    !d.endAnchor &&
    start > end
  )
    start = bound(d.startOffsetUnit, 1, undefined, true, now);
  return { startDate: ymd(start), endDate: ymd(end) };
}

// The comparison range for a main range: previous period (unit 9), a shift
// such as previous year, fixed days, or offsets from today. None otherwise.
export function compareRange(
  c: CompareDuration | undefined,
  mainDuration: Duration,
  main: { startDate: string; endDate: string },
  now = new Date(),
): { startDate: string; endDate: string } | undefined {
  const cfg = c?.config;
  if (!c || !cfg || !Object.keys(cfg).length) return undefined;
  const start = parseYmd(main.startDate);
  const end = parseYmd(main.endDate);
  if (c.anchorType === 1 && cfg.startOffsetUnit === 9) {
    const m = mainDuration;
    if (!m.startAnchor && !m.endAnchor && m.startOffsetUnit && m.startOffsetUnit === m.endOffsetUnit) {
      // As long as the main range, in its own unit: last 7 days → the 7 before.
      const n = Math.abs((m.startOffset ?? 0) - (m.endOffset ?? 0)) + 1;
      return { startDate: ymd(bound(m.startOffsetUnit, n, main.startDate, true, now)), endDate: ymd(bound(m.startOffsetUnit, n, main.endDate, false, now)) };
    }
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    return { startDate: ymd(shift(start, 3, days)), endDate: ymd(shift(end, 3, days)) };
  }
  if (c.anchorType === 1)
    return {
      startDate: ymd(shift(start, cfg.startOffsetUnit ?? 3, cfg.startOffset ?? 0)),
      endDate: ymd(shift(end, cfg.endOffsetUnit ?? 3, cfg.endOffset ?? 0)),
    };
  return dateRange(cfg, now);
}

// The first (start) or last (end) day of the unit `offset` units back from
// the anchor or today.
function bound(unit: number | undefined, offset: number, anchor: string | undefined, isStart: boolean, now: Date): Date {
  const base = anchor ? parseYmd(anchor) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (unit) {
    case 4:
    case 5: {
      const back = (base.getDay() - (unit === 5 ? 1 : 0) + 7) % 7;
      const first = new Date(base.getFullYear(), base.getMonth(), base.getDate() - back - 7 * offset);
      return isStart ? first : new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
    }
    case 6:
    case 7:
    case 8: {
      const months = unit === 6 ? 1 : unit === 7 ? 3 : 12;
      const first = Math.floor((base.getFullYear() * 12 + base.getMonth()) / months) * months - offset * months;
      return isStart ? new Date(Math.floor(first / 12), first % 12, 1) : new Date(Math.floor((first + months) / 12), (first + months) % 12, 0);
    }
    default:
      return new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset);
  }
}

// A day moved n units back, without lining up to the unit; a day past the end
// of a shorter month becomes that month's last day.
function shift(d: Date, unit: number, n: number): Date {
  switch (unit) {
    case 4:
    case 5:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * n);
    case 6:
    case 7:
    case 8: {
      const months = (unit === 6 ? 1 : unit === 7 ? 3 : 12) * n;
      const target = new Date(d.getFullYear(), d.getMonth() - months, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
    }
    default:
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
  }
}

function parseYmd(s: string): Date {
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
