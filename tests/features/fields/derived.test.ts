import { describe, expect, it } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { fake, input, writes } from './fake.js';

describe('calculated source fields', () => {
  it('field.calculated.add validates then appends the server column and preserves existing fields', async () => {
    const f = fake(), before = structuredClone(f.fields());
    await runTool(f.ctx, 'calculated_field_add', { ...input, name: '  ratio  ', formula: '  SUM(pageviews)/SUM(sessions)  ' });
    const names = f.calls.map((c) => c.endpoint);
    expect(names.indexOf('validateFormula')).toBeLessThan(names.indexOf('publishDatasource'));
    expect(f.fields().slice(0, -1)).toEqual(before);
    expect(f.fields().at(-1)).toMatchObject({ field: { ns: 't0', name: expect.stringMatching(/^calc_/) }, outputName: 'ratio', textFormula: 'SUM(pageviews)/SUM(sessions)', frontendTextFormula: 'SUM(pageviews)/SUM(sessions)', dataType: 5, custom: { preserved: true } });
    const request = f.calls.find((c) => c.endpoint === 'validateFormula')!.body;
    expect(request).toMatchObject({ detectDatatype: true, allowAutoDetectInFormula: true, dataRequest: { datasetSpec: { queryFields: [{ dataTransformation: { sourceType: 1, textFormula: 'SUM(pageviews)/SUM(sessions)' } }] } } });
    expect(request.dataRequest.datasetSpec.queryFields[0].dataTransformation.aggregation).toBeUndefined();
  });
  it('field.calculated.add preserves aggregate metric Auto when validation omits it', async () => {
    const f = fake({ formulaColumn: { conceptType: 1, type: 6, dataType: 3 } });
    await runTool(f.ctx, 'calculated_field_add', { ...input, name: 'Selected total', formula: 'SUM(CASE WHEN sessions > 0 THEN sessions ELSE 0 END)' });
    expect(f.fields().at(-1)).toMatchObject({ type: 6, defaultAggregationType: 7 });
  });
  it('field.calculated.add retries unresolved source calculations using their canonical IDs', async () => {
    const f = fake({ formulaResponse: body => body.dataRequest.datasetSpec.queryFields[0].dataTransformation.textFormula === 'n2 * 2'
      ? 'UNKNOWN' : { column: { dataType: 3, conceptType: 1 } } });
    f.fields().push({ ...structuredClone(f.fields().find(field => field.outputName === 'sessions')!), field: { ns: 't0', name: 'calc_previous' }, outputName: 'n2', textFormula: 'sessions * 2' });
    await runTool(f.ctx, 'calculated_field_add', { ...input, name: 'n4', formula: 'n2 * 2' });
    expect(f.calls.filter(call => call.endpoint === 'validateFormula').map(call => call.body.dataRequest.datasetSpec.queryFields[0].dataTransformation.textFormula)).toEqual(['n2 * 2', 't0.calc_previous * 2']);
    expect(f.fields().at(-1)).toMatchObject({ textFormula: 't0.calc_previous * 2', frontendTextFormula: 't0.calc_previous * 2' });
    expect(f.calls.filter(call => call.endpoint === 'publishDatasource')).toHaveLength(1);
  });
  it('field.calculated.add returns the validation error without publishing', async () => {
    const f = fake({ formulaError: 'Column not found: pageview' });
    await expect(runTool(f.ctx, 'calculated_field_add', { ...input, name: 'ratio', formula: 'pageview' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Column not found: pageview') });
    expect(writes(f)).toHaveLength(0);
  });
  it.each([{ name: '  ', formula: '1' }, { name: 'x', formula: '  ' }])('field.calculated.add rejects blank input %j before reads', async (args) => {
    const f = fake();
    await expect(runTool(f.ctx, 'calculated_field_add', { ...input, ...args })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('field.calculated.add rejects an existing name', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'calculated_field_add', { ...input, name: 'sessions', formula: '1' })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
});

const group = { ...input, field: 'device_category', name: 'Device group', groups: [{ name: 'Mobile', values: ['mobile', 'tablet'] }, { name: 'Desktop', condition: 'equals', values: ['desktop'] }] };
describe('bucketed fields', () => {
  it.each([
    { id: 'field.group.add', groups: [{ name: 'Selected', values: ['a', 'b'] }] },
    { id: 'field.group.exclude', groups: [{ name: 'Outside', values: ['a'], exclude: true }] },
    { id: 'field.group.other_bucket', groups: [{ name: 'Selected', values: ['a'] }], other_group: 'Remaining' },
  ])('$id uses the source field ID in validation and both persisted formulas', async (spec) => {
    const f = fake();
    const original = f.fields().find((field) => field.dataType === 0)!;
    original.field.name = '_segment_'; original.outputName = 'Segment label';
    await runTool(f.ctx, 'group_field_add', { ...input, field: 'Segment label', name: 'Segment groups', groups: spec.groups, ...('other_group' in spec ? { other_group: spec.other_group } : {}) });
    const transformation = f.calls.find((call) => call.endpoint === 'validateFormula')!.body.dataRequest.datasetSpec.queryFields[0].dataTransformation;
    expect(transformation).toMatchObject({ sourceType: 1, textFormula: '_segment_', bucketedFieldConfig: { sourceField: '_segment_' } });
    expect(f.fields().at(-1)).toMatchObject({ textFormula: '_segment_', frontendTextFormula: '_segment_', bucketedFieldConfig: { sourceField: '_segment_' } });
  });

  it('field.group.add writes ordered buckets with default condition and keeps the source', async () => {
    const f = fake(), before = structuredClone(f.fields());
    await runTool(f.ctx, 'group_field_add', group);
    expect(f.fields().slice(0, -1)).toEqual(before);
    const bucket = { sort: 1, sourceField: '_device_category_', customGroups: { buckets: [
      { id: 0, displayName: 'Mobile', filterConfig: { include: true, values: ['mobile', 'tablet'], filterConditionType: 15 } },
      { id: 1, displayName: 'Desktop', filterConfig: { include: true, values: ['desktop'], filterConditionType: 1 } },
    ] } };
    expect(f.fields().at(-1)).toMatchObject({ outputName: 'Device group', textFormula: before.find((field) => field.outputName === group.field)!.field.name, bucketedFieldConfig: bucket });
    expect(f.calls.find((c) => c.endpoint === 'validateFormula')!.body.dataRequest.datasetSpec.queryFields[0].dataTransformation.bucketedFieldConfig).toEqual(bucket);
  });
  it('field.group.add keeps both between endpoints', async () => {
    const f = fake();
    await runTool(f.ctx, 'group_field_add', { ...group, field: 'sessions', groups: [{ name: 'Mid', condition: 'between', values: [10, 100] }] });
    expect(f.fields().at(-1)!.bucketedFieldConfig.customGroups.buckets[0].filterConfig).toEqual({ include: true, values: [10, 100], filterConditionType: 5 });
  });
  it.each([
    ['equals', []], ['equals', ['a', 'b']], ['between', [1]], ['is_null', ['a']], ['in', []], ['unknown', ['a']],
  ])('field.group.add rejects condition %s with %j', async (condition, values) => {
    const f = fake();
    await expect(runTool(f.ctx, 'group_field_add', { ...group, groups: [{ name: 'Bad', condition, values }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('field.group.exclude flips include and accepts editor labels', async () => {
    const f = fake();
    await runTool(f.ctx, 'group_field_add', { ...group, groups: [{ name: 'Other', condition: 'Contains', values: ['mob'], exclude: true }] });
    expect(f.fields().at(-1)!.bucketedFieldConfig.customGroups.buckets[0].filterConfig).toEqual({ include: false, values: ['mob'], filterConditionType: 2 });
  });
  it('field.group.other_bucket appends the remaining group last and omits it otherwise', async () => {
    const f = fake();
    await runTool(f.ctx, 'group_field_add', { ...group, other_group: 'Other' });
    expect(f.fields().at(-1)!.bucketedFieldConfig.customGroups.buckets.at(-1)).toEqual({ id: 2, displayName: 'Other', isRemainingValues: true });
    const g = fake(); await runTool(g.ctx, 'group_field_add', group);
    expect(g.fields().at(-1)!.bucketedFieldConfig.customGroups.buckets).toHaveLength(2);
  });
  it('field.bin.add writes the interval config and resolves field ids', async () => {
    const f = fake();
    const result = await runTool(f.ctx, 'bin_field_add', { ...input, name: 'Session bins', field: '_sessions_', size: 100, min: 0, max: 500 });
    expect(resultText(result)).toContain('Session bins');
    expect(f.fields().at(-1)!.bucketedFieldConfig).toEqual({ sort: 0, sourceField: '_sessions_', uniformBinConfig: { labelType: 1, min: 0, max: 500, size: 100, binRemaining: true } });
    expect(f.calls.some((c) => c.endpoint === 'batchedDataV2')).toBe(false);
  });
  it.each([0, -5])('field.bin.add rejects size %d without reads', async (size) => {
    const f = fake();
    await expect(runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('field.bin.add rejects text fields without publishing', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'device_category', size: 100 })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('field.bin.range reads only a missing maximum', async () => {
    const f = fake({ max: 4321 });
    await runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size: 100, min: 0 });
    expect(f.fields().at(-1)!.bucketedFieldConfig.uniformBinConfig).toMatchObject({ min: 0, max: 4321 });
    const calls = f.calls.filter((c) => c.endpoint === 'batchedDataV2');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.dataRequest[0].datasetSpec.queryFields[0].dataTransformation).toMatchObject({ sourceFieldName: '_sessions_', aggregation: 4 });
  });
  it('field.bin.range reads MIN and MAX when neither is given', async () => {
    const f = fake({ min: 10, max: 500 });
    await runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size: 100 });
    expect(f.fields().at(-1)!.bucketedFieldConfig.uniformBinConfig).toMatchObject({ min: 10, max: 500 });
  });
  it('field.bin.range gives a constant column one interval without overriding explicit limits', async () => {
    const f = fake({ min: 3, max: 3 });
    await runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size: 5 });
    expect(f.fields().at(-1)!.bucketedFieldConfig.uniformBinConfig).toMatchObject({ min: 3, max: 8, size: 5 });
    const fixed = fake({ min: 3, max: 3 });
    await expect(runTool(fixed.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size: 5, max: 3 })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(fixed)).toEqual([]);
  });
  it('field.bin.range rejects reversed bounds before any request', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'bin_field_add', { ...input, name: 'Bins', field: 'sessions', size: 100, min: 1000, max: 10 })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
});
