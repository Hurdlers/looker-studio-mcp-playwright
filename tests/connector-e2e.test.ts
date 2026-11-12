import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const runner = await import(new URL('../scripts/connector-e2e.mjs', import.meta.url).href);
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
const scenario = () => ({ name: 'synthetic', billing_project: 'example-project', source: { sql: 'SELECT 1 AS amount' }, setup: [],
  templates: [{ template_id: 'test-card', bindings: { metric_1: 'amount' } }], expect: { normal: 1, total: 1 } });
const ids = ['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'];
const text = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError } : {}) });

function fake(failure?: 'create' | 'render' | 'delete' | 'fields' | 'theme') {
  const sent: Array<{ name: string; arguments: Record<string, any> }> = [];
  const names = new Map<string, string>();
  const callTool = vi.fn(async (call: { name: string; arguments: Record<string, any> }) => {
    sent.push(call);
    const a = call.arguments;
    if (call.name === 'report_create') {
      names.set(ids[0]!, a.name);
      return failure === 'create' ? text(`Connection failed. The report was created: ${ids[0]} (test URL).`, true)
        : text(`Created "${a.name}" | ${ids[0]} | test URL`);
    }
    if (call.name === 'report_spec_apply') { names.set(ids[1]!, a.name); return text(`Created ${ids[1]}: test URL`); }
    if (call.name === 'datasource_list') return text(`ds1 "Synthetic" (id ${a.report_id})\n  Fields (1):\n    - amount (calc_${a.report_id}): ${failure === 'fields' && a.report_id === ids[1] ? 'Number' : 'Currency (KRW)'}, metric, aggregation auto`);
    if (call.name === 'report_check') return text('Checked 1 page: 1 normal / 1 total.');
    if (call.name === 'report_render') {
      if (failure === 'render') throw new Error('transport interrupted');
      return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('identical test image bytes').toString('base64') }] };
    }
    if (call.name === 'report_spec_export') return text('```json\n' + JSON.stringify({ version: 1, name: names.get(a.report_id),
      data_sources: [{ name: 'Synthetic', sql: 'SELECT 1 AS amount' }], pages: [{ name: 'Page', components: [] }],
      ...(failure === 'theme' && a.report_id === ids[1] ? { theme: { preset: 'Default' } } : {}) }) + '\n```');
    if (call.name === 'report_delete' && failure === 'delete') return text('Delete refused', true);
    return text('OK');
  });
  return { sent, callTool, listTools: async () => ({ tools: [{ name: 'report_create' }] }) };
}

async function run(client: ReturnType<typeof fake>) {
  const dir = await mkdtemp(join(tmpdir(), 'connector-e2e-')); folders.push(dir);
  const result = await runner.runScenario(scenario(), { client, dir });
  return { result, dir };
}

