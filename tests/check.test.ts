import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkComponent, checkPage, compareRange, dataRequests, dateRange, describeCheck } from '../src/core/check.js';
import { renderChecked } from '../src/core/render.js';
import type { ReportDoc } from '../src/core/session.js';
import type { Rap, RapOutcome, RapRequest } from '../src/looker/rap.js';

type Json = Record<string, any>;

// Tuesday 3 November 2026, local time.
const NOW = new Date(2026, 10, 3, 15, 0, 0);

const chart = (id: string, extra: Json = {}, ds = 'dsA'): Json => ({
  componentId: id,
  type: 'simple-table',
  datasourceId: ds,
  conceptDefs: [
    { name: 'qt_d', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_platform_' } } },
    { name: 'qt_day', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_day_' } } },
  ],
  propertyConfig: {
    componentProperty: { dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_d'] } }] }, ...extra },
  },
});

const filterEntry = (key: string, value: string, datasourceId = 'dsA') => ({
  key,
  value: {
    name: key,
    datasourceId,
    version: 3,
    filterDefinition: { filterExpression: { include: true, conceptType: 0, concept: { ns: 't0', name: 'qt_f' }, filterConditionType: 'EQ', stringValues: [value] } },
  },
});

function doc(components: Json[], opts: { page?: Json; report?: Json; reportComponents?: Json[] } = {}): ReportDoc {
  return {
    shareable: { id: 'r1', name: 'R' },
    report: {
      componentConfig: opts.reportComponents ?? [],
      resource: { filter: { entry: [filterEntry('fChart', 'android'), filterEntry('fPage', 'ios'), filterEntry('fReport', 'web'), filterEntry('fOther', 'x', 'dsB')] } },
      propertyConfig: { reportProperty: opts.report ?? {} },
    },
    page: [{ pageId: 'p1', page: { componentConfig: components, propertyConfig: { pageProperty: opts.page ?? {} } } }],
  } as ReportDoc;
}

const spec = (d: ReportDoc, i = 0) => dataRequests('r1', d.page[0]!, 'Asia/Seoul', d, NOW)[i]!.request.datasetSpec as Json;
const ns0 = { datasetNs: 'd0', tableNs: 't0', contextNs: 'c0' };

it('checks a blended chart without sending its report-local id to getBlockDatasource', async () => {
  const c = chart('cd-blend', { dataset: { datasetType: 2, datasetId: 'blend-1' } });
  delete c.datasourceId;
  c.conceptDefs.push({ name: 'qt_right', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_right_value_', aggregation: 6 } } });
  c.propertyConfig.componentProperty.metrics = { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_right'] } }] };
  c.propertyConfig.componentProperty.sort = [{ sortColumn: 'qt_right', sortDir: 1 }];
  const d = doc([c]);
  const block = {
    datasourceBlock: { fields: [
      { field: { name: '_platform_' }, outputName: 'Platform', dataType: 0, queryTimeTransformation: { dataTransformation: { sourceFieldName: 'left_key' } } },
      { field: { name: '_right_value_' }, outputName: 'Value', dataType: 5, queryTimeTransformation: { dataTransformation: { sourceFieldName: 'right_value' } } },
    ] },
    blocks: [{ treeQueryBlockConfig: { join: { left: { query: { datasourceId: 'source-a', concepts: [{ id: { name: 'left_key' } }] } }, right: { query: { datasourceId: 'source-b', concepts: [{ id: { name: 'right_value' } }] } } } } }],
  };
  (d.report.resource as Json).dataViewResource = { entry: [{ key: 'blend-1', value: { blockDatasource: block } }] };
  const sent: RapRequest[] = [];
  const rap: Rap = {
    call: async () => { throw new Error('Use the batch'); },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => {
      sent.push(...requests);
      return requests.map(() => ({ ok: true, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount: 2 } } }] }] } as T }));
    },
  };
  expect(await checkPage(rap, d, 'p1')).toEqual([{ componentId: 'cd-blend', type: 'simple-table', ok: true, rows: 2 }]);
  expect(sent.map((request) => request.endpoint)).toEqual(['batchedDataV2']);
  const query = (sent[0]!.body as Json).dataRequest[0].datasetSpec;
  expect(query.dataset.map((source: Json) => source.datasourceId)).toEqual(['source-a', 'source-b']);
  expect(query.blendConfig.blockDatasource).toEqual(block);
  expect(query.queryFields.map((field: Json) => field.datasetNs)).toEqual(['d0', 'd1']);
  expect(query.sortData).toEqual([{ sortDir: 1, sortColumn: query.queryFields[1] }]);
  block.datasourceBlock.fields = [];
  expect((await checkPage(rap, d, 'p1'))[0]?.error).toContain('_platform_');
});

