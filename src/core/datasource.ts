import { randomBytes } from 'node:crypto';

import { RapError, type Rap, type RapOutcome } from '../looker/rap.js';
import type { WorkerTab } from '../browser/worker.js';
import { bigQueryConnector } from '../connectors/bigquery.js';
import { sheetsConnector } from '../connectors/sheets.js';
import { ga4Connector } from '../connectors/ga4.js';
import type { BigQuerySource, Column, ConnectorAdapter, ConnectorSource, SourceParams } from '../connectors/types.js';
import { isDryRun } from './dryrun.js';
import { LookerError } from './errors.js';
import { type ReportDoc, type ReportSession, type WriteResult } from './session.js';

export type { BigQuerySource, SourceParams } from '../connectors/types.js';

// Connects a BigQuery table or custom query to a report, the six calls the
// editor makes:
//   getFirstPartyAccessToken → getColumns → createBlockDatasource →
//   publishDatasource → claimDatasourceForReport → updateReport (alias)
// The access token is the user's own Looker Studio token: kept in memory for
// these calls only, never logged or returned.
//
// Also here: changing a data source (editDatasource and the wrappers below),
// reading its fields, and finding a report's data source by name.

export interface SourceField {
  id: string;
  name: string;
  dataType: number;
  aggregation: number;
  formula?: string;
  // Where the editor lists it (getSchema), when known.
  kind?: 'dimension' | 'metric';
  // Looker Studio's semantic type: 32 text, 33 number, 12 currency,
  // 14 percent, 2 date (YEAR_MONTH_DAY), 34 boolean, …
  semanticType?: number;
  outputSemanticInfo?: Record<string, unknown>;
}

export interface AddedSource {
  datasourceId: string;
  // Empty for a reusable source: no report uses it yet.
  alias: string;
  fields: SourceField[];
}

export interface AddSourceOptions {
  // The data source's name (shown in the data source list).
  name?: string;
  params?: SourceParams;
}

type Json = Record<string, unknown>;

// Defaults the editor sends for a new data source.
const DATASOURCE_DEFAULTS: Json = {
  datasourceId: '',
  allowThirdPartyViz: true,
  allowThirdPartyVizExternalAccess: false,
  isAutoRefreshEnabled: false,
  requestFilters: { filterIds: [] },
  allowNativeFunctions: false,
  delegatedAccessEnabled: true,
  isUnlocked: true,
  isCacheable: false,
  resource: {},
  queryCachePolicy: { shelfLife: { amount: 12, chronoUnit: 2 }, isDefaultPolicy: true },
};

// Compatibility entry points for callers that already supply BigQuery inputs.
export function connectorConfig(source: BigQuerySource, params: SourceParams = {}): Json {
  return bigQueryConnector.buildConfig(source, params);
}

export function addBigQuerySource(
  deps: { rap: Rap; worker: Pick<WorkerTab, 'run'>; session: ReportSession },
  reportId: string | null,
  source: BigQuerySource,
  opts: string | AddSourceOptions = {},
): Promise<AddedSource> {
  return addDataSource(deps, reportId, { connector: 'bigquery', source }, opts);
}

// Adds a connected data source to a report, or, with reportId null, makes a
// reusable data source of its own (no claim, no alias). `opts` may be just
// the name.
export async function addDataSource(
  deps: { rap: Rap; worker: Pick<WorkerTab, 'run'>; session: ReportSession },
  reportId: string | null,
  connection: ConnectorSource,
  opts: string | AddSourceOptions = {},
): Promise<AddedSource> {
  if (connection.connector === 'bigquery') return addSourceWithConnector(deps, reportId, bigQueryConnector, connection.source, opts);
  if (connection.connector === 'google_sheets') return addSourceWithConnector(deps, reportId, sheetsConnector, connection.source, opts);
  if (connection.connector === 'ga4') return addSourceWithConnector(deps, reportId, ga4Connector, connection.source, opts);
  throw new LookerError('invalid', 'The data source connector is not supported.');
}

