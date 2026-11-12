import { afterEach, expect, it, vi } from 'vitest';

import { editDatasource, resolveSource } from '../../../src/core/datasource.js';
import { DryRap } from '../../../src/core/dryrun.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { getReportBody } from '../../../src/looker/reports.js';
import { parseReportId } from '../../../src/looker/view.js';
import { fake, ORIGINAL, REUSABLE, SOURCE, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

for (const replacement of [{ original: 'ds1', ...TABLE }, { original: 'ds1', reusable: 'Reusable traffic' }]) {
  it(`report.copy.sources: previews ${'reusable' in replacement ? 'reuse' : 'reconnection'} while protecting the original`, async () => {
    const f = fake({ dryRun: true });
    const original = structuredClone(f.original);
    const source = structuredClone(f.sources[SOURCE]);
    await f.run('report_copy', { report_id: ORIGINAL, name: 'Preview', data_sources: [replacement] });
    expect(f.original).toEqual(original);
    expect(f.sources[SOURCE]).toEqual(source);
    for (const endpoint of ['copyReport', 'publishDatasource', 'updateReport', 'renameDatasource']) expect(f.sent(endpoint)).toEqual([]);
  });
}

it('report.create.source.sql_check: supplies both date bounds when the date range is enabled', async () => {
  const f = fake();
  await f.run('report_create', { name: 'Dated', sql: 'SELECT @DS_START_DATE AS d', date_range_params: true });
  expect(f.bqCalls[0]?.queryParameters).toEqual(['DS_START_DATE', 'DS_END_DATE'].map(name => ({ name, parameterType: { type: 'STRING' }, parameterValue: { value: '20240101' } })));
});

async function previewCopy(rap: DryRap) {
  const result = await rap.call<{ url: string }>('copyReport', {
    reportId: ORIGINAL,
    datasourceMap: JSON.stringify({ [SOURCE]: SOURCE }),
  });
  const reportId = parseReportId(result.url);
  const doc = (await rap.call<{ reportConfig: ReportDoc }>('getReport', getReportBody(reportId, true))).reportConfig;
  return { reportId, doc, sourceId: doc.report.resource!.datasourceAlias![0]!.datasourceId };
}

it('report.copy.sources: later batched reads resolve a virtual copied source without sending its id', async () => {
  const f = fake();
  const original = structuredClone(f.original);
  const source = structuredClone(f.sources[SOURCE]);
  const dry = new DryRap(f.ctx.rap, []);
  const copy = await previewCopy(dry);
  expect(copy.sourceId).not.toBe(SOURCE);
  expect((await dry.call<Json>('getBlockDatasource', { datasourceId: copy.sourceId })).embeddedInReportId).toBe(copy.reportId);

  const callsBefore = f.calls.length;
  await expect(resolveSource(dry, copy.doc, 'ds1')).resolves.toMatchObject({
    datasourceId: copy.sourceId,
    fields: expect.arrayContaining([expect.objectContaining({ id: '_value_', name: 'value' })]),
  });
  expect(f.calls.slice(callsBefore)).toEqual([]);
  expect(f.original).toEqual(original);
  expect(f.sources[SOURCE]).toEqual(source);
});

it('report.copy.sources: a second preview edit keeps the first edit when the original source has a draft', async () => {
  const f = fake();
  const original = structuredClone(f.original);
  const source = structuredClone(f.sources[SOURCE]);
  const call = f.ctx.rap.call.bind(f.ctx.rap);
  f.ctx.rap.call = async <T>(endpoint: string, body: unknown, timeoutMs?: number, mode?: Parameters<typeof call>[3]): Promise<T> => {
    const value = await call<Json>(endpoint, body, timeoutMs, mode);
    if (endpoint === 'getBlockDatasource' && (body as Json).datasourceId === SOURCE)
      value.draft = structuredClone(value.published);
    return value as T;
  };
  const dry = new DryRap(f.ctx.rap, []);
  const copy = await previewCopy(dry);
  await editDatasource(dry, copy.reportId, copy.sourceId, (draft: Json) => {
    draft.datasourceBlock.fields[0].outputName = 'Renamed value';
  }, 'rename field');
  await editDatasource(dry, copy.reportId, copy.sourceId, (draft: Json) => {
    draft.datasourceBlock.fields[0].defaultAggregationType = 1;
  }, 'change aggregation');

  const after = await dry.call<Json>('getBlockDatasource', { datasourceId: copy.sourceId });
  expect(after.draft).toBeUndefined();
  expect(after.published.datasourceBlock.fields[0]).toMatchObject({ outputName: 'Renamed value', defaultAggregationType: 1 });
  expect(f.sent('publishDatasource')).toEqual([]);
  expect(f.original).toEqual(original);
  expect(f.sources[SOURCE]).toEqual(source);
});

for (const batched of [false, true]) {
  it(`report.copy.sources: merges virtual and reusable source metadata through ${batched ? 'batched' : 'single'} reads`, async () => {
    const f = fake();
    const dry = new DryRap(f.ctx.rap, []);
    const copy = await previewCopy(dry);
    const request = { endpoint: 'getDatasourceList', body: { type: [1], shareableIds: [copy.sourceId, REUSABLE] } };
    const before = f.calls.length;
    let result: Json;
    if (batched) {
      const outcome = (await dry.callMany<Json>([request]))[0]!;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(outcome.error);
      result = outcome.value;
    } else result = await dry.call<Json>(request.endpoint, request.body);

    expect(result.datasourceInfo.map((info: Json) => info.shareableConfig.id)).toEqual([copy.sourceId, REUSABLE]);
    expect(result.datasourceInfo[0].isEmbedded).toBe(true);
    expect(result.datasourceInfo[1].isEmbedded).toBe(false);
    expect(f.calls.slice(before)).toEqual([
      { endpoint: 'getDatasourceList', body: { type: [1], shareableIds: [REUSABLE] } },
    ]);
  });
}
