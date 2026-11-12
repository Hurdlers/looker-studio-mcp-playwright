import { describe, expect, it } from 'vitest';
import { toMapValue } from '../../../src/core/mapvalue.js';
import { resultText, type Tool } from '../../../src/core/tool.js';
import { FEATURE_TOOLS } from '../../../src/features/registry.generated.js';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { planTablePresentation } from '../../../src/features/component-templates/table-presentation.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const theme = { background: '#FAFAFA', text: '#172B3A', accent: '#4C83D3', series: '#4C83D3', muted: '#64748B', activeText: '#FFFFFF', font: 'Tahoma' };
const darkTheme = { ...theme, background: '#18212A', text: '#F2F4F7', accent: '#8DBAFF', series: '#8DBAFF' };
const base = { report_id: ORIGINAL, template_id: 'common-detail-table', bindings: {
  dimension: 'category', date: 'day', metric: { field: 'value', aggregation: 'sum' as const, label: 'Count' },
}, date_range: '2026-11-01..2026-11-03', size: { width: 720, height: 280 } };
function setup(colors = theme, overrides: Tool[] = []) {
  const f = fake({ overrides }); f.original.shareable.name = '[looker-studio-mcp-lab-1] presentation fixture';
  f.original.report.propertyConfig = { reportProperty: { themeConfig: 'test-theme' } };
  (f.original.report.resource as Json).theme = { value: [toMapValue({ id: 'test-theme', content: {
    themeBackground: colors.background, themeFontColor: colors.text, themeAccentFillColor: colors.accent, themeFontFamily: colors.font,
  } })] };
  return f;
}
function chart(f: ReturnType<typeof fake>): Json {
  return f.original.page[0]!.page.componentConfig!.find(c => c.type === 'simple-table')!;
}
const tableStyle = (c: Json): Json => c.propertyConfig.componentProperty.tableProperty;
function analysis(c: Json) {
  const { tableProperty: _style, ...properties } = c.propertyConfig.componentProperty;
  const aliases = new Map(c.conceptDefs.flatMap((d: Json, i: number) => [[d.name, `concept-${i}`], [d.id, `id-${i}`]]));
  return JSON.parse(JSON.stringify({ type: c.type, source: c.datasourceId, concepts: c.conceptDefs, properties, behavior: c.behavior },
    (_key, value) => typeof value === 'string' && aliases.has(value) ? aliases.get(value) : value));
}
async function add(f: ReturnType<typeof fake>, options: Json, preview = false) {
  const result = await f.run('component_template_add', { ...base, common_options: options, preview });
  expect(result.isError, resultText(result)).toBeFalsy(); return JSON.parse(resultText(result));
}

