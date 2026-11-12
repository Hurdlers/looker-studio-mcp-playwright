import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { box, comp, context, looker, report, run } from './fake.js';

const X = 'cd-xxxxxxxxxx';

function chart() {
  return comp(
    X,
    { left: 100, top: 100, width: 200, height: 80 },
    {
      type: 'kpi-metric',
      conceptDefs: [{ id: 't0.qt_a', name: 'qt_a', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_n_', aggregation: 6 } } }],
      propertyConfig: { componentProperty: { dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_a'] } }] } } },
    },
  );
}

describe('component_duplicate', () => {
  it('component.duplicate: the copy has a new id, sits 20 px right and down, and has its own concept names', async () => {
    const lk = looker(report([{ id: 'p1', components: [chart()] }]));
    const original = structuredClone(lk.doc.page[0]!.page.componentConfig![0]);
    const res = await run(context(lk.rap), 'component_duplicate', { component_id: X });
    const sent = lk.saves()[0]!.body.pageRequest.componentConfig;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(original);
    const copy = sent[1];
    expect(copy.componentId).not.toBe(X);
    expect(copy.componentId).toMatch(/^cd-/);
    expect(box(copy)).toMatchObject({ left: 120, top: 120, width: 200, height: 80 });
    const name = copy.conceptDefs[0].name;
    expect(name).not.toBe('qt_a');
    expect(copy.conceptDefs[0].id).toBe(`t0.${name}`);
    expect(copy.propertyConfig.componentProperty.dimensions.labeledConcepts[0].value.conceptNames).toEqual([name]);
    expect(resultText(res)).toContain(copy.componentId);
  });

  it('component.duplicate: position overrides the box, conditional formatting is copied to the new id, unknown ids are not found', async () => {
    const lk = looker(report([{ id: 'p1', components: [chart()], chartCondition: [{ chartId: X, conditionalFormat: { rule: [{ field: 'qt_a' }] } }] }]));
    await run(context(lk.rap), 'component_duplicate', { component_id: X, position: { left: 600, top: 400 } });
    const req = lk.saves()[0]!.body.pageRequest;
    const copy = req.componentConfig[1];
    expect(box(copy)).toMatchObject({ left: 600, top: 400, width: 200, height: 80 });
    expect(req.chartCondition).toHaveLength(2);
    expect(req.chartCondition[0].chartId).toBe(X);
    expect(req.chartCondition[1].chartId).toBe(copy.componentId);
    expect(req.chartCondition[1].conditionalFormat.rule[0].field).toBe(copy.conceptDefs[0].name);

    const ctx = context(lk.rap);
    await expect(run(ctx, 'component_duplicate', { component_id: 'cd-nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('gives a control copy the next alias and a line copy end points that moved with it', async () => {
    const control = comp('cd-ctl', {}, { type: 'dimension-filter' });
    control.attributeConfig.componentAttribute.alias = 'df7';
    const line = comp('cd-line', { left: 50, top: 60 }, { type: 'arrow' });
    line.propertyConfig.componentProperty.arrowProperty = {
      terminals: { start: { componentId: 'cd-ctl', anchorId: 'a', left: 50, top: 60 }, end: { componentId: '', anchorId: '', left: 150, top: 60 } },
    };
    const lk = looker(report([{ id: 'p1', components: [control, line] }]));
    await run(context(lk.rap), 'component_duplicate', { component_id: 'cd-ctl' });
    expect(box(lk.doc.page[0]!.page.componentConfig!.at(-1)).alias).toBe('df8');
    await run(context(lk.rap), 'component_duplicate', { component_id: 'cd-line' });
    const t = (lk.doc.page[0]!.page.componentConfig!.at(-1) as Record<string, any>).propertyConfig.componentProperty.arrowProperty.terminals;
    expect(t.start).toEqual({ componentId: '', anchorId: '', left: 70, top: 80 });
    expect(t.end).toMatchObject({ left: 170, top: 80 });
  });
});
