import { describe, expect, it, vi } from 'vitest';
import { pageSize } from '../../../src/core/page.js';
import { resultText } from '../../../src/core/tool.js';
import { fitPageCanvas } from '../../../src/features/component-templates/canvas.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const args = { report_id: ORIGINAL, template_id: 'common-kpi', bindings: { metric: { field: 'value', aggregation: 'sum' } },
  position: { left: 288, top: 1060 }, size: { width: 400, height: 180 } };
const parsed = (r: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(r));
function setup(options: Parameters<typeof fake>[0] = {}) {
  const f = fake(options);
  f.original.shareable.name = '[looker-studio-mcp-lab-1] canvas fitting';
  f.original.report.attributeConfig = { reportAttribute: { width: 1440, height: 900 } };
  delete f.original.page[0]!.page.attributeConfig;
  f.original.page.push({ pageId: 'other', page: { componentConfig: [{ componentId: 'unrelated', type: 'text' }] } });
  return f;
}

describe('common template canvas fitting', () => {
  it('saves a lower card and its page growth together without shrinking an inherited width', async () => {
    const f = setup(), report = structuredClone(f.original.report), other = structuredClone(f.original.page[1]);
    const out = parsed(await f.run('component_template_add', args));
    expect(out).toMatchObject({ saved: true, canvas: { width: 1440, height: 1264 } });
    expect(out.creation).toMatch(/^Added /);
    expect(out.creation).not.toMatch(/hidden until the page grows|Would add/);
    expect(pageSize(f.original, 'p1')).toEqual({ width: 1440, height: 1264 });
    expect((f.original.page[0]!.page.attributeConfig as Json).pageAttribute.width).toBeUndefined();
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
    expect(f.original.report).toEqual(report); expect(f.original.page[1]).toEqual(other);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
    expect(f.writes().filter(c => c.endpoint === 'updateReport')).toHaveLength(0);
  });

  it('places an automatic chart below full-width content instead of clamping it into existing content', async () => {
    const f = setup();
    const first = parsed(await f.run('component_template_add', { ...args, position: { left: 24, top: 24 }, size: { width: 1392, height: 850 } }));
    const second = parsed(await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-kpi', bindings: args.bindings }));
    expect(second.position.top).toBeGreaterThanOrEqual(first.position.top + first.size.height + 24);
    expect(second.canvas.height).toBeGreaterThanOrEqual(second.position.top + second.size.height + 24);
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(2);
  });

  it('shows the required canvas in preview and config dry-run without persisting anything', async () => {
    for (const configDry of [false, true]) {
      const f = setup({ snapshots: true, dryRun: configDry }), before = structuredClone(f.original);
      const response = await f.run('component_template_add', { ...args, ...(!configDry ? { preview: true } : {}) });
      expect(resultText(response)).toContain('1264');
      expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
    }
  });

  it('rejects overflow including padding before saving a chart or snapshot', async () => {
    const f = setup({ snapshots: true }), before = structuredClone(f.original);
    await expect(f.run('component_template_add', { ...args, position: { left: 20, top: 19800 } })).rejects.toThrow(/20000/);
    expect(f.original).toEqual(before); expect(f.writes()).toEqual([]);
  });

  it('keeps inherited canvas dimensions when a composition already fits', async () => {
    const f = setup(), before = structuredClone(f.original.report);
    await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'common-navbar', bindings: {},
      navigation: { layout: 'vertical', items: [{ label: 'Overview', page: 'p1' }] }, position: { left: 24, top: 24 }, size: { width: 240, height: 720 } });
    expect(pageSize(f.original, 'p1')).toEqual({ width: 1440, height: 900 });
    expect(f.original.page[0]!.page.attributeConfig).toBeUndefined();
    expect(f.original.report).toEqual(before);
  });

  it('repairs a clipped existing card on update and then becomes a no-op', async () => {
    const f = setup(), made = parsed(await f.run('component_template_add', args));
    (f.original.page[0]!.page.attributeConfig as Json).pageAttribute.height = 900;
    const desired = { ...args, component_id: made.component_ids[0] };
    f.clear();
    expect(parsed(await f.run('component_template_update', desired))).toMatchObject({ saved: true, unchanged: false, canvas: { width: 1440, height: 1264 } });
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
    f.clear();
    expect(parsed(await f.run('component_template_update', desired))).toMatchObject({ saved: false, unchanged: true });
    expect(f.writes()).toEqual([]);
  });

  it('rejects concurrent page edits rather than overwriting or placing against stale content', async () => {
    const f = setup(), edit = f.ctx.session.editPage.bind(f.ctx.session);
    vi.spyOn(f.ctx.session, 'editPage').mockImplementation((reportId, pageId, mutate, reason) => edit(reportId, pageId, (page, doc) => {
      page.page.attributeConfig = { pageAttribute: { width: 1600 } };
      mutate(page, doc);
    }, reason));
    await expect(f.run('component_template_add', args)).rejects.toThrow(/changed/);
    expect(f.writes()).toEqual([]);
  });

  it('validates all requested extents before mutating canvas dimensions', () => {
    const f = setup(), page = f.original.page[0]!, before = structuredClone(page);
    expect(() => fitPageCanvas(page, f.original, [{ left: 0, top: 0, width: 1600, height: 100 }, { left: 0, top: 19900, width: 100, height: 100 }])).toThrow(/20000/);
    expect(page).toEqual(before);
  });
});
