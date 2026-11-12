import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { planReportAppearance } from '../../../src/features/component-templates/report-appearance.js';
import { fake, properties, type Json } from '../spec/fake.js';

describe('pivot header presentation', () => {
  it.each(['pivot_table', 'pivot_heatmap'])('updates %s header colors through the public style adapter without changing analysis', async (type) => {
    const f = fake();
    const added = await f.add('chart_add', { type, dimensions: ['category'], fields: { 'Column dimension': ['day'] },
      metrics: [{ field: 'value', aggregation: 'sum' }], sort_by: 'value', sort_ascending: false });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const before = structuredClone(original);
    const style = { 'Header background color': '#123456', 'Header font color': '#F1F2F3' };
    const updated = await f.add('component_update', { component_id: original.componentId, style });
    expect(updated.isError, resultText(updated)).not.toBe(true);
    const actual = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(properties(actual).pivotTableProperty).toMatchObject({ headerColor: { color: '#123456' }, headerFontColor: { color: '#F1F2F3' } });
    const normalized = structuredClone(actual);
    for (const key of ['headerColor', 'headerFontColor']) properties(normalized).pivotTableProperty[key] = properties(before).pivotTableProperty[key];
    expect(normalized).toEqual(before);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].style).toMatchObject(style);
  });

  it.each([
    { background: '#F1F2F3', text: '#123456' },
    { background: '#121314', text: '#E1E2E3' },
  ])('uses destination theme roles for the explicit profile: %j', (colors) => {
    const theme = { ...colors, muted: '#789ABC', accent: '#56789A', activeText: '#FFFFFF', series: '#2468AC', font: 'Arial' };
    const before = structuredClone(theme);
    expect(planReportAppearance('common-pivot-table', theme)).toMatchObject({
      'Header background color': theme.text, 'Header font color': theme.background,
    });
    expect(theme).toEqual(before);
  });
});
