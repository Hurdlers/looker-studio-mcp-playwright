import { createContext } from '../../../src/core/context.js';
import { Extensions } from '../../../src/core/extensions.js';
import { toMapValue } from '../../../src/core/mapvalue.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { tools as chartTools } from '../../../src/features/chart-core/index.js';
import { extensions as options } from '../../../src/features/chart-options/index.js';
import { extensions as kindsA } from '../../../src/features/chart-types-a/index.js';
import { extensions as kindsB } from '../../../src/features/chart-types-b/index.js';
import { tools as layoutTools } from '../../../src/features/layout/index.js';
import { extensions as staticExtensions } from '../../../src/features/static/index.js';
import type { Rap, RapRequest, RapOutcome } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const REPORT = '11111111-2222-4333-8444-555555555555';
export const ext = new Extensions([
  { group: 'chart-types-a', extensions: kindsA }, { group: 'chart-types-b', extensions: kindsB },
  { group: 'chart-options', extensions: options }, { group: 'static', extensions: staticExtensions },
]);
const fields = [
  { id: '_platform_', name: 'platform', semantic: 32, aggregation: 0 },
  { id: '_day_', name: 'day', semantic: 2, aggregation: 0 },
  { id: '_other_day_', name: 'other_day', semantic: 36, aggregation: 0 },
  { id: '_uses_', name: 'uses', semantic: 33, aggregation: 6 },
  { id: '_errors_', name: 'errors', semantic: 33, aggregation: 6 },
];
export const properties = (c: Json) => c.propertyConfig.componentProperty as Json;
export const definition = (c: Json, source: string) => c.conceptDefs.find((entry: Json) => entry.queryTimeTransformation?.dataTransformation?.sourceFieldName === source) as Json;
export const ref = (c: Json, which: string, key: string) => properties(c)[which].labeledConcepts.find((slot: Json) => slot.key === key)?.value.conceptNames as string[];

export function harness() {
  const doc: ReportDoc = {
    shareable: { id: REPORT, name: 'Test report' }, version: '1', chartCondition: [],
    report: { componentConfig: [], resource: { datasourceAlias: [{ datasourceId: 'ds-1', alias: 'ds1' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'page-a', displayName: 'Overview' } }] },
    page: [{ pageId: 'page-a', version: '1', chartCondition: [], page: { componentConfig: [] } }],
  };
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const answer = (endpoint: string, body: Json): unknown => {
    calls.push({ endpoint, body: structuredClone(body) });
    switch (endpoint) {
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'getDatasourceList': return { datasourceInfo: [{ shareableConfig: { id: 'ds-1', name: 'Test source' }, isEmbedded: true }] };
      case 'getSchema': return { schema: { dimensions: [], metrics: [] } };
      case 'getBlockDatasource': return { published: { datasourceId: 'ds-1', datasourceBlock: { fields: fields.map((field) => ({
        columnType: 1, field: { ns: 't0', name: field.id }, outputName: field.name, dataType: field.semantic === 33 ? 5 : 0,
        defaultAggregationType: field.aggregation, outputSemanticInfo: { semanticConfig: [{ semanticType: field.semantic }] },
      })) } } };
      case 'updatePage': {
        doc.page[0]!.page = structuredClone(body.pageRequest);
        doc.page[0]!.chartCondition = structuredClone(body.pageRequest.chartCondition);
        doc.version = String(Number(doc.version) + 1);
        doc.page[0]!.version = doc.version;
        return { version: doc.version };
      }
      case 'updateReport': {
        doc.report = structuredClone(body.reportRequest);
        doc.chartCondition = structuredClone(body.reportRequest.chartCondition ?? []);
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      }
      default: throw new Error(`Unexpected endpoint: ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => answer(endpoint, body as Json) as T,
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map((request) => ({ ok: true, value: answer(request.endpoint, request.body as Json) as T })),
  };
  const ctx = createContext({ rap, ext, tools: [...chartTools, ...layoutTools] });
  const components = () => doc.page[0]!.page.componentConfig as Json[];
  const last = () => components().at(-1)!;
  const add = async (type = 'table', extra: Json = {}) => {
    const defaults = type.startsWith('scorecard') ? type === 'scorecard_dimension' ? { dimensions: ['platform'], metrics: [] } : { dimensions: [], metrics: [{ field: 'uses' }] } : { dimensions: [type === 'combo' || type === 'time_series' ? 'day' : 'platform'], metrics: [{ field: 'uses' }, ...(type === 'combo' ? [{ field: 'errors' }] : [])] };
    const result = await runTool(ctx, 'chart_add', { report_id: REPORT, type, ...defaults, ...extra });
    return { component: last(), text: resultText(result) };
  };
  const update = async (change: Json, componentId = last().componentId) => resultText(await runTool(ctx, 'component_update', { report_id: REPORT, component_id: componentId, ...change }));
  const writes = () => calls.filter((call) => ['updatePage', 'updateReport', 'createNamedRevision'].includes(call.endpoint));
  const clear = () => { calls.length = 0; };
  return { doc, ctx, calls, add, update, last, components, writes, clear };
}

export async function invalidAdd(type: string, input: Json) {
  const h = harness();
  await expectInvalid(() => h.add(type, input));
  if (h.writes().length) throw new Error('Invalid input was saved.');
}

export async function expectInvalid(run: () => Promise<unknown>) {
  try { await run(); throw new Error('Invalid input was accepted.'); }
  catch (error) { if ((error as { code?: string }).code !== 'invalid') throw error; }
}

export const sortableBehavior = () => toMapValue({ onSort: [{ action: 'sort', isControl: true, init: { sortOptions: { sortData: [], isNewSortConfig: true } } }], onSelect: [{ action: 'cross-filtering', isControl: true }] });