describe('checkPage filters', () => {
  it("sends the chart's filters and the page's and report's for its data source, with the namespace the server needs", () => {
    const d = doc([chart('cd-1', { filters: ['fChart', 'fOther'] })], { page: { filters: ['fPage'] }, report: { filters: ['fReport'] } });
    const s = spec(d);
    expect(s.filters.map((f: Json) => f.filterDefinition.filterExpression.stringValues[0])).toEqual(['android', 'ios', 'web']);
    expect(s.filters[0]).toEqual({ filterDefinition: filterEntry('fChart', 'android').value.filterDefinition, dataSubsetNs: ns0, version: 3 });
  });

  it('leaves out page and report filters for a chart that does not inherit them', () => {
    const d = doc([chart('cd-1', { filters: ['fChart'], inheritFilters: false })], { page: { filters: ['fPage'] } });
    expect(spec(d).filters).toHaveLength(1);
  });
});

describe('checkPage date ranges', () => {
  it('sends the date range with its dimension, and the comparison range as a second context', () => {
    const d = doc([
      chart('cd-1', {
        dateRangeDimension: 'qt_day',
        dateDuration: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 },
        compareDateDuration: { anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } },
      }),
    ]);
    const s = spec(d);
    expect(s.dateRanges).toEqual([
      { startDate: '20261027', endDate: '20261102', dataSubsetNs: ns0 },
      { startDate: '20261020', endDate: '20261026', dataSubsetNs: { ...ns0, contextNs: 'c1' } },
    ]);
    expect(s.dateRangeDimensions).toEqual([{ name: 'qt_day', datasetNs: 'd0', tableNs: 't0', dataTransformation: { sourceFieldName: '_day_' } }]);
    expect(s.contextNsCount).toBe(2);
    // Not asked for: the dimension is not a shown field.
    expect(s.queryFields.map((q: Json) => q.name)).toEqual(['qt_d']);
  });

  it('sends no date range without a date range dimension (the server would ignore it)', () => {
    const d = doc([chart('cd-1', { dateDuration: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 } })]);
    expect(spec(d)).toMatchObject({ dateRanges: [], contextNsCount: 1 });
    expect(spec(d).dateRangeDimensions).toBeUndefined();
  });

  it("uses the page's date settings for a chart on the page's data source", () => {
    const page = {
      dataset: { datasetId: 'dsA' },
      dateRangeDimension: 'qt_pday',
      dateDuration: { startOffsetUnit: 6, startOffset: 1, endOffsetUnit: 6, endOffset: 1 },
    };
    const d = doc([chart('cd-1'), chart('cd-2', {}, 'dsB')], { page });
    d.page[0]!.page.conceptDefs = [{ name: 'qt_pday', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_date_' } } }];
    expect(spec(d, 0).dateRanges).toEqual([{ startDate: '20261001', endDate: '20261031', dataSubsetNs: ns0 }]);
    expect(spec(d, 0).dateRangeDimensions[0].dataTransformation).toEqual({ sourceFieldName: '_date_' });
    expect(spec(d, 1).dateRanges).toEqual([]);
  });
});

