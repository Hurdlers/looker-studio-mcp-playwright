import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as Render from '../../../src/core/render.js';
import { resultText } from '../../../src/core/tool.js';
import { chart, looker, type Json } from './fake.js';

const converter = vi.hoisted(() => ({ fail: false }));
vi.mock('../../../src/core/render.js', async (original) => {
  const actual = await original<typeof Render>();
  return { ...actual, renderChecked: async (...args: Parameters<typeof actual.renderChecked>) => actual.renderChecked(args[0], args[1], args[2], args[3], { waitMs: 0, run: async (cmd, params) => {
    if (converter.fail) throw new Error('Converter not installed');
    const file = cmd === 'pdftoppm' ? `${params.at(-1)}.png` : params.at(-1)!;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from('fake png'));
  } }) };
});

const dirs: string[] = [];
afterEach(async () => { converter.fail = false; await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'verify-render-'));
  dirs.push(dir);
  return looker(undefined, dir);
}

describe('report_render', () => {
  it('encodes a numeric internal page id for both PDF selectors after navigation reordering', async () => {
    const fake = await setup();
    fake.doc.page.find((p) => p.pageId === 'p2')!.pageId = '1234567';
    fake.doc.navigationInfo!.navItems![1]!.section!.navItems![0]!.page!.pageId = '1234567';
    const before = structuredClone(fake.doc);
    await fake.run('report_render', { page: 'Inner' });
    const body = fake.calls.find((c) => c.endpoint === 'getPdf')!.body;
    expect(body.pageIds).toEqual(['XKLF']);
    expect(body.pageSettings).toEqual([{ pageId: 'XKLF', name: 'Inner', width: 1200, height: 1100 }]);
    expect(fake.calls.find((c) => c.endpoint === 'batchedDataV2')!.body.dataRequest[0].requestContext.reportContext.pageId).toBe('1234567');
    expect(fake.doc).toEqual(before);
  });

  it('report.render.page: requests the selected nested page with the report canvas size', async () => {
    const fake = await setup();
    await fake.run('report_render', { page: 'Inner' });
    const body = fake.calls.find((c) => c.endpoint === 'getPdf')!.body;
    expect(body.pageIds).toEqual(['p2']);
    expect(body.pageSettings).toEqual([{ pageId: 'p2', name: 'Inner', width: 1200, height: 1100 }]);
    expect(fake.calls.findIndex((c) => c.endpoint === 'batchedDataV2')).toBeLessThan(fake.calls.findIndex((c) => c.endpoint === 'getPdf'));
  });

  it('report.render.page: defaults to the first navigation page despite a different page array order', async () => {
    const fake = await setup();
    await fake.run('report_render');
    expect(fake.calls.find((c) => c.endpoint === 'getPdf')!.body.pageIds).toEqual(['p1']);
  });

  it('report.render.page: page-specific size prevents a tall page from being clipped', async () => {
    const fake = await setup();
    fake.doc.page.find((p) => p.pageId === 'p2')!.page.attributeConfig = { pageAttribute: { width: 1500, height: 2400 } };
    await fake.run('report_render', { page: 'Inner' });
    expect(fake.calls.find((c) => c.endpoint === 'getPdf')!.body.pageSettings).toEqual([{ pageId: 'p2', name: 'Inner', width: 1500, height: 2400 }]);
  });

  it('report.render.page: missing page names list available pages without a render request', async () => {
    const fake = await setup();
    await expect(fake.run('report_render', { page: 'Nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringMatching(/Overview.*Inner/) });
    expect(fake.calls.filter((c) => c.endpoint === 'getPdf')).toHaveLength(0);
  });

  it('report.render.page: returns the saved PNG as base64 plus PNG and PDF file paths', async () => {
    const fake = await setup();
    const result = await fake.run('report_render', { page: 'Inner' });
    expect(result.content[0]).toEqual({ type: 'image', data: Buffer.from('fake png').toString('base64'), mimeType: 'image/png' });
    const text = resultText(result);
    const png = /PNG: (.+)/.exec(text)![1]!;
    const pdf = /PDF: (.+)/.exec(text)![1]!;
    expect((await readFile(png)).toString()).toBe('fake png');
    expect((await readFile(pdf)).toString()).toBe('%PDF fake');
    expect(text).toContain('published version');
  });

  it('report.render.page: falls back to the PDF path when every converter is unavailable', async () => {
    converter.fail = true;
    const fake = await setup();
    const result = await fake.run('report_render', { page: 'Inner' });
    expect(result.content.every((c) => c.type === 'text')).toBe(true);
    expect(resultText(result)).toContain('PDF:');
    expect(resultText(result)).toContain('No PNG converter succeeded');
  });

  it('report.render.consent_declined: warns once for email-parameter components and never grants consent', async () => {
    const fake = await setup();
    fake.dataSource.published.blocks[0].connectorBlockConfig.connectorConfig.sql = 'SELECT @DS_USER_EMAIL AS email';
    const result = await fake.run('report_render', { page: 'Inner' });
    expect(result.content.some((c) => c.type === 'image')).toBe(true);
    expect(resultText(result)).toContain('Consent may be required for components: cd-table.');
    expect(resultText(result).match(/Consent: this tool/g)).toHaveLength(1);
    expect(fake.calls.some((c) => c.endpoint === 'grantConsent')).toBe(false);
  });

  it('report.render.consent_declined: warns for viewer credentials and includes report-level components', async () => {
    const fake = await setup();
    fake.dataSource.published.delegatedAccessEnabled = false;
    fake.doc.report.componentConfig = [chart('cd-shared')];
    const text = resultText(await fake.run('report_render', { page: 'Inner' }));
    expect(text).toContain('cd-table, cd-shared');
  });

  it('report.render.consent_declined: ordinary owner-credential sources produce no consent note', async () => {
    const fake = await setup();
    expect(resultText(await fake.run('report_render', { page: 'Inner' }))).not.toContain('Consent:');
  });

  it.each([true, false])('report.render.data: returns the image and warns only for a NULL scalar aggregate (null=%s)', async (isNull) => {
    const fake = await setup();
    fake.doc.page.find((page) => page.pageId === 'p2')!.page.componentConfig = [chart('cd-null', 'google://devrel/gauge')];
    fake.replies.set('cd-null', { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: {
      totalCount: 1, size: 1, columnInfo: [{ ns: 't0', name: 'qt_cd-null' }],
      column: [isNull ? { nullIndex: [0] } : { longColumn: { values: ['0'] } }],
    } } }] }] });
    const result = await fake.run('report_render', { page: 'Inner' });
    const text = resultText(result);
    expect(result.content.some((content) => content.type === 'image')).toBe(true);
    expect(text).toContain('PDF:'); expect(text).toContain('PNG:');
    expect(text).toContain('published version');
    if (isNull) {
      expect(text).toContain('current draft'); expect(text).toContain('cd-null');
      expect(text).toContain('no data: aggregate metric is NULL');
    } else expect(text).not.toContain('no data');
    expect(fake.calls.filter((call) => call.endpoint === 'batchedDataV2')).toHaveLength(1);
    expect(fake.calls.filter((call) => call.endpoint === 'getBlockDatasource')).toHaveLength(1);
    expect(fake.calls.some((call) => /grant|update|publish/i.test(call.endpoint))).toBe(false);
  });
});
