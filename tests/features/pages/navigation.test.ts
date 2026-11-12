import { describe, expect, it } from 'vitest';

import { listPages } from '../../../src/core/page.js';
import { looker, report, type Json } from './fake.js';

describe('page navigation tools', () => {
  it('page.list: follows sections in navigation order and returns ids, section names and visibility', async () => {
    const doc = report(['Overview', 'Search', 'Social']);
    doc.page.reverse();
    doc.navigationInfo!.navItems = [{ page: { pageId: 'p1', displayName: 'Overview' } }, { section: { sectionId: 's1', displayName: 'Channels', navItems: [{ page: { pageId: 'p2', displayName: 'Search' } }, { page: { pageId: 'p3', displayName: 'Social', hiddenFromViewer: true } }] } }];
    const fake = looker(doc);
    const text = await fake.run('page_list');
    expect(text.split('\n')).toEqual(['1. Overview (p1)', '2. Search (p2) — section: Channels', '3. Social (p3) — section: Channels [hidden from viewers]']);
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.list: preserves the actual name of a one-page report', async () => {
    expect(await looker(report(['요약'])).run('page_list')).toBe('1. 요약 (p1)');
  });

  it('page.add: appends a trimmed name and returns the new page even when its name is duplicated', async () => {
    const fake = looker(report(['First', 'New page']));
    const text = await fake.run('page_add', { name: ' New page ' });
    const body = fake.saves('createPages')[0]!.body;
    expect(body.position).toEqual({ index: 2 });
    expect(body.pages[0].displayName).toBe('New page');
    expect(body.pages[0].pageId).toMatch(/^p_[a-z0-9]{10}$/);
    expect(body.pages[0].page.componentConfig).toEqual([]);
    expect(text).toContain(`3. New page (${body.pages[0].pageId})`);
  });

  it('page.add: rejects a whitespace name before sending any requests', async () => {
    const fake = looker();
    await expect(fake.run('page_add', { name: '   ' })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('page.rename: renames a nested page with the report version and preserves other navigation fields', async () => {
    const doc = report(['A', 'B']);
    doc.navigationInfo!.navItems = [{ page: { pageId: 'p1', displayName: 'A' } }, { section: { sectionId: 's1', navItems: [{ page: { pageId: 'p2', displayName: 'B' } }] } }];
    const fake = looker(doc);
    await fake.run('page_rename', { page: 'B', name: ' C ' });
    const body = fake.saves('updateReportNavigationInfo')[0]!.body;
    expect(body.version).toBe('10');
    expect(body.navigationInfo).toEqual({ style: 2, navItems: [{ page: { pageId: 'p1', displayName: 'A' } }, { section: { sectionId: 's1', navItems: [{ page: { pageId: 'p2', displayName: 'C' } }] } }] });
    expect((doc.page[1]!.page.attributeConfig as Json).pageAttribute.name).toBe('B');
  });

  it('page.rename: missing pages list available names and ambiguous names require a page id', async () => {
    const fake = looker(report(['A', 'B']));
    await expect(fake.run('page_rename', { page: 'Z', name: 'New' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('A, B') });
    expect(fake.saves()).toHaveLength(0);
    const duplicate = looker(report(['A', 'A']));
    await expect(duplicate.run('page_rename', { page: 'A', name: 'New' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('page id') });
    await duplicate.run('page_rename', { page: 'p2', name: 'New' });
    expect(listPages(duplicate.doc).map((p) => p.name)).toEqual(['A', 'New']);
  });

  it('page.rename: a single page is renamed directly without a temporary page', async () => {
    const fake = looker(report(['One']));
    await fake.run('page_rename', { page: 1, name: 'Solo' });
    expect(listPages(fake.doc)[0]!.name).toBe('Solo');
    expect(fake.doc.page).toHaveLength(1);
    expect(fake.saves('createPages')).toHaveLength(0);
  });

  it('page.rename: conflict reapplication preserves concurrent navigation fields', async () => {
    const fake = looker(report(['A']), { conflictNav: true });
    await fake.run('page_rename', { page: 'p1', name: 'New' });
    expect(fake.saves('updateReportNavigationInfo')).toHaveLength(2);
    expect(fake.doc.navigationInfo).toMatchObject({ extra: 'concurrent navigation edit', navItems: [{ page: { displayName: 'New' } }] });
  });

  it('page.action.delete: deletes one chosen id and returns the remaining list', async () => {
    const fake = looker(report(['First', 'Second']));
    const text = await fake.run('page_edit', { page: 'Second', action: 'delete' });
    expect(fake.saves('deletePages')).toHaveLength(1);
    expect(fake.saves('deletePages')[0]!.body.pageIds).toEqual(['p2']);
    expect(fake.doc.page.map((p) => p.pageId)).toEqual(['p1']);
    expect(text).toContain('1. First (p1)');
  });

  it('page.action.delete: refuses the final page without a write', async () => {
    const fake = looker(report(['One']));
    await expect(fake.run('page_edit', { page: 1, action: 'delete' })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.action.duplicate: allocates fresh component and group ids and updates all references', async () => {
    const doc = report(['Overview', 'Second']);
    const original = doc.page[0]!;
    original.page.componentConfig = [{ componentId: 'cd-a', type: 'simple-description' }, { componentId: 'cd-b', type: 'simple-line', attachment: { componentId: 'cd-a' } }];
    original.page.groupConfig = [{ groupId: 'group-a', componentIds: ['cd-a', 'cd-b'] }];
    original.chartCondition = [{ chartId: 'cd-a', rule: [{ color: '#FF0000' }] }];
    const before = structuredClone(original);
    const fake = looker(doc);
    await fake.run('page_edit', { page: 'Overview', action: 'duplicate' });
    const body = fake.saves('createPages')[0]!.body;
    const copy = body.pages[0];
    const ids = copy.page.componentConfig.map((c: Json) => c.componentId);
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id: string) => { expect(id).toMatch(/^cd-/); expect(['cd-a', 'cd-b']).not.toContain(id); });
    expect(copy.page.groupConfig[0].componentIds).toEqual(ids);
    expect(copy.page.groupConfig[0].groupId).not.toBe('group-a');
    expect(copy.page.componentConfig[1].attachment.componentId).toBe(ids[0]);
    expect(copy.chartCondition[0].chartId).toBe(ids[0]);
    expect(copy.displayName).toBe('Copy of Overview');
    expect(copy.page.attributeConfig.pageAttribute.name).toBe('Copy of Overview');
    expect(body.position).toEqual({ index: 1 });
    expect(original).toEqual(before);
    expect(listPages(doc).map((p) => p.name)).toEqual(['Overview', 'Copy of Overview', 'Second']);
  });

  it('page.action.duplicate: inserts the copy immediately after its source in the same section', async () => {
    const doc = report(['A', 'B', 'C']);
    doc.navigationInfo!.navItems = [{ page: { pageId: 'p1', displayName: 'A' } }, { section: { sectionId: 's1', displayName: 'Section', navItems: [{ page: { pageId: 'p2', displayName: 'B' } }, { page: { pageId: 'p3', displayName: 'C' } }] } }];
    const fake = looker(doc);
    await fake.run('page_edit', { page: 'B', action: 'duplicate' });
    expect(fake.saves('createPages')[0]!.body.position).toEqual({ index: 1, sectionId: 's1' });
    expect(listPages(doc).map((p) => p.name)).toEqual(['A', 'B', 'Copy of B', 'C']);
  });

  it('page.action.hide: changes only the target visibility and retains unrelated fields', async () => {
    const fake = looker(report(['First', 'Second']));
    await fake.run('page_edit', { page: 'Second', action: 'hide' });
    expect(fake.saves('updateReportNavigationInfo')[0]!.body.navigationInfo).toEqual({ style: 2, navItems: [{ page: { pageId: 'p1', displayName: 'First' } }, { page: { pageId: 'p2', displayName: 'Second', hiddenFromViewer: true } }] });
  });

  it('page.action.hide: refuses a single page and the final visible page without saving', async () => {
    const one = looker(report(['One']));
    await expect(one.run('page_edit', { page: 'One', action: 'hide' })).rejects.toMatchObject({ code: 'invalid' });
    expect(one.saves()).toHaveLength(0);
    const doc = report(['First', 'Second']);
    doc.navigationInfo!.navItems![1]!.page!.hiddenFromViewer = true;
    const last = looker(doc);
    await expect(last.run('page_edit', { page: 'First', action: 'hide' })).rejects.toMatchObject({ code: 'invalid' });
    expect(last.saves()).toHaveLength(0);
  });

  it('page.action.show: clears hiddenFromViewer and skips a save when already visible', async () => {
    const doc = report(['First', 'Second']);
    doc.navigationInfo!.navItems![1]!.page!.hiddenFromViewer = true;
    const fake = looker(doc);
    await fake.run('page_edit', { page: 'Second', action: 'show' });
    expect(doc.navigationInfo!.navItems![1]!.page!.hiddenFromViewer).not.toBe(true);
    const count = fake.saves().length;
    expect(await fake.run('page_edit', { page: 'Second', action: 'show' })).toContain('already visible');
    expect(fake.saves()).toHaveLength(count);
  });

  it.each([
    ['move_up', 'C', ['A', 'C', 'B'], 'A'],
    ['move_down', 'A', ['B', 'A', 'C'], 'C'],
    ['move_top', 'C', ['C', 'A', 'B'], 'A'],
    ['move_bottom', 'A', ['B', 'C', 'A'], 'C'],
  ])('page.action.%s: moves once and skips a save at the boundary', async (action, page, expected, boundary) => {
    const fake = looker();
    const originalPages = structuredClone(fake.doc.page);
    await fake.run('page_edit', { page, action });
    expect(listPages(fake.doc).map((p) => p.name)).toEqual(expected);
    expect(fake.doc.page).toEqual(originalPages);
    const edge = looker();
    expect(await edge.run('page_edit', { page: boundary, action })).toContain('already');
    expect(edge.saves()).toHaveLength(0);
  });

  it('page.action.move_top: keeps a page inside its section', async () => {
    const doc = report(['A', 'B', 'C']);
    doc.navigationInfo!.navItems = [{ page: { pageId: 'p1', displayName: 'A' } }, { section: { sectionId: 's1', navItems: [{ page: { pageId: 'p2', displayName: 'B' } }, { page: { pageId: 'p3', displayName: 'C' } }] } }];
    const fake = looker(doc);
    await fake.run('page_edit', { page: 'C', action: 'move_top' });
    expect(listPages(doc).map((p) => p.name)).toEqual(['A', 'C', 'B']);
    expect(doc.navigationInfo!.navItems![0]!.page!.pageId).toBe('p1');
  });
});