describe('date range arithmetic', () => {
  const r = (startOffsetUnit: number, startOffset: number, endOffsetUnit: number, endOffset: number, now = NOW) =>
    dateRange({ startOffsetUnit, startOffset, endOffsetUnit, endOffset }, now);

  it('matches the editor presets', () => {
    expect(r(3, 0, 3, 0)).toEqual({ startDate: '20261103', endDate: '20261103' }); // Today
    expect(r(3, 28, 3, 1)).toEqual({ startDate: '20261006', endDate: '20261102' }); // Last 28 days
    expect(r(4, 1, 4, 1)).toEqual({ startDate: '20261025', endDate: '20261031' }); // Last week (Sunday)
    expect(r(5, 0, 5, 0)).toEqual({ startDate: '20261102', endDate: '20261108' }); // This week (Monday)
    expect(r(6, 0, 3, 1)).toEqual({ startDate: '20261101', endDate: '20261102' }); // This month to date
    expect(r(7, 1, 7, 1)).toEqual({ startDate: '20260701', endDate: '20260930' }); // Last quarter
    expect(r(8, 0, 3, 1)).toEqual({ startDate: '20260101', endDate: '20261102' }); // This year to date
    expect(r(8, 1, 8, 1)).toEqual({ startDate: '20250101', endDate: '20251231' }); // Last year
    expect(dateRange({ startAnchor: '20250101', endAnchor: '20251231' })).toEqual({ startDate: '20250101', endDate: '20251231' });
    expect(dateRange({})).toBeUndefined();
  });

  it('starts "to date" ranges a unit earlier on the first day', () => {
    expect(r(6, 0, 3, 1, new Date(2026, 10, 1))).toEqual({ startDate: '20261001', endDate: '20261031' });
  });

  it('works out comparison ranges', () => {
    const prev = { anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } };
    const thisMonth = { startOffsetUnit: 6, startOffset: 0, endOffsetUnit: 6, endOffset: 0 };
    expect(compareRange(prev, thisMonth, dateRange(thisMonth, NOW)!, NOW)).toEqual({ startDate: '20261001', endDate: '20261031' });
    const toDate = { startOffsetUnit: 6, startOffset: 0, endOffsetUnit: 3, endOffset: 1 };
    expect(compareRange(prev, toDate, dateRange(toDate, NOW)!, NOW)).toEqual({ startDate: '20261030', endDate: '20261031' });
    const lastMonth = { startOffsetUnit: 6, startOffset: 1, endOffsetUnit: 6, endOffset: 1 };
    const prevYear = { anchorType: 1, config: { startOffsetUnit: 8, startOffset: 1, endOffsetUnit: 8, endOffset: 1 } };
    expect(compareRange(prevYear, lastMonth, dateRange(lastMonth, NOW)!, NOW)).toEqual({ startDate: '20251001', endDate: '20251031' });
    const fixed = { anchorType: 0, config: { startAnchor: '20240101', endAnchor: '20240131' } };
    expect(compareRange(fixed, lastMonth, dateRange(lastMonth, NOW)!, NOW)).toEqual({ startDate: '20240101', endDate: '20240131' });
    expect(compareRange({ anchorType: 0, config: {} }, lastMonth, dateRange(lastMonth, NOW)!, NOW)).toBeUndefined();
  });
});

