import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { datasourceQuery } from '../../../src/features/data-sources/query.js';
import { queryRows } from '../../../src/features/data-sources/query-rows.js';
import type { Rap } from '../../../src/looker/rap.js';
import { A, column, context, looker, R1, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

function setup(ga4 = true) {
  const f = looker(), source = f.sources[A]!.published;
  source.datasourceBlock.fields = [column('_event_', 'Event name', 32), column('_count_', 'Event count', 33, { defaultAggregationType: ga4 ? 7 : 6 }), column('_date_', 'Date', 2)];
  source.blocks[0].connectorBlockConfig.connectorConfig = ga4 ? { datasourceType: 1, googleAnalyticsConnectorConfig: { isEnhanced: true } } : { datasourceType: 8 };
  const asked: Json[] = [];
  let reply: ((request: Json) => Json) | undefined;
  const rap: Rap = { ...f.rap, call: async <T>(endpoint: string, body: unknown): Promise<T> => {
    if (endpoint !== 'batchedDataV2') return f.rap.call<T>(endpoint, body);
    const request = (body as Json).dataRequest[0]; asked.push(request);
    return (reply?.(request) ?? { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: {
      size: 2, totalCount: 2, columnInfo: request.datasetSpec.queryFields.map((q: Json) => ({ ns: 't0', name: q.name })),
      column: [{ stringColumn: { values: ['page_view', 'purchase'] } }, { longColumn: { values: ['0', '9007199254740993'] } }],
    } } }] }] }) as T;
  } };
  const ctx = context(rap); ctx.config.writesEnabled = false;
  const args = { report_id: R1, data_source: 'ds1', dimensions: ['Event name'], metrics: [{ field: 'Event count', ...(ga4 ? {} : { aggregation: 'sum' }) }], date_range: '2025-01-01..2025-01-28', date_range_dimension: 'Date' };
  const run = async (extra: Json = {}) => JSON.parse(resultText(await runTool(ctx, 'datasource_query', { ...args, ...extra })));
  return { ...f, ctx, asked, run, reply: (next: typeof reply) => { reply = next; } };
}

describe('datasource_query', () => {
  it('reads GA4 rows on a write-disabled server without changing report or source', async () => {
    const f = setup(), before = structuredClone({ report: f.report, sources: f.sources });
    const result = await f.run();
    expect(datasourceQuery.write).toBe(false);
    expect(result.rows).toEqual([['page_view', '0'], ['purchase', '9007199254740993']]);
    expect(result.returned_count).toBe(2); expect(result.total_count).toBe(2); expect(result.truncated).toBe(false);
    expect(result.quality).toEqual({ sampling: 'unknown', thresholding: 'unknown', freshness: 'unknown' });
    expect(f.asked[0]!.datasetSpec.dateRangeDimensions).toBeUndefined();
    expect(f.asked[0]!.datasetSpec.dateRanges[0]).toMatchObject({ startDate: '20250101', endDate: '20250128' });
    expect(f.asked[0]!.datasetSpec.paginateInfo).toEqual({ startRow: 1, rowsCount: 101 });
    expect({ report: f.report, sources: f.sources }).toEqual(before);
    expect(f.calls.every(c => ['getReport', 'getBlockDatasource', 'getSchema', 'getDatasourceList'].includes(c.endpoint))).toBe(true);
  });

  it('keeps explicit date dimensions for other connectors and inherits no report filters', async () => {
    const f = setup(false);
    f.report.report.propertyConfig = { reportProperty: { filters: ['filter1'] } };
    f.report.report.resource!.filter = { entry: [{ key: 'filter1', value: { datasourceId: A, filterDefinition: { filterExpression: {} } } }] };
    await f.run();
    expect(f.asked[0]!.datasetSpec.dateRangeDimensions).toHaveLength(1);
    expect(f.asked[0]!.datasetSpec.filters).toEqual([]);
  });

  it.each([
    { date_range: '2025-02-30..2025-03-01' }, { date_range: '2025-02-03..2025-02-01' },
    { date_range_dimension: 'Event name' }, { dimensions: ['missing'] }, { dimensions: ['Event name', '_event_'] },
    { metrics: [{ field: 'Event count', aggregation: 'sum' }] }, { limit: 501 },
  ])('refuses invalid query inputs before requesting data: %j', async (extra) => {
    const f = setup(); await expect(f.run(extra)).rejects.toThrow(); expect(f.asked).toHaveLength(0);
  });

  it('requires non-Auto aggregation and refuses ambiguous field names', async () => {
    const f = setup(false); await expect(f.run({ metrics: [{ field: 'Event count' }] })).rejects.toThrow(/Specify aggregation/);
    f.sources[A]!.published.datasourceBlock.fields.push(column('_event2_', 'Event name', 32));
    await expect(f.run()).rejects.toThrow(); expect(f.asked).toHaveLength(0);
  });

  it('reports backend failure without echoing raw error details as rows', async () => {
    const f = setup(); f.reply(() => ({ dataResponse: [{ errorStatus: { reasonStr: 'PERMISSION_DENIED', message: 'private diagnostic' } }] }));
    await expect(f.run()).rejects.toThrow('Data query failed (PERMISSION_DENIED)');
    await expect(f.run()).rejects.not.toThrow('private diagnostic');
  });

  it('returns empty data distinctly and does not invent unknown totals', async () => {
    const f = setup(); f.reply(() => ({ dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { size: 0 } } }] }] }));
    const result = await f.run(); expect(result.rows).toEqual([]); expect(result.total_count).toBeUndefined(); expect(result.truncated).toBeNull();
  });

  it('caps returned rows and exposes truncation', async () => {
    const f = setup(); const result = await f.run({ limit: 1 });
    expect(result.rows).toEqual([['page_view', '0']]); expect(result.truncated).toBe(true);
    expect(f.asked[0]!.datasetSpec.paginateInfo.rowsCount).toBe(2);
  });
});

describe('queryRows', () => {
  it('restores packed NULLs, false, zeros and integer precision using column identities', () => {
    const table = { size: 3, columnInfo: [{ ns: 't0', name: 'm' }, { ns: 't0', name: 'd' }], column: [
      { nullIndex: [1], longColumn: { values: ['0', '9007199254740993'] } }, { nullIndex: [0], boolColumn: { values: [false, true] } },
    ] };
    expect(queryRows(table, ['d', 'm'], 3).rows).toEqual([[null, '0'], [false, null], [true, '9007199254740993']]);
  });

  it.each([
    { nullIndex: [], longColumn: { values: [9007199254740992] } },
    { nullIndex: [], longColumn: { values: [] } },
    { nullIndex: [2] }, { nullIndex: [0, 0] },
  ])('refuses malformed or already-rounded values: %j', (column) => {
    expect(() => queryRows({ size: 1, columnInfo: [{ ns: 't0', name: 'm' }], column: [column] }, ['m'], 1)).toThrow(/incomplete table/);
  });
});
