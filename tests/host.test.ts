import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BrowserError, BrowserHost, findChrome } from '../src/browser/host.js';
import { parseConfig } from '../src/config.js';

describe('findChrome', () => {
  it('uses an explicit path that exists and refuses one that does not', () => {
    expect(findChrome(process.execPath)).toBe(process.execPath);
    expect(() => findChrome('/no/such/browser')).toThrow(BrowserError);
    expect(() => findChrome('/no/such/browser')).toThrow(/chrome_path/);
  });

  it('says how to proceed when no browser is installed for the platform', () => {
    expect(() => findChrome(undefined, 'unknown-os')).toThrow(/Install it or set chrome_path/);
  });
});

describe('BrowserHost.status', () => {
  it('reports a browser that was never started as not running, with its profile folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'browser-host-'));
    expect(await new BrowserHost({ home }).status()).toEqual({ running: false, profile: join(home, 'chrome-profile') });
  });

  it('treats a stale or damaged browser record as not running', async () => {
    const home = mkdtempSync(join(tmpdir(), 'browser-host-'));
    writeFileSync(join(home, 'browser.json'), JSON.stringify({ port: 1 }));
    expect((await new BrowserHost({ home }).status()).running).toBe(false);
    writeFileSync(join(home, 'browser.json'), 'not json');
    expect((await new BrowserHost({ home }).status()).running).toBe(false);
  });
});

describe('browser settings', () => {
  it('reads the browser path and headless switch, defaulting to a visible window', () => {
    expect(parseConfig({}, '/tmp/home').browser).toEqual({ headless: false });
    expect(parseConfig({ chrome_path: '/opt/chrome', headless: true }, '/tmp/home').browser).toEqual({ chromePath: '/opt/chrome', headless: true });
  });
});