describe('connector E2E contract', () => {
  it('requires real chart expectations and confines fixtures before making a client call', () => {
    expect(() => runner.validateScenario({ ...scenario(), expect: {} })).toThrow(/chart counts/);
    expect(() => runner.validateScenario({ ...scenario(), billing_project: undefined })).toThrow(/billing_project/);
    expect(() => runner.validateScenario({ ...scenario(), source: { sql: 'SELECT 1', project_id: 'other-project' } })).toThrow(/not approved/);
    expect(() => runner.validateScenario({ ...scenario(), expect: { normal: 0, total: 1 } })).toThrow(/diagnostic/);
    for (const sql of ['SELECT * FROM real.table', 'SELECT 1; SELECT 2', 'CALL procedure()', 'SELECT 1 -- comment'])
      expect(() => runner.validateScenario({ ...scenario(), source: { sql } })).toThrow();
    expect(() => runner.validateScenario({ ...scenario(), setup: [{ tool: 'report_delete', args: {} }] })).toThrow(/setup/);
    expect(() => runner.validateScenario({ ...scenario(), setup: [{ tool: 'field_update', args: { report_id: ids[0] } }] })).toThrow(/report ID/);
  });

  it('accepts only the explicitly approved sheet and refuses source substitution inside a spec', () => {
    const sheets = { ...scenario(), allowed_spreadsheets: ['approved-sheet'], source: { connector: 'google_sheets', spreadsheet: 'https://docs.google.com/spreadsheets/d/approved-sheet/edit#gid=0', worksheet_id: '0' } };
    expect(runner.validateScenario(sheets)).toBe(sheets);
    expect(() => runner.validateSource({ ...sheets.source, spreadsheet: 'another-sheet' }, sheets)).toThrow(/not approved/);
    expect(() => runner.validateSource({ ...sheets.source, spreadsheet: 'https://docs.google.com.evil.test/spreadsheets/d/approved-sheet' }, sheets)).toThrow();
    expect(() => runner.validateSource({ sql: 'SELECT 1', viewer_email_param: false }, scenario())).toThrow(/Consent/);
  });

  it('does not equate a successful tool response with a normal chart', () => {
    expect(() => runner.assertCheck('Checked 1 page: 0 normal / 1 total. no data', { normal: 1, total: 1 })).toThrow();
    expect(() => runner.assertCheck('Checked 1 page: 0 normal / 1 total. no data', { normal: 0, total: 1, includes: ['no data'] })).not.toThrow();
    expect(() => runner.assertCheck('Checked 1 page: 0 normal / 1 total. loading', { normal: 0, total: 1, includes: ['no data'] })).toThrow();
  });

  it('compares fields without hiding source swaps, and distinguishes harmless IDs from type loss', () => {
    const a = 'ds1 "A" (id old)\n - amount (old_id): Currency (KRW), metric, aggregation auto';
    const b = 'ds1 "A" (id new)\n - amount (new_id): Currency (KRW), metric, aggregation auto';
    expect(runner.fieldMetadata(a)).toEqual(runner.fieldMetadata(b));
    expect(runner.fieldMetadata(a)).not.toEqual(runner.fieldMetadata(b.replace('"A"', '"B"')));
  });

  it('saves original MCP image bytes, compares the roundtrip and trashes exactly its own reports', async () => {
    const client = fake(); const { result, dir } = await run(client);
    expect(result.status).toBe('pass');
    expect(result.comparison.image_bytes_equal).toBe(true);
    expect(result.comparison.field_metadata_equal_except_ids).toBe(true);
    expect(await readFile(join(dir, result.original.images[0].file), 'utf8')).toBe('identical test image bytes');
    expect(client.sent.filter((call) => call.name === 'report_delete').map((call) => call.arguments.report_id)).toEqual(ids);
    expect(result.cleanup.permanent_cleanup_required).toBe(true);
  });

  it('tracks a partially failed creation and cleans it up instead of losing the new id', async () => {
    const client = fake('create'); const { result, dir } = await run(client);
    expect(result.status).toBe('fail');
    expect(result.cleanup.reports).toEqual([{ id: ids[0], name: '[looker-studio-mcp-lab-1] connector-e2e synthetic original', status: 'trashed' }]);
    expect(JSON.parse(await readFile(join(dir, 'created.json'), 'utf8'))[0].id).toBe(ids[0]);
    expect(client.sent.some((call) => call.name === 'component_template_add')).toBe(false);
  });

  it('refuses reused output directories without losing the earlier ownership record or calling MCP', async () => {
    const { dir } = await run(fake());
    const before = await readFile(join(dir, 'created.json'), 'utf8');
    const client = fake();
    await expect(runner.runScenario(scenario(), { client, dir })).rejects.toThrow(/fresh output/);
    expect(client.callTool).not.toHaveBeenCalled();
    expect(await readFile(join(dir, 'created.json'), 'utf8')).toBe(before);
  });

  it('cleans up after a transport failure, and reports failed cleanup rather than calling the run a pass', async () => {
    const interrupted = await run(fake('render'));
    expect(interrupted.result.status).toBe('fail');
    expect(interrupted.result.cleanup.reports[0].status).toBe('trashed');
    const refused = await run(fake('delete'));
    expect(refused.result.status).toBe('fail');
    expect(refused.result.cleanup.errors).toHaveLength(2);
  });

  it('fails a field-type regression even with identical images, and leaves theme representation for explicit review', async () => {
    expect((await run(fake('fields'))).result.status).toBe('fail');
    const theme = (await run(fake('theme'))).result;
    expect(theme.status).toBe('review_required');
    expect(theme.comparison.theme_representation_difference).toBe(true);
  });

  it('redacts structured and embedded secrets and forbids loading secret environment variables', () => {
    const clean = runner.redact({ accessToken: 'secret-a', text: 'Bearer secret-b access_token="secret-c" ya29.example-secret' });
    expect(JSON.stringify(clean)).not.toMatch(/secret-[abc]|example-secret/);
    expect(runner.expandEnvironment({ spreadsheet: { $env: 'TEST_SHEET' } }, { TEST_SHEET: 'approved-sheet' })).toEqual({ spreadsheet: 'approved-sheet' });
    expect(() => runner.expandEnvironment({ $env: 'ACCESS_TOKEN' }, { ACCESS_TOKEN: 'secret' })).toThrow(/Secrets/);
  });

  it('normalizes rendered whitespace but does not treat Invalid metric as a successful numeric assertion', () => {
    expect(runner.assertRenderText('Female\n    2\t\nTotal   3', ['Female 2', 'Total\n3'])).toBe('Female 2 Total 3');
    expect(() => runner.assertRenderText('Invalid metric', ['Total 3'])).toThrow(/rendered text is missing/);
    expect(() => runner.validateScenario({ ...scenario(), expect: { normal: 1, total: 1, render_text_includes: 'Total 3' } })).toThrow(/arrays/);
  });

  it('reads only a returned PDF inside this run, rejecting arbitrary paths and outward symlinks before extraction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'connector-pdf-')); folders.push(dir);
    const renders = join(dir, 'server-home', 'renders'); await mkdir(renders, { recursive: true });
    const own = join(renders, 'own.pdf'), outside = join(dir, 'outside.pdf');
    await writeFile(own, 'fake pdf'); await writeFile(outside, 'private fake pdf');
    await symlink(outside, join(renders, 'escape.pdf'));
    const extract = vi.fn(async () => 'Total\n 3');
    expect(await runner.readRenderedText(`PDF: ${own}`, dir, extract)).toBe('Total 3');
    expect(extract).toHaveBeenCalledTimes(1);
    await expect(runner.readRenderedText(`PDF: ${outside}`, dir, extract)).rejects.toThrow(/outside/);
    await expect(runner.readRenderedText(`PDF: ${join(renders, 'escape.pdf')}`, dir, extract)).rejects.toThrow(/outside/);
    await expect(runner.readRenderedText('PDF: relative.pdf', dir, extract)).rejects.toThrow(/local PDF/);
    await expect(runner.readRenderedText(`PDF: ${own}\nPDF: ${own}`, dir, extract)).rejects.toThrow(/exactly one/);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  async function renderRun(rendered: string | Error, restored?: string) {
    const dir = await mkdtemp(join(tmpdir(), 'connector-render-text-')); folders.push(dir);
    const renders = join(dir, 'server-home', 'renders'); await mkdir(renders, { recursive: true });
    const file = join(renders, 'output.pdf'); await writeFile(file, 'fake pdf');
    const client = fake(), originalCall = client.callTool;
    client.callTool = vi.fn(async (call) => {
      const response = await originalCall(call);
      if (call.name !== 'report_render') return response;
      return { ...response, content: [...response.content, { type: 'text', text: `PDF: ${file}` }] } as typeof response;
    });
    let invocation = 0;
    const extractPdfText = vi.fn(async () => {
      if (rendered instanceof Error) throw rendered;
      return invocation++ === 0 ? rendered : restored ?? rendered;
    });
    const config = { ...scenario(), expect: { normal: 1, total: 1, render_text_includes: ['Total 3'] } };
    const result = await runner.runScenario(config, { client, dir, extractPdfText });
    return { result, dir, extractPdfText };
  }

  it('asserts original and restored render text and saves only redacted extracted text', async () => {
    const good = await renderRun('Total\n 3 access_token="secret-render"');
    expect(good.result.status).toBe('pass');
    expect(good.result.numeric_values).toBe('configured_render_text_assertions_passed');
    expect(good.extractPdfText).toHaveBeenCalledTimes(2);
    expect(await readFile(join(good.dir, 'original-page-1-render.txt'), 'utf8')).not.toContain('secret-render');
    const badCopy = await renderRun('Total 3', 'Invalid metric');
    expect(badCopy.result.status).toBe('fail');
    expect(badCopy.result.numeric_values).toBe('render_text_assertions_failed_or_incomplete');
    expect(badCopy.result.cleanup.reports).toHaveLength(2);
    expect(badCopy.result.cleanup.reports.every((report: { status: string }) => report.status === 'trashed')).toBe(true);
  });

  it('fails expected render-text verification when extraction is unavailable and explicitly marks runs without it', async () => {
    const unavailable = await renderRun(new Error('pdftotext ENOENT'));
    expect(unavailable.result.status).toBe('fail');
    expect(unavailable.result.error).toContain('ENOENT');
    expect(unavailable.result.cleanup.reports[0].status).toBe('trashed');
    expect((await run(fake())).result.numeric_values).toBe('manual_review_required');
  });
});
