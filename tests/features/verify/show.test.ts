import { describe, expect, it, vi } from 'vitest';

import type { WorkerTab } from '../../../src/browser/worker.js';
import { resultText } from '../../../src/core/tool.js';
import { looker, REPORT } from './fake.js';

describe('report_show', () => {
  function setup() {
    const fake = looker();
    const goto = vi.fn(async () => undefined);
    const cdp = vi.fn(async () => ({}));
    const waitFor = vi.fn(async () => true);
    const screenshot = vi.fn(async () => ({ data: 'aW1hZ2U=', mimeType: 'image/png' }));
    fake.ctx.worker = { run: async () => ({ origin: 'https://datastudio.google.com', path: '/navigation/reporting' }), goto, waitFor, screenshot, cdp } as unknown as WorkerTab;
    return { ...fake, goto, waitFor, screenshot, cdp };
  }

  it('report_show: opens a named page in view mode without asking for a screenshot', async () => {
    const fake = setup();
    expect(resultText(await fake.run('report_show', { page: 'Inner' }))).toContain('Opened page p2 in view mode');
    expect(fake.goto).toHaveBeenCalledWith(`https://datastudio.google.com/reporting/${REPORT}/page/p2?hl=en`);
    expect(fake.screenshot).not.toHaveBeenCalled();
    expect(fake.cdp).toHaveBeenCalledWith('Page.bringToFront', {});
  });

  it('opens the encoded URL of a numeric page while retaining its internal id', async () => {
    const fake = setup();
    fake.doc.page.find((p) => p.pageId === 'p2')!.pageId = '1234567';
    fake.doc.navigationInfo!.navItems![1]!.section!.navItems![0]!.page!.pageId = '1234567';
    const before = structuredClone(fake.doc);
    expect(resultText(await fake.run('report_show', { page: 'Inner', screenshot: true }))).toContain('1234567');
    expect(fake.goto).toHaveBeenCalledWith(`https://datastudio.google.com/reporting/${REPORT}/page/XKLF?hl=en`);
    expect(fake.doc).toEqual(before);
  });

  it('report_show: optionally captures navigation in edit mode', async () => {
    const fake = setup();
    const result = await fake.run('report_show', { page: 'Inner', edit: true, screenshot: true });
    expect(fake.goto).toHaveBeenCalledWith(`https://datastudio.google.com/reporting/${REPORT}/page/p2/edit?hl=en`);
    expect(fake.waitFor).toHaveBeenCalledOnce();
    expect(result.content[0]).toEqual({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' });
  });
});