describe('table-only presentation choices', () => {
  it('plans explicit role colors without modifying source options or inventing calculations', () => {
    for (const colors of [theme, darkTheme]) {
      const options = { percent_of_total: true, presentation: { table_header: 'surface' as const, share_display: 'heatmap' as const } };
      const before = structuredClone(options);
      expect(planTablePresentation('common-detail-table', colors, options)).toEqual({
        'Header background color': colors.background, 'Header font color': colors.text,
        'Metric column type#2': 'Heatmap', 'Show metric value#2': true, 'Metric column color#2': colors.series,
      });
      expect(planTablePresentation('common-detail-table', colors, { presentation: { table_header: 'inverse' } })).toEqual({
        'Header background color': colors.text, 'Header font color': colors.background,
      });
      expect(options).toEqual(before);
    }
    expect(planTablePresentation('common-detail-table', theme)).toEqual({});
  });
  it.each(['number', 'heatmap'] as const)('requires the share calculation to be independently selected for %s', async share_display => {
    const f = setup(), before = structuredClone(f.original);
    for (const percent_of_total of [undefined, false]) {
      await expect(add(f, { percent_of_total, presentation: { share_display } })).rejects.toThrow(/existing share column/);
    }
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
  });
  it('rejects presentation on another family and rejects unknown presentation keys', async () => {
    const f = setup();
    await expect(f.run('component_template_add', { ...base, template_id: 'common-kpi', bindings: { metric: 'value' },
      date_range: undefined, common_options: { presentation: { table_header: 'inverse' } } })).rejects.toThrow(/detail-table only/);
    await expect(add(f, { presentation: { table_header: 'inverse', extra_metric: 'value' } })).rejects.toThrow();
    expect(f.writes()).toEqual([]);
  });
  it.each(['surface', 'inverse'] as const)('keeps the exact analytical chart across %s headers and numeric/heatmap shares', async table_header => {
    const legacy = setup(); await add(legacy, { percent_of_total: true, data_bars: false });
    for (const share_display of ['number', 'heatmap'] as const) {
      const f = setup(), beforeReport = structuredClone(f.original.report);
      const options = { percent_of_total: true, data_bars: false, presentation: { table_header, share_display } };
      const preview = await add(f, options, true);
      expect(preview).toMatchObject({ saved: false, component_count: 1 }); expect(f.writes()).toEqual([]);
      await add(f, options);
      expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
      expect(f.writes().filter(c => c.endpoint !== 'updatePage')).toEqual([]);
      expect(f.original.report).toEqual(beforeReport);
      const c = chart(f), style = tableStyle(c);
      expect(analysis(c)).toEqual(analysis(chart(legacy)));
      expect(style.headerColor.color).toBe(table_header === 'surface' ? theme.background : theme.text);
      expect(style.headerFontColor.color).toBe(table_header === 'surface' ? theme.text : theme.background);
      expect(style.tableMetricProperty[0].colType).toBe(2);
      expect(style.tableMetricProperty[1]).toMatchObject({ colType: share_display === 'heatmap' ? 1 : 2, colShowNumber: true });
    }
  });
  it('keeps omitted and empty choices equivalent to the legacy presentation', async () => {
    const legacy = setup(), empty = setup();
    await add(legacy, { percent_of_total: true }); await add(empty, { percent_of_total: true, presentation: {} });
    expect(tableStyle(chart(empty))).toEqual(tableStyle(chart(legacy)));
    expect(analysis(chart(empty))).toEqual(analysis(chart(legacy)));
    const { style: _style, ...before } = commonChartArgs(base).args;
    const { style: _otherStyle, ...after } = commonChartArgs({ ...base, common_options: { presentation: { table_header: 'inverse' } } }).args;
    expect(after).toEqual(before);
  });
  it('lets explicit item presentation override page appearance defaults without adding columns', async () => {
    const f = setup(darkTheme);
    const item = { ...base, key: 'detail', common_options: { percent_of_total: true, data_bars: false,
      presentation: { table_header: 'surface', share_display: 'number' } } };
    const { report_id: _report, size: _size, ...recipe } = item;
    const args = { report_id: ORIGINAL, width: 1200, appearance: 'outlined-report', density: 'compact', items: [recipe] };
    const preview = await f.run('component_page_add', { ...args, preview: true }); expect(preview.isError).toBeFalsy(); expect(f.writes()).toEqual([]);
    const result = await f.run('component_page_add', args); expect(result.isError, resultText(result)).toBeFalsy();
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    const c = chart(f), s = tableStyle(c);
    expect(s).toMatchObject({ headerColor: { color: darkTheme.background }, headerFontColor: { color: darkTheme.text } });
    expect(s.tableMetricProperty.slice(0, 2).map((column: Json) => column.colType)).toEqual([2, 2]);
    expect(c.propertyConfig.componentProperty.metrics.labeledConcepts[0].value.conceptNames).toHaveLength(2);
    expect(JSON.parse(resultText(result)).items).toHaveLength(1);
  });
  it('blocks analytical mutation by a presentation updater before any live write', async () => {
    const original = FEATURE_TOOLS.find(t => t.name === 'component_update')!;
    const override: Tool = { ...original, run: async (ctx, args) => {
      const result = await original.run(ctx, args);
      await ctx.session.editPage(ORIGINAL, 'p1', page => {
        const c = page.page.componentConfig!.find(c => c.type === 'simple-table')! as Json;
        c.propertyConfig.componentProperty.metrics.labeledConcepts[0].value.conceptNames.pop();
      }, 'test analytical mutation');
      return result;
    } };
    const f = setup(theme, [override]), before = structuredClone(f.original);
    await expect(add(f, { percent_of_total: true, presentation: { share_display: 'heatmap' } })).rejects.toThrow(/Appearance changed/);
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
  });
});
