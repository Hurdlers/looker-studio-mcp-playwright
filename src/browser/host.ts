import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core';

export type BrowserErrorCode = 'not_installed' | 'launch_failed' | 'unreachable' | 'timeout' | 'page_closed';

export class BrowserError extends Error {
  constructor(
    readonly code: BrowserErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserError';
  }
}

export interface BrowserStatus {
  // The dedicated Chrome answers on its debugging port.
  running: boolean;
  // "Chrome/126.0.6478.127" as the browser reports it.
  version?: string;
  port?: number;
  // The Chrome profile the server signs in with.
  profile: string;
}

/** What the worker tab needs from one browser tab. */
export interface PageHandle {
  // Evaluates an expression string in the page and returns its value.
  evaluate(code: string, timeoutMs: number): Promise<unknown>;
  goto(url: string, timeoutMs: number): Promise<void>;
  cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  bringToFront(): Promise<void>;
  isClosed(): boolean;
  close(): Promise<void>;
}

/** Opens tabs in the browser the server drives. */
export interface BrowserLike {
  openPage(url: string): Promise<PageHandle>;
}

export interface BrowserHostOptions {
  // Where the profile and the browser record live.
  home: string;
  // Chrome or Chromium executable; found automatically when unset.
  chromePath?: string;
  headless?: boolean;
  launchTimeoutMs?: number;
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function findChrome(explicit?: string, platform: string = process.platform): string {
  if (explicit) {
    if (!existsSync(explicit)) throw new BrowserError('not_installed', `No browser at ${explicit}. Fix chrome_path in the config.`);
    return explicit;
  }
  const hit = (CHROME_PATHS[platform] ?? []).find((path) => existsSync(path));
  if (!hit) throw new BrowserError('not_installed', 'Google Chrome was not found. Install it or set chrome_path in the config.');
  return hit;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * The server's own Chrome: a dedicated profile kept under the home folder and
 * started once with a local debugging port. Every server process connects to
 * that one browser and works in a tab of its own, so two clients can run at
 * the same time and the sign-in survives restarts. The browser is left running
 * when a server exits.
 */
export class BrowserHost implements BrowserLike {
  readonly profile: string;
  private readonly record: string;
  private browser: Browser | undefined;

  constructor(private readonly opts: BrowserHostOptions) {
    this.profile = join(opts.home, 'chrome-profile');
    this.record = join(opts.home, 'browser.json');
  }

  async status(): Promise<BrowserStatus> {
    const port = this.recordedPort();
    const version = port ? await this.probe(port) : undefined;
    return { running: version !== undefined, ...(version ? { version } : {}), ...(port && version ? { port } : {}), profile: this.profile };
  }

  /** A new tab in the dedicated browser, starting the browser when needed. */
  async openPage(url: string): Promise<PageHandle> {
    const browser = await this.connect();
    const context = browser.contexts()[0];
    if (!context) throw new BrowserError('unreachable', 'The browser has no window to open a tab in. Close it and retry.');
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 }).catch(() => undefined);
    return new PlaywrightPage(page);
  }

  /** Lets go of the connection. The browser itself keeps running. */
  async disconnect(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close().catch(() => undefined);
  }

  private async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const port = await this.ensureRunning();
    try {
      this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20_000 });
    } catch (err) {
      throw new BrowserError('unreachable', `Could not connect to the browser on port ${port}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
    return this.browser;
  }

  private async ensureRunning(): Promise<number> {
    const known = this.recordedPort();
    if (known && (await this.probe(known))) return known;
    const executable = findChrome(this.opts.chromePath);
    mkdirSync(this.profile, { recursive: true });
    const port = await freePort();
    const child = spawn(
      executable,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...(this.opts.headless ? ['--headless=new'] : []),
        'about:blank',
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.once('error', () => undefined);
    child.unref();
    writeFileSync(this.record, JSON.stringify({ port, pid: child.pid }));
    const deadline = Date.now() + (this.opts.launchTimeoutMs ?? 20_000);
    while (Date.now() < deadline) {
      if (await this.probe(port)) return port;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new BrowserError('launch_failed', `The browser did not start within ${Math.round((this.opts.launchTimeoutMs ?? 20_000) / 1000)} s (${executable}).`);
  }

  private recordedPort(): number | undefined {
    try {
      const port = (JSON.parse(readFileSync(this.record, 'utf8')) as { port?: unknown }).port;
      return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : undefined;
    } catch {
      return undefined;
    }
  }

  // The browser's version string when it answers on that port.
  private async probe(port: number): Promise<string | undefined> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_500) });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { Browser?: unknown };
      return typeof body.Browser === 'string' ? body.Browser : undefined;
    } catch {
      return undefined;
    }
  }
}

class PlaywrightPage implements PageHandle {
  private session: CDPSession | undefined;

  constructor(private readonly page: Page) {}

  async evaluate(code: string, timeoutMs: number): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BrowserError('timeout', `The browser tab did not answer within ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      return await Promise.race([this.page.evaluate(code), timeout]);
    } catch (err) {
      if (err instanceof BrowserError) throw err;
      if (this.page.isClosed()) throw new BrowserError('page_closed', 'The Looker Studio MCP tab was closed.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      if (this.page.isClosed()) throw new BrowserError('page_closed', 'The Looker Studio MCP tab was closed.');
      throw new BrowserError('timeout', `Loading ${new URL(url).origin} did not finish: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }

  async cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.session ??= await this.page.context().newCDPSession(this.page);
    return (await this.session.send(method as never, params as never)) as T;
  }

  async bringToFront(): Promise<void> {
    await this.page.bringToFront();
  }

  isClosed(): boolean {
    return this.page.isClosed();
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined);
  }
}