describe('checkPage answers', () => {
  const table = (n: number) => ({ dataset: { tableDataset: { totalCount: n } } });
  // Answers by component id; getBlockDatasource knows both fields.
  function fakeRap(answers: Record<string, RapOutcome<unknown> | 'hang' | 'down'>, log: Array<{ n: number; timeoutMs?: number }> = []): Rap {
    return {
      call: async () => {
        throw new Error('unused');
      },
      callMany: async <T>(requests: RapRequest[], opts?: { timeoutMs?: number }) => {
        log.push({ n: requests.length, ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
        const out = requests.map((r) => {
          if (r.endpoint === 'getBlockDatasource')
            return { ok: true, value: { published: { datasourceBlock: { fields: [{ field: { name: '_platform_' } }, { field: { name: '_day_' } }] } } } };
          return answers[(r.body as Json).dataRequest[0].requestContext.reportContext.componentId];
        });
        if (out.includes('hang')) throw Object.assign(new Error('The browser tab did not answer in time'), { code: 'timeout' });
        if (out.includes('down')) throw Object.assign(new Error('The browser is not reachable'), { code: 'browser_unreachable' });
        return out as RapOutcome<T>[];
      },
    };
  }

  it('counts rows and comparison rows, and checks report-level charts too', async () => {
    const d = doc(
      [
        chart('cd-1', {
          dateRangeDimension: 'qt_day',
          dateDuration: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 },
          compareDateDuration: { anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } },
          filters: ['fChart'],
        }),
      ],
      { reportComponents: [chart('cd-shared')] },
    );
    const rap = fakeRap({
      'cd-1': { ok: true, value: { dataResponse: [{ dataSubset: [table(1), table(0)] }] } },
      'cd-shared': { ok: true, value: { dataResponse: [{ dataSubset: [table(0)] }] } },
    });
    const res = await checkPage(rap, d, 'p1', { now: NOW });
    expect(res).toEqual([
      { componentId: 'cd-1', type: 'simple-table', ok: true, rows: 1, compareRows: 0, filters: 1, dateRange: { startDate: '20261027', endDate: '20261102' } },
      { componentId: 'cd-shared', type: 'simple-table', ok: true, rows: 0, reportLevel: true },
    ]);
    expect(res.map(describeCheck)).toEqual(['cd-1 (simple-table): 1 row, 0 in the comparison range', 'cd-shared (simple-table): 0 rows (no data)']);
  });

  it('counts size-only columnar responses for the main and comparison contexts', async () => {
    const d = doc([chart('cd-1', {
      dateRangeDimension: 'qt_day',
      dateDuration: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 },
      compareDateDuration: { anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } },
    })]);
    const rap = fakeRap({ 'cd-1': { ok: true, value: { dataResponse: [{ dataSubset: [
      { dataset: { tableDataset: { size: 2, columnInfo: [{ ns: 't0', name: 'qt_d' }], column: [{ nullIndex: [], stringColumn: { values: ['alpha', 'beta'] } }] } } },
      { dataset: { tableDataset: { size: 1, columnInfo: [{ ns: 't0', name: 'qt_d' }], column: [{ nullIndex: [], stringColumn: { values: ['alpha'] } }] } } },
    ] }] } } });
    const [result] = await checkPage(rap, d, 'p1', { now: NOW });
    expect(result).toMatchObject({ ok: true, rows: 2, compareRows: 1 });
    expect(describeCheck(result!)).toBe('cd-1 (simple-table): 2 rows, 1 in the comparison range');
  });

  it('preserves totalCount when both total and returned size are present', async () => {
    for (const totalCount of [0, 8, '12']) {
      const rap = fakeRap({ 'cd-1': { ok: true, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount, size: 2 } } }] }] } } });
      expect((await checkPage(rap, doc([chart('cd-1')]), 'p1'))[0]).toMatchObject({ ok: true, rows: Number(totalCount) });
    }
  });

  it('accepts an empty returned size but never coerces malformed size values into row counts', async () => {
    for (const size of [0, -1, 1.5, NaN, Infinity, '2', '', true, null, undefined]) {
      const rap = fakeRap({ 'cd-1': { ok: true, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { size } } }] }] } } });
      expect((await checkPage(rap, doc([chart('cd-1')]), 'p1'))[0]).toMatchObject({ ok: true, rows: 0 });
    }
  });

  it('asks each chart alone when the round trip runs out of time, and marks the slow one as loading', async () => {
    const log: Array<{ n: number; timeoutMs?: number }> = [];
    const rap = fakeRap({ 'cd-1': { ok: true, value: { dataResponse: [{ dataSubset: [table(3)] }] } }, 'cd-2': 'hang' }, log);
    const res = await checkPage(rap, doc([chart('cd-1'), chart('cd-2')]), 'p1', { timeoutMs: 5_000 });
    expect(res[0]).toMatchObject({ componentId: 'cd-1', ok: true, rows: 3 });
    expect(res[1]).toMatchObject({ componentId: 'cd-2', ok: false, timedOut: true, error: 'no answer within 5 s' });
    expect(describeCheck(res[1]!)).toBe('cd-2 (simple-table): still loading — no answer within 5 s');
    // Source metadata first, then the two charts together and individually.
    expect(log).toEqual([{ n: 1, timeoutMs: 5_000 }, { n: 2, timeoutMs: 5_000 }, { n: 1, timeoutMs: 5_000 }, { n: 1, timeoutMs: 5_000 }]);
  });

  it('asks three at a time, only the round trip that ran out of time again, and nothing after the deadline', async () => {
    const ok = { ok: true as const, value: { dataResponse: [{ dataSubset: [table(1)] }] } };
    const log: Array<{ n: number; timeoutMs?: number }> = [];
    const charts = ['cd-1', 'cd-2', 'cd-3', 'cd-4', 'cd-5'];
    const rap = fakeRap({ 'cd-1': ok, 'cd-2': ok, 'cd-3': ok, 'cd-4': 'hang', 'cd-5': ok }, log);
    const res = await checkPage(rap, doc(charts.map((id) => chart(id))), 'p1', { timeoutMs: 5_000 });
    expect(res.map((r) => r.ok)).toEqual([true, true, true, false, true]);
    expect(res[3]).toMatchObject({ timedOut: true });
    // Source metadata first; [1,2,3] once; [4,5] timed out, then each alone.
    expect(log.map((l) => l.n)).toEqual([1, 3, 2, 1, 1]);

    const late = await checkPage(fakeRap({ 'cd-1': 'hang', 'cd-2': ok, 'cd-3': ok, 'cd-4': ok, 'cd-5': ok }), doc(charts.map((id) => chart(id))), 'p1', {
      timeoutMs: 5_000,
      deadlineMs: 0,
    });
    expect(late.every((r) => r.timedOut && r.error === 'not asked: the check ran out of time')).toBe(true);
  });

  it('fails when the browser is down instead of calling every chart slow', async () => {
    const log: Array<{ n: number }> = [];
    await expect(checkPage(fakeRap({ 'cd-1': 'down' }, log), doc([chart('cd-1'), chart('cd-2')]), 'p1')).rejects.toThrow(/not reachable/);
    expect(log).toHaveLength(2);
  });

  it('checks one component after a save, reading the report again', async () => {
    const rap = fakeRap({ 'cd-2': { ok: true, value: { dataResponse: [{ dataSubset: [table(2)] }] } } });
    const loaded: string[] = [];
    const load = async (id: string) => {
      loaded.push(id);
      return doc([chart('cd-1'), chart('cd-2'), { componentId: 'cd-text', type: 'simple-description' }]);
    };
    expect(await checkComponent(rap, load, 'r1', 'p1', 'cd-2')).toEqual({ componentId: 'cd-2', type: 'simple-table', ok: true, rows: 2 });
    expect(await checkComponent(rap, load, 'r1', 'p1', 'cd-text')).toBeUndefined();
    expect(loaded).toEqual(['r1', 'r1']);
  });
});

