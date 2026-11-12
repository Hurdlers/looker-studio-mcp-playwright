import { createContext } from '../../../src/core/context.js';
import { Extensions, type FeatureExtensions } from '../../../src/core/extensions.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { runTool, type ToolContext, type ToolResult } from '../../../src/core/tool.js';
import { extensions, tools } from '../../../src/features/layout/index.js';
import type { Rap } from '../../../src/looker/rap.js';

type Json = Record<string, any>;

export const REPORT = '1a2b3c4d-0000-4000-8000-000000000001';

export function comp(id: string, box: { left?: number; top?: number; width?: number; height?: number } = {}, extra: Json = {}): Json {
  return {
    componentId: id,
    type: 'generic-shape',
    attributeConfig: { componentAttribute: { left: 0, top: 0, width: 100, height: 50, ...box } },
    propertyConfig: { componentProperty: {} },
    ...extra,
  };
}

export function report(pages: Array<{ id: string; components: Json[]; groups?: Json[]; chartCondition?: Json[] }>, reportComponents: Json[] = []): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'Lab' },
    version: '10',
    page: pages.map((p, i) => ({
      pageId: p.id,
      version: String(100 + i),
      chartCondition: p.chartCondition ?? [],
      page: {
        componentConfig: p.components,
        groupConfig: p.groups ?? [],
        conceptDefs: [],
        propertyConfig: { pageProperty: { filters: [], inheritFilters: true } },
        attributeConfig: { pageAttribute: { name: p.id } },
      },
    })),
    report: {
      componentConfig: reportComponents,
      conceptDefs: [],
      propertyConfig: {},
      attributeConfig: { reportAttribute: { width: 1200, height: 900 } },
      resource: { datasourceAlias: [] },
    },
    chartCondition: [],
    navigationInfo: { navItems: pages.map((p) => ({ page: { pageId: p.id, displayName: p.id } })) },
  };
}

export interface Call {
  endpoint: string;
  body: Json;
}

// A Looker Studio keeping one report: saves change it, reads return copies.
export function looker(doc: ReportDoc, opts: { failPageSaves?: boolean } = {}) {
  const calls: Call[] = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      const b = structuredClone(body) as Json;
      calls.push({ endpoint, body: b });
      switch (endpoint) {
        case 'getReport':
          return { reportConfig: b.includePages === false ? { ...structuredClone(doc), page: [] } : structuredClone(doc) } as T;
        case 'updatePage': {
          if (opts.failPageSaves) throw new Error('updatePage returned HTTP 500');
          const page = doc.page.find((p) => p.pageId === b.pageId)!;
          if (b.version !== page.version) return { version: '-1' } as T;
          const req = b.pageRequest as Json;
          page.page.componentConfig = req.componentConfig;
          page.page.groupConfig = req.groupConfig;
          page.chartCondition = req.chartCondition;
          page.version = String(Number(page.version) + 1);
          return { version: page.version } as T;
        }
        case 'updateReport': {
          if (b.version !== doc.version) return { version: '-1' } as T;
          const req = b.reportRequest as Json;
          doc.report = { ...doc.report, componentConfig: req.componentConfig, resource: req.resource };
          doc.chartCondition = req.chartCondition;
          doc.version = String(Number(doc.version) + 1);
          return { version: doc.version } as T;
        }
        default:
          throw new Error(`unexpected ${endpoint}`);
      }
    },
    callMany: async () => {
      throw new Error('callMany is not used by layout tools');
    },
  };
  const saves = () => calls.filter((c) => c.endpoint === 'updatePage' || c.endpoint === 'updateReport');
  return { rap, calls, saves, doc };
}

export function context(rap: Rap, more: Array<{ group: string; extensions: FeatureExtensions }> = []): ToolContext {
  return createContext({ rap, ext: new Extensions([{ group: 'layout', extensions }, ...more]), tools });
}

export function run(ctx: ToolContext, name: string, args: Json): Promise<ToolResult> {
  return runTool(ctx, name, { report_id: REPORT, ...args });
}

export function ids(list: Json[] | undefined): string[] {
  return (list ?? []).map((c) => c.componentId);
}

export function box(c: Json | undefined): Json {
  return c?.attributeConfig?.componentAttribute;
}
