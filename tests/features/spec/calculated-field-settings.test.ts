import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { specToActions } from '../../../src/features/spec/plan.js';
import { CREATED, SOURCE, column, fake, specification, type Json } from './fake.js';

describe('calculated field settings in specifications', () => {
  it('restores a COUNT metric as KRW currency while retaining automatic aggregation', async () => {
    const f = fake({ formulaResponse: () => ({ column: { ...column('validated', 'Amount', 33), conceptType: 1, defaultAggregationType: 7 } }) });
    await f.add('calculated_field_add', { name: 'Amount', formula: 'COUNT(category)' });
    await f.add('field_update', { field: 'Amount', type: 'Currency > KRW' });
    const { spec } = await f.exportSpec();
    expect(spec.calculated_fields).toEqual([{ name: 'Amount', formula: 'COUNT(category)', type: 'Currency > KRW' }]);
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).toBe(false);
    const id = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    const amount = f.sources[id]!.block.datasourceBlock.fields.find((field: Json) => field.outputName === 'Amount');
    expect(amount).toMatchObject({ defaultAggregationType: 7, outputSemanticInfo: { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'KRW' } }] } });
    expect((await f.exportSpec({ report_id: CREATED })).spec.calculated_fields).toEqual(spec.calculated_fields);
  });

  it.each(['Percent', 'Number'])('preserves %s and an explicit average for a row-level calculation', async (type) => {
    const f = fake();
    await f.add('calculated_field_add', { name: 'Ratio', formula: 'value / 100' });
    await f.add('field_update', { field: 'Ratio', type, aggregation: 'avg' });
    const { spec } = await f.exportSpec();
    expect(spec.calculated_fields).toEqual([{ name: 'Ratio', formula: 'value / 100', type, aggregation: 'avg' }]);
    const applied = await f.run('report_spec_apply', { spec });
    expect(applied.isError, resultText(applied)).toBe(false);
    expect((await f.exportSpec({ report_id: CREATED })).spec.calculated_fields).toEqual(spec.calculated_fields);
  });

  it('restores each calculation before a dependent calculation or chart is created', () => {
    const spec: Json = { ...specification(), report_components: [], calculated_fields: [
      { name: 'Amount', formula: 'COUNT(category)', type: 'Currency > KRW' },
      { name: 'Share', formula: 'Amount / 100', type: 'Percent' },
    ] };
    const plan = specToActions(spec as any, undefined, { fresh: true });
    const calculations = plan.actions.filter((action) => ['calculated_field_add', 'field_update'].includes(action.tool));
    expect(calculations.map((action) => [action.tool, action.args?.name ?? action.args?.field])).toEqual([
      ['calculated_field_add', 'Amount'], ['field_update', 'Amount'],
      ['calculated_field_add', 'Share'], ['field_update', 'Share'],
    ]);
    expect(calculations[0]!.args).not.toHaveProperty('type');
  });

  it.each([{ type: 'Unknown type' }, { aggregation: 'auto' }, { aggregation: 7 }])('rejects invalid calculation settings before any write: %j', async (settings) => {
    const f = fake();
    const spec = { ...specification(), calculated_fields: [{ name: 'Amount', formula: 'COUNT(category)', ...settings }] };
    await expect(f.run('report_spec_apply', { spec })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.writes()).toEqual([]);
    expect(f.sources[SOURCE]).toBeDefined();
  });
});
