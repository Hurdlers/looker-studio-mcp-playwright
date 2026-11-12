import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, column, fake, type Json } from './fake.js';

describe('GA4 source names in composed specifications', () => {
  it.each([
    [{}, 'Google Analytics 4'],
    [{ source_name: 'Chosen GA4' }, 'Chosen GA4'],
  ])('uses the created source name for field overrides and inferred grouped bindings: %j', async (nameInput, expectedName) => {
    const f = fake({ columns: [column('date', 'Date', 2), { ...column('activeUsers', 'Active users', 33), defaultAggregationType: 7 }] });
    const spec = { version: 1, name: 'GA4 specification', data_sources: [{
      connector: 'ga4', account_id: '123456', property_id: '789012', ...nameInput as Json,
      field_overrides: [{ field: 'Active users', name: 'Visitors' }],
    }], pages: [{ name: 'Overview', components: [{ component: 'chart', type: 'scorecard', metrics: [{ field: 'Visitors' }] }], groups: [{ key: 'summary', components: [0] }] }] };
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    expect(resultText(applied)).not.toMatch(/failed|not found/i);
    expect(f.sent('createBlockDatasource')[0]!.body.name).toBe(expectedName);
    const sourceId = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    const fields = f.sources[sourceId]!.block.datasourceBlock.fields as Json[];
    expect(fields.find(field => field.field.name === 'activeUsers')!.outputName).toBe('Visitors');
    const page = f.reports[CREATED]!.page[0]!;
    expect(page.page.componentConfig).toHaveLength(1);
    expect(page.page.groupConfig).toHaveLength(1);
    expect(page.page.componentConfig![0]!.datasourceId).toBe(sourceId);
    expect(f.bqCalls).toEqual([]);
  });
});