// The shared creation lifecycle also works for connectors without SQL or a
// Linking API. Their adapter supplies only native settings and column access.
export async function addSourceWithConnector<TSource>(
  deps: { rap: Rap; worker: Pick<WorkerTab, 'run'>; session: ReportSession },
  reportId: string | null,
  adapter: ConnectorAdapter<TSource>,
  source: TSource,
  opts: string | AddSourceOptions = {},
): Promise<AddedSource> {
  const { rap } = deps;
  const o = typeof opts === 'string' ? { name: opts } : opts;
  const name = o.name?.trim() || adapter.defaultName(source);
  const config = adapter.buildConfig(source, o.params);
  const connectorBlockConfig = { alias: 't0', connectorConfig: config, useDatetimeType: true };
  const { columns, projectNumber, accessToken } = await adapter.loadColumns(deps, connectorBlockConfig);
  const [connectorId, outputId] = [blockId(), blockId()];
  const datasource = {
    ...DATASOURCE_DEFAULTS,
    blocks: [
      {
        type: 2,
        inputBlockIds: [],
        outputBlockIds: [outputId],
        fields: columns.filter((c) => c.mutableVersion),
        connectorBlockConfig,
        id: connectorId,
        name: adapter.label,
      },
    ],
    datasourceBlock: {
      type: 1,
      inputBlockIds: [connectorId],
      outputBlockIds: [],
      fields: columns
        .filter((c) => c.columnType === 1)
        .map((c) => ({ ...c, field: { ...c.field, simpleName: c.field.simpleName ?? c.field.name } })),
      id: outputId,
      name,
    },
  };
  const created = await rap.call<{ datasource: Json & { datasourceId: string } }>('createBlockDatasource', {
    name,
    oauthType: adapter.oauthType,
    datasource,
    ...(reportId ? { reportId } : {}),
    uiCreateOptions: { projectNumber, region: 'global' },
    accessToken,
  });
  const datasourceId = created.datasource.datasourceId;
  await rap.call('publishDatasource', { draft: created.datasource, clearThumbnails: false, ...(reportId ? { reportId } : {}), accessToken });
  const fields = fieldsOf(datasource.datasourceBlock.fields);
  if (!reportId) return { datasourceId, alias: '', fields };
  await rap.call('claimDatasourceForReport', { reportId, datasourceId });
  let alias = '';
  await deps.session.editReport(
    reportId,
    (doc) => {
      const aliases = (doc.report.resource ??= {}).datasourceAlias ?? [];
      alias = nextAlias(aliases.map((a) => a.alias));
      doc.report.resource.datasourceAlias = [...aliases, { datasourceId, alias }];
    },
    `add data source ${name}`,
  );
  return { datasourceId, alias, fields };
}

// What getBlockDatasource answers. embeddedInReportId: the report the data
// source belongs to ("" for a reusable one).
export type BlockDatasource = { published?: Json; draft?: Json; embeddedInReportId?: string };

// The fields of a data source as charts address them. With a reportId, also
// whether each is a dimension or a metric (getSchema, same round trip).
export async function sourceFields(rap: Rap, datasourceId: string, opts: { reportId?: string } = {}): Promise<SourceField[]> {
  if (!opts.reportId) return blockFields(await rap.call<BlockDatasource>('getBlockDatasource', { datasourceId }));
  const [block, schema] = await rap.callMany<unknown>([
    { endpoint: 'getBlockDatasource', body: { datasourceId } },
    { endpoint: 'getSchema', body: schemaBody(datasourceId, opts.reportId) },
  ]);
  if (!block?.ok) throw new RapError('getBlockDatasource', block?.status ?? 0, `getBlockDatasource returned HTTP ${block?.status}: ${block?.error}`);
  const fields = blockFields(block.value as BlockDatasource);
  return schema?.ok ? withSchema(fields, schema.value as SchemaAnswer) : fields;
}

export function blockFields(res: BlockDatasource): SourceField[] {
  const doc = (res.published ?? res.draft) as { datasourceBlock?: { fields?: Column[] } } | undefined;
  return fieldsOf(doc?.datasourceBlock?.fields ?? []);
}

// getSchema lists a data source's fields as the editor's field panel does.
export function schemaBody(datasourceId: string, reportId: string): Json {
  return {
    datasourceId,
    includeDisabledColumns: false,
    revisionNumber: '0',
    requestContext: { reportContext: { reportId, mode: 2 }, requestMode: 0 },
    version: '-1',
    googleAuthOAuthToken: '',
  };
}

