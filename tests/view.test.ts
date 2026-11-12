import { describe, expect, it } from 'vitest';

import { WorkerTab } from '../src/browser/worker.js';
import { openReport, parseReportId, waitForCharts } from '../src/looker/view.js';
import { FakeBrowser, type FakeTab } from './fakes/fakeBrowser.js';

const ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const HOME = 'https://datastudio.google.com/u/0/navigation/reporting?hl=en';

function setup(page: (tab: FakeTab) => void = () => undefined) {
  const browser = new FakeBrowser((tab) => {
    (tab.location as Record<string, string>).pathname = '/u/0/navigation/reporting';
    page(tab);
  });
  return { browser, worker: new WorkerTab(browser, { homeUrl: HOME }) };
}

describe('parseReportId', () => {
  it('takes ids and URLs', () => {
    expect(parseReportId(ID.toUpperCase())).toBe(ID);
    expect(parseReportId(`https://datastudio.google.com/u/0/reporting/${ID}/page/p_1/edit`)).toBe(ID);
  });

  it('keeps the older Drive-style ids as they are (they are case-sensitive)', () => {
    const drive = '1Une4jLUpx9VwzVpl5wt6yrt0S7ARwp72';
    expect(parseReportId(drive)).toBe(drive);
    expect(parseReportId(`https://lookerstudio.google.com/u/0/reporting/${drive}/page/abc`)).toBe(drive);
  });

  it('refuses anything else', () => {
    expect(() => parseReportId('my report')).toThrow(/Not a Looker Studio report/);
    expect(() => parseReportId('https://example.com/x')).toThrow(/Not a Looker Studio report/);
  });
});

describe('openReport', () => {
  it('loads the view URL on the worker origin', async () => {
    const { browser, worker } = setup();

    await openReport(worker, ID, { pageId: 'p_1' });

    expect(browser.navigated).toEqual([`https://datastudio.google.com/reporting/${ID}/page/p_1?hl=en`]);
  });

  it('does not reload a page that is already open', async () => {
    const { browser, worker } = setup();
    await worker.ensure();
    (browser.current!.location as Record<string, string>).pathname = `/u/0/reporting/${ID}/page/p_1/edit`;
    await openReport(worker, ID, { pageId: 'p_1', edit: true });

    expect(browser.navigated).toEqual([]);
  });

  it('recognizes the encoded viewer URL of an already open numeric page', async () => {
    const { browser, worker } = setup();
    await worker.ensure();
    (browser.current!.location as Record<string, string>).pathname = `/u/0/reporting/${ID}/page/XKLF/edit`;
    await openReport(worker, ID, { pageId: '1234567', edit: true });
    expect(browser.navigated).toEqual([]);
  });
});

describe('waitForCharts', () => {
  it('settles once the canvas shows no loading shimmer', async () => {
    const { worker } = setup((tab) => {
      tab.document.querySelector = (sel: string) => (sel === '.reportArea' ? {} : null);
      tab.Date = Date;
    });

    expect(await waitForCharts(worker, 5_000)).toBe(true);
  });

  it('gives up while charts keep loading', async () => {
    const { worker } = setup((tab) => {
      tab.document.querySelector = () => ({});
      tab.Date = Date;
    });

    expect(await waitForCharts(worker, 300)).toBe(false);
  });
});
