import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, ORIGINAL, SOURCE, column, fake, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const config = () => ({ datasourceType: 1, useDatetimeType: true,
  googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '789012', isEnhanced: true } });
const metric = () => ({ ...column('activeUsers', 'Active users', 33), defaultAggregationType: 7 });
function setup() {
  const fields = [column('date', 'Date', 2), metric()];
  const f = fake({ columns: fields });
  const source = f.sources[SOURCE]!.block;
  source.blocks[0].connectorBlockConfig = { alias: 't0', useDatetimeType: true, connectorConfig: config() };
  source.blocks[0].fields = structuredClone(fields);
  source.datasourceBlock.fields = structuredClone(fields);
  const call = f.ctx.rap.call.bind(f.ctx.rap);
  vi.spyOn(f.ctx.rap, 'call').mockImplementation(async (endpoint, body, timeout, mode) => {
    const result = await call(endpoint, body, timeout, mode);
    if (endpoint === 'getSchema') {
      const schema = (result as Json).schema;
      const columns = f.sources[(body as Json).datasourceId]!.block.datasourceBlock.fields as Json[];
      for (const field of [...schema.dimensions, ...schema.metrics]) {
        const column = columns.find(c => c.field.name === field.name)!;
        field.displayName = column.outputName; field.newDefaultAggregation = column.defaultAggregationType;
      }
    }
    return result;
  });
  return { ...f, fields, source };
}

describe('GA4 source description and specification', () => {
  it('exports only the supported GA4 identity and describes its source without raw native metadata', async () => {
    const f = setup();
    f.source.blocks[0].connectorBlockConfig.connectorConfig.googleAnalyticsConnectorConfig.meta = { propertyName: 'Internal property title', tokenHint: 'fake-private-value' };
    const { spec, text } = await f.exportSpec();
    expect(spec.data_sources).toEqual([{ name: 'Metrics', connector: 'ga4', account_id: '123456', property_id: '789012' }]);
    expect(text).not.toMatch(/fake-private-value|tokenHint|Internal property title|googleAnalyticsConnectorConfig/);
    const listed = resultText(await f.add('datasource_list', { fields: true }));
    expect(listed).toContain('Google Analytics 4, account 123456, property 789012');
    expect(listed).toMatch(/aggregation auto/i);
    expect(listed).not.toMatch(/fake-private-value|tokenHint/);
    expect(f.writes()).toEqual([]);
  });

  it.each([
    { isEnhanced: false, viewId: '123' },
    { isEnhanced: true, viewId: '123' },
    { isEnhanced: true, analyticsSegment: 'sessions::condition::source==example' },
    { isEnhanced: true, unknownOption: true },
    { isEnhanced: true, propertyId: 'UA-123456-1' },
  ])('reports unsupported or legacy Analytics configuration instead of dropping settings silently: %j', async extra => {
    const f = setup();
    Object.assign(f.source.blocks[0].connectorBlockConfig.connectorConfig.googleAnalyticsConnectorConfig, extra);
    const { spec, text } = await f.exportSpec();
    expect(spec.data_sources).toEqual([]);
    expect(text).toMatch(/not a reproducible GA4.*source was omitted/);
    expect(f.writes()).toEqual([]);
  });

  it('rejects opaque connector-level options rather than re-exporting a narrower GA4 source', async () => {
    const f = setup();
    f.source.blocks[0].connectorBlockConfig.connectorConfig.parameterConfiguration = { unknownScope: true };
    const { spec, text } = await f.exportSpec();
    expect(spec.data_sources).toEqual([]); expect(text).toContain('source was omitted');
  });

  it('recreates the GA4 source and chart while keeping a preaggregated metric free of SUM', async () => {
    const f = setup();
    await f.add('chart_add', { type: 'time_series', dimensions: ['Date'], metrics: [{ field: 'Active users' }], date_range_dimension: 'Date', date_range: '2026-11-01..2026-11-03' });
    const { spec } = await f.exportSpec();
    expect(spec.pages[0].components[0].metrics).toEqual([{ field: 'Active users' }]);
    f.clear();
    await f.run('report_spec_apply', { spec, name: 'GA4 roundtrip' });
    const made = f.sent('createBlockDatasource')[0]!.body.datasource.blocks[0].connectorBlockConfig.connectorConfig;
    expect(made).toEqual(config());
    const recreated = f.reports[CREATED]!.page.flatMap(p => p.page.componentConfig ?? []);
    expect(recreated).toHaveLength(1);
    const definition = (recreated[0]!.conceptDefs as Json[]).find(d => d.queryTimeTransformation?.dataTransformation?.sourceFieldName === 'activeUsers')!;
    expect(definition.queryTimeTransformation.dataTransformation.aggregation).toBeUndefined();
    const after = await f.exportSpec({ report_id: CREATED });
    expect(after.spec.data_sources).toEqual(spec.data_sources);
    expect(after.spec.pages[0].components[0].metrics).toEqual(spec.pages[0].components[0].metrics);
    expect(f.bqCalls).toEqual([]);
  });

  it('refreshes GA4 fields through its adapter while preserving Auto and user fields', async () => {
    const f = setup();
    f.source.datasourceBlock.fields.push({ ...column('calc_twice', 'User calculation', 33), defaultAggregationType: 7, textFormula: 'activeUsers * 2' });
    f.fields.push({ ...column('screenPageViews', 'Views', 33), defaultAggregationType: 7 });
    await f.add('datasource_refresh', { name: 'ds1' });
    const request = f.sent('getColumns')[0]!.body;
    expect(request.isBigQueryConnection).toBe(false);
    expect(request.connectorBlockConfig.connectorConfig).toEqual(config());
    const fields = f.sources[SOURCE]!.block.datasourceBlock.fields as Json[];
    expect(fields.find(field => field.field.name === 'activeUsers')!.defaultAggregationType).toBe(7);
    expect(fields.find(field => field.field.name === 'screenPageViews')!.defaultAggregationType).toBe(7);
    expect(fields.find(field => field.field.name === 'calc_twice')!.textFormula).toBe('activeUsers * 2');
    expect(f.sent('publishDatasource')).toHaveLength(1);
    expect(f.bqCalls).toEqual([]);
  });
});