interface SchemaField {
  name: string;
  semanticInfo?: { semanticConfig?: Array<{ semanticType?: number }> };
}

export type SchemaAnswer = { schema?: { dimensions?: SchemaField[]; metrics?: SchemaField[]; isDelegatedAccessEnabled?: boolean } & Json };

export function withSchema(fields: SourceField[], res: SchemaAnswer): SourceField[] {
  const known = new Map<string, { kind: 'dimension' | 'metric'; semanticType?: number; outputSemanticInfo?: Record<string, unknown> }>();
  for (const [kind, list] of [['dimension', res.schema?.dimensions], ['metric', res.schema?.metrics]] as const)
    for (const f of list ?? []) {
      const semanticType = f.semanticInfo?.semanticConfig?.[0]?.semanticType;
      known.set(f.name, { kind, ...(semanticType !== undefined ? { semanticType, outputSemanticInfo: structuredClone(f.semanticInfo!) } : {}) });
    }
  return fields.map((f) => {
    const schema = known.get(f.id);
    if (!schema?.outputSemanticInfo) return { ...f, ...schema };
    const prior = (f.outputSemanticInfo?.semanticConfig ?? []) as Array<Record<string, unknown>>;
    const configs = schema.outputSemanticInfo.semanticConfig as Array<Record<string, unknown>>;
    return { ...f, ...schema, outputSemanticInfo: {
      ...f.outputSemanticInfo, ...schema.outputSemanticInfo,
      semanticConfig: configs.map((config) => ({ ...prior.find((old) => old.semanticType === config.semanticType), ...config })),
    } };
  });
}

function fieldsOf(columns: Column[]): SourceField[] {
  return columns.map((c) => {
    const semanticType = (c.outputSemanticInfo as { semanticConfig?: Array<{ semanticType?: number }> } | undefined)?.semanticConfig?.[0]?.semanticType;
    return {
      id: c.field.name,
      name: c.outputName ?? c.field.name,
      dataType: c.dataType ?? 0,
      aggregation: c.defaultAggregationType ?? 0,
      ...(c.textFormula && !c.field.name.startsWith('datastudio_') ? { formula: c.textFormula } : {}),
      ...(semanticType !== undefined ? { semanticType } : {}),
      ...(c.outputSemanticInfo ? { outputSemanticInfo: structuredClone(c.outputSemanticInfo as Record<string, unknown>) } : {}),
    };
  });
}

// ---- Changing a data source -------------------------------------------------

export interface EditedSource {
  datasourceId: string;
  fields: SourceField[];
  // The data source as it was: restoreDatasource(rap, reportId, datasourceId,
  // previous) puts it back.
  previous: Json;
}

// Changes a data source the way the editor saves one: read it (the draft when
// there is one, which holds unpublished edits), change a copy, publish it.
// `edit` gets the copy (blocks, datasourceBlock.fields, queryCachePolicy, …)
// to change in place. reportId is the report it belongs to; null for a
// reusable source.
export async function editDatasource(
  rap: Rap,
  reportId: string | null,
  datasourceId: string,
  edit: (ds: Json) => void,
  label = 'edit data source',
): Promise<EditedSource> {
  const got = await rap.call<BlockDatasource>('getBlockDatasource', { datasourceId });
  const current = got.draft ?? got.published;
  if (!current) throw new LookerError('not_found', `Data source ${datasourceId} not found, or this account cannot open it (${label}).`);
  const previous = structuredClone(current);
  const draft = structuredClone(current);
  edit(draft);
  const { accessToken } = await rap.call<{ accessToken: string }>('getFirstPartyAccessToken', {});
  await rap.call('publishDatasource', { draft, clearThumbnails: false, ...(reportId ? { reportId } : {}), accessToken });
  return { datasourceId, fields: blockFields({ published: draft }), previous };
}

// Puts a data source back as editDatasource found it (its `previous`): the
// whole content is replaced, so keys an edit added (parameterConfiguration,
// a new block) go too.
export async function restoreDatasource(rap: Rap, reportId: string | null, datasourceId: string, previous: Json): Promise<EditedSource> {
  return editDatasource(
    rap,
    reportId,
    datasourceId,
    (ds) => {
      for (const key of Object.keys(ds)) delete ds[key];
      Object.assign(ds, structuredClone(previous));
    },
    'restore data source',
  );
}

