import { readFileSync } from 'node:fs';

import { createContext } from '../../../src/core/context.js';
import { Extensions } from '../../../src/core/extensions.js';
import { ReportSession } from '../../../src/core/session.js';
import { resultText, runTool, type Tool } from '../../../src/core/tool.js';
import { FEATURE_EXTENSIONS, FEATURE_TOOLS } from '../../../src/features/registry.generated.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';
import { fake as reports, CREATED, ORIGINAL, SOURCE, TABLE, type Json } from '../reports/fake.js';

export { CREATED, ORIGINAL, SOURCE, TABLE };
export type { Json };
export const column = (id: string, name: string, semantic = 32): Json => ({ field: { ns: 't0', name: id, simpleName: id }, outputName: name, columnType: 1, mutableVersion: 1, enabled: true, dataType: semantic === 33 ? 5 : 0, defaultAggregationType: semantic === 33 ? 6 : 0, outputSemanticInfo: { semanticConfig: [{ semanticType: semantic }] } });
export const columns = [column('_category_', 'category'), column('_value_', 'value', 33), column('_day_', 'day', 2)];
export const specification = () => ({ version: 1, name: 'Example report', data_sources: [{ ...TABLE, name: 'Metrics' }], pages: [{ name: 'Overview', components: [] }] });
export const parseSpecText = (body: string): Json => JSON.parse(/```json\n([\s\S]*?)\n```/.exec(body)![1]!);
export const properties = (component: Json): Json => component.propertyConfig.componentProperty;

