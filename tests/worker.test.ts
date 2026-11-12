import { describe, expect, it } from 'vitest';

import { BrowserError } from '../src/browser/host.js';
import { parseKey, WorkerError, WorkerTab } from '../src/browser/worker.js';
import { FakeBrowser } from './fakes/fakeBrowser.js';

const HOME = 'https://datastudio.google.com/u/0/navigation/reporting?hl=en';

function worker(browser: FakeBrowser): WorkerTab {
  return new WorkerTab(browser, { homeUrl: HOME });
}

describe('WorkerTab.ensure', () => {
  it('opens one tab at the home page and keeps using it', async () => {
    const browser = new FakeBrowser(), tab = worker(browser);
    await tab.ensure();
    await tab.ensure();
    expect(browser.opened).toEqual([HOME]);
    expect(browser.tabs).toHaveLength(1);
  });

  it('gives each worker a tab of its own', async () => {
    const browser = new FakeBrowser();
    await worker(browser).ensure();
    await worker(browser).ensure();
    expect(browser.tabs).toHaveLength(2);
  });

  it('reports a browser that cannot start as an unavailable worker', async () => {
    const browser = new FakeBrowser();
    browser.failOpen = new BrowserError('not_installed', 'Google Chrome was not found.');
    await expect(worker(browser).ensure()).rejects.toMatchObject({ code: 'worker_unavailable', message: expect.stringContaining('Google Chrome was not found') });
  });
});

describe('WorkerTab.run', () => {
  it('opens the tab on first use and returns the value', async () => {
    const browser = new FakeBrowser();
    expect(await worker(browser).run((a: { n: number }) => a.n * 2, { n: 21 })).toBe(42);
    expect(browser.tabs).toHaveLength(1);
  });

  it('awaits async functions and passes structured arguments', async () => {
    const browser = new FakeBrowser();
    const value = await worker(browser).run(async (a: { items: string[] }) => a.items.join('+'), { items: ['a', 'b'] });
    expect(value).toBe('a+b');
  });

  it('reports an error thrown in the page as a page error', async () => {
    const browser = new FakeBrowser();
    const failing = worker(browser).run(() => {
      throw new Error('boom');
    }, null);
    await expect(failing).rejects.toBeInstanceOf(WorkerError);
    await expect(failing).rejects.toMatchObject({ code: 'page_error', message: 'boom' });
  });

  it('opens a fresh tab and retries once when its tab was closed', async () => {
    const browser = new FakeBrowser(), tab = worker(browser);
    await tab.ensure();
    browser.tabs[0]!.closed = true;
    expect(await tab.run(() => 7, null)).toBe(7);
    expect(browser.tabs).toHaveLength(2);
  });
});

describe('WorkerTab.waitFor', () => {
  it('resolves when the condition becomes true', async () => {
    const browser = new FakeBrowser((tab) => {
      tab.ready = false;
    });
    const tab = worker(browser);
    await tab.ensure();
    setTimeout(() => {
      browser.tabs[0]!.ready = true;
    }, 30);
    expect(await tab.waitFor(() => (globalThis as { ready?: boolean }).ready, null, 2_000)).toBe(true);
  });

  it('times out with the timeout code', async () => {
    const browser = new FakeBrowser();
    await expect(worker(browser).waitFor(() => false, null, 300)).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('WorkerTab input and capture', () => {
  it('brings a hidden tab forward before it clicks', async () => {
    const browser = new FakeBrowser(), tab = worker(browser);
    await tab.clickAt(10, 20);
    expect(browser.tabs[0]!.document.visibilityState).toBe('visible');
    expect(browser.cdpCalls.map((c) => [c.method, c.params.type])).toEqual([
      ['Input.dispatchMouseEvent', 'mouseMoved'],
      ['Input.dispatchMouseEvent', 'mousePressed'],
      ['Input.dispatchMouseEvent', 'mouseReleased'],
    ]);
  });

  it('refuses to act while the browser window is minimized', async () => {
    const browser = new FakeBrowser();
    browser.windowShown = false;
    await expect(worker(browser).clickAt(1, 1)).rejects.toMatchObject({ code: 'worker_hidden' });
    expect(browser.cdpCalls).toEqual([]);
  });

  it('captures a screenshot through the browser', async () => {
    const browser = new FakeBrowser();
    expect(await worker(browser).screenshot({ format: 'png' })).toEqual({ data: 'QUJD', mimeType: 'image/png' });
    expect(browser.cdpCalls.at(-1)).toEqual({ method: 'Page.captureScreenshot', params: { format: 'png' } });
  });

  it('loads a URL in its own tab and closes only that tab', async () => {
    const browser = new FakeBrowser(), tab = worker(browser);
    await tab.goto('https://lookerstudio.google.com/reporting/abc');
    expect(browser.tabs[0]!.url).toBe('https://lookerstudio.google.com/reporting/abc');
    await tab.close();
    expect(browser.tabs[0]!.closed).toBe(true);
  });
});

describe('parseKey', () => {
  it('maps named keys, modifiers and characters', () => {
    expect(parseKey('Enter')).toMatchObject({ key: 'Enter', windowsVirtualKeyCode: 13, text: '\r', modifiers: 0 });
    expect(parseKey('Shift+ArrowRight')).toMatchObject({ key: 'ArrowRight', modifiers: 8 });
    expect(parseKey('Meta+a')).toMatchObject({ key: 'a', code: 'KeyA', modifiers: 4 });
    expect(parseKey('Meta+a')).not.toHaveProperty('text');
    expect(() => parseKey('NoSuchKey')).toThrow(WorkerError);
  });
});