// Renames a data source: the name in the data source list (getDatasourceList),
// read back to confirm. Whether the datasourceBlock name follows is not
// known; read names from the list (datasourceInfo, resolveSource).
export async function renameDatasource(rap: Rap, datasourceId: string, name: string): Promise<{ name: string }> {
  const title = name.trim();
  if (!title) throw new LookerError('invalid', 'A data source name cannot be empty.');
  await rap.call('renameDatasource', { datasourceId, title });
  if (isDryRun(rap)) return { name: title };
  const [info] = await datasourceInfo(rap, [datasourceId]);
  if (info?.name !== title)
    throw new LookerError('format_changed', `renameDatasource answered but the name reads "${info?.name ?? '?'}": Looker Studio may have changed its internal API.`);
  return { name: title };
}

export interface SourceUse {
  componentId: string;
  type: string;
  // Page name, or "report level".
  page: string;
}

// Where a report uses a data source: components on every page and at report
// level (charts, controls, blends), conditional formatting, and report
// filters and parameters.
export function sourceUses(doc: ReportDoc, datasourceId: string): SourceUse[] {
  const names = new Map<string, string>();
  const walk = (items: NonNullable<ReportDoc['navigationInfo']>['navItems'] = []): void =>
    items.forEach((i) => {
      if (i.page) names.set(i.page.pageId, i.page.displayName ?? i.page.pageId);
      walk(i.section?.navItems);
    });
  walk(doc.navigationInfo?.navItems);
  const uses = (c: Json) => JSON.stringify(c).includes(datasourceId);
  const found: SourceUse[] = [];
  for (const p of doc.page)
    for (const c of p.page.componentConfig ?? [])
      if (uses(c)) found.push({ componentId: String(c.componentId), type: String(c.type), page: names.get(p.pageId) ?? p.pageId });
  for (const p of doc.page)
    if (uses({ c: p.chartCondition ?? [] }))
      found.push({ componentId: '(conditional formatting)', type: 'chartCondition', page: names.get(p.pageId) ?? p.pageId });
  for (const c of doc.report.componentConfig ?? [])
    if (uses(c)) found.push({ componentId: String(c.componentId), type: String(c.type), page: 'report level' });
  if (uses({ c: doc.chartCondition ?? [] })) found.push({ componentId: '(conditional formatting)', type: 'chartCondition', page: 'report level' });
  const { datasourceAlias: _aliases, ...rest } = doc.report.resource ?? {};
  if (uses(rest)) found.push({ componentId: '(report filters or parameters)', type: 'resource', page: 'report level' });
  return found;
}

// Takes a data source out of a report: its alias first (a saved report
// change, so a snapshot comes before anything else), then deleteClaim. When
// deleteClaim fails the alias is put back. Refused while anything in the
// report uses it, naming what does.
export async function removeDatasource(
  deps: { rap: Rap; session: ReportSession },
  reportId: string,
  datasourceId: string,
): Promise<WriteResult & { alias: string }> {
  const doc = await deps.session.load(reportId);
  const alias = doc.report.resource?.datasourceAlias?.find((a) => a.datasourceId === datasourceId)?.alias;
  if (!alias) throw new LookerError('not_found', `Data source ${datasourceId} is not in report ${reportId}.`);
  const uses = sourceUses(doc, datasourceId);
  if (uses.length)
    throw new LookerError(
      'invalid',
      `Data source ${alias} is still used by ${uses.map((u) => `${u.componentId} (${u.type}) on ${u.page === 'report level' ? 'report level' : `page "${u.page}"`}`).join(', ')}. Remove or repoint those first.`,
    );
  const res = await deps.session.editReport(
    reportId,
    (d) => {
      const r = (d.report.resource ??= {});
      r.datasourceAlias = (r.datasourceAlias ?? []).filter((a) => a.datasourceId !== datasourceId);
    },
    `remove data source ${alias}`,
  );
  try {
    await deps.rap.call('deleteClaim', { reportId, datasourceId });
  } catch (err) {
    await deps.session
      .editReport(
        reportId,
        (d) => {
          const r = (d.report.resource ??= {});
          const rest = (r.datasourceAlias ?? []).filter((a) => a.datasourceId !== datasourceId);
          r.datasourceAlias = [...rest, { datasourceId, alias }];
        },
        `undo remove data source ${alias}`,
      )
      .catch(() => undefined);
    throw err;
  }
  return { ...res, alias };
}

