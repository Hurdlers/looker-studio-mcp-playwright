import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resultText } from '../../../src/core/tool.js';
import { box, comp, context, ids, looker, report, run } from './fake.js';

const A = 'cd-aaaaaaaaaa';
const B = 'cd-bbbbbbbbbb';
const C = 'cd-cccccccccc';
const X = 'cd-xxxxxxxxxx';

function abc() {
  return looker(report([{ id: 'p1', components: [comp(A, { left: 100, top: 100, width: 200, height: 80 }), comp(B), comp(C)] }]));
}

describe('component_update: position', () => {
  it('component.move_resize: changes only the keys given and leaves other components as they were', async () => {
    const lk = abc();
    const before = structuredClone(lk.doc.page[0]!.page.componentConfig![1]);
    await run(context(lk.rap), 'component_update', { component_id: A, position: { left: 300 } });
    const saves = lk.saves();
    expect(saves.map((s) => s.endpoint)).toEqual(['updatePage']);
    const sent = saves[0]!.body.pageRequest.componentConfig;
    expect(box(sent[0])).toMatchObject({ left: 300, top: 100, width: 200, height: 80 });
    expect(sent[1]).toEqual(before);
  });

  it('component.move_resize: nothing to change, an unknown component and a zero height are refused before saving', async () => {
    const lk = abc();
    const ctx = context(lk.rap);
    await expect(run(ctx, 'component_update', { component_id: A })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/Nothing to change/) });
    await expect(run(ctx, 'component_update', { component_id: 'cd-nope', position: { left: 1 } })).rejects.toMatchObject({ code: 'not_found' });
    await expect(run(ctx, 'component_update', { component_id: A, position: { height: 0 } })).rejects.toMatchObject({ code: 'invalid' });
    expect(lk.saves()).toEqual([]);
  });

  it('component.move_resize: a box past the page is saved with a warning, and a report-level component is saved with updateReport', async () => {
    const lk = looker(report([{ id: 'p1', components: [comp(A)] }], [comp(X)]));
    const res = await run(context(lk.rap), 'component_update', { component_id: X, position: { left: 1150 } });
    expect(lk.saves().map((s) => s.endpoint)).toEqual(['updateReport']);
    expect(box(lk.doc.report.componentConfig![0])).toMatchObject({ left: 1150 });
    expect(resultText(res)).toMatch(/past the page width 1200/);
  });
});

describe('component_update: order', () => {
  const cases = [
    ['component.order.front', A, 'front', [B, C, A], C],
    ['component.order.back', C, 'back', [C, A, B], A],
    ['component.order.forward', A, 'forward', [B, A, C], C],
    ['component.order.backward', C, 'backward', [A, C, B], A],
  ] as const;
  for (const [row, who, order, want, noop] of cases)
    it(`${row}: [A,B,C] → ${order} reorders componentConfig; a component already there is not saved`, async () => {
      const lk = abc();
      const ctx = context(lk.rap);
      await run(ctx, 'component_update', { component_id: who, order });
      expect(ids(lk.saves()[0]!.body.pageRequest.componentConfig)).toEqual(want);

      const lk2 = abc();
      const res = await run(context(lk2.rap), 'component_update', { component_id: noop, order });
      expect(lk2.saves()).toEqual([]);
      expect(resultText(res)).toMatch(/already (in front|behind)/);
    });
});

describe('component_update: report_level', () => {
  function withText() {
    return looker(
      report([
        { id: 'p1', components: [comp(A), comp(X, {}, { type: 'simple-description' })], chartCondition: [{ chartId: X, conditionalFormat: { rule: [] } }], groups: [{ groupId: 'g-1', componentId: [A, X], childGroupId: [] }] },
        { id: 'p2', components: [comp(B)] },
      ]),
    );
  }

  it('component.report_level: true adds it at report level with its formatting, then takes it off the page; a failed page save undoes the report save', async () => {
    const lk = withText();
    await run(context(lk.rap), 'component_update', { component_id: X, report_level: true });
    const [rep, page] = lk.saves();
    expect(rep!.endpoint).toBe('updateReport');
    expect(ids(rep!.body.reportRequest.componentConfig).at(-1)).toBe(X);
    expect(rep!.body.reportRequest.chartCondition).toEqual([{ chartId: X, conditionalFormat: { rule: [] } }]);
    expect(page!.endpoint).toBe('updatePage');
    expect(ids(page!.body.pageRequest.componentConfig)).toEqual([A]);
    expect(page!.body.pageRequest.chartCondition).toEqual([]);
    expect(page!.body.pageRequest.groupConfig[0].componentId).toEqual([A]);

    const bad = looker(withText().doc, { failPageSaves: true });
    await expect(run(context(bad.rap), 'component_update', { component_id: X, report_level: true })).rejects.toThrow(/HTTP 500/);
    const sent = bad.saves();
    expect(sent.map((s) => s.endpoint)).toEqual(['updateReport', 'updatePage', 'updateReport']);
    expect(ids(sent[2]!.body.reportRequest.componentConfig)).not.toContain(X);
  });

  it('component.report_level: true on a report-level component saves nothing; false with page p2 moves it to the end of p2', async () => {
    const lk = looker(report([{ id: 'p1', components: [comp(A)] }, { id: 'p2', components: [comp(B)] }], [comp(X)]));
    const res = await run(context(lk.rap), 'component_update', { component_id: X, report_level: true });
    expect(lk.saves()).toEqual([]);
    expect(resultText(res)).toMatch(/already report-level/);

    await run(context(lk.rap), 'component_update', { component_id: X, report_level: false, page: 'p2' });
    expect(lk.saves().map((s) => s.endpoint)).toEqual(['updatePage', 'updateReport']);
    expect(ids(lk.doc.page[1]!.page.componentConfig)).toEqual([B, X]);
    expect(ids(lk.doc.report.componentConfig)).toEqual([]);
    expect(ids(lk.doc.page[0]!.page.componentConfig)).toEqual([A]);
  });

  it('component.report_level: report_level true with order back puts it behind the other report-level components', async () => {
    const lk = looker(report([{ id: 'p1', components: [comp(A), comp(X)] }], [comp(B)]));
    await run(context(lk.rap), 'component_update', { component_id: X, report_level: true, order: 'back' });
    expect(ids(lk.doc.report.componentConfig)).toEqual([X, B]);
    expect(ids(lk.doc.page[0]!.page.componentConfig)).toEqual([A]);
  });
});

describe('component_update: other groups\' settings', () => {
  it('applies an updater from another group, then the position, in one save', async () => {
    const lk = abc();
    const seen: unknown[] = [];
    const ctx = context(lk.rap, [
      {
        group: 'other',
        extensions: {
          updaters: [
            {
              key: 'label',
              input: z.string().describe('A label.'),
              apply: async (t, v) => {
                seen.push(t.component.attributeConfig.componentAttribute.left);
                t.component.propertyConfig.componentProperty.label = v;
                return 'kept short';
              },
            },
          ],
        },
      },
    ]);
    const res = await run(ctx, 'component_update', { component_id: A, label: 'Hi', position: { left: 10 } });
    expect(seen).toEqual([100]);
    const sent = lk.saves()[0]!.body.pageRequest.componentConfig[0];
    expect(sent.propertyConfig.componentProperty.label).toBe('Hi');
    expect(box(sent).left).toBe(10);
    expect(resultText(res)).toMatch(/label: kept short/);
  });
});
