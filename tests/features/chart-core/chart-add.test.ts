import { describe, expect, it } from 'vitest';

import type { ReportDoc } from '../../../src/core/session.js';
import {
  added,
  column,
  context,
  def,
  filterUpdater,
  looker,
  REPORT,
  report,
  run,
  sentOnce,
  slot,
  textOf,
  writes,
  type Json,
} from './helpers.js';

const table = { report_id: REPORT, type: 'table', dimensions: ['Device Category'], metrics: [{ field: 'sessions' }] };

async function add(args: Json, doc?: ReportDoc, sources?: Parameters<typeof looker>[1]) {
  const before = (doc ?? report()).page.flatMap((p) => (p.page.componentConfig ?? []).map((x) => String(x.componentId)));
  const l = looker(doc, sources);
  const res = await run(context(l.rap), 'chart_add', args);
  return { ...l, res, c: added(l.calls, before) };
}

async function refused(args: Json, code = 'invalid', doc?: ReportDoc, sources?: Parameters<typeof looker>[1]) {
  const l = looker(doc, sources);
  await expect(run(context(l.rap), 'chart_add', args)).rejects.toMatchObject({ code });
  expect(writes(l.calls)).toEqual([]);
  return l;
}

const withBottom = (top: number, height: number, canvasHeight = 900): ReportDoc => {
  const d = report();
  d.report.attributeConfig = { reportAttribute: { width: 1200, height: canvasHeight } };
  d.page[0]!.page.componentConfig!.push({ componentId: 'cd-low0000001', type: 'simple-description', attributeConfig: { componentAttribute: { left: 0, top, width: 100, height } } });
  return d;
};

