import { describe, expect, it } from 'vitest';

import { Extensions } from '../../../src/core/extensions.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { context, looker, REPORT, report, run, sentOnce, textOf, writes, type Json } from './helpers.js';

const box = (left: number, top: number, width: number, height: number) => ({ componentAttribute: { left, top, width, height } });

describe('component_list', () => {
  it('component.list: one line per component with id, kind and box, report-level marked; empty page; only getReport sent', async () => {
    const d = report();
    d.page[0]!.page.componentConfig = [
      { componentId: 'cd-text', type: 'simple-description', attributeConfig: box(10, 20, 300, 40) },
      { componentId: 'cd-kpi', type: 'kpi-metric', preset: 'default', attributeConfig: box(10, 80, 140, 80) },
      { componentId: 'cd-bars', type: 'simple-barchart', preset: 'vertical-stacked', attributeConfig: box(200, 80, 380, 280) },
    ];
    d.report.componentConfig = [{ componentId: 'cd-shape', type: 'generic-shape', attributeConfig: box(0, 0, 1200, 60) }];
    const l = looker(d);
    const out = textOf(await run(context(l.rap), 'component_list', { report_id: REPORT }));
    const rows = out.split('\n').filter((x) => x.startsWith('- '));
    expect(rows).toHaveLength(4);
    for (const [id, b] of [
      ['cd-text', 'left 10, top 20, 300x40'],
      ['cd-kpi', 'left 10, top 80, 140x80'],
      ['cd-bars', 'left 200, top 80, 380x280'],
      ['cd-shape', 'left 0, top 0, 1200x60'],
    ] as const)
      expect(rows.find((r) => r.includes(id))).toContain(b);
    expect(out).toContain('scorecard');
    expect(out).toContain('stacked_bar (Stacked bar chart)');
    expect(rows.find((r) => r.includes('cd-shape'))).toContain('report-level');
    expect(new Set(l.calls.map((c) => c.endpoint))).toEqual(new Set(['getReport']));

    const empty = report();
    empty.page[0]!.page.componentConfig = [];
    const e = looker(empty);
    expect(textOf(await run(context(e.rap), 'component_list', { report_id: REPORT }))).toContain('is empty');
    expect(e.calls.map((c) => c.endpoint)).toEqual(['getReport']);
  });
});

describe('component_inspect', () => {
  const kpiReport = (): ReportDoc => {
    const d = report();
    d.page[0]!.page.componentConfig = [
      {
        componentId: 'cd-kpi',
        type: 'kpi-metric',
        preset: 'default',
        datasourceId: 'dsA',
        conceptDefs: [
          {
            name: 'qt_m',
            queryTimeTransformation: { dataTransformation: { sourceFieldName: '_sessions_', aggregation: 6 }, displayTransformation: { displayName: 'sessions' } },
          },
        ],
        propertyConfig: {
          componentProperty: {
            metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_m'] } }] },
            kpiMetricProperty: { chartTitleProperty: { chartTitleText: '세션' }, backgroundColor: { color: '#ffffff', opacity: 1 } },
          },
        },
        attributeConfig: box(10, 20, 140, 80),
      },
    ];
    return d;
  };

  it('component.describe: reads runtime visualization labels through extensions', async () => {
    const doc = kpiReport();
    doc.page[0]!.page.componentConfig![0]!.type = 'gs://custom';
    const f = looker(doc);
    const ctx = context(f.rap);
    ctx.ext = new Extensions([{ group: 'runtime', extensions: { componentMetadata: async () => ({
      name: 'Runtime chart', creationTool: 'community_viz_add',
      slots: [{ title: 'Total', kind: 'metrics', key: 'primary' }],
      controls: [{ label: 'Accent' }, { label: 'Accent' }], style: { Accent: '#abcdef' },
    }) } }]);
    const out = textOf(await run(ctx, 'component_inspect', { report_id: REPORT, component_id: 'cd-kpi' }));
    expect(out).toContain('Runtime chart');
    expect(out).toContain('Total: sessions (Sum)');
    expect(out).toContain('Accent: #ABCDEF');
    expect(out).toContain('At their default: Accent#2');
    expect(writes(f.calls)).toEqual([]);
  });
  it('component.describe: shows kind, position, data source, slot fields, labels and colors as #RRGGBB; unknown id is not_found', async () => {
    const l = looker(kpiReport());
    const out = textOf(await run(context(l.rap), 'component_inspect', { report_id: REPORT, component_id: 'cd-kpi' }));
    expect(out).toContain('scorecard');
    expect(out).toContain('left 10, top 20, width 140, height 80');
    expect(out).toContain('4 Demo');
    expect(out).toContain('Metric: sessions (Sum)');
    expect(out).toContain('Title: "세션"');
    expect(out).toContain('#FFFFFF');
    expect(writes(l.calls)).toEqual([]);

    const m = looker(kpiReport());
    await expect(run(context(m.rap), 'component_inspect', { report_id: REPORT, component_id: 'cd-nope' })).rejects.toMatchObject({ code: 'not_found' });
    expect(writes(m.calls)).toEqual([]);
  });
});

describe('component_delete', () => {
  const abc = (): ReportDoc => {
    const d = report();
    d.page[0]!.page.componentConfig = [{ componentId: 'A' }, { componentId: 'B' }, { componentId: 'C' }];
    d.page[0]!.chartCondition = [{ chartId: 'B' }, { chartId: 'C' }];
    return d;
  };

  it('component.delete: removes the component and its conditional formatting in one updatePage; report level via updateReport; unknown id and dry run write nothing', async () => {
    const l = looker(abc());
    await run(context(l.rap), 'component_delete', { report_id: REPORT, component_id: 'B' });
    expect(l.calls.filter((c) => c.endpoint === 'updatePage')).toHaveLength(1);
    const body = sentOnce(l.calls, 'updatePage');
    expect(body.pageRequest.componentConfig.map((c: Json) => c.componentId)).toEqual(['A', 'C']);
    expect(body.pageRequest.chartCondition).toEqual([{ chartId: 'C' }]);

    const r = report();
    r.page[0]!.page.componentConfig = [{ componentId: 'A' }];
    r.report.componentConfig = [{ componentId: 'B' }, { componentId: 'Z' }];
    const rl = looker(r);
    const res = await run(context(rl.rap), 'component_delete', { report_id: REPORT, component_id: 'B' });
    expect(writes(rl.calls)).toEqual(['createNamedRevision', 'updateReport']);
    expect(sentOnce(rl.calls, 'updateReport').reportRequest.componentConfig).toEqual([{ componentId: 'Z' }]);
    expect(textOf(res)).toContain('revision 41');

    const n = looker(abc());
    await expect(run(context(n.rap), 'component_delete', { report_id: REPORT, component_id: 'cd-nope' })).rejects.toMatchObject({ code: 'not_found' });
    expect(writes(n.calls)).toEqual([]);

    const dry = looker(abc());
    const out = await run(context(dry.rap, { dryRun: true }), 'component_delete', { report_id: REPORT, component_id: 'B' });
    expect(writes(dry.calls)).toEqual([]);
    expect(textOf(out)).toContain('Would delete');
  });
});
