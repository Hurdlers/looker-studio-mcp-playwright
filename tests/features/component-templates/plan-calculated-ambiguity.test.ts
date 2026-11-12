import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { ambiguousFieldReferences, canonicalFieldFormula } from '../../../src/features/fields/parameter-reference.js';
import { resolveSource } from '../../../src/core/datasource.js';
import { column, fake, ORIGINAL, SOURCE } from '../spec/fake.js';

function setup() {
  const f = fake({ snapshots: true });
  f.original.shareable.name = '[looker-studio-mcp-lab-1] calculated preparation';
  f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_other_value_', 'VALUE', 33));
  return f;
}
const plan = { report_id: ORIGINAL, purpose: 'kpi', data_source: SOURCE,
  bindings: { metric: { field: 'New total', aggregation: 'sum' } } };

describe('calculated preparation field-name ambiguity', () => {
  it('refuses duplicated display-name references before remote formula validation or any write', async () => {
    const f = setup(), before = structuredClone(f.sources[SOURCE]);
    const out = JSON.parse(resultText(await f.run('component_template_plan', { ...plan, calculated_field: { name: 'New total', formula: 'value * 2' } })));
    expect(out.status).toBe('invalid');
    expect(out.preparation).toBeUndefined();
    expect(out.execution).toBeUndefined();
    expect(out.issues).toContainEqual(expect.objectContaining({ code: 'ambiguous_formula_field', candidates: [
      { id: '_value_', name: 'value' }, { id: '_other_value_', name: 'VALUE' },
    ] }));
    expect(f.calls.some(call => call.endpoint === 'validateFormula')).toBe(false);
    expect(f.calls.some(call => call.endpoint === 'getFirstPartyAccessToken')).toBe(false);
    expect(f.writes()).toEqual([]);
    expect(f.sources[SOURCE]).toEqual(before);
  });

  it.each(['t0._value_ * 2', '_other_value_ * 2', "CASE WHEN category = 'value' THEN t0._value_ ELSE 0 END /* VALUE */", 't0._value_ + 1 -- value\n'])('accepts explicit IDs and ignores names in literals or comments: %s', async formula => {
    const f = setup();
    const out = JSON.parse(resultText(await f.run('component_template_plan', { ...plan, calculated_field: { name: 'New total', formula } })));
    expect(out.status).toBe('needs_preparation');
    expect(out.issues).toEqual([]);
    expect(f.calls.some(call => call.endpoint === 'validateFormula')).toBe(true);
    expect(f.calls.some(call => call.endpoint === 'getFirstPartyAccessToken')).toBe(false);
    expect(f.writes()).toEqual([]);
  });

  it('uses whole known references, skipping functions and other namespaces', async () => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_sum1_', 'sum', 33), column('_sum2_', 'SUM', 33), column('_net_', 'Net value', 33));
    const source = await resolveSource(f.ctx.rap, f.original, SOURCE);
    expect(ambiguousFieldReferences(source, 'SUM(t0._value_) + Net value + t1.value + \uE000value')).toEqual([]);
    expect(ambiguousFieldReferences(source, 'SUM + VALUE + t0.value')).toEqual(['sum', 'value']);
  });

  it.each(['_value_', 't0._value_'])('refuses an ID/name overlap before the fallback can redirect %s', async ref => {
    const f = setup();
    f.sources[SOURCE]!.block.datasourceBlock.fields.push(column('_shadow_', '_value_', 33));
    const source = await resolveSource(f.ctx.rap, f.original, SOURCE);
    // The standalone tool's existing fallback demonstrates the collision.
    expect(canonicalFieldFormula(source, `${ref} * 2`)).toBe('t0._shadow_ * 2');
    const out = JSON.parse(resultText(await f.run('component_template_plan', { ...plan, calculated_field: { name: 'New total', formula: `${ref} * 2` } })));
    expect(out.status).toBe('invalid');
    expect(out.preparation).toBeUndefined();
    expect(out.issues).toContainEqual(expect.objectContaining({ code: 'ambiguous_formula_field', candidates: [
      { id: '_value_', name: 'value' }, { id: '_shadow_', name: '_value_' },
    ] }));
    expect(f.calls.some(call => call.endpoint === 'validateFormula')).toBe(false);
    expect(f.writes()).toEqual([]);
  });
});
