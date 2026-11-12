import { tmpdir } from 'node:os';

import { vi } from 'vitest';

import { parseConfig } from '../../../src/config.js';
import { BigQueryClient } from '../../../src/core/bigquery.js';
import { createContext } from '../../../src/core/context.js';
import type { ReportDoc } from '../../../src/core/session.js';
import type { ToolContext } from '../../../src/core/tool.js';
import type { WorkerTab } from '../../../src/browser/worker.js';
import { tools } from '../../../src/features/data-sources/index.js';
import { RapError, type Rap, type RapOutcome, type RapRequest } from '../../../src/looker/rap.js';

// A Looker Studio and a BigQuery for the data source tools: report R1 with
// ds1 → A (a table, used by three scorecards) and ds2 → B (a custom query,
// unused). Projects and tables are made up.

export type Json = Record<string, any>;

export const R1 = '0d1c2b3a-1111-4222-8333-944455556666';
export const A = 'aaaaaaaa-1111-4222-8333-000000000001';
export const B = 'bbbbbbbb-1111-4222-8333-000000000002';
export const PROJECT = 'demo-project';
export const DATASET = 'analytics_demo';
export const TABLE = 'web traffic';
export const SQL_B = `SELECT device_category, SUM(sessions) AS sessions FROM \`${PROJECT}.${DATASET}.${TABLE}\` GROUP BY 1`;

export const column = (name: string, outputName: string, semanticType: number, extra: Json = {}): Json => ({
  columnType: 1,
  mutableVersion: 1,
  outputName,
  dataType: semanticType === 33 ? 5 : 0,
  defaultAggregationType: semanticType === 33 ? 6 : 0,
  outputSemanticInfo: { semanticConfig: [{ semanticType }] },
  field: { ns: 't0', name, simpleName: name },
  ...extra,
});

const tableConfig = { datasourceType: 2, bigQueryConnectorConfig: { projectId: PROJECT, datasetId: DATASET, tableId: TABLE, sqlType: 2 } };

function sourceDoc(id: string, name: string, connectorConfig: Json, fields: Json[]): Json {
  return {
    datasourceId: id,
    delegatedAccessEnabled: true,
    queryCachePolicy: { shelfLife: { amount: 12, chronoUnit: 2 }, isDefaultPolicy: true },
    blocks: [{ type: 2, id: 'block_c', fields: fields.filter((f) => f.mutableVersion), connectorBlockConfig: { alias: 't0', connectorConfig, useDatetimeType: true }, name: 'BigQuery' }],
    datasourceBlock: { type: 1, id: 'block_o', name, health: 1, fields },
  };
}

export interface Source {
  name: string;
  embedded: boolean;
  delegated: boolean;
  published: Json;
  draft?: Json;
}

