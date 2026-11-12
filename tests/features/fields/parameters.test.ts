import { describe, expect, it } from 'vitest';

import { runTool } from '../../../src/core/tool.js';
import { A, fake, input, writes } from './fake.js';

const args = { ...input, name: 'Target', id: 'target_value' };
describe('data source parameters', () => {
  it('parameter.add preserves resources and appends a text parameter with both roles', async () => {
    const f = fake();
    f.published().resource = { keep: { nested: 'unchanged' }, parameterConfiguration: { keepConfig: true, parameters: [{ key: 'existing', value: {} }] } };
    await runTool(f.ctx, 'parameter_add', args);
    expect(f.parameters()).toHaveLength(2);
    const p = f.parameters()[1];
    expect(p.key).toBe('target_value');
    expect(p.value.parameterDisplayConfiguration).toEqual({ name: 'target_value', displayName: 'Target', displayType: 1 });
    expect(p.value.parametersModifiedByRoles).toEqual([1, 2].map((key) => ({ key, value: { name: 'target_value', dataType: 1, options: [], defaultValue: [], lock: 2 } })));
    expect(f.published().resource.keep).toEqual({ nested: 'unchanged' });
    expect(f.published().resource.parameterConfiguration.keepConfig).toBe(true);
    expect(f.parameters()[0]).toEqual({ key: 'existing', value: {} });
  });
  it.each(['1abc', 'a-b', 'DS_X'])('parameter.add rejects invalid id %s before reads', async (id) => {
    const f = fake();
    await expect(runTool(f.ctx, 'parameter_add', { ...args, id })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('parameter.add requires a source when several exist', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'parameter_add', { report_id: args.report_id, name: args.name })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/ds1.*ds2/) });
    expect(writes(f)).toHaveLength(0);
  });
  it('parameter.add accepts an omitted source when unique and generates a valid id', async () => {
    const f = fake({ oneSource: true });
    await runTool(f.ctx, 'parameter_add', { report_id: args.report_id, name: '목표 값' });
    expect(f.parameters()[0].key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(f.calls.find((c) => c.endpoint === 'publishDatasource')!.body.draft.datasourceId).toBe(A);
  });
  it.each([['Number (whole)', 4, 100], ['Number (decimal)', 3, 1.5], ['Boolean', 2, false], ['Text', 1, 'hi']])('parameter.data_type serializes %s for both roles', async (data_type, code, default_value) => {
    const f = fake();
    await runTool(f.ctx, 'parameter_add', { ...args, data_type, default_value });
    for (const role of f.parameters()[0].value.parametersModifiedByRoles) expect(role.value.dataType).toBe(code);
    expect(f.parameters()[0].value.parametersModifiedByRoles[0].value.defaultValue[0]).toEqual(code === 2 ? { label: String(default_value), boolValue: default_value } : { label: String(default_value), stringValue: String(default_value) });
  });
  it('parameter.values writes list options and list display', async () => {
    const f = fake();
    await runTool(f.ctx, 'parameter_add', { ...args, values: ['mobile', 'desktop'] });
    const value = f.parameters()[0].value;
    expect(value.parametersModifiedByRoles[0].value.options).toEqual([{ label: 'mobile', stringValue: 'mobile' }, { label: 'desktop', stringValue: 'desktop' }]);
    expect(value.parameterDisplayConfiguration.displayType).toBe(2);
  });
  it('parameter.values omits restrictions by default', async () => {
    const f = fake(); await runTool(f.ctx, 'parameter_add', args);
    expect(f.parameters()[0].value.parametersModifiedByRoles[0].value.options).toEqual([]);
  });
  it('parameter.default stores a permitted text default', async () => {
    const f = fake();
    await runTool(f.ctx, 'parameter_add', { ...args, values: ['mobile', 'desktop'], default_value: 'desktop' });
    expect(f.parameters()[0].value.parametersModifiedByRoles[0].value.defaultValue).toEqual([{ label: 'desktop', stringValue: 'desktop' }]);
  });
  it.each([{ values: ['mobile', 'desktop'], default_value: 'tablet' }, { data_type: 'Number (whole)', default_value: 'abc' }, { data_type: 'Number (whole)', default_value: 1.5 }, { data_type: 'Boolean', values: ['true'] }])('parameter.default rejects incompatible values %j', async (extra) => {
    const f = fake();
    await expect(runTool(f.ctx, 'parameter_add', { ...args, ...extra })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('parameter.add rejects duplicate ids', async () => {
    const f = fake(); await runTool(f.ctx, 'parameter_add', args);
    await expect(runTool(f.ctx, 'parameter_add', args)).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(1);
  });
});
