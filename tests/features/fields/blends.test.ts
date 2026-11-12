import { describe, expect, it } from 'vitest';

import { blendsOf } from '../../../src/features/chart-core/blend-source.js';
import { runTool } from '../../../src/core/tool.js';
import { A, B, fake, input, writes } from './fake.js';

const tables = [
  { data_source: 'ds1', dimensions: ['device_category'], metrics: ['sessions'] },
  { data_source: 'ds2', dimensions: ['device_category'], metrics: ['sessions'] },
];
const args = { report_id: input.report_id, name: 'Combined totals', tables, joins: [{ keys: [['device_category', 'device_category']] }] };
const blend = (f: ReturnType<typeof fake>) => f.resource().dataViewResource.entry[0].value.blockDatasource;
describe('blends', () => {
  it('blend.create adds a source resource with query concepts, output fields and preserved existing resources', async () => {
    const f = fake(), before = structuredClone(f.resource());
    await runTool(f.ctx, 'blend_create', args);
    expect(f.resource().datasourceAlias).toEqual(before.datasourceAlias);
    expect(f.resource().filter).toEqual(before.filter);
    const b = blend(f), block = b.blocks[0], join = block.treeQueryBlockConfig.join;
    expect(block).toMatchObject({ type: 6, isExperimental: true });
    expect(join).toMatchObject({ type: 3, left: { query: { datasourceId: A } }, right: { query: { datasourceId: B } } });
    const left = join.left.query.concepts, right = join.right.query.concepts;
    expect(join.condition.and.conditions).toEqual([{ boolean: { joinKeyPair: { leftName: left[0].id.name, rightName: right[0].id.name } } }]);
    expect(left[0].queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: '_device_category_' });
    expect(left[1].queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: '_sessions_', aggregation: 6 });
    expect(b.datasourceBlock.name).toBe(args.name);
    expect(b.datasourceBlock.fields[0]).toMatchObject({ field: { name: expect.stringMatching(/^calc_.+_dv0$/) }, queryTimeTransformation: { dataTransformation: { sourceFieldName: left[0].id.name } } });
    const readback = blendsOf(f.report)[0]!;
    expect(readback.name).toBe(args.name);
    expect(readback.fields.map((x) => [x.name, x.kind])).toEqual([['device_category', 'dimension'], ['sessions', 'metric'], ['device_category (2)', 'dimension'], ['sessions (2)', 'metric']]);
    expect(writes(f).map((c) => c.endpoint)).toEqual(['updateReport']);
  });
  it.each([1, 6])('blend.create rejects %d tables', async (count) => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, tables: Array.from({ length: count }, () => tables[0]) })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('blend.create rejects empty selections before requests', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, tables: [{ data_source: 'ds1' }, tables[1]] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('blend.create gives available source names when lookup fails', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, tables: [{ ...tables[0], data_source: 'Missing' }, tables[1]] })).rejects.toMatchObject({ code: 'not_found', message: expect.stringMatching(/ds1.*ds2/) });
    expect(writes(f)).toHaveLength(0);
  });
  it.each([['inner', 1], ['full outer', 2], ['right outer', 4], ['left outer', 3]])('blend.join.keyed maps %s to %d', async (type, code) => {
    const f = fake(); await runTool(f.ctx, 'blend_create', { ...args, joins: [{ ...args.joins[0], type }] });
    expect(blend(f).blocks[0].treeQueryBlockConfig.join.type).toBe(code);
  });
  it('blend.join.keyed needs one join per following table', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, tables: [...tables, tables[0]] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
  it('blend.join.keyed requires a right selected dimension', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, joins: [{ keys: [['device_category', 'session_medium']] }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('blend.join.keyed rejects duplicate uses of a join key', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, joins: [{ keys: [['device_category', 'device_category'], ['device_category', 'device_category']] }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes(f)).toHaveLength(0);
  });
  it('blend.join.keyed nests a previous join on the left with three tables', async () => {
    const f = fake();
    await runTool(f.ctx, 'blend_create', { ...args, tables: [...tables, tables[0]], joins: [args.joins[0], { type: 'cross' }] });
    expect(blend(f).blocks[0].treeQueryBlockConfig.join.left.join.type).toBe(3);
  });
  it('blend.join.cross stores type three without a condition', async () => {
    const f = fake(); await runTool(f.ctx, 'blend_create', { ...args, joins: [{ type: 'cross', keys: [] }] });
    const join = blend(f).blocks[0].treeQueryBlockConfig.join;
    expect(join.type).toBe(3);
    expect(join).not.toHaveProperty('condition');
  });
  it('blend.join.cross rejects any key pairs', async () => {
    const f = fake();
    await expect(runTool(f.ctx, 'blend_create', { ...args, joins: [{ ...args.joins[0], type: 'cross' }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toHaveLength(0);
  });
});
