import { runInNewContext } from 'node:vm';

import { BrowserError, type BrowserLike, type PageHandle } from '../../src/browser/host.js';

export interface FakeTab extends Record<string, unknown> {
  id: number;
  url: string;
  closed: boolean;
  window: Record<string, unknown>;
  document: Record<string, unknown> & { visibilityState: 'visible' | 'hidden' };
}

export interface CdpCall {
  method: string;
  params: Record<string, unknown>;
}

// Simulates the dedicated browser: tabs with their own JS realm. A new tab
// opens in the background (hidden), as when the browser window is not focused.
export class FakeBrowser implements BrowserLike {
  readonly tabs: FakeTab[] = [];
  readonly opened: string[] = [];
  // URLs loaded into a tab after it was opened.
  readonly navigated: string[] = [];
  readonly cdpCalls: CdpCall[] = [];
  // false: the browser window is minimized, bringing a tab forward shows nothing.
  windowShown = true;
  // Set to make openPage fail, as when the browser cannot start.
  failOpen: Error | undefined;
  private nextId = 1;

  constructor(private readonly setup: (tab: FakeTab) => void = () => undefined) {}

  get current(): FakeTab | undefined {
    return this.tabs.filter((tab) => !tab.closed).at(-1);
  }

  async openPage(url: string): Promise<PageHandle> {
    if (this.failOpen) throw this.failOpen;
    this.opened.push(url);
    const tab = this.newTab(url);
    const closedError = () => new BrowserError('page_closed', 'The Looker Studio MCP tab was closed.');
    return {
      evaluate: async (code: string) => {
        if (tab.closed) throw closedError();
        return runInNewContext(code, tab);
      },
      goto: async (next: string) => {
        if (tab.closed) throw closedError();
        this.navigated.push(next);
        tab.url = next;
        (tab.location as { origin: string; href: string }).origin = new URL(next).origin;
        (tab.location as { origin: string; href: string }).href = next;
      },
      cdp: async <T>(method: string, params: Record<string, unknown> = {}) => {
        this.cdpCalls.push({ method, params });
        return (method === 'Page.captureScreenshot' ? { data: 'QUJD' } : {}) as T;
      },
      bringToFront: async () => {
        for (const other of this.tabs) if (other !== tab) other.document.visibilityState = 'hidden';
        if (this.windowShown) tab.document.visibilityState = 'visible';
      },
      isClosed: () => tab.closed,
      close: async () => {
        tab.closed = true;
      },
    };
  }

  private newTab(url: string): FakeTab {
    const observers: Array<() => void> = [];
    class MutationObserver {
      constructor(private readonly cb: () => void) {}
      observe(): void {
        observers.push(this.cb);
      }
      disconnect(): void {
        observers.splice(observers.indexOf(this.cb), 1);
      }
    }
    const tab: FakeTab = {
      id: this.nextId++,
      url,
      closed: false,
      window: {},
      document: { visibilityState: 'hidden' },
      location: { origin: new URL(url).origin, href: url },
      MutationObserver,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };
    this.setup(tab);
    this.tabs.push(tab);
    return tab;
  }
}
