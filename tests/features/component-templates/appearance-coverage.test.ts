import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { applyStyle, labelsFor } from '../../../src/core/style.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';
import { compositionTheme } from '../../../src/features/component-templates/theme-tokens.js';
import { planReportAppearance } from '../../../src/features/component-templates/report-appearance.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const metric = { field: 'value', aggregation: 'sum', label: 'Sum' };
const cases = [
  { id: 'common-category-bars', bindings: { dimension: 'day', metric, breakdown: 'category' }, options: { orientation: 'horizontal', stack: 'percent' } },
  { id: 'common-radial-share', bindings: { dimension: 'category', metric }, options: { donut: true } },
  { id: 'common-area-trend', bindings: { date: 'day', metric, breakdown: 'category' }, options: { stack: 'absolute' } },
  { id: 'common-mixed-series', bindings: { dimension: 'day', metric, secondary_metric: { field: 'value', aggregation: 'avg', label: 'Mean' } }, options: { secondary_axis: true } },
  { id: 'common-pivot-table', bindings: { row: 'category', column: 'day', metric }, options: { heatmap: true } },
  { id: 'common-xy-scatter', bindings: { dimension: 'category', x_metric: metric, y_metric: { field: 'value', aggregation: 'avg', label: 'Mean' }, size_metric: { field: 'value', aggregation: 'count', label: 'Count' } }, options: {} },
];
function normalized(chart: Json) {
  const aliases = new Map<string, string>([[chart.componentId, 'chart']]);
  chart.conceptDefs.forEach((d: Json, i: number) => { aliases.set(d.name, `concept-${i}`); if (d.id) aliases.set(d.id, `id-${i}`); });
  return JSON.parse(JSON.stringify(chart, (_key, value) => typeof value === 'string' ? aliases.get(value) ?? value : value));
}

describe('report presentation across remaining common structures', () => {
  it.each(cases)('changes only registered presentation fields for $id', async ({ id, bindings, options }) => {
    const plain = fake(), styled = fake();
    for (const f of [plain, styled]) f.original.shareable.name = '[looker-studio-mcp-lab-1] profile coverage';
    const args = { report_id: ORIGINAL, width: 1500, columns: 1, density: 'compact',
      items: [{ key: 'chart', template_id: id, bindings, common_options: options, height: 400 }] };
    const preview = await styled.run('component_page_add', { ...args, appearance: 'outlined-report', preview: true });
    expect(preview.isError, resultText(preview)).toBeFalsy(); expect(styled.writes()).toEqual([]);
    for (const [f, appearance] of [[plain, undefined], [styled, 'outlined-report']] as const) {
      const result = await f.run('component_page_add', { ...args, ...(appearance ? { appearance } : {}) });
      expect(result.isError, resultText(result)).toBeFalsy();
      expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    }
    const expected = structuredClone(plain.original.page[0]!.page.componentConfig![0]!) as Json;
    const actual = styled.original.page[0]!.page.componentConfig![0]! as Json;
    const style = planReportAppearance(id, compositionTheme(plain.original));
    const applied = applyStyle(expected, labelsFor(styleTables, expected.type, expected.preset), style);
    expect(applied.notApplied).toEqual([]);
    // Includes native kind/preset, stack mode, pivot axes/rollups, bubble roles,
    // series axes, formats, filters and every other value outside these styles.
    expect(normalized(actual)).toEqual(normalized(expected));
    expect(styled.original.report).toEqual(plain.original.report);
  });
});
