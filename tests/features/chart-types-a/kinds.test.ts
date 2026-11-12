import { describe, expect, it } from 'vitest';

import { Extensions } from '../../../src/core/extensions.js';
import { runTool } from '../../../src/core/tool.js';
import { extensions } from '../../../src/features/chart-types-a/index.js';
import { extensions as options } from '../../../src/features/chart-options/index.js';
import { added, column, context, def, looker, REPORT, report, slot, writes } from '../chart-core/helpers.js';

type Json = Record<string, any>;

const fields = [column('_category_', 'Category', 32, 0), column('_day_', 'Day', 2, 0), column('_amount_', 'Amount', 33, 6), column('_visits_', 'Visits', 33, 6)];

function setup() {
  const fake = looker(report(), { dsA: { name: 'Sample source', fields } });
  const ctx = context(fake.rap);
  ctx.ext = new Extensions([{ group: 'chart-types-a', extensions }]);
  return { ...fake, ctx };
}

function args(key: string): Json {
  const isCard = ['scorecard', 'scorecard_compact'].includes(key);
  const date = /time_series|area/.test(key);
  return {
    report_id: REPORT, type: key, dimensions: isCard ? [] : [date ? 'Day' : 'Category'],
    metrics: key === 'scorecard_dimension' ? [] : [{ field: 'Amount' }, ...(['scatter', 'combo', 'line'].includes(key) ? [{ field: 'Visits' }] : [])],
  };
}