describe('chart_add', () => {
  it('chart.add: saves a snapshot then one updatePage with the old components plus the new table', async () => {
    const { calls, res, c } = await add(table);
    expect(writes(calls)).toEqual(['createNamedRevision', 'updatePage']);
    const body = sentOnce(calls, 'updatePage');
    expect(body.pageRequest.componentConfig.map((x: Json) => x.componentId)).toEqual(['cd-old0000001', c.componentId]);
    expect(c).toMatchObject({ type: 'simple-table', preset: 'default', datasourceId: 'dsA' });
    expect(c.componentId).toMatch(/^cd-[0-9a-f]{10}$/);
    expect(textOf(res)).toContain(c.componentId);
    expect(textOf(res)).toContain('revision 41');
  });

  it('chart.add: an unknown field or a broken count rule is invalid before any write; dry_run sends no updatePage', async () => {
    await refused({ ...table, dimensions: ['revenue'] });
    await refused({ ...table, metrics: [{ field: 'revenue' }] });
    await refused({ ...table, metrics: [] });

    const l = looker();
    const res = await run(context(l.rap, { dryRun: true }), 'chart_add', table);
    expect(l.calls.map((c) => c.endpoint)).not.toContain('updatePage');
    expect(writes(l.calls)).toEqual([]);
    expect(textOf(res)).toContain('Would add table (Table)');
    expect(textOf(res)).toContain('Would have sent: updatePage');
  });

  it('chart.page: finds the page by name or id in navigation order, the first page by default, and lists pages when missing', async () => {
    const twoPages = (): ReportDoc => {
      const d = report();
      d.navigationInfo = {
        navItems: [{ section: { displayName: 'S', navItems: [{ page: { pageId: 'p_a', displayName: 'Overview' } }] } }, { page: { pageId: 'p_b', displayName: 'Detail' } }],
      };
      d.page = [
        { pageId: 'p_b', page: { componentConfig: [] } },
        { pageId: 'p_a', page: { componentConfig: [] } },
      ];
      return d;
    };
    for (const [page, want] of [['Detail', 'p_b'], ['p_a', 'p_a'], [undefined, 'p_a']] as const) {
      const l = looker(twoPages());
      await run(context(l.rap), 'chart_add', { ...table, ...(page ? { page } : {}) });
      expect(sentOnce(l.calls, 'updatePage').pageId).toBe(want);
    }
    const l = looker(twoPages());
    const err = await run(context(l.rap), 'chart_add', { ...table, page: 'Nope' }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'not_found' });
    expect((err as Error).message).toContain('Overview');
    expect((err as Error).message).toContain('Detail');
    expect(writes(l.calls)).toEqual([]);
  });

  it('chart.layout.position: puts the chart at the given left and top', async () => {
    const { c } = await add({ ...table, position: { left: 100, top: 200 } });
    expect(c.attributeConfig.componentAttribute).toMatchObject({ left: 100, top: 200 });
  });

  it('chart.layout.position: defaults below the lowest component within the page, one axis given, out of range refused', async () => {
    expect((await add(table, withBottom(300, 100))).c.attributeConfig.componentAttribute).toMatchObject({ left: 40, top: 420 });
    expect((await add(table, withBottom(800, 50))).c.attributeConfig.componentAttribute).toMatchObject({ left: 40, top: 780 });
    expect((await add({ ...table, position: { top: 50 } }, withBottom(300, 100))).c.attributeConfig.componentAttribute).toMatchObject({ left: 40, top: 50 });
    await refused({ ...table, position: { left: -1 } });
    await refused({ ...table, position: { left: 20001 } });
  });

  it('chart.layout.size: uses the given size, else 380x280 (140x80 for a scorecard); out of range refused', async () => {
    expect((await add({ ...table, position: { width: 600, height: 300 } })).c.attributeConfig.componentAttribute).toMatchObject({ width: 600, height: 300 });
    expect((await add(table)).c.attributeConfig.componentAttribute).toMatchObject({ width: 380, height: 280 });
    expect((await add({ report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }] })).c.attributeConfig.componentAttribute).toMatchObject({
      width: 140,
      height: 80,
    });
    await refused({ ...table, position: { width: 5 } });
    await refused({ ...table, position: { height: 20001 } });
  });

  it('chart.title: writes a shown, fixed title into the chart type\'s own property block; an empty title changes nothing', async () => {
    const want = { chartTitleShowTitle: true, chartTitleText: 'Sessions by day', chartTitleAutoGenerateText: false };
    const col = (await add({ ...table, type: 'column', title: 'Sessions by day' })).c;
    expect(col.propertyConfig.componentProperty.barChartProperty.chartTitleProperty).toMatchObject(want);
    const tab = (await add({ ...table, title: 'Sessions by day' })).c;
    expect(tab.propertyConfig.componentProperty.tableProperty.chartTitleProperty).toMatchObject(want);
    const plain = (await add(table)).c;
    const empty = (await add({ ...table, title: '' })).c;
    expect(empty.propertyConfig.componentProperty.tableProperty.chartTitleProperty).toEqual(plain.propertyConfig.componentProperty.tableProperty.chartTitleProperty);
  });

  it('chart.data_source: picks the source by name, lists the names when missing, and takes the last added by default', async () => {
    const two = (): ReportDoc => {
      const d = report();
      d.report.resource = { datasourceAlias: [{ datasourceId: 'A', alias: 'ds1' }, { datasourceId: 'B', alias: 'ds2' }] };
      return d;
    };
    const sources = {
      A: { name: '4 Demo', fields: [column('_sessions_', 'sessions', 33, 6), column('_device_category_', 'Device Category', 32, 0)] },
      B: { name: 'Custom query', fields: [column('_sessions_', 'sessions', 33, 6), column('_device_category_', 'Device Category', 32, 0)] },
    };
    const named = (await add({ ...table, data_source: 'Custom query' }, two(), sources)).c;
    expect(named.datasourceId).toBe('B');
    expect(named.propertyConfig.componentProperty.dataset).toEqual({ datasetType: 1, datasetId: 'B' });
    expect((await add(table, two(), sources)).c.datasourceId).toBe('B');
    const l = await refused({ ...table, data_source: 'Nope' }, 'invalid', two(), sources);
    const err = await run(context(l.rap), 'chart_add', { ...table, data_source: 'Nope' }).catch((e: Error) => e.message);
    expect(err).toContain('4 Demo');
    expect(err).toContain('Custom query');
  });

  it('chart.data_source: a blend by name → dataset {datasetType 2, datasetId entry key}, no datasourceId, its fields; listed when missing', async () => {
    const blendColumn = (id: string, name: string, qt: string, dataType: number): Json => ({
      columnType: 0,
      field: { ns: 't0', name: id, simpleName: id },
      outputName: name,
      enabled: true,
      dataType,
      queryTimeTransformation: { dataTransformation: { sourceFieldName: qt } },
    });
    const concept = (qt: string, source: string, aggregation?: number, semantic: number[] = []): Json => ({
      id: { id: `t0.${qt}`, name: qt, namespace: 't0' },
      semantic,
      queryTimeTransformation: { dataTransformation: { sourceFieldName: source, ...(aggregation !== undefined ? { aggregation } : {}) } },
    });
    const withBlend = (): ReportDoc => {
      const d = report();
      d.report.resource = {
        datasourceAlias: [{ datasourceId: 'A', alias: 'ds1' }, { datasourceId: 'B', alias: 'ds2' }],
        dataViewResource: {
          entry: [
            {
              key: 'dataViewResourceabc123def0',
              value: {
                blockDatasource: {
                  datasourceBlock: {
                    id: 'block_x1',
                    type: 1,
                    name: 'Blended data (1)',
                    fields: [blendColumn('calc_dev_dv0', 'Device Category', 'qt_dev', 0), blendColumn('calc_ses_dv0', 'sessions', 'qt_ses', 5)],
                  },
                  blocks: [
                    {
                      id: 'block_x2',
                      type: 6,
                      treeQueryBlockConfig: {
                        join: {
                          type: 3,
                          left: { query: { datasourceId: 'A', concepts: [concept('qt_dev', '_device_category_', undefined, [32])] } },
                          right: { query: { datasourceId: 'B', concepts: [concept('qt_ses', '_sessions_', 6, [33])] } },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      };
      return d;
    };
    const sources = {
      A: { name: '4 Demo', fields: [column('_device_category_', 'Device Category', 32, 0)] },
      B: { name: 'Custom query', fields: [column('_sessions_', 'sessions', 33, 6), column('_device_category_', 'Device Category', 32, 0)] },
    };
    for (const name of ['Blended data (1)', 'blended data (1)', 'dataViewResourceabc123def0']) {
      const { c, res } = await add({ ...table, data_source: name }, withBlend(), sources);
      expect('datasourceId' in c).toBe(false);
      expect(c.propertyConfig.componentProperty.dataset).toEqual({ datasetType: 2, datasetId: 'dataViewResourceabc123def0' });
      const [dim] = slot(c, 'dimensions', 'primary');
      const [metric] = slot(c, 'metrics', 'primary');
      expect(def(c, dim!).queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: 'calc_dev_dv0' });
      // A blend field made from a table metric keeps that metric's aggregation.
      expect(def(c, metric!).queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: 'calc_ses_dv0', aggregation: 6 });
      expect(textOf(res)).toContain('blend "Blended data (1)"');
    }
    // Plain data sources still resolve as before next to a blend.
    expect((await add({ ...table, data_source: 'Custom query' }, withBlend(), sources)).c.propertyConfig.componentProperty.dataset).toEqual({
      datasetType: 1,
      datasetId: 'B',
    });
    const l = await refused({ ...table, data_source: 'Nope' }, 'invalid', withBlend(), sources);
    const err = await run(context(l.rap), 'chart_add', { ...table, data_source: 'Nope' }).catch((e: Error) => e.message);
    expect(err).toContain('Custom query');
    expect(err).toContain('Blended data (1)');
    // A data source and a blend with the same name: the exact match wins, a tie is refused.
    const clash = withBlend();
    const exactBlend = { ...sources, B: { ...sources.B, name: 'blended data (1)' } };
    expect((await add({ ...table, data_source: 'Blended data (1)' }, clash, exactBlend)).c.propertyConfig.componentProperty.dataset.datasetType).toBe(2);
    expect((await add({ ...table, data_source: 'blended data (1)' }, withBlend(), exactBlend)).c.propertyConfig.componentProperty.dataset).toEqual({
      datasetType: 1,
      datasetId: 'B',
    });
    await refused({ ...table, data_source: 'Blended data (1)' }, 'invalid', withBlend(), { ...sources, B: { ...sources.B, name: 'Blended data (1)' } });
  });

  it('chart.dimensions: puts dimension concepts (no aggregation) in the primary slot, by name or id; unknown fields are listed', async () => {
    const fields = { dsA: { name: '4 Demo', fields: [column('_sessions_', 'sessions', 33, 6), column('_device_category_', 'Device Category', 32, 0)] } };
    for (const ref of ['Device Category', '_device_category_']) {
      const { c } = await add({ ...table, dimensions: [ref] }, undefined, fields);
      // The primary slot lists exactly the one dimension concept, by its name.
      const made = c.conceptDefs.filter((x: Json) => x.queryTimeTransformation.dataTransformation.sourceFieldName === '_device_category_');
      expect(made).toHaveLength(1);
      expect(slot(c, 'dimensions', 'primary')).toEqual([made[0].name]);
      const d = def(c, made[0].name);
      expect(d.queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: '_device_category_' });
      expect('aggregation' in d.queryTimeTransformation.dataTransformation).toBe(false);
    }
    const l = looker(undefined, fields);
    const err = await run(context(l.rap), 'chart_add', { ...table, dimensions: ['Country'] }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'invalid' });
    expect((err as Error).message).toContain('sessions, Device Category');
    expect(writes(l.calls)).toEqual([]);
  });

  it('chart.metrics: metrics in input order with the field default aggregation, none for Record Count; unknown is invalid', async () => {
    const { c } = await add({ ...table, metrics: [{ field: 'sessions' }, { field: 'Record Count' }] });
    const names = slot(c, 'metrics', 'primary');
    expect(names).toHaveLength(2);
    expect(def(c, names[0]!).queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: '_sessions_', aggregation: 6 });
    expect(def(c, names[1]!).queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: 'datastudio_record_count_system_field_id_98323387' });
    await refused({ ...table, metrics: [{ field: 'revenue' }] });
  });

  it('chart.metrics.aggregation: maps sum/avg/count/count_distinct/min/max/none to 6/1/2/3/5/4/0', async () => {
    const want = { sum: 6, avg: 1, count: 2, count_distinct: 3, min: 5, max: 4, none: 0 };
    for (const [aggregation, n] of Object.entries(want)) {
      const { c } = await add({ ...table, metrics: [{ field: 'sessions', aggregation }] });
      expect(def(c, slot(c, 'metrics', 'primary')[0]!).queryTimeTransformation.dataTransformation.aggregation).toBe(n);
    }
  });

  it('chart.metrics.aggregation: a text field refuses avg (naming what it takes); Record Count refuses any', async () => {
    const l = looker();
    const err = await run(context(l.rap), 'chart_add', { ...table, metrics: [{ field: 'Device Category', aggregation: 'avg' }] }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: 'invalid' });
    expect((err as Error).message).toContain('count_distinct');
    expect(writes(l.calls)).toEqual([]);
    await refused({ ...table, metrics: [{ field: 'Record Count', aggregation: 'sum' }] });
  });

  it('chart.metrics.label: sets the display name; an empty label keeps the field name', async () => {
    const one = (await add({ ...table, metrics: [{ field: 'Record Count', label: 'Total uses' }] })).c;
    expect(def(one, slot(one, 'metrics', 'primary')[0]!).queryTimeTransformation.displayTransformation.displayName).toBe('Total uses');
    const two = (await add({ ...table, metrics: [{ field: 'Record Count', label: '' }] })).c;
    expect(def(two, slot(two, 'metrics', 'primary')[0]!).queryTimeTransformation.displayTransformation.displayName).toBe('Record Count');
  });

  it('chart.breakdown: a breakdown slot plus its breakdownConfig (10 rows, first metric descending, Others)', async () => {
    const { c } = await add({ ...table, type: 'column', breakdown: 'Device Category' });
    const [m] = slot(c, 'metrics', 'primary');
    const [d] = slot(c, 'dimensions', 'primary');
    // The breakdown slot lists exactly the breakdown concept: the one
    // Device Category concept that is not the primary dimension.
    const others = c.conceptDefs.filter((x: Json) => x.name !== d && x.queryTimeTransformation.dataTransformation.sourceFieldName === '_device_category_');
    expect(others).toHaveLength(1);
    const b = others[0].name as string;
    expect(slot(c, 'dimensions', 'breakdown')).toEqual([b]);
    expect(b).not.toBe(d);
    expect(def(c, b!).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_device_category_');
    const own = { conceptName: b, row: 10, sort: { sortColumn: m, sortDir: 1 }, reverseSortOrder: false, includeBreakdownOthers: true };
    // Bar and combo charts (simple-barchart, combochart) also need the primary
    // dimension's entry first: saving only the breakdown entry is refused by
    // updatePage with 400 {errorStatus code 3} (evidence
    // chart.breakdown/experiment-single-entry.json). Area charts do not.
    expect(c.propertyConfig.componentProperty.breakdownConfig).toEqual([{ conceptName: d, row: 100, sort: { sortDir: 0, sortColumn: d } }, own]);
    const area = (await add({ ...table, type: 'stacked_area', dimensions: ['date'], breakdown: 'Device Category' })).c;
    const abs = slot(area, 'dimensions', 'breakdown');
    expect(abs).toHaveLength(1);
    const [ab] = abs;
    expect(def(area, ab!).queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_device_category_');
    const [am] = slot(area, 'metrics', 'primary');
    expect(area.propertyConfig.componentProperty.breakdownConfig).toEqual([
      { conceptName: ab, row: 10, sort: { sortColumn: am, sortDir: 1 }, reverseSortOrder: false, includeBreakdownOthers: true },
    ]);
    // An area chart without a breakdown gets the constant "" concept.
    const plain = (await add({ ...table, type: 'stacked_area', dimensions: ['date'] })).c;
    const [k] = slot(plain, 'dimensions', 'breakdown');
    expect(def(plain, k!).queryTimeTransformation.dataTransformation).toMatchObject({ textFormula: '""', formulaOutputDataType: 0 });
  });

  it('chart.breakdown: pie, table, scorecard, pivot table and scatter refuse a breakdown', async () => {
    for (const type of ['pie', 'table', 'pivot_table', 'scatter'])
      await refused({ report_id: REPORT, type, dimensions: ['Device Category'], metrics: [{ field: 'sessions' }, { field: 'pageviews' }], breakdown: 'date' });
    await refused({ report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }], breakdown: 'date' });
  });

  it('chart.setup_slots: a pivot table\'s Column dimension follows the rows in primary and gets a col entry (title case ignored)', async () => {
    for (const title of ['Column dimension', 'column DIMENSION']) {
      const { c } = await add({ ...table, type: 'pivot_table', fields: { [title]: ['date'] } });
      const names = slot(c, 'dimensions', 'primary');
      expect(names.map((n) => def(c, n).queryTimeTransformation.dataTransformation.sourceFieldName)).toEqual(['_device_category_', '_date_']);
      const pivot = c.propertyConfig.componentProperty.pivotTableProperty.pivotDisplayConfig;
      expect(pivot.row).toHaveLength(1);
      expect(pivot.col).toHaveLength(1);
      expect(pivot.col[0].sort[0].sortColumn).toBe(names[1]);
    }
  });

  it('chart.setup_slots: a scorecard Sparkline goes to its own slot; unknown or empty titles and fields are invalid', async () => {
    const { c } = await add({ report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }], fields: { Sparkline: ['date'] } });
    expect(slot(c, 'dimensions', 'sparkline')).toHaveLength(1);
    const l = looker();
    const err = await run(context(l.rap), 'chart_add', { report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }], fields: { Foo: ['date'] } }).catch(
      (e: Error) => e,
    );
    expect(err).toMatchObject({ code: 'invalid' });
    expect((err as Error).message).toContain('"Sparkline"');
    expect((err as Error).message).toContain('"Target metric"');
    await refused({ report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }], fields: { '': ['date'] } });
    await refused({ report_id: REPORT, type: 'scorecard', metrics: [{ field: 'sessions' }], fields: { Sparkline: [''] } });
  });

  it('applies options other groups add and lets a kind place metrics in its own slots', async () => {
    const l = looker();
    await run(context(l.rap, { updaters: [filterUpdater] }), 'chart_add', { ...table, filters: ['f1'] });
    expect(added(l.calls).propertyConfig.componentProperty.filters).toEqual(['f1']);
    const { c } = await add({ ...table, type: 'scatter', metrics: [{ field: 'sessions' }, { field: 'pageviews' }] });
    expect(slot(c, 'metrics', 'x_metric')).toHaveLength(1);
    expect(slot(c, 'metrics', 'primary')).toBeUndefined();
  });
});


