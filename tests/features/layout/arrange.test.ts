import { describe, expect, it } from 'vitest';

import { box, comp, context, ids, looker, report, run } from './fake.js';

const A = 'cd-aaaaaaaaaa';
const B = 'cd-bbbbbbbbbb';
const C = 'cd-cccccccccc';

function three() {
  return looker(
    report([
      {
        id: 'p1',
        components: [
          comp(A, { left: 100, top: 50, width: 200, height: 100 }),
          comp(B, { left: 300, top: 200, width: 100, height: 50 }),
          comp(C, { left: 50, top: 400, width: 300, height: 80 }),
        ],
      },
    ]),
  );
}

type Box = { left: number; top: number; width: number; height: number };
const original: Record<string, Box> = {
  [A]: { left: 100, top: 50, width: 200, height: 100 },
  [B]: { left: 300, top: 200, width: 100, height: 50 },
  [C]: { left: 50, top: 400, width: 300, height: 80 },
};

const aligns = [
  ['component.arrange.align_left', 'align_left', 'left', [50, 50, 50]],
  ['component.arrange.align_center', 'align_center', 'left', [125, 175, 75]],
  ['component.arrange.align_right', 'align_right', 'left', [200, 300, 100]],
  ['component.arrange.align_top', 'align_top', 'top', [50, 50, 50]],
  ['component.arrange.align_middle', 'align_middle', 'top', [215, 240, 225]],
  ['component.arrange.align_bottom', 'align_bottom', 'top', [380, 430, 400]],
] as const;