describe('chart-types-a through chart_add', () => {
  for (const key of ['column', 'bar', 'stacked_column', 'stacked_100_column', 'stacked_bar', 'stacked_100_bar']) {
    it(`chart.type.${key}: rejects two dimensions without saving`, async () => {
      const f = setup();
      await expect(runTool(f.ctx, 'chart_add', { ...args(key), dimensions: ['Category', 'Day'] })).rejects.toMatchObject({ code: 'invalid' });
      expect(writes(f.calls)).toEqual([]);
    });
  }
  for (const ascending of [false, true]) {
    it(`chart.type.scorecard_dimension: sorts a dimension card ${ascending ? 'ascending' : 'descending'}`, async () => {
      const f = setup();
      f.ctx.ext = new Extensions([{ group: 'chart-types-a', extensions }, { group: 'chart-options', extensions: options }]);
      const callRap = f.rap.call.bind(f.rap);
      f.rap.call = async <T>(endpoint: string, body: unknown): Promise<T> => endpoint === 'getSchema'
        ? { schema: { dimensions: [{ name: '_amount_', semanticInfo: { semanticConfig: [{ semanticType: 33 }] } }], metrics: [] } } as T
        : callRap<T>(endpoint, body);
      await runTool(f.ctx, 'chart_add', { ...args('scorecard_dimension'), sort_by: 'Amount', ...(ascending ? { sort_ascending: true } : {}) });
      const c = added(f.calls);
      expect(slot(c, 'dimensions', 'primary')).toHaveLength(1);
      expect(slot(c, 'metrics', 'primary')).toEqual([]);
      const sort = c.propertyConfig.componentProperty.sort[0];
      expect(sort.sortDir).toBe(ascending ? 0 : 1);
      expect(def(c, sort.sortColumn).queryTimeTransformation.dataTransformation).toMatchObject({ sourceFieldName: '_amount_', aggregation: 6 });
    });
  }
  for (const semanticType of [12, 14, 16, 18, 37]) {
    it(`chart.type.time_series: checks semantic type ${semanticType}`, async () => {
      const fake = looker(report(), { dsA: { name: 'Sample source', fields: [column('_value_', 'Value', semanticType, 0), ...fields] } });
      const ctx = context(fake.rap);
      ctx.ext = new Extensions([{ group: 'chart-types-a', extensions }]);
      const call = runTool(ctx, 'chart_add', { ...args('time_series'), dimensions: ['Value'] });
      if (semanticType === 37) {
        await call;
        expect(added(fake.calls).type).toBe('simple-linechart');
      } else {
        await expect(call).rejects.toMatchObject({ code: 'invalid' });
        expect(writes(fake.calls)).toEqual([]);
      }
    });
  }
  for (const kind of extensions.chartKinds!) {
    it(`chart.type.${kind.key}: saves its preset and resolved concepts`, async () => {
      const f = setup();
      const input = args(kind.key);
      await runTool(f.ctx, 'chart_add', input);
      const c = added(f.calls);
      expect(c.type).toBe(kind.type);
      expect(c.preset).toBe(kind.preset);
      expect(c.datasourceId).toBe('dsA');
      for (const ref of [...input.dimensions, ...input.metrics.map((m: Json) => m.field)]) {
        const field = fields.find((x) => x.outputName === ref)!;
        expect(c.conceptDefs.some((d: Json) => d.queryTimeTransformation?.dataTransformation?.sourceFieldName === field.field.name)).toBe(true);
      }
      const prop = c.propertyConfig.componentProperty;
      if (kind.type === 'simple-linechart') expect(prop).not.toHaveProperty('row');
      if (kind.type === 'simple-table' || kind.type === 'pivot-table') {
        const key = kind.type === 'simple-table' ? 'tableProperty' : 'pivotTableProperty';
        const colType = /bars$/.test(kind.key) ? 0 : /heatmap$/.test(kind.key) ? 1 : 2;
        expect(prop[key].tableMetricProperty.every((x: Json) => x.colType === colType)).toBe(true);
      }
      if (kind.type === 'simple-barchart') {
        expect(prop.barChartProperty.orientation).toBe(kind.key.includes('column') ? 0 : 1);
        expect(prop.barChartProperty.showStack).toBe(kind.key.startsWith('stacked'));
        expect(prop.barChartProperty.show100Stack).toBe(kind.key.startsWith('stacked_100'));
      }
      if (kind.type === 'pivot-table') expect(prop.pivotTableProperty.pivotDisplayConfig.row[0].sort).toEqual([{ sortDir: 0, sortColumn: slot(c, 'dimensions', 'primary')[0] }]);
      if (kind.key === 'donut') expect(prop.pieChartProperty.pieHole).toBe(0.55);
      if (kind.key.startsWith('smoothed')) expect((prop.lineChartProperty ?? prop.comboChartProperty).smoothCurve).toBe(true);
      if (kind.key === 'scorecard_compact') expect(prop.kpiMetricProperty.compactNumbers).toBe(true);
      if (['line', 'smoothed_line', 'combo'].includes(kind.key))
        expect(prop.comboChartProperty.seriesProperty.map((s: Json) => s.seriesType)).toEqual(Array.from({ length: 20 }, (_, i) => kind.key === 'combo' && i === 0 ? 1 : 0));
      if (kind.key === 'stacked_combo') expect(prop.comboChartProperty.showStack).toBe(true);
      if (kind.type === 'simple-areachart') {
        expect(prop.areaChartProperty.showStack).toBe(kind.key !== 'area');
        expect(prop.areaChartProperty.show100Stack).toBe(kind.key === 'stacked_100_area');
        expect(slot(c, 'dimensions', 'breakdown')).toHaveLength(1);
        expect(def(c, slot(c, 'dimensions', 'breakdown')[0]!).queryTimeTransformation.dataTransformation).not.toHaveProperty('aggregation');
        expect(def(c, slot(c, 'dimensions', 'breakdown')[0]!).queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual({ semanticConfig: [{ semanticType: 32 }] });
      }
      if (kind.key === 'scatter') {
        expect(def(c, slot(c, 'metrics', 'x_metric')[0]!).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_amount_');
        expect(def(c, slot(c, 'metrics', 'y_metric')[0]!).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_visits_');
      }
    });

    it(`chart.type.${kind.key}: rejects invalid field counts before writing`, async () => {
      const f = setup();
      const input = args(kind.key);
      if (['scorecard', 'scorecard_compact'].includes(kind.key)) input.dimensions = ['Category'];
      else if (kind.key === 'scorecard_dimension') input.metrics = [{ field: 'Amount' }];
      else if (/time_series/.test(kind.key)) input.dimensions = ['Category'];
      else if (['pie', 'donut'].includes(kind.key) || /area/.test(kind.key)) input.metrics = [{ field: 'Amount' }, { field: 'Visits' }];
      else if (kind.key === 'scatter') input.metrics = [{ field: 'Amount' }];
      else if (kind.type === 'simple-table' || kind.type === 'pivot-table') input.metrics = [];
      else input.dimensions = [];
      await expect(runTool(f.ctx, 'chart_add', input)).rejects.toMatchObject({ code: 'invalid' });
      expect(writes(f.calls)).toEqual([]);
    });
  }

  for (const key of ['pivot_table', 'pivot_bars', 'pivot_heatmap']) {
    it(`chart.type.${key}: keeps row and column dimensions distinct`, async () => {
      const f = setup();
      await runTool(f.ctx, 'chart_add', { ...args(key), fields: { 'Column dimension': ['Day'] } });
      const c = added(f.calls);
      const names = slot(c, 'dimensions', 'primary');
      const config = c.propertyConfig.componentProperty.pivotTableProperty.pivotDisplayConfig;
      expect(names).toHaveLength(2);
      expect(config.row[0].sort[0].sortColumn).toBe(names[0]);
      expect(config.col[0].sort[0].sortColumn).toBe(names[1]);
    });
  }

  it('chart.type.stacked_combo: prepares both breakdown entries and asks for enough rows', async () => {
    const f = setup();
    await runTool(f.ctx, 'chart_add', { ...args('stacked_combo'), dimensions: ['Day'], breakdown: 'Category' });
    const c = added(f.calls);
    const prop = c.propertyConfig.componentProperty;
    expect(prop.row).toBe(1000);
    expect(prop.breakdownConfig.map((x: Json) => x.conceptName)).toEqual([slot(c, 'dimensions', 'primary')[0], slot(c, 'dimensions', 'breakdown')[0]]);
  });

  it('chart.type.stacked_combo: refuses multiple metrics with a breakdown', async () => {
    const f = setup();
    await expect(runTool(f.ctx, 'chart_add', { ...args('stacked_combo'), breakdown: 'Category', metrics: [{ field: 'Amount' }, { field: 'Visits' }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f.calls)).toEqual([]);
  });

  it('chart.type.scatter: puts a third metric in the bubble size slot', async () => {
    const f = setup();
    await runTool(f.ctx, 'chart_add', { ...args('scatter'), metrics: [{ field: 'Amount' }, { field: 'Visits' }, { field: 'Amount', aggregation: 'avg' }] });
    const c = added(f.calls);
    expect(def(c, slot(c, 'metrics', 'bubble_size')[0]!).queryTimeTransformation.dataTransformation.aggregation).toBe(1);
  });
});
