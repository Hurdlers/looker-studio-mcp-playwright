import { tmpdir } from 'node:os';
import { RECORD_COUNT } from '../../../src/core/components.js';
import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { Extensions } from '../../../src/core/extensions.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { extensions as options } from '../../../src/features/chart-options/index.js';
import { extensions, tools } from '../../../src/features/controls/index.js';
import { tools as layoutTools } from '../../../src/features/layout/index.js';
import { extensions as statics } from '../../../src/features/static/index.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const REPORT = '12345678-1234-4234-8234-123456789012';
export const SOURCE = 'sample-source';
const column = (name: string, dataType: number, semanticType: number, agg = 0) => ({
  field: { ns: 't0', name: `_${name}_` }, outputName: name, dataType, defaultAggregationType: agg, columnType: 1,
  outputSemanticInfo: { semanticConfig: [{ semanticType }] },
});
const COLUMNS = [column('device', 0, 32), column('country', 0, 32), column('n', 3, 33, 6), column('flag', 1, 34), column('day', 8, 2)];

export function report(): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'Example' }, version: '10', chartCondition: [{ chartId: 'cd-report', rule: 'kept' }],
    navigationInfo: { navItems: [{ page: { pageId: 'p_aaa', displayName: 'Overview' } }, { page: { pageId: 'p_bbb', displayName: 'Detail' } }] },
    report: { componentConfig: [], conceptDefs: [], propertyConfig: {}, resource: { datasourceAlias: [{ alias: 'ds1', datasourceId: SOURCE }] }, attributeConfig: { reportAttribute: { width: 1200, height: 900 } } },
    page: ['p_aaa', 'p_bbb'].map((pageId) => ({ pageId, version: '20', chartCondition: [{ chartId: 'cd-existing', rule: 'kept' }], page: { componentConfig: [], groupConfig: [] } })),
  };
}

export function looker(doc = report(), opts: { failPage?: boolean; conflictPage?: boolean; dryRun?: boolean; parameters?: Json[]; recordCount?: boolean } = {}) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  let conflict = opts.conflictPage;
  const answer = (endpoint: string, body: Json): unknown => {
    calls.push({ endpoint, body: structuredClone(body) });
    switch (endpoint) {
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'getBlockDatasource': return { published: { resource: { parameterConfiguration: { parameters: opts.parameters ?? [] } }, datasourceId: body.datasourceId, datasourceBlock: { name: body.datasourceId === SOURCE ? 'Sample data' : 'Other data', fields: opts.recordCount === false ? COLUMNS : [...COLUMNS, { ...column('Record Count', 3, 33, 7), field: { ns: 't0', name: RECORD_COUNT } }] } } };
      case 'getSchema': return { schema: { dimensions: COLUMNS.filter((c) => c.dataType !== 3).map((c) => ({ name: c.field.name })), metrics: [{ name: '_n_' }] } };
      case 'getDatasourceList': return { datasourceInfo: body.shareableIds.map((id: string) => ({ shareableConfig: { id, name: id === SOURCE ? 'Sample data' : 'Other data' }, isEmbedded: true })) };
      case 'createNamedRevision': return { revisionNumber: '31' };
      case 'updatePage': {
        if (opts.failPage) throw new Error('sample page failure');
        const page = doc.page.find((p) => p.pageId === body.pageId)!;
        if (conflict) { conflict = false; page.version = String(Number(page.version) + 1); return { version: '-1' }; }
        if (page.version !== body.version) return { version: '-1' };
        const { chartCondition, fieldMask: _mask, ...saved } = structuredClone(body.pageRequest);
        page.page = saved;
        page.chartCondition = chartCondition;
        page.version = String(Number(page.version) + 1);
        return { version: page.version };
      }
      case 'updateReport': {
        if (doc.version !== body.version) return { version: '-1' };
        const { chartCondition, ...saved } = structuredClone(body.reportRequest);
        doc.report = saved;
        doc.chartCondition = chartCondition;
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      }
      default: throw new Error(`Unexpected endpoint ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => answer(endpoint, body as Json) as T,
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map((r) => ({ ok: true, value: answer(r.endpoint, r.body as Json) as T })),
  };
  const ext = new Extensions([{ group: 'controls', extensions }, { group: 'chart-options', extensions: options }, { group: 'static', extensions: statics }]);
  const ctx = createContext({ rap, ext, tools: [...tools, ...layoutTools], config: parseConfig({ writes_enabled: true, dry_run: opts.dryRun === true }, tmpdir()) });
  const run = async (name: string, args: Json = {}) => resultText(await runTool(ctx, name, { report_id: REPORT, ...args }));
  const add = (args: Json = {}) => run('control_add', args);
  const saves = (endpoint?: string) => calls.filter((c) => endpoint ? c.endpoint === endpoint : ['updatePage', 'updateReport', 'createNamedRevision'].includes(c.endpoint));
  const components = (page = 0): Json[] => doc.page[page]!.page.componentConfig as Json[];
  return { doc, rap, ctx, ext, calls, run, add, saves, components };
}

export function prop(c: Json): Json { return c.propertyConfig.componentProperty; }
export function attr(c: Json): Json { return c.attributeConfig.componentAttribute; }
export function slot(c: Json, kind = 'dimensions'): Json[] {
  const names = prop(c)[kind].labeledConcepts.find((s: Json) => s.key === 'primary').value.conceptNames;
  return names.map((name: string) => c.conceptDefs.find((d: Json) => d.name === name));
}
export function source(concept: Json): string { return concept.queryTimeTransformation.dataTransformation.sourceFieldName; }
