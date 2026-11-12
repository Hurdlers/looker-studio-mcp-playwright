import { describe, expect, it } from 'vitest';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const recipe = { report_id: ORIGINAL, template_id: 'common-category-line', data_source: 'Metrics',
  date_range: '2026-11-01..2026-11-03', bindings: { dimension: 'day', date: 'day', metric: { field: 'value', aggregation: 'sum' as const } } };
function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] category labels'; return f; }
const semantics = ({ style: _style, position: _position, ...data }: Record<string, unknown>) => data;
describe('explicit category line values', () => {
  it('changes only label presentation and keeps category/date/aggregation/sort contracts', () => {
    const legacy = commonChartArgs(recipe), labels = commonChartArgs({ ...recipe, common_options: { show_values: true } });
    expect(semantics(labels.args)).toEqual(semantics(legacy.args));
    expect(labels.args).toMatchObject({ type: 'line', dimensions: ['day'], metrics: [{ field: 'value', aggregation: 'sum' }], date_range: recipe.date_range, date_range_dimension: 'day' });
    expect(labels.args).not.toHaveProperty('sorts');
    expect(legacy.args).not.toHaveProperty('sort_by');
    expect(legacy.args).not.toHaveProperty('sort_ascending');
    expect(labels.args.style).toMatchObject({ 'Show data labels': true, 'Show points': true });
    expect(legacy.args.style).toHaveProperty('Show data labels', false);
    expect(commonChartArgs({ ...recipe, common_options: { show_values: false } }).args.style).toMatchObject({ 'Show data labels': false, 'Show points': false });
    expect(labels.notes.some(note => note.includes('범주 순서'))).toBe(true);
    expect(labels.notes.some(note => note.includes('날짜 사이 간격') && note.includes('같은 간격'))).toBe(true);
  });
  it('public preview writes nothing and save enables values on native combo line series', async () => {
    const f = setup(), before = structuredClone(f.original), args = { ...recipe, common_options: { show_values: true } };
    const preview = await f.run('component_template_add', { ...args, preview: true });
    expect(preview.isError, resultText(preview)).toBeFalsy(); expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
    const result = await f.run('component_template_add', args);
    expect(result.isError, resultText(result)).toBeFalsy();
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.type).toBe('simple-combochart');
    const p = c.propertyConfig.componentProperty;
    expect(p.comboChartProperty.seriesProperty[0]).toMatchObject({ seriesType: 0, seriesShowDataLabel: true, seriesShowPoints: true });
    expect(p.dateDuration).toMatchObject({ startAnchor: '20261101', endAnchor: '20261103' });
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const baseline = setup(); await baseline.run('component_template_add', recipe);
    const b = baseline.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.conceptDefs.map((d: Json) => d.queryTimeTransformation)).toEqual(b.conceptDefs.map((d: Json) => d.queryTimeTransformation));
    expect(p.sort).toEqual(b.propertyConfig.componentProperty.sort);
    expect(p.dateDuration).toEqual(b.propertyConfig.componentProperty.dateDuration);
  });
  it.each(['ascending', 'descending'] as const)('explicitly sorts the category %s without changing values or query limits', async dimension_order => {
    const f = setup(), baseline = setup();
    const options = { show_values: true, dimension_order };
    const planned = commonChartArgs({ ...recipe, common_options: options }).args;
    const legacy = commonChartArgs({ ...recipe, common_options: { show_values: true } }).args;
    expect(planned.sort_by).toBe('day');
    expect(planned.sort_ascending).toBe(dimension_order === 'ascending');
    const { sort_by: _by, sort_ascending: _ascending, ...withoutSort } = semantics(planned);
    expect(withoutSort).toEqual(semantics(legacy));
    await f.run('component_template_add', { ...recipe, common_options: options });
    await baseline.run('component_template_add', { ...recipe, common_options: { show_values: true } });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    const b = baseline.original.page[0]!.page.componentConfig![0] as Json;
    const p = c.propertyConfig.componentProperty, bp = b.propertyConfig.componentProperty;
    const date = c.conceptDefs.find((d: Json) => d.queryTimeTransformation.dataTransformation.sourceFieldName === '_day_');
    expect(p.sort[0]).toEqual({ sortColumn: date.name, sortDir: dimension_order === 'ascending' ? 0 : 1 });
    expect(c.conceptDefs.map((d: Json) => d.queryTimeTransformation)).toEqual(b.conceptDefs.map((d: Json) => d.queryTimeTransformation));
    expect(p.row).toEqual(bp.row); expect(p.dateDuration).toEqual(bp.dateDuration);
  });
  it('does not extend team-v1 support to category lines', async () => {
    const f = setup();
    await expect(f.run('component_template_add', { ...recipe, common_options: { design_rules: 'team-v1', show_values: true } })).rejects.toThrow(/design_rules/);
    expect(f.writes()).toEqual([]);
  });
});
