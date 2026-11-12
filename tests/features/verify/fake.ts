import { tmpdir } from 'node:os';

import { createContext } from '../../../src/core/context.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { tools } from '../../../src/features/verify/index.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const REPORT = '1a2b3c4d-0000-4000-8000-000000000001';

export function chart(id: string, type = 'kpi-metric', field = '_amount_', label = 'amount', kind: 'dimensions' | 'metrics' = 'metrics'): Json {
  return {
    componentId: id, type, datasourceId: 'ds-demo',
    conceptDefs: [{ name: `qt_${id}`, namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: field }, displayTransformation: { displayName: label } } }],
    propertyConfig: { componentProperty: { [kind]: { labeledConcepts: [{ key: 'primary', value: { conceptNames: [`qt_${id}`] } }] } } },
  };
}

export function report(): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'Demo report' }, version: '5',
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }, { section: { sectionId: 's1', displayName: 'Details', navItems: [{ page: { pageId: 'p2', displayName: 'Inner' } }] } }] },
    report: { componentConfig: [], propertyConfig: {}, attributeConfig: { reportAttribute: { width: 1200, height: 1100 } }, resource: { datasourceAlias: [{ alias: 'ds1', datasourceId: 'ds-demo' }] } },
    page: [
      { pageId: 'p2', version: '102', page: { componentConfig: [chart('cd-table', 'simple-table')] } },
      { pageId: 'p1', version: '101', page: { componentConfig: [chart('cd-ok'), chart('cd-bad', 'kpi-metric', '_gone_', 'broken'), { componentId: 'cd-text', type: 'simple-description' }] } },
    ],
  };
}

export function success(totalCount = 1): Json {
  return { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount, rows: [{ values: ['0'] }] } } }] }] };
}

export function source(): Json {
  return { published: { datasourceBlock: { name: 'Demo data', fields: ['amount', 'region'].map((name) => ({ columnType: 1, field: { ns: 't0', name: `_${name}_` }, outputName: name, dataType: name === 'amount' ? 5 : 0, defaultAggregationType: name === 'amount' ? 6 : 0 })) }, delegatedAccessEnabled: true, blocks: [{ connectorBlockConfig: { connectorConfig: { datasourceType: 2, sql: 'SELECT 1 AS amount' } } }] } };
}

export function looker(doc = report(), home = tmpdir()) {
  const calls: Array<{ endpoint: string; body: Json; options?: Json }> = [];
  const replies = new Map<string, Json>();
  const delays = new Map<string, number>();
  const dataSource = source();
  const answer = async (endpoint: string, body: Json): Promise<unknown> => {
    switch (endpoint) {
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'getShareableList': return { shareableConfig: [] };
      case 'getBlockDatasource': return structuredClone(dataSource);
      case 'getPdf': return Buffer.from('%PDF fake').toString('base64');
      case 'batchedDataV2': {
        const id = body.dataRequest[0].requestContext.reportContext.componentId as string;
        if (delays.has(id)) await new Promise((resolve) => setTimeout(resolve, delays.get(id)));
        return structuredClone(replies.get(id) ?? success());
      }
      default: throw new Error(`Unexpected endpoint ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: structuredClone(body) as Json });
      return await answer(endpoint, body as Json) as T;
    },
    callMany: async <T>(requests: RapRequest[], options?: { timeoutMs?: number }): Promise<RapOutcome<T>[]> => {
      requests.forEach((request) => calls.push({ endpoint: request.endpoint, body: structuredClone(request.body) as Json, ...(options ? { options } : {}) }));
      return Promise.all(requests.map(async (request) => ({ ok: true as const, value: await answer(request.endpoint, request.body as Json) as T })));
    },
  };
  const ctx = createContext({ rap, tools, home });
  const run = (name: string, args: Json = {}) => runTool(ctx, name, { report_id: REPORT, ...args });
  const check = async (args: Json = {}) => resultText(await run('report_check', args));
  return { doc, rap, calls, replies, dataSource, delays, ctx, run, check };
}