describe('renderChecked', () => {
  it('asks for the data, waits, then renders at the page size', async () => {
    const order: string[] = [];
    const d = doc([chart('cd-1')]);
    d.page[0]!.page.attributeConfig = { pageAttribute: { width: 1400, height: 2000 } };
    const rap: Rap = {
      call: async <T>(endpoint: string, body: unknown) => {
        order.push(endpoint);
        expect(body).toMatchObject({ width: 1400, height: 2000, pageSettings: [{ pageId: 'p1', width: 1400, height: 2000 }] });
        return 'JVBERg==' as T;
      },
      callMany: async <T>(requests: RapRequest[]) => {
        order.push(...requests.map(r => r.endpoint));
        return requests.map((r) =>
          r.endpoint === 'getBlockDatasource'
            ? { ok: false, status: 403, error: 'denied' }
            : { ok: true, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount: 1 } } }] }] } },
        ) as RapOutcome<T>[];
      },
    };
    const res = await renderChecked(rap, d, 'p1', { dir: mkdtempSync(join(tmpdir(), 'kl-')), name: 'x' }, {
      sleep: async (ms) => void order.push(`wait ${ms}`),
      run: async () => {
        throw new Error('no converter');
      },
    });
    expect(order).toEqual(['getBlockDatasource', 'batchedDataV2', 'wait 15000', 'getPdf']);
    expect(res.checks).toEqual([{ componentId: 'cd-1', type: 'simple-table', ok: true, rows: 1 }]);
    expect(res.render.pdf).toMatch(/x\.pdf$/);
  });
});

