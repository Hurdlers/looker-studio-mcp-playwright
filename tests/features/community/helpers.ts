import { readFileSync } from 'node:fs';

import { createContext } from '../../../src/core/context.js';
import { LookerError } from '../../../src/core/errors.js';
import { Extensions } from '../../../src/core/extensions.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { extensions as options } from '../../../src/features/chart-options/index.js';
import { extensions as community, tools } from '../../../src/features/community/index.js';
import type { VisualizationConfig } from '../../../src/features/community/registration.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const REPORT = '11111111-2222-4333-8444-555555555555';
export const GAUGE = 'google://devrel/gauge';
export const SUNBURST = 'gs://dscv/public/sunburst';
export const CUSTOM = 'gs://chart-example-bucket/display';
export const configFile = (name: string): VisualizationConfig => JSON.parse(readFileSync(new URL(`../../../fixtures/community/configs/${name}.json`, import.meta.url), 'utf8'));
export const properties = (component: Json): Json => component.propertyConfig.componentProperty;
export const definition = (component: Json, field: string): Json => component.conceptDefs.find((entry: Json) => entry.queryTimeTransformation.dataTransformation.sourceFieldName === field);
export const setup = (component: Json, kind: string, key: string): string[] => properties(component)[kind].labeledConcepts.find((entry: Json) => entry.key === key)?.value.conceptNames;
export const settings: VisualizationConfig = {
  data: [{ elements: [{ id: 'measure', type: 'METRIC', label: 'Metric', options: { min: 1, max: 1 } }] }],
  style: [{ elements: [
    { id: 'showTitle', type: 'CHECKBOX', label: 'Show title' }, { id: 'title', type: 'TEXTINPUT', label: 'Title' },
    { id: 'barColor', type: 'FILL_COLOR', label: 'Bar color' }, { id: 'showLabels', type: 'CHECKBOX', label: 'Show labels' },
    { id: 'dir', type: 'SELECT_SINGLE', label: 'Direction', options: [{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' }] },
    { id: 'otherColor', type: 'FONT_COLOR', label: 'Bar color' }, { id: 'alpha', type: 'OPACITY', label: 'Opacity' },
    { id: 'size', type: 'INTERVAL', label: 'Size' }, { id: 'font', type: 'FONT_FAMILY', label: 'Font' },
  ] }],
};
const columns = [
  { id: '_platform_', name: 'platform', semantic: 32, aggregation: 0 },
  { id: '_day_', name: 'day', semantic: 2, aggregation: 0 },
  { id: '_uses_', name: 'uses', semantic: 33, aggregation: 6 },
  { id: '_errors_', name: 'errors', semantic: 33, aggregation: 6 },
  { id: '_auto_', name: 'Auto result', semantic: 33, aggregation: 7 },
];

export function harness() {
  const doc: ReportDoc = {
    shareable: { id: REPORT, name: 'Example report' }, version: '1', chartCondition: [],
    report: { componentConfig: [], resource: { datasourceAlias: [{ datasourceId: 'ds-a', alias: 'ds1' }, { datasourceId: 'ds-b', alias: 'ds2' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'page-a', displayName: 'Overview' } }, { page: { pageId: 'page-b', displayName: 'Page 2' } }] },
    page: ['page-a', 'page-b'].map((pageId) => ({ pageId, version: '1', chartCondition: [], page: { componentConfig: [] } })),
  };
  const registration = (name: string, id: string, config: VisualizationConfig, state = 1): Json => ({
    manifest: { name, components: [{ id, name, privileges: [] }] }, config: JSON.stringify(config), approvalState: state, manifestFingerprint: 'example-fingerprint',
  });
  const registrations: Record<string, Json> = {
    [GAUGE]: registration('Gauge', 'gauge', configFile('gauge')),
    [SUNBURST]: registration('Sunburst', 'sunburst_v1', configFile('sunburst'), 0),
    [CUSTOM]: registration('Example chart', 'example', structuredClone(settings)),
  };
  const calls: Array<{ endpoint: string; body: Json }> = [];
  let failPage = false;
  const answer = (endpoint: string, body: Json): unknown => {
    calls.push({ endpoint, body: structuredClone(body) });
    switch (endpoint) {
      case 'getCommunityVizRegistrationInfo': {
        const info = registrations[body.manifestPath];
        if (!info) throw new Error('manifest-not-found');
        return structuredClone(info);
      }
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'getDatasourceList': return { datasourceInfo: ['a', 'b'].map((key) => ({ shareableConfig: { id: `ds-${key}`, name: key.toUpperCase() }, isEmbedded: true })) };
      case 'getSchema': return { schema: { dimensions: [], metrics: [] } };
      case 'getBlockDatasource': return { published: { datasourceId: body.datasourceId, datasourceBlock: { fields: columns.map((field) => ({
        columnType: 1, field: { ns: 't0', name: field.id }, outputName: field.name, dataType: field.semantic === 33 ? 5 : 0,
        defaultAggregationType: field.aggregation, outputSemanticInfo: { semanticConfig: [{ semanticType: field.semantic }] },
      })) } } };
      case 'grantConsent': return null;
      case 'updateReport':
        doc.report = structuredClone(body.reportRequest);
        doc.chartCondition = structuredClone(body.reportRequest.chartCondition ?? []);
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      case 'updatePage': {
        if (failPage) { failPage = false; throw new LookerError('invalid', 'Example page save failed.'); }
        const page = doc.page.find((entry) => entry.pageId === body.pageId)!;
        page.page = structuredClone(body.pageRequest);
        page.chartCondition = structuredClone(body.pageRequest.chartCondition);
        doc.version = String(Number(doc.version) + 1); page.version = doc.version;
        return { version: doc.version };
      }
      default: throw new Error(`Unexpected endpoint: ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => answer(endpoint, body as Json) as T,
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map((request) => {
      try { return { ok: true, value: answer(request.endpoint, request.body as Json) as T }; }
      catch (error) { return { ok: false, error } as RapOutcome<T>; }
    }),
  };
  const ext = new Extensions([{ group: 'community', extensions: community }, { group: 'chart-options', extensions: options }]);
  const ctx = createContext({ rap, ext, tools });
  const components = (pageId = 'page-a'): Json[] => doc.page.find((entry) => entry.pageId === pageId)!.page.componentConfig ?? [];
  const last = (pageId = 'page-a'): Json => components(pageId).at(-1)!;
  const add = async (extra: Json = {}): Promise<string> => resultText(await runTool(ctx, 'community_viz_add', { report_id: REPORT, name: 'Gauge', ...extra }));
  const writes = () => calls.filter((entry) => ['grantConsent', 'updatePage', 'updateReport'].includes(entry.endpoint));
  return { ctx, doc, calls, registrations, add, writes, last, components, clear: () => { calls.length = 0; }, failNextPage: () => { failPage = true; } };
}
