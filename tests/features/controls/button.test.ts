import { describe, expect, it } from 'vitest';
import { attr, looker, prop, type Json } from './fake.js';

describe('control buttons', () => {
  it('control.button.link_url: stores address, new tab and clears internal links', async () => {
    const f = looker();
    await f.add({ kind: 'button', button: { action: 'link', url: 'https://example.com/a', new_tab: true } });
    expect(prop(f.components()[0]!).buttonProperty).toMatchObject({ actionType: 1, linkType: 1, linkUrl: 'https://example.com/a', internalLink: '', linkNewTab: true });
    const out = await f.add({ kind: 'button', button: { action: 'link', url: 'https://example.com/a', page: 'Detail' } });
    expect(prop(f.components()[1]!).buttonProperty.linkNewTab).toBe(false);
    expect(out).toContain('page was ignored');
    for (const args of [{ kind: 'button', button: { action: 'link' } }, { kind: 'drop_down', field: 'device', button: { action: 'link', url: 'https://example.com' } }]) await expect(f.add(args)).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it('control.button.link_page: whole page name ignores case, ids are accepted, partial names refuse', async () => {
    const f = looker();
    for (const page of ['detail', 'p_bbb']) await f.add({ kind: 'button', button: { action: 'link', page } });
    for (const c of f.components()) expect(prop(c).buttonProperty).toMatchObject({ actionType: 1, linkUrl: 'http://Detail', internalLink: 'p_bbb', linkNewTab: false });
    await expect(f.add({ kind: 'button', button: { action: 'link', page: 'Det' } })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('Overview') });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it.each([
    ['control.button.report_action.invite_people', 'Invite people', 1],
    ['control.button.report_action.get_report_link', 'Get report link', 2],
    ['control.button.report_action.download_report', 'Download report', 3],
    ['control.button.report_action.reset_filters', 'Reset filters', 4],
  ])('%s: sets the action without invoking sharing/download endpoints', async (_id, report_action, value) => {
    const f = looker();
    const out = await f.add({ kind: 'button', button: { action: 'report_action', report_action, url: 'https://example.com', page: 'Detail', new_tab: true } });
    expect(prop(f.components()[0]!).buttonProperty).toMatchObject({ actionType: 2, internalActionType: value });
    expect(out).toContain('ignored');
    expect(f.calls.map((c) => c.endpoint)).toEqual(['getReport', 'getReport', 'updatePage']);
  });
  it('control.button.report_action.invite_people: a missing action refuses before any save', async () => {
    const f = looker();
    await expect(f.add({ kind: 'button', button: { action: 'report_action' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
  });
});

describe('component_update button extension', () => {
  it('component.button.link: updates exactly the requested button and preserves position and neighbors', async () => {
    const f = looker();
    await f.add({ kind: 'button', position: { left: 35, top: 42, width: 210, height: 44 }, button: { action: 'report_action', report_action: 'Invite people' } });
    await f.add({ kind: 'button' });
    const before = structuredClone(f.components());
    const c = f.components()[0]!;
    await f.run('component_update', { component_id: c.componentId, button: { action: 'link', page: 'Detail' } });
    expect(prop(f.components()[0]!).buttonProperty).toMatchObject({ actionType: 1, internalLink: 'p_bbb', linkUrl: 'http://Detail' });
    expect(attr(f.components()[0]!)).toEqual(attr(before[0]!));
    expect(f.components()[1]).toEqual(before[1]);
    await f.run('component_update', { component_id: c.componentId, button: { action: 'link', url: 'https://example.com/b' } });
    expect(prop(f.components()[0]!).buttonProperty).toMatchObject({ internalLink: '', linkUrl: 'https://example.com/b' });
  });
  it('component.button.report_action: changes only actionType/internalActionType on a link button', async () => {
    const f = looker();
    await f.add({ kind: 'button', button: { action: 'link', url: 'https://example.com/b', new_tab: true } });
    const before = structuredClone(f.components()[0]!);
    await f.run('component_update', { component_id: before.componentId, button: { action: 'report_action', report_action: 'Download report' } });
    const expected = structuredClone(before); Object.assign(prop(expected).buttonProperty, { actionType: 2, internalActionType: 3 });
    expect(f.components()[0]).toEqual(expected);
  });
  it.each(['component.button.link', 'component.button.report_action'])('%s: non-buttons refuse without a write', async (id) => {
    const f = looker();
    f.components().push({ componentId: 'cd-card', type: 'kpi-metric' });
    const button = id.endsWith('.link') ? { action: 'link', url: 'https://example.com' } : { action: 'report_action', report_action: 'Reset filters' };
    await expect(f.run('component_update', { component_id: 'cd-card', button })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
  });
  it('component.button.link: preset filters can change to navigation and report-level buttons save at report level', async () => {
    const f = looker();
    await f.add({ kind: 'preset_filter', field: 'flag' });
    const id = f.components()[0]!.componentId;
    await f.run('component_update', { component_id: id, button: { action: 'link', url: 'https://example.com' } });
    expect(prop(f.components()[0]!).buttonProperty.actionType).toBe(1);
    const c = f.components().pop()!;
    (f.doc.report.componentConfig as Json[]).push(c);
    const count = f.saves('updatePage').length;
    await f.run('component_update', { component_id: id, button: { action: 'report_action', report_action: 'Reset filters' } });
    expect(prop((f.doc.report.componentConfig as Json[])[0]!).buttonProperty).toMatchObject({ actionType: 2, internalActionType: 4 });
    expect(f.saves('updatePage')).toHaveLength(count);
    expect(f.saves('updateReport')).toHaveLength(1);
  });
  it('control.style: the shared style updater reads controls tables without duplicate updater keys', async () => {
    const f = looker();
    await f.add({ kind: 'checkbox', field: 'flag' });
    const c = f.components()[0]!;
    await f.run('component_update', { component_id: c.componentId, style: { 'Label position': 'Right', 'Font color': '#112233' } });
    expect(prop(f.components()[0]!).dimensionFilterProperty).toMatchObject({ labelPosition: 4, labelFontColor: { color: '#112233', opacity: 1 } });
    expect(f.ext.updaters().filter((u) => u.key === 'button')).toHaveLength(1);
    expect(f.ext.updaters().filter((u) => u.key === 'style')).toHaveLength(1);
    expect(f.ext.updaters().filter((u) => u.key === 'filters')).toHaveLength(1);
  });
});