it.each([1, 2, 8])('uses connector-specific date dimensions without dropping date ranges (%s)', async (datasourceType) => {
  const seen: Json[] = [];
  const d = doc([chart('cd-date', { dateRangeDimension: 'qt_day', dateDuration: { startAnchor: '20261001', endAnchor: '20261028' } })]);
  const rap: Rap = {
    call: async () => { throw Error('unused'); },
    callMany: async <T>(requests: RapRequest[]) => requests.map(r => {
      if (r.endpoint === 'getBlockDatasource') return { ok: true as const, value: { published: {
        blocks: [{ connectorBlockConfig: { connectorConfig: { datasourceType, ...(datasourceType === 1 ? { googleAnalyticsConnectorConfig: { isEnhanced: true } } : {}) } } }],
        datasourceBlock: { fields: [{ field: { name: '_platform_' } }, { field: { name: '_day_' } }] },
      } } as T };
      const spec = (r.body as Json).dataRequest[0].datasetSpec;
      seen.push(spec);
      const bad = datasourceType === 1 && spec.dateRangeDimensions;
      return { ok: true as const, value: { dataResponse: [bad ? { errorStatus: { message: 'DATASET_CONFIGURATION' } } : { dataSubset: [{ dataset: { tableDataset: { size: 2 } } }] }] } as T };
    }),
  };
  expect((await checkPage(rap, d, 'p1'))[0]).toMatchObject({ ok: true, rows: 2 });
  expect(seen[0]!.dateRanges[0]).toMatchObject({ startDate: '20261001', endDate: '20261028' });
  expect(Boolean(seen[0]!.dateRangeDimensions)).toBe(datasourceType !== 1);
});

it('uses the grouped date picker only for its own auto-date charts', async () => {
  const { toMapValue } = await import('../src/core/mapvalue.js');
  const picker = { componentId: 'cd-picker', type: 'simple-daterangepicker', behavior: toMapValue({ onSelect: [{ action: 'lego-change-date-range', isControl: true, init: { dateRange: { startAnchor: '20261001', endAnchor: '20261028' } } }] }) };
  const d = doc([chart('cd-in', { dateRangeDimension: 'qt_day' }), chart('cd-out', { dateRangeDimension: 'qt_day' }), chart('cd-fixed', { dateRangeDimension: 'qt_day', dateDuration: { startAnchor: '20261003', endAnchor: '20261004' } }), picker]);
  d.page[0]!.page.groupConfig = [{ groupId: 'g-section', componentId: ['cd-in', 'cd-fixed', 'cd-picker'], childGroupId: [] }];
  expect(spec(d, 0).dateRanges[0]).toMatchObject({ startDate: '20261001', endDate: '20261028' });
  expect(spec(d, 1).dateRanges).toEqual([]);
  expect(spec(d, 2).dateRanges[0]).toMatchObject({ startDate: '20261003', endDate: '20261004' });
});