describe('native metric result calculations', () => {
  it('preserves percent of total independently of aggregation and label', async () => {
    const { c } = await add({ ...table, metrics: [
      { field: 'sessions', aggregation: 'sum' },
      { field: 'sessions', aggregation: 'sum', label: 'Share', calculation: 'percent_of_total', relative_to_base: false, bypass_filters: true },
    ] });
    const metrics = c.conceptDefs.filter((d: Json) => d.queryTimeTransformation?.dataTransformation?.sourceFieldName === '_sessions_');
    expect(metrics).toHaveLength(2);
    expect(metrics[0].resultTransformation).toBeUndefined();
    expect(metrics[1].resultTransformation).toEqual({ analyticalFunction: 1, isRelativeToBase: false, bypassCanvasFilters: true });
  });
  it('keeps an explicit none calculation and its saved flags', async () => {
    const { c } = await add({ ...table, metrics: [{ field: 'sessions', calculation: 'none', relative_to_base: true }] });
    expect(c.conceptDefs.find((d: Json) => d.resultTransformation)?.resultTransformation)
      .toEqual({ analyticalFunction: 0, isRelativeToBase: true, bypassCanvasFilters: false });
  });
  it('rejects calculation flags without a calculation', async () => {
    await refused({ ...table, metrics: [{ field: 'sessions', bypass_filters: true }] });
  });
});