describe('component_arrange: align', () => {
  for (const [row, action, key, want] of aligns) {
    it(`${row}: moves only ${key} to ${want.join('/')}`, async () => {
      const lk = three();
      await run(context(lk.rap), 'component_arrange', { component_ids: [A, B, C], action });
      const sent = lk.saves()[0]!.body.pageRequest.componentConfig;
      expect(lk.saves()).toHaveLength(1);
      sent.forEach((c: Record<string, any>, i: number) => {
        expect(box(c)).toEqual({ ...original[c.componentId]!, [key]: want[i] });
      });
    });

    it(`${row}: a repeated id counts once and an unknown id is not found, both before saving`, async () => {
      const lk = three();
      const ctx = context(lk.rap);
      await expect(run(ctx, 'component_arrange', { component_ids: [A, A], action })).rejects.toMatchObject({ code: 'invalid' });
      await expect(run(ctx, 'component_arrange', { component_ids: [A, 'cd-nope'], action })).rejects.toMatchObject({ code: 'not_found' });
      expect(lk.saves()).toEqual([]);
    });
  }

  it('moves a group as one block and a report-level component with updateReport', async () => {
    const lk = looker(
      report(
        [{ id: 'p1', components: [comp(A, { left: 100 }), comp(B, { left: 300 })], groups: [{ groupId: 'g-1', componentId: [A, B], childGroupId: [] }] }],
        [comp(C, { left: 40 })],
      ),
    );
    await run(context(lk.rap), 'component_arrange', { component_ids: ['g-1', C], action: 'align_left' });
    expect(lk.saves().map((s) => s.endpoint)).toEqual(['updateReport', 'updatePage']);
    expect(box(lk.doc.page[0]!.page.componentConfig![0]).left).toBe(40);
    expect(box(lk.doc.page[0]!.page.componentConfig![1]).left).toBe(240);
    expect(box(lk.doc.report.componentConfig![0]).left).toBe(40);
  });

  it('refuses components on two different pages', async () => {
    const lk = looker(report([{ id: 'p1', components: [comp(A)] }, { id: 'p2', components: [comp(B)] }]));
    await expect(run(context(lk.rap), 'component_arrange', { component_ids: [A, B], action: 'align_left' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('component_arrange: distribute', () => {
  it('component.arrange.distribute_horizontally: the middle one gets the average gap, the ends stay', async () => {
    const lk = looker(
      report([{ id: 'p1', components: [comp(A, { left: 0, width: 100 }), comp(B, { left: 150, width: 100 }), comp(C, { left: 500, width: 100 })] }]),
    );
    await run(context(lk.rap), 'component_arrange', { component_ids: [C, B, A], action: 'distribute_horizontally' });
    const sent = lk.saves()[0]!.body.pageRequest.componentConfig;
    expect(sent.map((c: Record<string, any>) => box(c).left)).toEqual([0, 250, 500]);
  });

  it('component.arrange.distribute_horizontally: two components are refused before saving', async () => {
    const lk = three();
    await expect(run(context(lk.rap), 'component_arrange', { component_ids: [A, B], action: 'distribute_horizontally' })).rejects.toMatchObject({ code: 'invalid' });
    expect(lk.saves()).toEqual([]);
  });

  it('component.arrange.distribute_vertically: the middle one gets the average gap, the ends stay', async () => {
    const lk = looker(
      report([{ id: 'p1', components: [comp(A, { top: 0, height: 50 }), comp(B, { top: 60, height: 50 }), comp(C, { top: 400, height: 50 })] }]),
    );
    await run(context(lk.rap), 'component_arrange', { component_ids: [A, B, C], action: 'distribute_vertically' });
    const sent = lk.saves()[0]!.body.pageRequest.componentConfig;
    expect(sent.map((c: Record<string, any>) => box(c).top)).toEqual([0, 200, 400]);
  });

  it('component.arrange.distribute_vertically: two components are refused before saving', async () => {
    const lk = three();
    await expect(run(context(lk.rap), 'component_arrange', { component_ids: [A, C, A], action: 'distribute_vertically' })).rejects.toMatchObject({ code: 'invalid' });
    expect(lk.saves()).toEqual([]);
  });
});

describe('component_arrange: group and ungroup', () => {
  it('component.arrange.group: adds one group entry and leaves the components as they were; report-level components are refused', async () => {
    const lk = three();
    const before = structuredClone(lk.doc.page[0]!.page.componentConfig);
    await run(context(lk.rap), 'component_arrange', { component_ids: [A, B], action: 'group' });
    const req = lk.saves()[0]!.body.pageRequest;
    expect(req.groupConfig).toHaveLength(1);
    expect(req.groupConfig[0]).toMatchObject({ componentId: [A, B], childGroupId: [], groupId: expect.stringMatching(/^g-/) });
    expect(req.groupConfig[0].propertyConfig.groupProperty).toMatchObject({ inheritFilters: true, controlStatePassThrough: false, sectionType: 0 });
    expect(req.componentConfig).toEqual(before);

    const lk2 = looker(report([{ id: 'p1', components: [comp(A)] }], [comp(C)]));
    await expect(run(context(lk2.rap), 'component_arrange', { component_ids: [A, C], action: 'group' })).rejects.toMatchObject({ code: 'invalid' });
    expect(lk2.saves()).toEqual([]);
  });

  it('component.arrange.group: grouping a group with another component merges them into one group', async () => {
    const lk = looker(
      report([{ id: 'p1', components: [comp(A), comp(B), comp(C)], groups: [{ groupId: 'g-1', componentId: [A, B], childGroupId: [] }] }]),
    );
    await run(context(lk.rap), 'component_arrange', { component_ids: ['g-1', C], action: 'group' });
    const groups = lk.doc.page[0]!.page.groupConfig!;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.groupId).not.toBe('g-1');
    expect(groups[0]!.componentId).toEqual([A, B, C]);
  });

  it('component.arrange.ungroup: removes the group by its id or a member id; a component in no group is refused', async () => {
    const make = () =>
      looker(report([{ id: 'p1', components: [comp(A), comp(B), comp(C)], groups: [{ groupId: 'g-1', componentId: [A, B], childGroupId: [] }] }]));
    for (const given of ['g-1', A]) {
      const lk = make();
      const before = structuredClone(lk.doc.page[0]!.page.componentConfig);
      await run(context(lk.rap), 'component_arrange', { component_ids: [given], action: 'ungroup' });
      const req = lk.saves()[0]!.body.pageRequest;
      expect(req.groupConfig).toEqual([]);
      expect(req.componentConfig).toEqual(before);
      expect(ids(req.componentConfig)).toEqual([A, B, C]);
    }
    const lk = make();
    await expect(run(context(lk.rap), 'component_arrange', { component_ids: [C], action: 'ungroup' })).rejects.toMatchObject({ code: 'invalid' });
    expect(lk.saves()).toEqual([]);
  });
});
