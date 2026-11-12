import { datasourceInfo, schemaBody, sourceUses, type BlockDatasource } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import type { Rap } from '../../looker/rap.js';
import { aggregationLabel, typeLabel } from './types.js';

// A report's data sources as the tools show them, and finding one by alias,
// id or name.

type Json = Record<string, any>;

export interface SourceRef {
  datasourceId: string;
  alias: string;
  name: string;
}

// The report's data sources (its aliases) with their names from the data
// source list: one request.
export async function sourceRefs(rap: Rap, doc: ReportDoc): Promise<SourceRef[]> {
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  const info = await datasourceInfo(
    rap,
    aliases.map((a) => a.datasourceId),
  );
  return aliases.map((a) => ({ ...a, name: info.find((i) => i.datasourceId === a.datasourceId)?.name || a.alias }));
}

export function describeRefs(refs: SourceRef[]): string {
  return refs.map((r) => `${r.alias} "${r.name}"`).join(', ');
}

// One data source by alias (ds1), id, or name (case and surrounding spaces
// ignored). Without a reference, the only one. Two with the same name need
// the alias.
export function pickSource<T extends SourceRef>(refs: T[], reportId: string, ref?: string): T {
  if (!refs.length) throw new LookerError('invalid', `Report ${reportId} has no data source yet: add one with datasource_add.`);
  const want = ref?.trim().toLowerCase();
  if (!want) {
    if (refs.length === 1) return refs[0]!;
    throw new LookerError('invalid', `Report ${reportId} has ${refs.length} data sources (${describeRefs(refs)}): name one.`);
  }
  const direct = refs.find((r) => r.alias.toLowerCase() === want || r.datasourceId.toLowerCase() === want);
  if (direct) return direct;
  const hits = refs.filter((r) => r.name.trim().toLowerCase() === want);
  if (!hits.length) throw new LookerError('not_found', `No data source "${ref}" in report ${reportId}: it has ${describeRefs(refs)}.`);
  if (hits.length > 1)
    throw new LookerError('invalid', `${hits.length} data sources are named "${ref}" (${hits.map((h) => h.alias).join(', ')}): use the alias.`);
  return hits[0]!;
}

// ---- Everything datasource_list shows -------------------------------------

export interface SchemaField {
  name: string;
  displayName?: string;
  dataType?: number;
  newDefaultAggregation?: number;
  semanticInfo?: { semanticConfig?: Array<{ semanticType?: number; currencyOptions?: { currencyCode?: string } }> };
}

interface Schema {
  dimensions?: SchemaField[];
  metrics?: SchemaField[];
  connectorType?: number;
  isDelegatedAccessEnabled?: boolean;
  cacheShelfLife?: { amount?: number; chronoUnit?: number };
}

export interface SourceDetail extends SourceRef {
  embedded?: boolean;
  // The data source document (published, or the draft when there is none).
  block?: Json;
  embeddedInReportId?: string;
  schema?: Schema;
  // Why it could not be read, when it could not.
  error?: string;
}

// Every data source of the report in one round trip: each one's document,
// its field panel (getSchema) and the list with names.
export async function readSources(rap: Rap, doc: ReportDoc): Promise<SourceDetail[]> {
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  if (!aliases.length) return [];
  const ids = aliases.map((a) => a.datasourceId);
  const answers = await rap.callMany<unknown>([
    ...ids.map((datasourceId) => ({ endpoint: 'getBlockDatasource', body: { datasourceId } })),
    ...ids.map((datasourceId) => ({ endpoint: 'getSchema', body: schemaBody(datasourceId, doc.shareable.id) })),
    { endpoint: 'getDatasourceList', body: { type: [1], trashed: false, shareableIds: ids } },
  ]);
  const listed = answers[2 * ids.length];
  const info = new Map<string, { name?: string; isEmbedded?: boolean }>();
  if (listed?.ok)
    for (const d of (listed.value as { datasourceInfo?: Array<{ shareableConfig?: { id?: string; name?: string }; isEmbedded?: boolean }> }).datasourceInfo ?? [])
      info.set((d.shareableConfig?.id ?? '').toLowerCase(), { ...(d.shareableConfig?.name ? { name: d.shareableConfig.name } : {}), ...(d.isEmbedded !== undefined ? { isEmbedded: d.isEmbedded } : {}) });
  return aliases.map((a, i) => {
    const b = answers[i];
    const s = answers[ids.length + i];
    const got = b?.ok ? (b.value as BlockDatasource) : undefined;
    const block = (got?.published ?? got?.draft) as Json | undefined;
    const listedInfo = info.get(a.datasourceId.toLowerCase());
    const name = listedInfo?.name || block?.datasourceBlock?.name || a.alias;
    const embedded = listedInfo?.isEmbedded ?? (got?.embeddedInReportId !== undefined ? got.embeddedInReportId !== '' : undefined);
    return {
      ...a,
      name,
      ...(embedded !== undefined ? { embedded } : {}),
      ...(block ? { block } : {}),
      ...(got?.embeddedInReportId !== undefined ? { embeddedInReportId: got.embeddedInReportId } : {}),
      ...(s?.ok ? { schema: ((s.value as { schema?: Schema }).schema ?? {}) as Schema } : {}),
      ...(b && !b.ok ? { error: `HTTP ${b.status}` } : {}),
    };
  });
}

// The connector settings of a data source document.
export function connectorOf(block: Json | undefined): Json | undefined {
  return block?.blocks?.[0]?.connectorBlockConfig?.connectorConfig;
}

