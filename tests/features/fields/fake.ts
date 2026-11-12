import { readFileSync } from 'node:fs';

import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { tools } from '../../../src/features/fields/index.js';
import type { Rap } from '../../../src/looker/rap.js';
import { A, B, column, looker, R1, type Json } from '../data-sources/fake.js';

export { A, B, R1 };

export function fake(options: { formulaError?: string; formulaColumn?: Json; formulaResponse?: (body: Json) => unknown; min?: number; max?: number; oneSource?: boolean; failReport?: boolean; failPage?: number } = {}) {
  const base = looker();
  const report = base.report;
  const resource = report.report.resource as Json;
  resource.filter = { entry: JSON.parse(readFileSync(new URL('../../../fixtures/fields/filters.json', import.meta.url), 'utf8')) };
  if (options.oneSource) resource.datasourceAlias = [resource.datasourceAlias[0]];
  (report.page[0]!.page.componentConfig![0] as Json).propertyConfig = { componentProperty: { filters: ['filterA', 'filterB'] } };
  report.page[0]!.page.propertyConfig = { pageProperty: { filters: ['filterA'] } };
  report.report.propertyConfig = { reportProperty: { filters: ['filterA', 'filterB'] } };
  report.report.componentConfig = [{ componentId: 'cd-shared', propertyConfig: { componentProperty: { filters: ['filterA'] } } }];
  let pageWrites = 0;
  const rap: Rap = {
    call: async <T>(endpoint: string, input: unknown): Promise<T> => {
      const body = input as Json;
      if (!['validateFormula', 'batchedDataV2', 'updatePage', 'updateReport'].includes(endpoint)) return base.rap.call<T>(endpoint, body);
      base.calls.push({ endpoint, body: structuredClone(body) });
      if (endpoint === 'validateFormula') return (options.formulaResponse?.(body) ?? options.formulaError ?? { column: options.formulaColumn ?? column('validated', 'validated', 33, { textFormula: 'server formula', custom: { preserved: true } }) }) as T;
      if (endpoint === 'batchedDataV2') {
        const aggregation = body.dataRequest[0].datasetSpec.queryFields[0].dataTransformation.aggregation;
        return { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { column: [{ nullIndex: [], longColumn: { values: [String(aggregation === 5 ? options.min ?? 0 : options.max ?? 4321)] } }], totalCount: 1 } } }] }] } as T;
      }
      if (endpoint === 'updatePage') {
        pageWrites++;
        if (pageWrites === options.failPage) throw new Error('page save failed');
        const page = report.page.find((p) => p.pageId === body.pageId)!;
        const request = body.pageRequest;
        page.page.componentConfig = structuredClone(request.componentConfig);
        page.page.propertyConfig = structuredClone(request.propertyConfig);
        page.version = String(Number(page.version ?? 0) + 1);
        return { version: page.version } as T;
      }
      if (options.failReport) throw new Error('report save failed');
      const request = body.reportRequest;
      report.report.resource = structuredClone(request.resource);
      report.report.componentConfig = structuredClone(request.componentConfig);
      report.report.propertyConfig = structuredClone(request.propertyConfig);
      report.version = String(Number(report.version ?? 0) + 1);
      return { version: report.version } as T;
    },
    callMany: base.rap.callMany.bind(base.rap),
  };
  const ctx = createContext({ rap, tools });
  const calls = base.calls;
  const published = () => base.sources[A]!.published;
  const parameters = () => published().resource.parameterConfiguration.parameters;
  const fields = () => published().datasourceBlock.fields as Json[];
  return { ...base, rap, ctx, calls, published, parameters, fields, resource: () => report.report.resource as Json };
}

export const input = { report_id: R1, data_source: 'ds1' };
export const writes = (f: ReturnType<typeof fake>) => f.calls.filter((c) => ['publishDatasource', 'updatePage', 'updateReport'].includes(c.endpoint));
