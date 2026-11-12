import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { parseType } from '../../../src/features/data-sources/types.js';
import { A, context, looker, R1, sent, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

function setup(opts: { dryRun?: boolean; single?: boolean } = {}) {
  const f = looker();
  if (opts.single !== false) f.report.report.resource!.datasourceAlias = [{ datasourceId: A, alias: 'ds1' }];
  const ctx = context(f.rap, opts.dryRun ? { dryRun: true } : {});
  const update = async (args: Record<string, unknown>) => resultText(await runTool(ctx, 'field_update', { report_id: R1, ...args }));
  const before = structuredClone(f.sources[A]!.published.datasourceBlock.fields) as Json[];
  const published = () => f.calls.filter((c) => c.endpoint === 'publishDatasource').map((c) => c.body.draft.datasourceBlock.fields as Json[]);
  return { ...f, update, before, published };
}

const others = (fields: Json[], name: string) => fields.filter((f) => f.field.name !== name);

describe('field_update', () => {
  it('keeps native semantic options when a spec reapplies the same type', async () => {
    for (const [type, semantic] of [
      ['Date', { semanticType: 2, dateTimeOptions: { useNativeDateTime: true } }],
      ['Currency > EUR', { semanticType: 12, currencyOptions: { currencyCode: 'EUR', customFormat: 'native' } }],
    ] as const) {
      const s = setup();
      const field = s.sources[A]!.published.datasourceBlock.fields.find((f: Json) => f.field.name === '_sessions_')!;
      field.outputSemanticInfo.semanticConfig = [structuredClone(semantic)];
      await s.update({ field: 'sessions', type, name: 'Restored field' });
      expect(s.published()[0]!.find((f) => f.field.name === '_sessions_')!.outputSemanticInfo.semanticConfig).toEqual([semantic]);
    }
  });

  it('field.update.type: changes only that field\'s semantic type, with a currency code from a menu path', async () => {
    const s = setup();
    const out = await s.update({ field: 'session_medium', type: 'Number' });
    const [fields] = s.published();
    expect(fields!.find((f) => f.field.name === '_session_medium_')!.outputSemanticInfo.semanticConfig).toEqual([{ semanticType: 33 }]);
    expect(others(fields!, '_session_medium_')).toEqual(others(s.before, '_session_medium_'));
    expect(out).toContain('"session_medium" (_session_medium_): Number');

    const c = setup();
    const money = await c.update({ field: 'sessions', type: 'Currency > EUR' });
    expect(c.published()[0]!.find((f) => f.field.name === '_sessions_')!.outputSemanticInfo.semanticConfig).toEqual([
      { semanticType: 12, currencyOptions: { currencyCode: 'EUR' } },
    ]);
    expect(money).toContain('Currency (EUR)');
    // Bare names are found in submenus too; enum names work.
    expect(parseType('Country')).toEqual({ semanticType: 16 });
    expect(parseType('Date & Time > Date Hour')).toEqual({ semanticType: 1 });
    expect(parseType('YEAR_MONTH_DAY')).toEqual({ semanticType: 2 });
    expect(parseType('Currency > KRW - Korean won')).toEqual({ semanticType: 12, currencyOptions: { currencyCode: 'KRW' } });
    expect(() => parseType('Currency')).toThrow(/three-letter/);
  });

  it('field.update.type: an unknown field lists the fields, two sources need data_source, and a dry run publishes nothing', async () => {
    const s = setup();
    await expect(s.update({ field: 'nope', type: 'Number' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('device_category, sessions, session_medium') });
    const two = setup({ single: false });
    await expect(two.update({ field: 'sessions', type: 'Number' })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining(`ds1 "${TABLE}", ds2 "Custom query"`),
    });
    const dry = setup({ dryRun: true });
    const out = await dry.update({ field: 'sessions', type: 'Percent' });
    expect(sent(dry.calls)).not.toContain('publishDatasource');
    expect(out).toMatch(/Dry run .*publishDatasource/);
  });

  it('field.update.aggregation: sets the default aggregation; an amount on a text field is invalid', async () => {
    const want: Record<string, number> = { avg: 1, count_distinct: 3, median: 10, std_dev: 12, variance: 11, none: 0 };
    for (const [aggregation, n] of Object.entries(want)) {
      const s = setup();
      await s.update({ field: 'sessions', aggregation });
      expect(s.published()[0]!.find((f) => f.field.name === '_sessions_')!.defaultAggregationType).toBe(n);
    }
    const t = setup();
    await expect(t.update({ field: 'device_category', aggregation: 'sum' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Number first') });
    expect(t.published()).toEqual([]);
  });

  it('field.update.rename: renames the field and keeps its id; type, aggregation and name go in one publish; nothing or a blank name is invalid', async () => {
    const s = setup();
    const out = await s.update({ field: 'sessions', name: 'Sessions (all)' });
    const field = s.published()[0]!.find((f) => f.field.name === '_sessions_')!;
    expect(field.outputName).toBe('Sessions (all)');
    expect(field.field.name).toBe('_sessions_');
    expect(out).toContain('"Sessions (all)" (_sessions_)');

    const all = setup();
    await all.update({ field: 'session_medium', type: 'Number', aggregation: 'sum', name: 'medium n' });
    expect(all.published()).toHaveLength(1);
    expect(all.published()[0]!.find((f) => f.field.name === '_session_medium_')).toMatchObject({
      outputName: 'medium n',
      defaultAggregationType: 6,
      outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] },
    });

    for (const args of [{ field: 'sessions' }, { field: 'sessions', name: '' }]) {
      const n = setup();
      await expect(n.update(args)).rejects.toMatchObject({ code: 'invalid' });
      expect(n.calls).toEqual([]);
    }
  });
});
