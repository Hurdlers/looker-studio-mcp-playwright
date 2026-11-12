import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, ORIGINAL, SOURCE, specification, type Json } from './fake.js';

const native = JSON.parse(readFileSync(new URL('../../../fixtures/spec/native-roundtrip.json', import.meta.url), 'utf8'));
function setup() {
  const columns = native.connector_fields.flatMap((field: Json) => [field, { ...field, columnType: 1, field: field.mutableVersion, immutableVersion: field.field, createdBy: 1 }]);
  const f = fake({ columns, formulaResponse: (body) => {
    const query = body.dataRequest.datasetSpec, expression = query.queryFields[0].dataTransformation.textFormula;
    const fields = f.sources[query.dataset[0].datasourceId]?.block.datasourceBlock.fields ?? [];
    if (expression.includes('Segment') && !fields.some((field: Json) => field.outputName === 'Segment')) return 'UNKNOWN';
    return { column: { ...native.source_fields[3], field: { name: 'validated' } } };
  } });
  f.sources[SOURCE]!.block.datasourceBlock.fields = structuredClone(native.source_fields);
  f.sources[SOURCE]!.block.blocks[0].fields = structuredClone(native.connector_fields);
  return f;
}

describe('portable source field overrides', () => {
  it('renames physical fields before validating calculations that use their restored aliases', async () => {
    const f = setup(), field = f.sources[SOURCE]!.block.datasourceBlock.fields[3];
    field.textFormula = field.frontendTextFormula = 'COUNT_DISTINCT(t0._category_)';
    const { spec } = await f.exportSpec();
    expect(spec.calculated_fields[0].formula).toBe('COUNT_DISTINCT(Segment)');
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    const validation = f.calls.findIndex((call) => call.endpoint === 'validateFormula');
    const prior = f.calls.slice(0, validation).filter((call) => call.endpoint === 'publishDatasource');
    expect(prior.at(-1)!.body.draft.datasourceBlock.fields.some((field: Json) => field.outputName === 'Segment')).toBe(true);
    const sourceId = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    expect(f.sources[sourceId]!.block.datasourceBlock.fields.find((field: Json) => field.outputName === 'Total').textFormula).toBe('COUNT_DISTINCT(Segment)');
  });

  it('keeps an existing source unchanged and reports differing overrides', async () => {
    const f = setup(), before = structuredClone(f.sources[SOURCE]);
    const spec = specification(); (spec.data_sources[0] as Json).field_overrides = [{ field: 'category', name: 'Changed' }];
    const out = await f.run('report_spec_apply', { report_id: ORIGINAL, spec });
    expect(resultText(out)).toContain('differing field overrides were left unchanged');
    expect(f.sources[SOURCE]).toEqual(before);
    expect(f.sent('publishDatasource')).toHaveLength(0);
  });

  it('does not warn about existing overrides that already match', async () => {
    const f = setup(); const { spec } = await f.exportSpec();
    const out = await f.run('report_spec_apply', { report_id: ORIGINAL, spec });
    expect(resultText(out)).not.toContain('differing field overrides'); expect(f.sent('publishDatasource')).toHaveLength(0);
  });

  it.each([
    [{ field: '', name: 'Label' }], [{ field: 'value' }], [{ field: 'value', type: 'No such type' }],
    [{ field: 'value', aggregation: 'No such aggregation' }], [{ field: 'value', name: 'Value', raw_json: {} }],
  ])('rejects malformed source overrides before any write: %j', async (fields) => {
    const f = setup(), spec = specification(); (spec.data_sources[0] as Json).field_overrides = fields;
    await expect(f.run('report_spec_apply', { spec })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.writes()).toHaveLength(0);
  });

  it('reports unrepresentable source semantics with their exact configuration', async () => {
    const f = setup(), fields = f.sources[SOURCE]!.block.datasourceBlock.fields;
    fields[1].outputSemanticInfo.semanticConfig[0].currencyOptions.auto = true;
    fields[2].outputSemanticInfo.semanticConfig[0] = { semanticType: 999, unknownOptions: { mode: 4 } };
    const out = await f.exportSpec();
    expect(out.text).toContain('Metrics.value: semantic options {"currencyOptions":{"auto":true}}');
    expect(out.text).toContain('Metrics.Day: semanticType 999 cannot be reproduced');
    expect(out.text).toContain('"unknownOptions":{"mode":4}');
  });

  it('preserves native date options when an explicit same-type override renames a newly connected field', async () => {
    const semantic = { semanticType: 2, dateTimeOptions: { useNativeDateTime: true } };
    const raw = { ...native.connector_fields[2], outputSemanticInfo: undefined };
    const output = { ...native.source_fields[2], outputName: 'day', outputSemanticInfo: { semanticConfig: [semantic] } };
    const f = fake({ columns: [raw, output] });
    f.sources[SOURCE]!.block.blocks[0].fields = [raw];
    f.sources[SOURCE]!.block.datasourceBlock.fields = [{ ...output, outputName: 'Day' }];
    const { spec, text } = await f.exportSpec();
    expect(spec.data_sources[0].field_overrides).toEqual([{ field: 'day', name: 'Day', type: 'Date' }]);
    expect(text).toContain('"dateTimeOptions":{"useNativeDateTime":true}');
    const out = await f.run('report_spec_apply', { spec }); expect(out.isError, resultText(out)).toBe(false);
    const sourceId = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    expect(f.sources[sourceId]!.block.datasourceBlock.fields[0]).toMatchObject({ outputName: 'Day', outputSemanticInfo: { semanticConfig: [semantic] } });
  });
});