it('does not infer picker scopes for charts without a date field or outside a selected check', async () => {
  const { toMapValue } = await import('../src/core/mapvalue.js');
  const picker = (id: string) => ({ componentId: id, type: 'simple-daterangepicker', behavior: toMapValue({ onSelect: [{ action: 'lego-change-date-range', init: { dateRange: { startAnchor: '20261001', endAnchor: '20261002' } } }] }) });
  const d = doc([chart('cd-plain'), chart('cd-ambiguous', { dateRangeDimension: 'qt_day' }), picker('pick1'), picker('pick2')]);
  expect(dataRequests('r1', d.page[0]!, 'UTC', d, NOW, ['cd-plain'])).toHaveLength(1);
  expect(() => dataRequests('r1', d.page[0]!, 'UTC', d, NOW, ['cd-ambiguous'])).toThrow(/Multiple date picker/);
});

it('refuses unsupported nested picker scopes rather than claiming a guessed period', () => {
  const d = doc([chart('cd-child', { dateRangeDimension: 'qt_day' })]);
  d.page[0]!.page.groupConfig = [{ groupId: 'child', componentId: ['cd-child'] }, { groupId: 'parent', childGroupId: ['child'] }];
  expect(() => spec(d)).toThrow(/Nested or pass-through/);
});

it('does not send a dated chart query when source-format discovery fails', async () => {
  const calls: string[] = [];
  const rap: Rap = { call: async () => { throw Error('unused'); }, callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map(r => {
    calls.push(r.endpoint); return { ok: false, status: 403, error: 'denied' };
  }) };
  const d = doc([chart('cd-date', { dateRangeDimension: 'qt_day', dateDuration: { startAnchor: '20261001', endAnchor: '20261002' } })]);
  await expect(checkPage(rap, d, 'p1')).rejects.toThrow(/Could not read source/);
  expect(calls).toEqual(['getBlockDatasource']);
});

it('applies a grouped picker to GA4 controls without an explicit date field', async () => {
  const { toMapValue } = await import('../src/core/mapvalue.js');
  const c = chart('cd-control'); c.type = 'dimension-filter';
  const d = doc([c, { componentId: 'picker', type: 'simple-daterangepicker', behavior: toMapValue({ onSelect: [{ action: 'lego-change-date-range', init: { dateRange: { startAnchor: '20261001', endAnchor: '20261028' } } }] }) }]);
  d.page[0]!.page.groupConfig = [{ groupId: 'g', componentId: ['cd-control', 'picker'] }];
  const seen: Json[] = [];
  const rap: Rap = { call: async () => { throw Error('unused'); }, callMany: async <T>(rs: RapRequest[]) => rs.map(r => {
    if(r.endpoint === 'getBlockDatasource') return { ok: true as const, value: { published: { blocks: [{ connectorBlockConfig: { connectorConfig: { datasourceType: 1, googleAnalyticsConnectorConfig: { isEnhanced: true } } } }], datasourceBlock: { fields: [{ field: { name: '_platform_' } }] } } } as T };
    const spec = (r.body as Json).dataRequest[0].datasetSpec; seen.push(spec);
    return { ok: true as const, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { size: 3 } } }] }] } as T };
  }) };
  expect((await checkPage(rap, d, 'p1'))[0]).toMatchObject({ ok: true, rows: 3, dateRange: { startDate: '20261001', endDate: '20261028' } });
  expect(seen[0]!.dateRangeDimensions).toBeUndefined();
  d.page[0]!.page.componentConfig = [c];
  d.page[0]!.page.groupConfig = [];
  expect((await checkPage(rap, d, 'p1', { now: NOW }))[0]).toMatchObject({ ok: true, dateRange: { startDate: '20261006', endDate: '20261102' } });
});
