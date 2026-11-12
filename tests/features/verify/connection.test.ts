import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerTab } from '../../../src/browser/worker.js';
import { parseConfig } from '../../../src/config.js';
import { adcAccount, type GoogleAccount } from '../../../src/core/bigquery.js';
import { resultText } from '../../../src/core/tool.js';
import { looker } from './fake.js';

const auth = vi.hoisted(() => ({ getCredentials: vi.fn(async () => ({ client_email: 'demo-sa@example.iam.gserviceaccount.com' })), getAccessToken: vi.fn(async () => 'ya29.secret-test'), getProjectId: vi.fn(async () => 'demo-project') }));
vi.mock('google-auth-library', () => ({ GoogleAuth: class {
  getCredentials = auth.getCredentials;
  getAccessToken = auth.getAccessToken;
  getProjectId = auth.getProjectId;
} }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup(options: { url?: string; cookie?: boolean; running?: boolean; workerError?: string } = {}) {
  const fake = looker();
  const workerRun = vi.fn(async () => { if (options.workerError) throw new Error(options.workerError); return ({ url: options.url ?? 'https://datastudio.google.com/u/0/navigation/reporting', hasXsrf: options.cookie ?? true, email: 'person@example.com', visible: false }); });
  fake.ctx.worker = { run: workerRun } as unknown as WorkerTab;
  fake.ctx.browser = { status: async () => ({ running: options.running ?? true, version: 'Chrome/1.0.0', profile: '/tmp/profile' }) };
  fake.ctx.google = { token: async () => 'ya29.secret-test', email: async () => 'person@example.com', projectId: async () => 'demo-project' };
  return { ...fake, workerRun };
}

describe('connection_check', () => {
  it('connection.check.bigquery: service-account ADC reports its email without a userinfo request', async () => {
    const fake = setup();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    fake.ctx.google = adcAccount();
    const result = await fake.run('connection_check');
    expect(resultText(result)).toContain('BigQuery: OK (demo-sa@example.iam.gserviceaccount.com)');
    expect(auth.getCredentials).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(resultText(result)).not.toContain('ya29.');
    expect(fake.calls.some((c) => c.endpoint.includes('bigquery'))).toBe(false);
  });

  it('connection.check.bigquery: missing credentials are a failed line without isError', async () => {
    const fake = setup();
    fake.ctx.google.token = async () => { throw new Error('No Application Default Credentials'); };
    const result = await fake.run('connection_check');
    expect(resultText(result)).toContain('BigQuery: failed — No Application Default Credentials');
    expect(result.isError).toBeUndefined();
  });

  it('connection.check.bigquery: email lookup failure keeps OK and secret-bearing errors are redacted', async () => {
    const fake = setup();
    fake.ctx.google.email = async () => { throw new Error('email scope unavailable'); };
    expect(resultText(await fake.run('connection_check'))).toContain('BigQuery: OK.');
    fake.ctx.google.token = async () => { throw new Error('Failure Bearer abcdef access_token=secret-value ya29.secret-token'); };
    const text = resultText(await fake.run('connection_check'));
    expect(text).not.toContain('abcdef');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('ya29.');
  });

  it('connection.check.looker_signin: hidden signed-in worker is tested using an unguessable catalog query', async () => {
    const fake = setup();
    const result = await fake.run('connection_check');
    const text = resultText(result);
    expect(text).toContain('Looker Studio: signed in (person@example.com)');
    expect(text).toContain('in the background');
    expect(text).toContain('round trip');
    const call = fake.calls.find((c) => c.endpoint === 'getShareableList')!;
    expect(call.body.titleContains).toMatch(/^__connection_[0-9a-f-]+__$/);
    expect(call.body.ownedByMe).toBe(true);
    expect(fake.workerRun).toHaveBeenCalledOnce();
  });

  it('connection.check.looker_signin: a Google sign-in page prompts login without a catalog request', async () => {
    const fake = setup({ url: 'https://accounts.google.com/signin' });
    const result = await fake.run('connection_check');
    expect(resultText(result)).toContain('Looker Studio: failed — not signed in. Run the server\'s "login" command');
    expect(fake.calls.filter((c) => c.endpoint === 'getShareableList')).toHaveLength(0);
    expect(result.isError).toBeUndefined();
  });

  it('connection.check.looker_signin: a browser that cannot start is a failed line with the login hint', async () => {
    const failed = setup({ running: false, workerError: 'Could not open the Looker Studio MCP tab: Google Chrome was not found.' });
    const text = resultText(await failed.run('connection_check'));
    expect(text).toContain('Browser: failed — not running');
    expect(text).toContain('Looker Studio: failed — Could not open the Looker Studio MCP tab');
    expect(failed.calls.filter((c) => c.endpoint === 'getShareableList')).toHaveLength(0);
    expect(resultText(await setup().run('connection_check'))).toContain('Browser: OK (Chrome/1.0.0)');
  });

  it('connection.check.looker_signin: missing XSRF cookie does not attempt a catalog request', async () => {
    const fake = setup({ cookie: false });
    expect(resultText(await fake.run('connection_check'))).toContain('Looker Studio: failed — not signed in');
    expect(fake.calls.filter((c) => c.endpoint === 'getShareableList')).toHaveLength(0);
  });

  it('connection.check.settings: reports configured project, writes and dry run', async () => {
    const fake = setup();
    fake.ctx.config = parseConfig({ billing_project: 'billing-demo', writes_enabled: true, dry_run: true }, tmpdir());
    const text = resultText(await fake.run('connection_check'));
    expect(text).toContain('Default project: billing-demo');
    expect(text).toContain('Writes: enabled');
    expect(text).toContain('Dry run: enabled');
  });

  it('connection.check.settings: falls back to ADC project and distinguishes unset project and read-only tools', async () => {
    const fake = setup();
    fake.ctx.config = parseConfig({}, tmpdir());
    expect(resultText(await fake.run('connection_check'))).toContain('Default project: demo-project');
    fake.ctx.google.projectId = async () => undefined;
    const text = resultText(await fake.run('connection_check'));
    expect(text).toContain('Default project: not set');
    expect(text).toContain('Writes: disabled (read tools only)');
    expect(text).toContain('Dry run: disabled');
  });
});