export function looker(opts: { columns?: (body: Json) => Json[]; convert403?: boolean; stayEmbedded?: boolean; consentRefused?: boolean } = {}) {
  const scorecard = (id: string) => ({ componentId: id, type: 'kpi-metric', datasourceId: A });
  const report: ReportDoc = {
    shareable: { id: R1, name: 'Lab' },
    version: '5',
    chartCondition: [],
    page: [{ pageId: 'p1', version: '9', page: { componentConfig: [scorecard('cd-a'), scorecard('cd-b'), scorecard('cd-c')] } }],
    report: { componentConfig: [], resource: { datasourceAlias: [{ datasourceId: A, alias: 'ds1' }, { datasourceId: B, alias: 'ds2' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }] },
  };
  const tableFields = [column('_device_category_', 'device_category', 32), column('_sessions_', 'sessions', 33), column('_session_medium_', 'session_medium', 32)];
  const sqlFields = [column('_device_category_', 'device_category', 32), column('_sessions_', 'sessions', 33)];
  const sources: Record<string, Source> = {
    [A]: { name: TABLE, embedded: true, delegated: true, published: sourceDoc(A, TABLE, structuredClone(tableConfig), tableFields) },
    [B]: {
      name: 'Custom query',
      embedded: true,
      delegated: true,
      published: sourceDoc(
        B,
        'Custom query',
        { datasourceType: 2, bigQueryConnectorConfig: { projectId: PROJECT, billingProjectId: PROJECT, sqlType: 2 }, sql: SQL_B },
        sqlFields,
      ),
    },
  };
  const consent: Array<{ consentType: number; approval?: number }> = [{ consentType: 1, approval: 0 }];
  const calls: Array<{ endpoint: string; body: Json }> = [];
  let made = 0;
  const schema = (id: string): Json => {
    const s = sources[id]!;
    const doc = s.draft ?? s.published;
    const fields = (doc.datasourceBlock.fields as Json[]).map((f) => ({
      name: f.field.name,
      displayName: f.outputName,
      dataType: f.dataType,
      newDefaultAggregation: f.defaultAggregationType,
      semanticInfo: { semanticConfig: f.outputSemanticInfo?.semanticConfig ?? [] },
    }));
    return {
      schema: {
        connectorType: 2,
        isDelegatedAccessEnabled: s.delegated,
        cacheShelfLife: doc.queryCachePolicy?.shelfLife,
        dimensions: fields,
        metrics: [{ name: 'datastudio_record_count_system_field_id_1', displayName: 'Record Count', dataType: 5, newDefaultAggregation: 7, semanticInfo: { semanticConfig: [{ semanticType: 33 }] } }],
      },
    };
  };
  const answer = (endpoint: string, b: Json): unknown => {
    switch (endpoint) {
      case 'getReport':
        return { reportConfig: structuredClone(report) };
      case 'updateReport':
        if (b.version !== report.version) return { version: '-1' };
        report.report.resource = b.reportRequest.resource;
        report.version = String(Number(report.version) + 1);
        return { version: report.version };
      case 'createNamedRevision':
        return { revisionNumber: '3' };
      case 'getBlockDatasource': {
        const s = sources[b.datasourceId];
        if (!s) throw new RapError(endpoint, 404, 'getBlockDatasource returned HTTP 404');
        return structuredClone({ published: s.published, ...(s.draft ? { draft: s.draft } : {}), embeddedInReportId: s.embedded ? R1 : '' });
      }
      case 'getSchema':
        return schema(b.datasourceId);
      case 'getDatasourceList':
        return {
          datasourceInfo: (b.shareableIds as string[]).flatMap((id) => (sources[id] ? [{ shareableConfig: { id, name: sources[id].name }, isEmbedded: sources[id].embedded }] : [])),
        };
      case 'getFirstPartyAccessToken':
        return { accessToken: 'ya29.secret-token' };
      case 'getColumns':
        return { columns: opts.columns ? opts.columns(b) : [] };
      case 'createBlockDatasource': {
        const id = `new-${++made}`;
        const datasource = { ...b.datasource, datasourceId: id };
        sources[id] = { name: b.name, embedded: true, delegated: true, published: datasource };
        return { datasource };
      }
      case 'publishDatasource':
        sources[b.draft.datasourceId]!.published = b.draft;
        delete sources[b.draft.datasourceId]!.draft;
        return {};
      case 'claimDatasourceForReport':
      case 'deleteClaim':
        return {};
      case 'renameDatasource':
        sources[b.datasourceId]!.name = b.title;
        return null;
      case 'updateDataAccessControl':
        sources[b.datasourceId]!.delegated = b.delegatedAccessEnabled;
        return { version: '77' };
      case 'convertEmbeddedDatasource':
        if (!opts.stayEmbedded) sources[b.datasourceId]!.embedded = false;
        if (opts.convert403 ?? true) throw new RapError(endpoint, 403, 'convertEmbeddedDatasource returned HTTP 403: PERMISSION_DENIED');
        return {};
      case 'checkConsent':
        return { parameter: { consent: structuredClone(consent) } };
      case 'grantConsent':
        if (opts.consentRefused) throw new Error('grantConsent: refused by a safety rule');
        consent[0]!.approval = 1;
        return {};
      default:
        throw new Error(`unexpected ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: structuredClone(body) as Json });
      return answer(endpoint, body as Json) as T;
    },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> =>
      requests.map((r) => {
        calls.push({ endpoint: r.endpoint, body: structuredClone(r.body) as Json });
        try {
          return { ok: true, value: answer(r.endpoint, r.body as Json) as T };
        } catch (e) {
          return { ok: false, status: (e as RapError).status ?? 0, error: (e as Error).message };
        }
      }),
  };
  return { rap, report, sources, calls, consent };
}

// BigQuery's REST API: dry runs answer SELECT unless `reply` says otherwise.
export function bigquery(reply: (body: Json) => [number, Json] = () => [200, { statementType: 'SELECT', totalBytesProcessed: '0' }]) {
  const sent: Array<{ url: string; body: Json }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    sent.push({ url, body });
    const [status, answer] = reply(body);
    return new Response(JSON.stringify(answer), { status });
  }) as typeof globalThis.fetch;
  // The parameterised dry run goes out through the global fetch.
  vi.stubGlobal('fetch', fetch);
  return { fetch, sent };
}

export function context(rap: Rap, opts: { dryRun?: boolean; billingProject?: string | null; fetch?: typeof globalThis.fetch } = {}): ToolContext {
  const config = parseConfig(
    { writes_enabled: true, dry_run: opts.dryRun === true, ...(opts.billingProject === null ? {} : { billing_project: opts.billingProject ?? PROJECT }) },
    tmpdir(),
  );
  const tokens = { token: async () => 'adc-token' };
  return createContext({
    rap,
    tools,
    config,
    worker: { run: async () => '123456' } as unknown as WorkerTab,
    google: { ...tokens, projectId: async () => undefined, email: async () => undefined },
    bigquery: new BigQueryClient(tokens, config.bigquery, { fetch: opts.fetch ?? bigquery().fetch, sleep: async () => undefined }),
  });
}

export const sent = (calls: Array<{ endpoint: string }>): string[] => calls.map((c) => c.endpoint);
