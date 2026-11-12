#!/usr/bin/env node
import { join } from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { BrowserHost } from './browser/host.js';
import { WorkerTab } from './browser/worker.js';
import { loadConfig } from './config.js';
import { RapClient } from './looker/rap.js';
import { listReports } from './looker/reports.js';
import { FileAudit } from './core/audit.js';
import { adcAccount, BigQueryClient } from './core/bigquery.js';
import { ReportSession } from './core/session.js';
import { buildServer } from './mcp/server.js';

const VERSION = '0.2.0';

function deps() {
  const config = loadConfig();
  const browser = new BrowserHost({
    home: config.home,
    headless: config.browser.headless,
    ...(config.browser.chromePath ? { chromePath: config.browser.chromePath } : {}),
  });
  const worker = new WorkerTab(browser);
  const google = adcAccount();
  const rap = new RapClient(worker);
  return {
    browser,
    worker,
    google,
    bigquery: new BigQueryClient(google, config.bigquery),
    rap,
    session: new ReportSession(rap),
    audit: new FileAudit(join(config.home, 'audit.ndjson')),
    home: config.home,
    config,
  };
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const value = await fn();
  console.log(`${label.padEnd(28)} ${Math.round(performance.now() - started)} ms`);
  return value;
}

type SignIn = { signedIn: boolean; email?: string };

// Whether the worker tab holds a Looker Studio session.
async function signInState(worker: WorkerTab): Promise<SignIn> {
  return worker.run(() => {
    const preload = (window as unknown as { preload?: { user?: { activeSession?: { emailAddress?: string } } } }).preload;
    const email = preload?.user?.activeSession?.emailAddress;
    const onLooker = ['datastudio.google.com', 'lookerstudio.google.com'].includes(location.hostname);
    return { signedIn: onLooker && /(?:^|;\s*)RAP_XSRF_TOKEN=/.test(document.cookie), ...(email ? { email } : {}) };
  }, null);
}

// Checks every layer and prints how long each one takes. Opens no report.
async function doctor(): Promise<void> {
  const { browser, worker, rap, google } = deps();
  try {
    await timed('working tab', () => worker.ensure());
    const status = await browser.status();
    console.log(`  browser ${status.version ?? 'not running'}, profile ${status.profile}`);
    const rounds: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await worker.run(() => 1, null);
      rounds.push(performance.now() - t);
    }
    rounds.sort((a, b) => a - b);
    console.log(`${'evaluate round trip (median)'.padEnd(28)} ${Math.round(rounds[2] ?? 0)} ms`);
    const state = await signInState(worker);
    console.log(`  Looker Studio: ${state.signedIn ? `signed in${state.email ? ` (${state.email})` : ''}` : 'NOT signed in — run "login"'}`);
    await timed('BigQuery credentials (ADC)', () => google.token());
    if (state.signedIn) {
      const reports = await timed('report names', () => listReports(rap));
      console.log(`  ${reports.length} reports`);
    }
  } finally {
    await worker.close();
    await browser.disconnect();
  }
}

// Opens the dedicated browser on the Google sign-in page and waits until the
// Looker Studio session exists. The sign-in is kept in the browser profile.
async function login(): Promise<void> {
  const config = loadConfig();
  // Signing in needs a window even when the server otherwise runs headless.
  const browser = new BrowserHost({ home: config.home, headless: false, ...(config.browser.chromePath ? { chromePath: config.browser.chromePath } : {}) });
  const worker = new WorkerTab(browser);
  try {
    await worker.ensure();
    let state = await signInState(worker).catch((): SignIn => ({ signedIn: false }));
    if (!state.signedIn) {
      await worker.goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Flookerstudio.google.com%2Fnavigation%2Freporting', 60_000).catch(() => undefined);
      await worker.cdp('Page.bringToFront', {}).catch(() => undefined);
      console.log('Sign in to Google in the browser window that opened. Waiting up to 10 minutes…');
      const deadline = Date.now() + 600_000;
      while (!state.signedIn && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        state = await signInState(worker).catch((): SignIn => ({ signedIn: false }));
      }
    }
    if (!state.signedIn) {
      console.error('Not signed in. Run "login" again when you are ready.');
      process.exitCode = 1;
      return;
    }
    console.log(`Signed in to Looker Studio${state.email ? ` as ${state.email}` : ''}. The browser keeps this sign-in.`);
  } finally {
    await worker.close();
    await browser.disconnect();
  }
}

async function serve(): Promise<void> {
  const parts = deps();
  // Close this process's tab when the client goes away; the browser stays.
  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await parts.worker.close().catch(() => undefined);
    await parts.browser.disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.stdin.once('end', () => void shutdown());
  process.stdin.once('close', () => void shutdown());
  await buildServer(parts, VERSION).connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'serve';
  if (cmd === 'serve') await serve();
  else if (cmd === 'doctor') await doctor();
  else if (cmd === 'login') await login();
  else {
    console.error(`Unknown command: ${cmd}. Use "serve", "login" or "doctor".`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
