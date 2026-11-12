import { BrowserError, type BrowserLike, type PageHandle } from './host.js';
import { inPageCode, parseOutcome, waitForCode } from './inpage.js';

export type WorkerErrorCode = 'worker_unavailable' | 'worker_hidden' | 'page_error' | 'timeout';

export class WorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

export interface Point {
  x: number;
  y: number;
}

export interface WorkerOptions {
  homeUrl?: string;
}

export const DEFAULT_HOME_URL = 'https://lookerstudio.google.com/navigation/reporting?hl=en';

// The server's own tab in its dedicated browser. Looker Studio's front-end API
// is called from inside this tab, so it carries the signed-in session. The tab
// belongs to this process alone; it is opened on first use and reopened when
// someone closes it.
export class WorkerTab {
  private page: PageHandle | undefined;
  private visibleAt = 0;
  private readonly homeUrl: string;

  constructor(
    private readonly browser: BrowserLike,
    opts: WorkerOptions = {},
  ) {
    this.homeUrl = opts.homeUrl ?? DEFAULT_HOME_URL;
  }

  async ensure(): Promise<void> {
    if (this.page && !this.page.isClosed()) return;
    try {
      this.page = await this.browser.openPage(this.homeUrl);
    } catch (err) {
      throw new WorkerError('worker_unavailable', `Could not open the Looker Studio MCP tab: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Closes the tab. The browser stays open. */
  async close(): Promise<void> {
    const page = this.page;
    this.page = undefined;
    await page?.close();
  }

  async run<A, R>(fn: (args: A) => R | Promise<R>, args: A, timeoutMs = 30_000): Promise<R> {
    return this.exec<R>(inPageCode(fn, args), timeoutMs);
  }

  async waitFor<A>(predicate: (args: A) => unknown, args: A, timeoutMs = 15_000): Promise<unknown> {
    return this.exec(waitForCode(predicate, args, timeoutMs), timeoutMs);
  }

  // Loads a URL in the worker tab and returns once the document is complete.
  async goto(url: string, timeoutMs = 30_000): Promise<void> {
    await this.ensure();
    try {
      await this.page!.goto(url, timeoutMs);
    } catch (err) {
      throw this.translate(err);
    }
  }

  async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ensure();
    return this.page!.cdp<T>(method, params);
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.ensureVisible();
    await this.mouse('mouseMoved', x, y);
    await this.mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
    await this.mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
  }

  async click(selector: string): Promise<void> {
    const box = await this.run((a: { selector: string }) => {
      const el = document.querySelector(a.selector);
      if (!el) throw new Error(`No element matches ${a.selector}`);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { selector });
    await this.clickAt(box.x, box.y);
  }

  async drag(from: Point, to: Point, steps = 10): Promise<void> {
    await this.ensureVisible();
    await this.mouse('mouseMoved', from.x, from.y);
    await this.mouse('mousePressed', from.x, from.y, { button: 'left', clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await this.mouse('mouseMoved', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, {
        button: 'left',
        buttons: 1,
      });
    }
    await this.mouse('mouseReleased', to.x, to.y, { button: 'left', clickCount: 1 });
  }

  async type(text: string): Promise<void> {
    await this.ensureVisible();
    await this.cdp('Input.insertText', { text });
  }

  // "Enter", "Escape", "Shift+ArrowRight", "Meta+a"…
  async press(combo: string): Promise<void> {
    await this.ensureVisible();
    const key = parseKey(combo);
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    const { text: _text, ...up } = key;
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...up });
  }

  async screenshot(
    opts: { format?: 'jpeg' | 'png'; quality?: number } = {},
  ): Promise<{ data: string; mimeType: string }> {
    await this.ensureVisible();
    const format = opts.format ?? 'jpeg';
    const shot = await this.cdp<{ data: string }>('Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality: opts.quality ?? 70 } : {}),
    });
    return { data: shot.data, mimeType: `image/${format}` };
  }

  private async exec<R>(code: string, timeoutMs: number, retried = false): Promise<R> {
    await this.ensure();
    let raw: unknown;
    try {
      raw = await this.page!.evaluate(code, timeoutMs + 5_000);
    } catch (err) {
      // The tab was closed under us: open a fresh one and try once more.
      if (err instanceof BrowserError && err.code === 'page_closed' && !retried) {
        this.page = undefined;
        return this.exec<R>(code, timeoutMs, true);
      }
      throw this.translate(err);
    }
    const out = parseOutcome<R>(raw);
    if (out.ok) {
      if (out.visible) this.visibleAt = Date.now();
      return out.value;
    }
    throw new WorkerError(out.code, out.error);
  }

  private translate(err: unknown): Error {
    if (err instanceof WorkerError) return err;
    if (err instanceof BrowserError) return new WorkerError(err.code === 'timeout' ? 'timeout' : 'worker_unavailable', err.message);
    // A navigation while the code ran, or a value that cannot be returned.
    return new WorkerError('page_error', err instanceof Error ? (err.message.split('\n')[0] ?? err.message) : String(err));
  }

  // A hidden tab neither paints nor runs its timers at speed: bring it to the
  // front of its window first.
  private async ensureVisible(): Promise<void> {
    if (Date.now() - this.visibleAt < 1_000) return;
    if (await this.run(() => document.visibilityState === 'visible', null)) return;
    await this.page!.bringToFront();
    if (await this.run(() => document.visibilityState === 'visible', null)) return;
    throw new WorkerError(
      'worker_hidden',
      'The Looker Studio MCP tab stays hidden: its browser window is minimized. Restore the window and retry.',
    );
  }

  private async mouse(type: string, x: number, y: number, extra: Record<string, unknown> = {}): Promise<void> {
    await this.cdp('Input.dispatchMouseEvent', { type, x, y, ...extra });
  }
}

const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

export function parseKey(combo: string): Record<string, unknown> {
  const parts = combo.split('+');
  const name = parts.pop() ?? '';
  const modifiers = parts.reduce((m, p) => m | (MODIFIERS[p] ?? 0), 0);
  const named = KEYS[name];
  if (named) {
    return {
      key: name,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      modifiers,
      ...(named.text ? { text: named.text } : {}),
    };
  }
  if (name.length !== 1) throw new WorkerError('page_error', `Unknown key: ${combo}`);
  const upper = name.toUpperCase();
  return {
    key: name,
    code: /[0-9]/.test(name) ? `Digit${name}` : `Key${upper}`,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    modifiers,
    ...(modifiers & (2 | 4) ? {} : { text: name }),
  };
}
