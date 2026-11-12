import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Render from '../../../src/core/render.js';
import { resultText } from '../../../src/core/tool.js';
import { RapError } from '../../../src/looker/rap.js';
import { looker, REPORT, type Json } from './fake.js';

vi.mock('../../../src/core/render.js', async original => {
  const actual = await original<typeof Render>();
  return { ...actual, renderChecked: async (...args: Parameters<typeof actual.renderChecked>) => actual.renderChecked(args[0], args[1], args[2], args[3], {
    waitMs: 0,
    run: async (command, params) => {
      const file = command === 'pdftoppm' ? `${params.at(-1)}.png` : params.at(-1)!;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from('fake refreshed png'));
    },
  }) };
});

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(failure = false) {
  const home = await mkdtemp(join(tmpdir(), 'verify-refresh-')); dirs.push(home);
  const f = looker(undefined, home), call = f.rap.call.bind(f.rap);
  const audit: Json[] = [];
  f.ctx.audit = { write: async entry => { audit.push(entry); } };
  vi.spyOn(f.rap, 'call').mockImplementation(async (endpoint, body, ...rest) => {
    if (endpoint === 'updatePrefetch') {
      f.calls.push({ endpoint, body: structuredClone(body) as Json });
      if (failure) throw new RapError(endpoint, 403, 'Refresh refused');
      return {};
    }
    return call(endpoint, body, ...rest);
  });
  return { ...f, audit };
}

describe('explicit report data refresh', () => {
  it('refreshes the normalized report target without changing report content, fields or publishing', async () => {
    const f = await setup(), before = structuredClone(f.doc), source = structuredClone(f.dataSource);
    await f.run('report_data_refresh', { report_id: `https://lookerstudio.google.com/reporting/${REPORT}/page/p2` });
    expect(f.calls.filter(c => c.endpoint === 'updatePrefetch')).toEqual([
      { endpoint: 'updatePrefetch', body: { prefetchConfig: { reportId: REPORT }, fieldMask: 'TIMESTAMP' } },
    ]);
    expect(f.calls.findIndex(c => c.endpoint === 'getReport')).toBeLessThan(f.calls.findIndex(c => c.endpoint === 'updatePrefetch'));
    expect(f.calls.some(c => /^(create|publish|updatePage|updateReport)/.test(c.endpoint))).toBe(false);
    expect(f.doc).toEqual(before); expect(f.dataSource).toEqual(source);
    expect(f.audit.filter(entry => entry.tool === 'report_data_refresh')).toHaveLength(1);
  });

  it('keeps the existing render behavior when refresh_data is omitted or false', async () => {
    for (const args of [{}, { refresh_data: false }]) {
      const f = await setup();
      const out = await f.run('report_render', { page: 'Inner', ...args });
      expect(out.content.some(c => c.type === 'image')).toBe(true);
      expect(f.calls.some(c => c.endpoint === 'updatePrefetch')).toBe(false);
      expect(f.audit).toEqual([]);
    }
  });

  it('refreshes once before the data check and PDF, auditing the refresh once', async () => {
    const f = await setup(), before = structuredClone(f.doc);
    const out = await f.run('report_render', { page: 'Inner', refresh_data: true });
    const refresh = f.calls.findIndex(c => c.endpoint === 'updatePrefetch');
    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(refresh).toBeLessThan(f.calls.findIndex(c => c.endpoint === 'batchedDataV2'));
    expect(refresh).toBeLessThan(f.calls.findIndex(c => c.endpoint === 'getPdf'));
    expect(f.calls.filter(c => c.endpoint === 'updatePrefetch')).toHaveLength(1);
    expect(f.audit.filter(entry => entry.tool === 'report_data_refresh')).toHaveLength(1);
    expect(out.content.some(c => c.type === 'image')).toBe(true);
    expect(resultText(out)).toContain('published version');
    expect(f.doc).toEqual(before);
  });

  it('refuses a nonexistent page before touching the report cache', async () => {
    const f = await setup();
    await expect(f.run('report_render', { page: 'Missing page', refresh_data: true })).rejects.toThrow();
    expect(f.calls.some(c => ['updatePrefetch', 'batchedDataV2', 'getPdf'].includes(c.endpoint))).toBe(false);
    expect(f.audit).toEqual([]);
  });

  it('cannot refresh through the read-only render tool when write tools are disabled', async () => {
    const f = await setup();
    f.ctx.config.writesEnabled = false;
    f.ctx.tools = new Map([...f.ctx.tools].filter(([, tool]) => !tool.write));
    await expect(f.run('report_render', { page: 'Inner', refresh_data: true })).rejects.toThrow();
    await expect(f.run('report_data_refresh')).rejects.toThrow();
    expect(f.calls.some(c => ['updatePrefetch', 'batchedDataV2', 'getPdf'].includes(c.endpoint))).toBe(false);
  });

  it('does not refresh or render when refresh_data is requested under dry-run', async () => {
    const f = await setup(), before = structuredClone(f.doc);
    f.ctx.config.dryRun = true;
    const out = await f.run('report_render', { page: 'Inner', refresh_data: true });
    expect(f.calls.some(c => ['updatePrefetch', 'batchedDataV2', 'getPdf'].includes(c.endpoint))).toBe(false);
    expect(out.content.every(c => c.type === 'text')).toBe(true);
    expect(resultText(out)).toMatch(/dry.run|미리보기/i);
    expect(f.doc).toEqual(before);
    expect(f.audit.filter(entry => entry.tool === 'report_data_refresh')).toHaveLength(1);
  });

  it('does not send the refresh write when the standalone refresh tool runs under dry-run', async () => {
    const f = await setup(); f.ctx.config.dryRun = true;
    const out = await f.run('report_data_refresh');
    expect(f.calls.some(c => c.endpoint === 'updatePrefetch')).toBe(false);
    expect(resultText(out)).toMatch(/dry.run/i);
  });

  it('propagates a native refresh failure without retrying or producing a stale PDF', async () => {
    const f = await setup(true);
    await expect(f.run('report_render', { page: 'Inner', refresh_data: true })).rejects.toThrow('Refresh refused');
    expect(f.calls.filter(c => c.endpoint === 'updatePrefetch')).toHaveLength(1);
    expect(f.calls.some(c => ['batchedDataV2', 'getPdf'].includes(c.endpoint))).toBe(false);
    expect(f.audit.filter(entry => entry.tool === 'report_data_refresh')).toHaveLength(1);
  });
});
