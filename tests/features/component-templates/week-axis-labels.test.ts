import { describe, expect, it } from 'vitest';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { ORIGINAL } from '../spec/fake.js';

const mixed = { report_id: ORIGINAL, template_id: 'common-mixed-series', size: { width: 820, height: 360 },
  bindings: { date: 'day', dimension: 'day', metric: { field: 'value', aggregation: 'sum' as const }, secondary_metric: { field: 'cost', aggregation: 'sum' as const } },
  common_options: { secondary_axis: true } };
const weekly = [{ field: 'day', kind: 'dimension' as const, date_granularity: 'Year Week' }];
const style = (input: Parameters<typeof commonChartArgs>[0]) => commonChartArgs(input).args.style as Record<string, unknown>;

describe('week labels on a category axis', () => {
  it('slants week labels and moves plot height to the axis without changing the analysis', () => {
    const plain = commonChartArgs(mixed), week = commonChartArgs({ ...mixed, field_formats: weekly });
    expect(style(mixed)).not.toHaveProperty('Axis label rotation');
    expect(style({ ...mixed, field_formats: weekly })).toMatchObject({ 'Axis label rotation': 30,
      'Chart area height': (style(mixed)['Chart area height'] as number) - 84,
      'Chart area width': (style(mixed)['Chart area width'] as number) - 88, 'Chart area left': (style(mixed)['Chart area left'] as number) + 88 });
    expect(week.args.dimensions).toEqual(plain.args.dimensions);
    expect(week.args.metrics).toEqual(plain.args.metrics);
    expect(week.args.position).toEqual(plain.args.position);
    expect(week.notes.join(' ')).toContain('주 단위 축 라벨');
  });
  it('leaves other date groupings, metric formats and other structures alone', () => {
    expect(style({ ...mixed, field_formats: [{ field: 'day', kind: 'dimension', date_granularity: 'Year Month' }] })).not.toHaveProperty('Axis label rotation');
    expect(style({ ...mixed, field_formats: [{ field: 'value', kind: 'metric', display_format: '0.0' }] })).not.toHaveProperty('Axis label rotation');
    const trend = { report_id: ORIGINAL, template_id: 'common-time-trend', bindings: { metric: mixed.bindings.metric, date: 'day' }, field_formats: weekly };
    expect(style(trend)).not.toHaveProperty('Axis label rotation');
  });
});

describe('horizontal bar category names', () => {
  const bars = { report_id: ORIGINAL, template_id: 'common-category-bars', size: { width: 560, height: 400 }, bindings: { dimension: 'category', metric: { field: 'value', aggregation: 'sum' as const } } };
  it('widens the name axis for horizontal bars only and keeps the plot inside the box', () => {
    const vertical = style(bars), horizontal = style({ ...bars, common_options: { orientation: 'horizontal' } });
    expect(horizontal['Chart area left']).toBe(156);
    expect(horizontal['Chart area left'] as number).toBeGreaterThan(vertical['Chart area left'] as number);
    expect((horizontal['Chart area left'] as number) + (horizontal['Chart area width'] as number)).toBeLessThanOrEqual(560 - 48);
  });
});

describe('detail table value columns', () => {
  it('adds further metrics after the first metric and its share', () => {
    const args = commonChartArgs({ report_id: ORIGINAL, template_id: 'common-detail-table', common_options: { percent_of_total: true },
      bindings: { dimension: 'category', metric: { field: 'value', aggregation: 'sum', label: 'Value' }, metric_2: { field: 'cost', aggregation: 'sum', label: 'Cost' }, metric_3: { field: 'orders', aggregation: 'sum' } } }).args;
    expect((args.metrics as Array<{ field: string; calculation?: string }>).map(m => [m.field, m.calculation])).toEqual([['value', undefined], ['value', 'percent_of_total'], ['cost', undefined], ['orders', undefined]]);
    expect(() => commonChartArgs({ report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' }, metric_2: { field: 'cost', aggregation: 'sum' } } })).toThrow(/Unknown role/);
  });
});