// Whose credentials the data source uses to read BigQuery: the owner's
// (everyone sees the owner's data) or each viewer's own. Read back from
// getSchema.
export async function setCredentials(
  rap: Rap,
  reportId: string,
  datasourceId: string,
  who: 'owner' | 'viewer',
): Promise<{ version?: string; credentials: 'owner' | 'viewer' }> {
  const res = await rap.call<{ version?: string } | null>('updateDataAccessControl', {
    datasourceId,
    reportId,
    delegatedAccessEnabled: who === 'owner',
    oauthType: 1,
  });
  if (isDryRun(rap)) return { ...(res?.version ? { version: res.version } : {}), credentials: who };
  const schema = await rap.call<SchemaAnswer>('getSchema', schemaBody(datasourceId, reportId));
  const now = schema.schema?.isDelegatedAccessEnabled ? 'owner' : 'viewer';
  if (now !== who)
    throw new LookerError('format_changed', `updateDataAccessControl answered but the data source still uses ${now} credentials.`);
  return { ...(res?.version ? { version: res.version } : {}), credentials: now };
}

// Turns a report's own (embedded) data source into a reusable one, keeping
// sharing as it is. Looker Studio answers this call with 403 and converts
// anyway, so the answer is judged by reading isEmbedded again. Cannot be
// undone; the reusable source outlives the report.
export async function makeReusable(rap: Rap, reportId: string, datasourceId: string): Promise<{ converted: boolean }> {
  const [before] = await datasourceInfo(rap, [datasourceId]);
  if (!before) throw new LookerError('not_found', `Data source ${datasourceId} not found, or this account cannot open it.`);
  if (!before.isEmbedded) return { converted: false };
  let failure: RapError | undefined;
  try {
    await rap.call('convertEmbeddedDatasource', { datasourceId, reportId, updateSharing: false });
  } catch (err) {
    if (!(err instanceof RapError)) throw err;
    failure = err;
  }
  if (isDryRun(rap)) return { converted: true };
  const [after] = await datasourceInfo(rap, [datasourceId]);
  if (after && !after.isEmbedded) return { converted: true };
  if (failure) throw new LookerError('refused', `Looker Studio did not make data source ${datasourceId} reusable: ${failure.message}`);
  throw new LookerError('format_changed', `convertEmbeddedDatasource answered but data source ${datasourceId} is still embedded.`);
}

export interface DatasourceInfo {
  datasourceId: string;
  name: string;
  isEmbedded: boolean;
}

// List names and whether each is embedded, for these ids only (without
// shareableIds the list holds every reusable source the account can see).
export async function datasourceInfo(rap: Rap, ids: string[]): Promise<DatasourceInfo[]> {
  if (!ids.length) return [];
  return infoRows(ids, await rap.call<DatasourceList>('getDatasourceList', listBody(ids)));
}

type DatasourceList = { datasourceInfo?: Array<{ shareableConfig?: { id?: string; name?: string }; isEmbedded?: boolean }> };

function listBody(ids: string[]): Json {
  return { type: [1], trashed: false, shareableIds: ids };
}

function infoRows(ids: string[], res: DatasourceList): DatasourceInfo[] {
  const by = new Map((res.datasourceInfo ?? []).map((d) => [(d.shareableConfig?.id ?? '').toLowerCase(), d]));
  return ids.flatMap((id) => {
    const d = by.get(id.toLowerCase());
    return d ? [{ datasourceId: id, name: d.shareableConfig?.name ?? '', isEmbedded: d.isEmbedded === true }] : [];
  });
}

// ---- Consent ----------------------------------------------------------------

// Whether the signed-in account has consented to a data source's viewer
// email parameter (DS_USER_EMAIL). consentTypes [1] is that consent.
export async function hasViewerEmailConsent(rap: Rap, datasourceId: string): Promise<boolean> {
  const res = await rap.call<{ parameter?: { consent?: Array<{ consentType?: number; approval?: number }> } }>('checkConsent', {
    parameter: { datasourceId, consentTypes: [1] },
  });
  return (res.parameter?.consent ?? []).some((c) => c.consentType === 1 && c.approval === 1);
}

