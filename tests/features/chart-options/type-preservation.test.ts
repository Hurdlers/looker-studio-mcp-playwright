import { describe, expect, it } from 'vitest';
import { harness, properties as p } from './helpers.js';

describe('chart type and title updates', () => {
  it('preserves bar chart settings and identity while changing orientation and stacking', async () => {
    const h = harness();
    const { component } = await h.add('column', { title: 'Visitors by channel', date_range: 'Last 28 days', comparison: 'Previous period', style: { 'Bar color': '#0099AA', Background: '#FFFFFF', 'Title font size': 22 } });
    const before = structuredClone(component);
    for (const [kind, orientation, stack, percent] of [['bar', 1, false, false], ['stacked_100_column', 0, true, true], ['column', 0, false, false]] as const) {
      await h.update({ chart_type: kind });
      const expected = structuredClone(before);
      expected.preset = kind === 'bar' ? 'vertical' : kind === 'stacked_100_column' ? 'horizontal-stacked-100' : 'default';
      Object.assign(p(expected).barChartProperty, { orientation, showStack: stack, show100Stack: percent });
      expect(h.last()).toEqual(expected);
    }
  });

  it('accepts title updates together with type changes and preserves title typography', async () => {
    const h = harness();
    await h.add('column', { title: 'Before', style: { 'Title font size': 22 } });
    await h.update({ chart_type: 'bar', title: 'After' });
    expect(p(h.last()).barChartProperty.chartTitleProperty).toMatchObject({ chartTitleText: 'After', chartTitleFontSize: 22, chartTitleShowTitle: true, chartTitleAutoGenerateText: false });
    await h.update({ title: '' });
    expect(p(h.last()).barChartProperty.chartTitleProperty).toMatchObject({ chartTitleText: '', chartTitleShowTitle: false });
  });

  it('keeps the title and card background when switching to another chart family', async () => {
    const h = harness();
    const { component } = await h.add('column', { title: 'Visits', style: { Background: '#FFFFFF', 'Title font size': 22 } });
    const before = structuredClone(p(component).barChartProperty);
    await h.update({ chart_type: 'table' });
    expect(p(h.last()).tableProperty.chartTitleProperty).toEqual(before.chartTitleProperty);
    expect(p(h.last()).tableProperty.backgroundAndBorderProperty).toEqual(before.backgroundAndBorderProperty);
  });
});
