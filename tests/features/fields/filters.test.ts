import { describe, expect, it } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { fake, input, writes } from './fake.js';

const args = { report_id: input.report_id, name: 'Only mobile', action: 'edit' };
const entry = (f: ReturnType<typeof fake>) => f.resource().filter.entry.find((e: any) => e.key === 'filterA');
const expression = (f: ReturnType<typeof fake>) => entry(f).value.filterDefinition.filterExpression;
const clause = (value: string) => ({ field: 'device_category', condition: 'equals', values: [value] });
describe('saved filters', () => {
  it('filter.edit replaces conditions while keeping the resource key, other filters and chart references', async () => {
    const f = fake(), other = structuredClone(f.resource().filter.entry[1]);
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, field: 'device_category', condition: 'in', values: ['mobile', 'tablet'] } });
    expect(entry(f).value.name).toBe(args.name);
    expect(expression(f)).toMatchObject({ filterConditionType: 'IN', stringValues: ['mobile', 'tablet'], include: true });
    expect(f.resource().filter.entry[1]).toEqual(other);
    expect((f.report.page[0]!.page.componentConfig![0] as any).propertyConfig.componentProperty.filters).toEqual(['filterA', 'filterB']);
  });
  it('filter.edit rejects missing filter input before reading', async () => {
    const f = fake(); await expect(runTool(f.ctx, 'report_filter_edit', args)).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('filter.edit reports existing names for a missing filter', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, name: 'Nope', filter: { name: 'New' } })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('Only mobile') });
    expect(writes(f)).toHaveLength(0);
  });
  it('filter.edit.rename preserves all original conditions', async () => {
    const f = fake(), definition = structuredClone(entry(f).value.filterDefinition);
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: 'Mobile only' } });
    expect(entry(f).value.name).toBe('Mobile only'); expect(entry(f).value.filterDefinition).toEqual(definition);
  });
  it('filter.edit.rename skips a save if the name and conditions have not changed', async () => {
    const f = fake();
    expect(resultText(await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name } }))).toContain('Nothing changed');
    expect(writes(f)).toHaveLength(0);
  });
  it('filter.edit.rename requires filter.name', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, filter: { field: 'device_category', condition: 'equals', values: ['mobile'] } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('filter.edit.condition handles exclusion and editor labels', async () => {
    const f = fake();
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, field: 'device_category', condition: 'starts_with', values: ['mob'], exclude: true } });
    expect(expression(f)).toMatchObject({ filterConditionType: 'BW', stringValues: ['mob'], include: false, queryTimeTransformation: { dataTransformation: { sourceFieldName: '_device_category_' } } });
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, field: 'device_category', condition: 'Contains', values: ['mob'] } });
    expect(expression(f).filterConditionType).toBe('PT');
  });
  it.each([{ field: 'device_category' }, { condition: 'equals', values: ['x'] }, { field: 'device_category', condition: 'is_null', values: ['x'] }])('filter.edit.condition rejects incomplete or excessive values %j', async (extra) => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, ...extra } })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('filter.edit.clauses keeps AND around ordered OR groups', async () => {
    const f = fake();
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, clauses: [[clause('mobile'), clause('tablet')], [{ field: 'session_medium', condition: 'contains', values: ['organic'] }]] } });
    const list = entry(f).value.filterDefinition.and.filterDefinitions;
    expect(list[0].or.filterDefinitions.map((d: any) => d.filterExpression.stringValues[0])).toEqual(['mobile', 'tablet']);
    expect(list[1].filterExpression).toMatchObject({ filterConditionType: 'PT', stringValues: ['organic'] });
  });
  it('filter.edit.clauses collapses a single group and clause', async () => {
    const f = fake();
    await runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, clauses: [[clause('mobile')]] } });
    expect(expression(f).filterConditionType).toBe('EQ');
  });
  it.each([{ field: 'device_category', clauses: [[clause('mobile')]] }, { clauses: [[]] }])('filter.edit.clauses rejects mixed or empty groups %j', async (extra) => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, filter: { name: args.name, ...extra } })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('filter.duplicate copies the full definition and source under a new key and reports its name', async () => {
    const f = fake(), original = structuredClone(entry(f));
    const result = await runTool(f.ctx, 'report_filter_edit', { ...args, action: 'duplicate' });
    const copy = f.resource().filter.entry[2];
    expect(f.resource().filter.entry).toHaveLength(3); expect(copy.key).toMatch(/^filter[a-z0-9]{10}$/);
    expect(copy.value.filterDefinition).toEqual(original.value.filterDefinition); expect(copy.value.datasourceId).toBe(original.value.datasourceId);
    expect(resultText(result)).toContain(copy.value.name);
  });
  it.each(['duplicate', 'delete'])('filter.duplicate/filter.delete rejects filter input on %s', async (action) => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, action, filter: { name: 'Ignored' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('filter.delete removes the saved filter and references on charts, pages and report components', async () => {
    const f = fake();
    await runTool(f.ctx, 'report_filter_edit', { ...args, action: 'delete' });
    expect(f.resource().filter.entry.map((e: any) => e.key)).toEqual(['filterB']);
    expect((f.report.page[0]!.page.componentConfig![0] as any).propertyConfig.componentProperty.filters).toEqual(['filterB']);
    expect((f.report.page[0]!.page.propertyConfig as any).pageProperty.filters).toEqual([]);
    expect((f.report.report.propertyConfig as any).reportProperty.filters).toEqual(['filterB']);
    expect((f.report.report.componentConfig![0] as any).propertyConfig.componentProperty.filters).toEqual([]);
    expect(writes(f).map((c) => c.endpoint)).toEqual(['updatePage', 'updateReport']);
  });
  it('filter.delete reports a missing filter without any save', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, action: 'delete', name: 'Nope' })).rejects.toMatchObject({ code: 'not_found' });
    expect(writes(f)).toHaveLength(0);
  });
  it('filter.delete restores page references if saving the report fails', async () => {
    const f = fake({ failReport: true }), before = structuredClone(f.report.page);
    await expect(runTool(f.ctx, 'report_filter_edit', { ...args, action: 'delete' })).rejects.toThrow('report save failed');
    expect(f.report.page[0]!.page).toEqual(before[0]!.page);
    expect(entry(f)).toBeDefined();
  });
});