// Consents, for the signed-in account only, to pass its email to the data
// source's @DS_USER_EMAIL. Other viewers consent for themselves.
export async function grantViewerEmailConsent(rap: Rap, datasourceId: string): Promise<void> {
  await rap.call('grantConsent', { parameter: { consent: [{ consentType: 1, approval: 1 }], datasourceId } });
}

// Lets a community visualization read the report's data
// (getCommunityVizRegistrationInfo gives the fingerprint).
// vizId is "<manifestPath>::<componentId>".
export async function grantVizConsent(rap: Rap, reportId: string, vizId: string, manifestFingerprint: string): Promise<void> {
  await rap.call('grantConsent', { vizPermitted: { reportId, vizId, manifestFingerprint, type: 1 } });
}

// ---- Finding a data source ----------------------------------------------------

export interface ResolvedSource {
  datasourceId: string;
  alias: string;
  name: string;
  fields: SourceField[];
}

// Finds one of a report's data sources by alias (ds1), id, or name (case and
// surrounding spaces ignored). Without a name, the report's only data source.
// Fields carry kind (dimension or metric) when getSchema answered.
export async function resolveSource(rap: Rap, doc: ReportDoc, name?: string): Promise<ResolvedSource> {
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  if (!aliases.length) throw new LookerError('invalid', `Report ${doc.shareable.id} has no data source yet: add one first.`);
  const want = name?.trim().toLowerCase();
  // Alias or id: no lookup of names needed.
  const direct = want ? aliases.find((a) => a.alias.toLowerCase() === want || a.datasourceId.toLowerCase() === want) : aliases.length === 1 ? aliases[0] : undefined;
  const candidates = direct ? [direct] : aliases;
  const ids = candidates.map((a) => a.datasourceId);
  // One round trip: each data source, its dimensions and metrics, and the
  // list with their names.
  const answers = await rap.callMany<unknown>([
    ...ids.map((datasourceId) => ({ endpoint: 'getBlockDatasource', body: { datasourceId } })),
    ...ids.map((datasourceId) => ({ endpoint: 'getSchema', body: schemaBody(datasourceId, doc.shareable.id) })),
    { endpoint: 'getDatasourceList', body: listBody(ids) },
  ]);
  const listed = answers[2 * ids.length];
  const info = listed?.ok ? infoRows(ids, listed.value as DatasourceList) : [];
  const rows = candidates.map((a, i) => {
    const b = answers[i] as RapOutcome<BlockDatasource> | undefined;
    const block = b?.ok ? (b.value.published ?? b.value.draft) : undefined;
    const listedName = info.find((d) => d.datasourceId === a.datasourceId)?.name;
    const blockName = (block as { datasourceBlock?: { name?: string } } | undefined)?.datasourceBlock?.name;
    const schema = answers[ids.length + i];
    const fields = b?.ok ? blockFields(b.value) : undefined;
    return { ...a, name: listedName || blockName || a.alias, fields: fields && schema?.ok ? withSchema(fields, schema.value as SchemaAnswer) : fields };
  });
  const hits = direct ? rows : rows.filter((r) => r.name.trim().toLowerCase() === want);
  const list = rows.map((r) => `${r.alias} "${r.name}"`).join(', ');
  if (!hits.length)
    throw new LookerError(
      want ? 'not_found' : 'invalid',
      want ? `No data source "${name}" in report ${doc.shareable.id}: it has ${list}.` : `Report ${doc.shareable.id} has ${rows.length} data sources (${list}): name one.`,
    );
  if (hits.length > 1) throw new LookerError('invalid', `${hits.length} data sources are named "${name}" (${hits.map((h) => h.alias).join(', ')}): use the alias.`);
  const hit = hits[0]!;
  if (!hit.fields) throw new LookerError('not_found', `Data source ${hit.alias} (${hit.datasourceId}) cannot be read by this account.`);
  return { datasourceId: hit.datasourceId, alias: hit.alias, name: hit.name, fields: hit.fields };
}

export function nextAlias(taken: string[]): string {
  const n = Math.max(0, ...taken.map((a) => Number(/^ds(\d+)$/.exec(a)?.[1] ?? 0)));
  return `ds${n + 1}`;
}

function blockId(): string {
  return `block_${randomBytes(5).toString('hex')}`;
}