export function fake(options: { dryRun?: boolean; snapshots?: boolean; sqlError?: boolean; overrides?: Tool[]; nativeColumns?: boolean; formulaResponse?: (body: Json) => Json | string | undefined; columns?: Json[] } = {}) {
  const base = reports({ dryRun: options.dryRun ?? false, sqlError: options.sqlError ?? false });
  base.original.page[0]!.page.componentConfig = [];
  base.original.chartCondition = [];
  base.sources[SOURCE]!.name = 'Metrics';
  base.sources[SOURCE]!.block.datasourceBlock.name = 'Metrics';
  base.sources[SOURCE]!.block.datasourceBlock.fields = structuredClone(columns);
  const images = new Map<string, string>();
  let imageCount = 0;
  const extra = new Set(['getSchema', 'getColumns', 'updatePage', 'createPages', 'updateReportNavigationInfo', 'createNamedRevision', 'getImageV2', 'uploadImage', 'getImageDataByUrl', 'batchedDataV2', 'validateFormula', 'getCommunityVizRegistrationInfo']);
  const rap: Rap = {
    call: async <T>(endpoint: string, input: unknown, timeout?: number, mode?: RapRequest['mode']): Promise<T> => {
      if (!extra.has(endpoint)) {
        const result = await base.ctx.rap.call<T>(endpoint, input, timeout, mode);
        if (options.nativeColumns && endpoint === 'publishDatasource') {
          const draft = (input as Json).draft;
          const source = base.sources[draft.datasourceId]!.block;
          const originals = new Set(source.blocks.filter((block: Json) => block.connectorBlockConfig).flatMap((block: Json) => block.fields).map((field: Json) => field.field.name));
          for (const field of source.datasourceBlock.fields) if (originals.has(field.field.name)) {
            const raw = field.field.name.replace(/^_|_$/g, '');
            field.createdBy = 1; field.immutableVersion = { ns: 't0', name: raw, simpleName: raw }; field.textFormula = `t0.${raw}`;
          }
        }
        return result;
      }
      const body = input as Json;
      base.calls.push({ endpoint, body: structuredClone(body), ...(mode ? { mode } : {}) });
      const doc = base.reports[body.reportId];
      const answer = (): unknown => {
        switch (endpoint) {
          case 'getColumns': return { columns: structuredClone(options.columns ?? columns) };
          case 'getSchema': {
            const source = base.sources[body.datasourceId]?.block;
            const fields = source?.datasourceBlock.fields ?? [];
            return { schema: { dimensions: fields.filter((field: Json) => !field.defaultAggregationType).map((field: Json) => ({ name: field.field.name, semanticInfo: field.outputSemanticInfo })), metrics: fields.filter((field: Json) => field.defaultAggregationType).map((field: Json) => ({ name: field.field.name, semanticInfo: field.outputSemanticInfo })) } };
          }
          case 'updatePage': {
            const page = doc!.page.find((entry) => entry.pageId === body.pageId)!;
            page.page = structuredClone(body.pageRequest); page.chartCondition = structuredClone(body.pageRequest.chartCondition);
            doc!.version = String(Number(doc!.version) + 1); page.version = doc!.version;
            return { version: doc!.version };
          }
          case 'createPages':
            for (const page of body.pages) {
              doc!.page.push({ pageId: page.pageId, page: structuredClone(page.page), version: '1', chartCondition: page.chartCondition });
              doc!.navigationInfo!.navItems!.push({ page: { pageId: page.pageId, displayName: page.displayName } });
            }
            doc!.version = String(Number(doc!.version) + 1); return { navigationInfo: doc!.navigationInfo };
          case 'updateReportNavigationInfo': doc!.navigationInfo = structuredClone(body.navigationInfo); doc!.version = String(Number(doc!.version) + 1); return { version: doc!.version };
          case 'createNamedRevision': return { revisionNumber: 'revision-1' };
          case 'getImageV2': return { payload: images.get(body.id) ?? 'AAEC' };
          case 'uploadImage': { const id = `image-${++imageCount}`; images.set(id, body.payload); return { id }; }
          case 'getImageDataByUrl': return { filename: 'image.png', contentType: 'image/png', dataByteArray: 'AAEC' };
          case 'batchedDataV2': return { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount: 2, column: [{ longColumn: { values: ['1', '2'] } }] } } }] }] };
          case 'validateFormula': return options.formulaResponse?.(body) ?? { column: column('validated', 'validated', 33) };
          case 'getCommunityVizRegistrationInfo': return { manifest: { name: 'Gauge', components: [{ name: 'Gauge', id: 'gauge' }] }, config: readFileSync(new URL('../../../fixtures/community/configs/gauge.json', import.meta.url), 'utf8'), approvalState: 1, manifestFingerprint: 'example-fingerprint' };
          default: throw new Error(`Unexpected ${endpoint}`);
        }
      };
      return answer() as T;
    },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => Promise.all(requests.map(async (request) => {
      try { return { ok: true, value: await rap.call<T>(request.endpoint, request.body, undefined, request.mode) }; }
      catch (error) { return { ok: false, status: 404, error: error instanceof Error ? error.message : String(error) }; }
    })),
  };
  const audit: Json[] = [];
  const overrides = options.overrides ?? [];
  const tools = [...FEATURE_TOOLS.filter((tool) => !overrides.some((override) => override.name === tool.name)), ...overrides];
  const ctx = createContext({ rap, tools, ext: new Extensions(FEATURE_EXTENSIONS), config: base.ctx.config, google: base.ctx.google, bigquery: base.ctx.bigquery, worker: base.ctx.worker,
    session: new ReportSession(rap, { snapshots: options.snapshots ?? false }), audit: { write: async (entry) => { audit.push(entry); } } });
  const run = async (tool: string, args: Json) => runTool(ctx, tool, args);
  const add = async (tool: string, args: Json = {}) => run(tool, { report_id: ORIGINAL, ...args });
  const exportSpec = async (extra: Json = {}) => {
    const result = await add('report_spec_export', extra); const body = resultText(result);
    return { spec: parseSpecText(body), text: body };
  };
  const writes = () => base.calls.filter((call) => /^(?:create|update|delete|publish|restore|claim|copy|upload|rename|persist|grant)/.test(call.endpoint));
  return { ...base, ctx, run, add, exportSpec, writes, images, audit, clear: () => { base.calls.length = 0; audit.length = 0; } };
}
