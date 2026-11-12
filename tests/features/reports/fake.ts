import { tmpdir } from 'node:os';

import { vi } from 'vitest';

import type { WorkerTab } from '../../../src/browser/worker.js';
import { parseConfig } from '../../../src/config.js';
import { BigQueryClient } from '../../../src/core/bigquery.js';
import { createContext } from '../../../src/core/context.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { runTool, type ToolContext } from '../../../src/core/tool.js';
import { tools } from '../../../src/features/reports/index.js';
import { RapError, type Rap, type RapOutcome, type RapRequest } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const ORIGINAL = '11111111-1111-4111-8111-111111111111';
export const CREATED = '22222222-2222-4222-8222-222222222222';
export const COPIED = '33333333-3333-4333-8333-333333333333';
export const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const COPY_SOURCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const REUSABLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const TABLE = { project_id: 'example-project', dataset_id: 'example_data', table_id: 'traffic data' };
export const SQL = 'SELECT * FROM `example-project.example_data.traffic data`';

function report(id: string, name: string): ReportDoc {
  return { shareable: { id, name }, version: '1', page: [{ pageId: 'p1', version: '1', page: { componentConfig: [] } }], report: { componentConfig: [], resource: { datasourceAlias: [] } }, navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }] } };
}

export function fake(options: { noProject?: boolean; dryRun?: boolean; sqlError?: boolean; consentFails?: boolean } = {}) {
  const original = report(ORIGINAL, 'Lab A');
  original.report.resource!.datasourceAlias = [{ datasourceId: SOURCE, alias: 'ds1' }];
  original.page[0]!.page.componentConfig = [{ componentId: 'cd-one', type: 'kpi-metric', datasourceId: SOURCE }];
  const reports: Record<string, ReportDoc> = { [ORIGINAL]: original };
  const column = { field: { name: '_value_', ns: 't0' }, outputName: 'value', dataType: 5, defaultAggregationType: 6, columnType: 1, mutableVersion: 1 };
  const block = (id: string, name: string): Json => ({ datasourceId: id, blocks: [{ fields: [column], connectorBlockConfig: { alias: 't0', connectorConfig: { datasourceType: 2, bigQueryConnectorConfig: { projectId: TABLE.project_id, datasetId: TABLE.dataset_id, tableId: TABLE.table_id } } } }], datasourceBlock: { name, fields: [column] } });
  const sources: Record<string, { reportId: string; name: string; block: Json }> = {
    [SOURCE]: { reportId: ORIGINAL, name: TABLE.table_id, block: block(SOURCE, TABLE.table_id) },
    [REUSABLE]: { reportId: '', name: 'Reusable traffic', block: block(REUSABLE, 'Reusable traffic') },
  };
  const calls: Array<{ endpoint: string; body: Json; mode?: string }> = [];
  const bqCalls: Json[] = [];
  const answer = (endpoint: string, b: Json): unknown => {
    switch (endpoint) {
      case 'getReport': return { reportConfig: reports[b.reportId] ? structuredClone(reports[b.reportId]) : undefined };
      case 'getShareableList': return { shareableConfig: Object.values(reports).map((r) => r.shareable) };
      case 'createTempReport': return { reportConfig: report('temp', b.reportTitle) };
      case 'persistTempReport': reports[CREATED] = report(CREATED, b.reportName); return { reportConfig: structuredClone(reports[CREATED]) };
      case 'updateReport': {
        const r = reports[b.reportId]!;
        if (b.reportName !== undefined) r.shareable.name = b.reportName;
        if (b.reportRequest !== undefined) r.report = structuredClone(b.reportRequest);
        r.version = String(Number(r.version) + 1);
        return { version: r.version };
      }
      case 'getFirstPartyAccessToken': return { accessToken: 'fake-token' };
      case 'getColumns': return { columns: [structuredClone(column)] };
      case 'createBlockDatasource': {
        const id = `new-source-${Object.keys(sources).length}`;
        const ds = { ...structuredClone(b.datasource), datasourceId: id };
        sources[id] = { reportId: b.reportId ?? '', name: b.name, block: ds };
        return { datasource: ds };
      }
      case 'publishDatasource': sources[b.draft.datasourceId]!.block = structuredClone(b.draft); return {};
      case 'claimDatasourceForReport': return {};
      case 'getBlockDatasource': {
        const source = sources[b.datasourceId];
        if (!source) throw new RapError(endpoint, 404, 'No source');
        return { published: structuredClone(source.block), embeddedInReportId: source.reportId };
      }
      case 'getDatasourceList': return { datasourceInfo: Object.entries(sources).filter(([id]) => !b.shareableIds || b.shareableIds.includes(id)).map(([id, source]) => ({ shareableConfig: { id, name: source.name }, isEmbedded: !!source.reportId })) };
      case 'renameDatasource': {
        const source = sources[b.datasourceId]!;
        source.name = b.title;
        source.block.datasourceBlock.name = b.title;
        return null;
      }
      case 'copyReport': {
        const map = JSON.parse(b.datasourceMap) as Record<string, string>;
        const copy = structuredClone(reports[b.reportId]!);
        copy.shareable = { id: COPIED, name: `Copy of ${copy.shareable.name}` };
        const replacements: Record<string, string> = {};
        for (const alias of copy.report.resource!.datasourceAlias ?? []) {
          const id = alias.datasourceId;
          const mapped = map[id] ?? id;
          if (mapped !== id || !sources[id]?.reportId) replacements[id] = mapped;
          else {
            replacements[id] = id === SOURCE ? COPY_SOURCE : `copied-${id}`;
            const ds = structuredClone(sources[id]!);
            ds.reportId = COPIED;
            ds.block.datasourceId = replacements[id];
            sources[replacements[id]!] = ds;
          }
          alias.datasourceId = replacements[id]!;
        }
        for (const page of copy.page)
          for (const component of page.page.componentConfig ?? [])
            if (typeof component.datasourceId === 'string') component.datasourceId = replacements[component.datasourceId] ?? component.datasourceId;
        reports[COPIED] = copy;
        return { url: `https://lookerstudio.google.com/reporting/${COPIED}/page/p1` };
      }
      case 'checkConsent': return { parameter: { consent: [{ consentType: 1, approval: 0 }] } };
      case 'grantConsent': if (options.consentFails) throw new Error('refused'); return {};
      case 'updateRemovedState': reports[b.id]!.shareable.trashed = true; return {};
      default: throw new Error(`Unexpected ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown, _timeout?: number, mode?: string): Promise<T> => {
      calls.push({ endpoint, body: structuredClone(body) as Json, ...(mode ? { mode } : {}) });
      return answer(endpoint, body as Json) as T;
    },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => Promise.all(requests.map(async (r) => ({ ok: true, value: await rap.call<T>(r.endpoint, r.body) }))),
  };
  const bqFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    bqCalls.push(body);
    return new Response(JSON.stringify(options.sqlError ? { error: { message: 'Unrecognized name: missing_column' } } : { statementType: 'SELECT', totalBytesProcessed: '0' }), { status: options.sqlError ? 400 : 200 });
  });
  vi.stubGlobal('fetch', bqFetch);
  const config = parseConfig({ writes_enabled: true, dry_run: options.dryRun === true, ...(!options.noProject ? { billing_project: TABLE.project_id } : {}) }, tmpdir());
  const google = { token: async () => 'fake-adc', projectId: async () => undefined, email: async () => undefined };
  const ctx: ToolContext = createContext({ rap, tools, config, google, worker: { run: async () => '123456' } as unknown as WorkerTab, bigquery: new BigQueryClient(google, config.bigquery, { fetch: bqFetch as typeof fetch }) });
  const run = (name: string, args: Json) => runTool(ctx, name, args);
  const sent = (endpoint: string) => calls.filter((call) => call.endpoint === endpoint);
  return { ctx, run, sent, calls, bqCalls, reports, sources, original };
}