// The connection identity, without credentials or the native configuration.
export function connectionText(d: SourceDetail): string {
  const c = connectorOf(d.block);
  if (c?.datasourceType === 1 && c.googleAnalyticsConnectorConfig) {
    const analytics = c.googleAnalyticsConnectorConfig;
    return analytics.isEnhanced === true && !analytics.viewId
      ? `Google Analytics 4, account ${analytics.accountId ?? '?'}, property ${analytics.propertyId ?? '?'}`
      : 'Google Analytics (legacy or unsupported configuration)';
  }
  if (c?.datasourceType === 8 || c?.sheetsConfig !== undefined || (!c && d.schema?.connectorType === 4)) {
    const sheets = (c?.sheetsConfig ?? {}) as Json;
    const sheet = sheets.meta?.worksheetName ?? (sheets.sheetId !== undefined ? `gid ${sheets.sheetId}` : undefined);
    return `Google Sheets${sheets.key ? ` ${sheets.key}` : ''}${sheet ? `, worksheet ${sheet}` : ''}${sheets.range ? `, range ${sheets.range}` : ''}`;
  }
  const bigquery = c?.datasourceType === 2 || d.schema?.connectorType === 2 || c?.bigQueryConnectorConfig !== undefined;
  if (!bigquery) {
    const type = c?.datasourceType ?? d.schema?.connectorType;
    return type !== undefined ? `connector type ${type} (not BigQuery)` : 'connector unknown';
  }
  const bq = (c?.bigQueryConnectorConfig ?? {}) as Json;
  if (typeof c?.sql === 'string') return `BigQuery custom query, billing project ${bq.billingProjectId ?? bq.projectId ?? '?'}`;
  if (bq.tableId) return `BigQuery table ${bq.projectId}.${bq.datasetId}.${bq.tableId}`;
  return 'BigQuery';
}

export function freshnessText(d: SourceDetail): string | undefined {
  const life = d.schema?.cacheShelfLife ?? d.block?.queryCachePolicy?.shelfLife;
  if (!life?.amount) return undefined;
  const unit = life.chronoUnit === 1 ? 'minute' : life.chronoUnit === 2 ? 'hour' : life.chronoUnit === 3 ? 'day' : `unit ${life.chronoUnit}`;
  return `${life.amount} ${unit}${life.amount === 1 ? '' : 's'}`;
}

export function credentialsText(d: SourceDetail): string | undefined {
  const delegated = d.schema?.isDelegatedAccessEnabled ?? d.block?.delegatedAccessEnabled;
  return delegated === undefined ? undefined : delegated ? 'owner' : 'viewer';
}

// Components using the source, and report filters or parameters naming it.
export function usesOf(doc: ReportDoc, datasourceId: string): { charts: number; variables: number } {
  const charts = sourceUses(doc, datasourceId).filter((u) => u.type !== 'resource' && u.type !== 'chartCondition').length;
  const { datasourceAlias: _a, ...rest } = doc.report.resource ?? {};
  let variables = 0;
  for (const value of Object.values(rest)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) if (JSON.stringify(item ?? null).includes(datasourceId)) variables++;
  }
  return { charts, variables };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function describeSource(doc: ReportDoc, d: SourceDetail, withFields: boolean): string[] {
  const { charts, variables } = usesOf(doc, d.datasourceId);
  const head = `${d.alias} "${d.name}" (id ${d.datasourceId})`;
  if (d.error && !d.block) return [`${head}: used by ${plural(charts, 'chart')}; this account cannot read it (${d.error}).`];
  const parts = [
    `${plural(charts, 'chart')}, ${variables} report filters/parameters`,
    connectionText(d),
    d.embedded === undefined ? undefined : d.embedded ? 'embedded in this report' : 'reusable',
  ];
  const credentials = credentialsText(d);
  if (credentials) parts.push(`credentials: ${credentials}`);
  const freshness = freshnessText(d);
  if (freshness) parts.push(`data freshness: ${freshness}`);
  const health = d.block?.datasourceBlock?.health;
  if (health !== undefined) parts.push(`status: ${health === 1 ? 'ok' : `problem (health ${health})`}`);
  const c = connectorOf(d.block);
  const params = ((c?.parameterConfiguration?.parameters ?? []) as Json[]).map((p) => String(p.key));
  if (params.length) parts.push(`query parameters: ${params.map((p) => `@${p}`).join(', ')}`);
  const lines = [`${head} — ${parts.filter(Boolean).join('; ')}`];
  if (typeof c?.sql === 'string') lines.push(`  SQL: ${c.sql}`);
  if (withFields) {
    const fields = [
      ...(d.schema?.dimensions ?? []).map((f) => ({ f, kind: 'dimension' })),
      ...(d.schema?.metrics ?? []).map((f) => ({ f, kind: 'metric' })),
    ];
    if (!d.schema) lines.push('  Fields: could not be read.');
    else {
      lines.push(`  Fields (${fields.length}):`);
      let numericDimension = false;
      for (const { f, kind } of fields) {
        const cfg = f.semanticInfo?.semanticConfig?.[0];
        const type = typeLabel(cfg?.semanticType, cfg?.currencyOptions?.currencyCode);
        lines.push(`    - ${f.displayName ?? f.name} (${f.name}): ${type}, ${kind}, aggregation ${aggregationLabel(f.newDefaultAggregation ?? 0)}`);
        if (kind === 'dimension' && (f.newDefaultAggregation ?? 0) !== 0 && aggregationLabel(f.newDefaultAggregation ?? 0) !== 'none') numericDimension = true;
      }
      // Table columns arrive as dimensions even when they hold amounts or counts.
      if (numericDimension) lines.push('    A number listed as a dimension can be used as a chart metric: name it as the metric and give its aggregation (for example sum).');
    }
  }
  return lines;
}
