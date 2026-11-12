import { describe, expect, it } from 'vitest';
import { fromMapValue, toMapValue } from '../../../src/core/mapvalue.js';
import { fake, CREATED, type Json } from './fake.js';

const periods = (components: Json[]) => components.filter(c => c.type === 'simple-daterangepicker').map(c => (fromMapValue(c.behavior) as Json).onSelect[0].init);
describe('date picker specification defaults', () => {
  it('preserves fixed, relative and automatic defaults instead of inheriting the creation fixture', async () => {
    const f = fake();
    for (const [index, date_range] of ['2026-11-01..2026-11-03', 'Last 14 days', 'Auto date range'].entries())
      await f.add('control_add', { kind: 'date_range', date_range, position: { left: 20, top: 20 + index * 70, width: 300, height: 44 } });
    const before = periods(f.original.page[0]!.page.componentConfig as Json[]);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components.map((c: Json) => c.date_range)).toEqual(['2026-11-01..2026-11-03', 'Last 14 days', 'Auto date range']);
    const result = await f.run('report_spec_apply', { spec: exported.spec });
    expect(result.isError).not.toBe(true);
    expect(periods(f.reports[CREATED]!.page[0]!.page.componentConfig as Json[])).toEqual(before);
  });
  it('refuses an unrepresentable initial range instead of omitting it', async () => {
    const f = fake(); await f.add('control_add', { kind: 'date_range', date_range: 'Last 14 days' });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    const behavior = fromMapValue(c.behavior) as Json;
    behavior.onSelect[0].init.dateRange.unknownAnchorRule = true;
    c.behavior = toMapValue(behavior);
    await expect(f.exportSpec()).rejects.toThrow(/unsupported date picker initial range/);
  });
});
