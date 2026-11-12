import { describe, expect, it } from 'vitest';
import { planSection, SECTION_TEMPLATE_ID } from '../../../src/features/component-templates/section.js';
import { fake, ORIGINAL, SOURCE, properties } from '../spec/fake.js';
import { resultText } from '../../../src/core/tool.js';

const base = { template_id: SECTION_TEMPLATE_ID, report_id: ORIGINAL, data_source: SOURCE,
  bindings: { metric: { field: 'value', aggregation: 'sum' as const, label: '매출' }, date: 'day', dimension: 'category' },
  date_range: '2026-11-01..2026-11-07', texts: { title: '매출 요약', description: '동일한 기간과 분류로 비교합니다.' } };
const children = (plan: ReturnType<typeof planSection>) => plan.steps.filter(s => s.tool === 'component_template_add');

describe('overview section plan', () => {
  it('shares one metric and source while letting the date control own the initial range', async () => {
    const input = structuredClone(base);
    const plan = planSection(input, { background: '#FFFFFF', text: '#18354E', muted: '#607080', accent: '#EAF0F5', font: 'Roboto' });
    const charts = children(plan);
    expect(charts).toHaveLength(3);
    for (const c of charts) {
      expect(c.args.data_source).toBe(SOURCE);
      expect(c.args.bindings).toMatchObject({ metric: base.bindings.metric, date: 'day' });
      expect(c.args).not.toHaveProperty('date_range');
    }
    expect(plan.steps.find(s => s.args.kind === 'drop_down')!.args.metric).toBe('value');
    const date = plan.steps.find(s => s.args.kind === 'date_range')!;
    expect(date.args.date_range).toBe(base.date_range);
    expect(date.args).not.toHaveProperty('data_source');
    expect(date.args).not.toHaveProperty('field');
    const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] section';
    for (const step of plan.steps) expect(resultText(await f.run(step.tool, step.args))).not.toMatch(/Not applied/i);
    const chartTypes = new Set(['kpi-metric', 'simple-linechart', 'simple-table']);
    const savedCharts = f.original.page[0]!.page.componentConfig!.filter(c => chartTypes.has(String(c.type)));
    expect(savedCharts).toHaveLength(3);
    for (const c of savedCharts) expect(properties(c).dateDuration).toBeUndefined();
    expect(input).toEqual(base);
  });

  it('avoids the captured date picker Last 7 days default and supports a fixed period without controls', () => {
    const automatic = planSection({ ...base, date_range: undefined });
    expect(automatic.steps.find(s => s.args.kind === 'date_range')!.args.date_range).toBe('Auto date range');
    const fixed = planSection({ ...base, section_options: { date_control: false, dimension_control: false } });
    expect(fixed.steps.some(s => s.tool === 'control_add')).toBe(false);
    for (const chart of children(fixed)) expect(chart.args.date_range).toBe(base.date_range);
  });

  it('keeps every item inside its section and switches to vertical composition on narrow pages', () => {
    const position = { left: 72, top: 120 };
    for (const width of [600, 760, 1120]) {
      const minimum = planSection({ ...base, position, size: { width, height: 1300 } });
      for (const step of minimum.steps) {
        const p = step.args.position as { left: number; top: number; width?: number; height?: number };
        const size = (step.args.size ?? p) as { width: number; height: number };
        expect(p.left).toBeGreaterThanOrEqual(position.left);
        expect(p.top).toBeGreaterThanOrEqual(position.top);
        expect(p.left + size.width).toBeLessThanOrEqual(position.left + minimum.width);
        expect(p.top + size.height).toBeLessThanOrEqual(position.top + minimum.height);
      }
      const [kpi, trend] = children(minimum);
      const a = kpi!.args.position as { top: number }, b = trend!.args.position as { top: number };
      expect(b.top > a.top).toBe(width < 1000);
    }
    expect(() => planSection({ ...base, size: { width: 600, height: 500 } })).toThrow(/height/);
    expect(() => planSection({ ...base, bindings: { ...base.bindings, ignored: 'value' } })).toThrow(/Unknown section role/);
  });
});

describe('compact overview sections', () => {
  it('uses one surface, shorter controls and fewer repeated headings while keeping data roles', () => {
    const comfortable = planSection(base);
    const compact = planSection({ ...base, section_options: { density: 'compact', table_rows: 5 } });
    expect(compact.height).toBeLessThan(comfortable.height);
    expect(compact.steps.filter(step => step.tool === 'shape_add')).toHaveLength(1);
    const title = compact.steps.find(step => step.tool === 'text_add')!;
    expect(title.args.font_size).toBe(24);
    for (const control of compact.steps.filter(step => step.tool === 'control_add')) {
      expect(control.args.position).toMatchObject({ height: 36 });
      expect(control.args.style).toMatchObject({ 'Add border shadow': false });
    }
    for (const child of children(compact)) {
      expect(child.args.bindings).toMatchObject({ metric: base.bindings.metric, date: 'day' });
      expect(child.args.common_options).toMatchObject({ density: 'compact', surface: 'plain' });
      expect(child.args).not.toHaveProperty('date_range');
    }
    const trend = children(compact).find(child => child.args.template_id === 'common-time-trend')!;
    expect(trend.args.texts).toEqual({ title: '' });
    const table = children(compact).find(child => child.args.template_id === 'common-detail-table')!;
    expect(table.args.common_options).toMatchObject({ visible_rows: 5, percent_of_total: true });
  });

  it('lets visible rows drive the table height and rejects undersized explicit containers', () => {
    const short = planSection({ ...base, section_options: { density: 'compact', table_rows: 5 } });
    const long = planSection({ ...base, section_options: { density: 'compact', table_rows: 20 } });
    expect(long.height).toBeGreaterThan(short.height);
    expect(() => planSection({ ...base, section_options: { density: 'compact', table_rows: 20 }, size: { width: 1120, height: short.height } })).toThrow(/height/);
    const expanded = planSection({ ...base, section_options: { density: 'compact', table_rows: 5 }, size: { width: 1120, height: long.height + 40 } });
    expect(expanded.height).toBe(long.height + 40);
    expect(() => planSection({ ...base, section_options: { table_rows: 6 as 5 } })).toThrow();
  });
});


it('reserves compact header height for multiline descriptions before placing controls', () => {
  const plan = planSection({ ...base, size: { width: 600 }, texts: { title: '활동 요약', description: '첫 번째 설명\n두 번째 설명\n세 번째 설명' }, section_options: { density: 'compact' } });
  const description = plan.steps.filter(s => s.tool === 'text_add')[1]!;
  const d = description.args.position as { top: number; height: number };
  const control = plan.steps.find(s => s.tool === 'control_add')!;
  const c = control.args.position as { top: number };
  expect(d.height).toBeGreaterThanOrEqual(3 * 21);
  expect(c.top).toBeGreaterThan(d.top + d.height);
});
