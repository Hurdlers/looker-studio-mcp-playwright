import { createContext } from '../../../src/core/context.js';
import type { NavItem, ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { tools } from '../../../src/features/pages/index.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';

export type Json = Record<string, any>;
export const REPORT = '0d1c2b3a-1111-4222-8333-944455556666';
export const SOURCE = 'demo-source';

const columns = [
  { field: { name: '_amount_', ns: 't0' }, outputName: 'amount', dataType: 5, defaultAggregationType: 6, columnType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] } },
  { field: { name: '_day_', ns: 't0' }, outputName: 'day', dataType: 8, defaultAggregationType: 0, columnType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 2 }] } },
  { field: { name: '_region_', ns: 't0' }, outputName: 'region', dataType: 0, defaultAggregationType: 0, columnType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] } },
];

export function report(names: string[] = ['A', 'B', 'C']): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'Sample report' },
    version: '10',
    chartCondition: [],
    navigationInfo: { style: 2, navItems: names.map((name, i) => ({ page: { pageId: `p${i + 1}`, displayName: name } })) },
    report: {
      componentConfig: [], conceptDefs: [],
      propertyConfig: { reportProperty: { themeConfig: 'theme-demo', coordinatedColoring: true } },
      attributeConfig: { reportAttribute: { width: 1200, height: 900 } },
      resource: { datasourceAlias: [{ datasourceId: SOURCE, alias: 'ds1' }] },
    },
    page: names.map((name, i) => ({
      pageId: `p${i + 1}`, version: String(100 + i), chartCondition: [],
      page: { componentConfig: [], groupConfig: [], conceptDefs: [], propertyConfig: { pageProperty: { filters: [], inheritFilters: true } }, attributeConfig: { pageAttribute: { name } } },
    })),
  };
}

export function looker(doc = report(), options: { failPage?: boolean; conflictNav?: boolean } = {}) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  let conflictNav = options.conflictNav;
  const dropPages = (items: NavItem[], ids: string[]): NavItem[] => items.filter((i) => !i.page || !ids.includes(i.page.pageId)).map((i) => i.section ? { ...i, section: { ...i.section, navItems: dropPages(i.section.navItems ?? [], ids) } } : i);
  const findSection = (items: NavItem[], id: string): NavItem[] | undefined => {
    for (const item of items) {
      if (item.section?.sectionId === id) return item.section.navItems ??= [];
      const nested = findSection(item.section?.navItems ?? [], id);
      if (nested) return nested;
    }
    return undefined;
  };
  const answer = (endpoint: string, body: Json): unknown => {
    calls.push({ endpoint, body: structuredClone(body) });
    switch (endpoint) {
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'updateReportNavigationInfo':
        if (conflictNav) {
          conflictNav = false;
          doc.version = String(Number(doc.version) + 1);
          doc.navigationInfo!.extra = 'concurrent navigation edit';
          return { version: '-1' };
        }
        if (body.version !== doc.version) return { version: '-1' };
        doc.navigationInfo = structuredClone(body.navigationInfo);
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      case 'createPages': {
        const root = doc.navigationInfo!.navItems!;
        const at = body.position.sectionId ? findSection(root, body.position.sectionId)! : root;
        at.splice(body.position.index, 0, ...body.pages.map((p: Json) => ({ page: { pageId: p.pageId, displayName: p.displayName } })));
        doc.page.push(...body.pages.map((p: Json) => ({ pageId: p.pageId, page: structuredClone(p.page), chartCondition: structuredClone(p.chartCondition), version: '1' })));
        doc.version = String(Number(doc.version) + 1);
        return { navigationInfo: structuredClone(doc.navigationInfo) };
      }
      case 'deletePages':
        doc.page = doc.page.filter((p) => !body.pageIds.includes(p.pageId));
        doc.navigationInfo!.navItems = dropPages(doc.navigationInfo!.navItems!, body.pageIds);
        doc.version = String(Number(doc.version) + 1);
        return { navigationInfo: structuredClone(doc.navigationInfo) };
      case 'updatePage': {
        if (options.failPage) throw new Error('page save failed');
        const page = doc.page.find((p) => p.pageId === body.pageId)!;
        if (body.version !== page.version) return { version: '-1' };
        const { fieldMask: _fieldMask, pageId: _pageId, chartCondition, ...data } = structuredClone(body.pageRequest);
        page.page = data;
        page.chartCondition = chartCondition;
        page.version = String(Number(page.version) + 1);
        return { version: page.version };
      }
      case 'updateReport': {
        if (body.version !== doc.version) return { version: '-1' };
        const { chartCondition, ...data } = structuredClone(body.reportRequest);
        doc.report = data;
        doc.chartCondition = chartCondition;
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      }
      case 'getBlockDatasource':
        return { published: { datasourceId: body.datasourceId, datasourceBlock: { name: 'Demo data', fields: structuredClone(columns) } } };
      case 'getSchema':
        return { schema: { dimensions: columns.filter((c) => c.dataType !== 5).map((c) => ({ name: c.field.name })), metrics: columns.filter((c) => c.dataType === 5).map((c) => ({ name: c.field.name })) } };
      case 'getDatasourceList':
        return { datasourceInfo: body.shareableIds.map((id: string) => ({ shareableConfig: { id, name: id === SOURCE ? 'Demo data' : 'Alternate data' } })) };
      default: throw new Error(`unexpected endpoint ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => answer(endpoint, body as Json) as T,
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map((req) => ({ ok: true, value: answer(req.endpoint, req.body as Json) as T })),
  };
  const ctx = createContext({ rap, tools });
  const run = async (name: string, args: Json = {}) => resultText(await runTool(ctx, name, { report_id: REPORT, ...args }));
  const saves = (endpoint?: string) => calls.filter((c) => endpoint ? c.endpoint === endpoint : ['updatePage', 'updateReport', 'updateReportNavigationInfo', 'createPages', 'deletePages'].includes(c.endpoint));
  return { doc, rap, ctx, calls, run, saves };
}

export function pageProp(doc: ReportDoc, index = 0): Json {
  return (doc.page[index]!.page.propertyConfig as Json).pageProperty;
}

export function entries(doc: ReportDoc): Json[] {
  return (doc.report.resource as Json).filter?.entry ?? [];
}
