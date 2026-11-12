import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

/** A source that answers every breakdown query with a given number of values. */
function setup(values: Record<string, number>) {
  const f = fake(), original = f.ctx.rap.call.bind(f.ctx.rap), asked: Json[] = [];
  f.ctx.rap.call = (async (endpoint: string, body: unknown) => {
    if (endpoint !== 'batchedDataV2') return original(endpoint, body);
    const request = (body as Json).dataRequest[0]; asked.push(request);
    const names = request.datasetSpec.queryFields.map((q: Json) => q.name);
    const text = JSON.stringify(request), count = Object.entries(values).find(([field]) => text.includes(field))?.[1] ?? 2;
    return { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { size: count, totalCount: count, columnInfo: names.map((name: string) => ({ ns: 't0', name })),
      column: [{ stringColumn: { values: Array.from({ length: count }, (_, i) => `v${i}`) } }, { longColumn: { values: Array.from({ length: count }, (_, i) => String(i + 1)) } }] } } }] }] };
  }) as typeof f.ctx.rap.call;
  return { ...f, asked };
}
const input = { report_id: ORIGINAL, date: 'day', date_range: '2026-11-01..2026-11-07', metrics: [{ field: 'value', aggregation: 'sum', label: 'Value' }] };

describe('component_page_outline tool', () => {
  it('reads value counts once per breakdown, saves nothing and returns input that component_page_add accepts', async () => {
    const f = setup({ _category_: 3 }), before = structuredClone(f.original);
    const result = await f.run('component_page_outline', { ...input, dimensions: ['category'], cross: [{ row: 'category', column: 'category' }], page: 'p1',
      header: { title: 'Visits', band_color: '#123456' }, design: { table_header: 'accent' } });
    expect(result.isError, resultText(result)).toBeFalsy();
    const out = JSON.parse(resultText(result));
    expect(out.saved).toBe(false); expect(out.period_days).toBe(7);
    expect(out.observed).toEqual([{ dimension: 'category', values: 3, complete: true }]);
    expect(f.asked).toHaveLength(1);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    expect(out.page_add).toMatchObject({ report_id: ORIGINAL, page: 'p1', header: { title: 'Visits', band_color: '#123456' }, design: { table_header: 'accent' } });
    expect(out.page_add.regions.map((region: Json) => region.key)).toEqual(['overview', 'by_1', 'cross_1']);
    const built = await f.run('component_page_add', { ...out.page_add, preview: true });
    expect(built.isError, resultText(built)).toBeFalsy();
    expect(JSON.parse(resultText(built)).preview).toBe(true);
  });
  it('lists the dimensions it did not use and refuses unknown fields and open-ended periods', async () => {
    const f = setup({});
    const out = JSON.parse(resultText(await f.run('component_page_outline', input)));
    expect(out.unused_dimensions).toContain('category');
    expect(out.page_add.regions).toHaveLength(1);
    await expect(f.run('component_page_outline', { ...input, dimensions: ['missing'] })).rejects.toThrow();
    await expect(f.run('component_page_outline', { ...input, date_range: 'Last 7 days' })).rejects.toThrow();
  });
});

describe('component_report_add tool', () => {
  const pages = [
    { name: 'Visits', metrics: [{ field: 'value', aggregation: 'sum', label: 'Value' }], dimensions: ['category'] },
    { name: 'Detail', metrics: [{ field: 'value', aggregation: 'sum', label: 'Value' }], dimensions: ['category'], include: { overview: false } },
  ];
  const request = { report_id: ORIGINAL, date: 'day', date_range: '2026-11-01..2026-11-07', header: { band_color: '#123456', description: 'Seven days' }, pages };
  it('plans every page without writing when previewing', async () => {
    const f = setup({ _category_: 3 }), before = structuredClone(f.original);
    const out = JSON.parse(resultText(await f.run('component_report_add', { ...request, preview: true })));
    expect(out.saved).toBe(false);
    expect(out.pages.map((page: Json) => page.name)).toEqual(['Visits', 'Detail']);
    expect(out.pages[1].regions.map((region: Json) => region.key)).toEqual(['by_1']);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });
  it('reuses the empty first page, adds the rest, groups them into menu sections and composes each page', async () => {
    const f = setup({ _category_: 3 });
    const firstId = f.original.page[0]!.pageId, count = f.original.page.length;
    const result = await f.run('component_report_add', { ...request, pages: pages.map(page => ({ ...page, section: 'Traffic' })) });
    expect(result.isError, resultText(result)).toBeFalsy();
    const out = JSON.parse(resultText(result));
    expect(count).toBe(1);
    {
      expect(out.saved).toBe(true); expect(out.navigation).toBe('page menu with sections');
      expect(out.pages.every((page: Json) => page.tabs === false && page.section === 'Traffic')).toBe(true);
      const section = f.original.navigationInfo!.navItems!.find(item => item.section)!.section!;
      expect(section.displayName).toBe('Traffic'); expect(section.icon).toEqual({ matIcon: 'groups' }); expect(section.navItems!.map(item => item.page!.displayName)).toEqual(['Visits', 'Detail']);
      expect(out.pages.map((page: Json) => page.name)).toEqual(['Visits', 'Detail']);
      expect(out.pages[0].page_id).toBe(firstId);
      expect(f.original.page).toHaveLength(2);
      for (const page of f.original.page) expect((page.page.componentConfig ?? []).length).toBeGreaterThan(3);
    }
  });
  it('gives the first unsectioned page a home icon, takes explicit icons and refuses bad icon names', async () => {
    const f = setup({ _category_: 3 });
    const out = JSON.parse(resultText(await f.run('component_report_add', { ...request, pages: [pages[0], { ...pages[1], section: '기타', section_icon: 'insights', icon: 'analytics' }] })));
    expect(out.pages[0].icon).toBe('home'); expect(out.pages[1]).toMatchObject({ section_icon: 'insights', icon: 'analytics' });
    const items = f.original.navigationInfo!.navItems!;
    expect((items.find(item => item.page)!.page as Json).icon).toEqual({ matIcon: 'home' });
    const section = items.find(item => item.section)!.section!;
    expect(section.icon).toEqual({ matIcon: 'insights' }); expect((section.navItems![0]!.page as Json).icon).toEqual({ matIcon: 'analytics' });
    await expect(setup({}).run('component_report_add', { ...request, pages: [{ ...pages[0], icon: 'Home Icon' }] })).rejects.toThrow();
  });
  it('applies one brand color to the theme and to every header band', async () => {
    const f = setup({ _category_: 3 });
    const out = JSON.parse(resultText(await f.run('component_report_add', { ...request, header: { description: 'Seven days' }, brand_color: '#0b6e4f' })));
    expect(out.saved).toBe(true);
    expect(JSON.stringify(f.original.report.resource?.theme ?? {})).toContain('#0B6E4F');
    for (const page of f.original.page) {
      const band = (page.page.componentConfig ?? []).find(c => JSON.stringify(c).toUpperCase().includes('#0B6E4F'));
      expect(band, `page ${page.pageId} header band`).toBeTruthy();
    }
  });
  it('refuses duplicate page names and names already in the report', async () => {
    const f = setup({ _category_: 3 });
    await expect(f.run('component_report_add', { ...request, pages: [pages[0], pages[0]] })).rejects.toThrow(/different name/);
    expect(f.writes()).toEqual([]);
  });
});
