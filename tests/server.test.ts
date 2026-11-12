import { tmpdir } from 'node:os';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { WorkerTab } from '../src/browser/worker.js';
import type { AuditEntry } from '../src/core/audit.js';
import { LookerError } from '../src/core/errors.js';
import { ReportSession } from '../src/core/session.js';
import type { FeatureExtensions } from '../src/core/extensions.js';
import { defineTool, resultText, runTool, text as reply, type Tool } from '../src/core/tool.js';
import { parseConfig } from '../src/config.js';
import type { Rap } from '../src/looker/rap.js';
import { FEATURE_TOOLS, FEATURE_EXTENSIONS } from '../src/features/registry.generated.js';
import { buildServer } from '../src/mcp/server.js';

const ids = { sales: '00000000-0000-4000-8000-000000000001', draft: '00000000-0000-4000-8000-000000000002', ga: '00000000-0000-4000-8000-000000000003' };

const shareables = [
  { id: ids.sales, name: 'Sales', modifiedDate: '1700000300000' },
  { id: ids.draft, name: 'Sales (draft)', modifiedDate: '1700000200000' },
  { id: ids.ga, name: 'GA overview', modifiedDate: '1700000100000' },
];

async function setup(
  opts: { tools?: Tool[]; writesEnabled?: boolean; dryRun?: boolean; extensions?: Array<{ group: string; extensions: FeatureExtensions }> } = {},
) {
  const fetched: string[] = [];
  const audited: AuditEntry[] = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => {
      if (endpoint === 'getShareableList') return { shareableConfig: shareables } as T;
      fetched.push(`${endpoint}:${(body as { reportId: string }).reportId}`);
      if (endpoint === 'updatePage') return { version: '10' } as T;
      return { reportConfig: { shareable: { id: ids.sales, name: 'Sales' }, page: [{ pageId: 'p1', page: {} }], report: {} } } as T;
    },
    callMany: async () => [],
  };
  const server = buildServer(
    {
      browser: { status: async () => ({ running: true, profile: '' }) },
      worker: {} as WorkerTab,
      rap,
      session: new ReportSession(rap, { snapshots: false }),
      audit: { write: async (e) => void audited.push(e) },
      home: tmpdir(),
      config: parseConfig({ writes_enabled: opts.writesEnabled ?? false, dry_run: opts.dryRun ?? false }, tmpdir()),
    },
    'test',
    opts.tools ?? FEATURE_TOOLS,
    opts.extensions ?? FEATURE_EXTENSIONS,
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    return { text: res.content.map((c) => c.text ?? '').join('\n'), isError: !!res.isError };
  };
  const names = async () => (await client.listTools()).tools.map((t) => t.name);
  return { call, fetched, names, audited, client };
}

describe('report tools', () => {
  it('exposes the feature registry through MCP with writes gated and retired names absent', async () => {
    for (const writesEnabled of [false, true]) {
      const { client, names } = await setup({ writesEnabled });
      const listed = await names();
      expect(listed.sort()).toEqual(FEATURE_TOOLS.filter(t => writesEnabled || !t.write).map(t => t.name).sort());
      for (const old of ['browser_status', 'list_reports', 'get_report', 'screenshot_report', 'scope_scan']) expect(listed).not.toContain(old);
      expect(new Set(listed).size).toBe(listed.length);
      await client.close();
    }
  });
  it('distinguishes data reads from edits and local output effects in MCP annotations', async () => {
    const { client } = await setup({ writesEnabled: true });
    const listed = (await client.listTools()).tools;
    for (const name of ['page_list', 'component_list', 'report_check']) expect(listed.find(t => t.name === name)?.annotations?.readOnlyHint).toBe(true);
    for (const name of ['chart_add', 'report_delete', 'report_spec_export', 'report_render', 'report_show', 'connection_check']) expect(listed.find(t => t.name === name)?.annotations?.readOnlyHint).toBe(false);
    await client.close();
  });
  it('lists reports by name, newest first', async () => {
    const { call } = await setup();

    const res = await call('report_list');

    expect(res.text.split('\n')).toHaveLength(3);
    expect(res.text.indexOf('Sales |')).toBeLessThan(res.text.indexOf('GA overview |'));
  });

  it('reads a report through the internal API', async () => {
    const { call, fetched } = await setup();

    const res = await call('page_list', { report_id: ids.sales });

    expect(res.isError).toBe(false);
    expect(fetched).toContain(`getReport:${ids.sales}`);
  });
});

describe('feature tools', () => {
  const read = defineTool({
    name: 'thing_list',
    title: 'List things',
    description: 'Lists things.',
    input: { n: z.number().int().default(2) },
    write: false,
    run: async (_ctx, a) => reply(`${a.n} things`),
  });
  const write = defineTool({
    name: 'thing_delete',
    title: 'Delete a thing',
    description: 'Deletes a thing.',
    input: {},
    write: true,
    run: async () => {
      throw new LookerError('version_conflict', 'Report r1 kept changing.');
    },
  });

  it('registers read tools always and write tools only when writes are enabled', async () => {
    expect(await (await setup({ tools: [read, write] })).names()).toContain('thing_list');
    expect(await (await setup({ tools: [read, write] })).names()).not.toContain('thing_delete');
    expect(await (await setup({ tools: [read, write], writesEnabled: true })).names()).toContain('thing_delete');
  });

  it('writes an audit line for every write tool call, and none for reads', async () => {
    const save = defineTool({
      name: 'thing_save',
      title: 'Save a thing',
      description: 'Saves a thing.',
      input: { report_id: z.string() },
      write: true,
      run: async (_ctx, a) => ({ ...reply('saved'), audit: { reportId: a.report_id, version: '8', snapshot: '3' } }),
    });
    const { call, audited } = await setup({ tools: [read, write, save], writesEnabled: true });
    await call('thing_list');
    expect(await call('thing_save', { report_id: 'r1' })).toEqual({ text: 'saved', isError: false });
    await call('thing_delete', { report_id: 'r1' });
    expect(audited).toEqual([
      { tool: 'thing_save', reportId: 'r1', version: '8', snapshot: '3', result: 'ok' },
      { tool: 'thing_delete', result: 'error', detail: 'Report r1 kept changing. [version_conflict]' },
    ]);
  });

  it('runs them with their parsed input and explains their errors', async () => {
    const { call } = await setup({ tools: [read, write], writesEnabled: true });
    expect(await call('thing_list')).toEqual({ text: '2 things', isError: false });
    expect(await call('thing_delete')).toEqual({ text: 'Error: Report r1 kept changing. [version_conflict]', isError: true });
  });
});

describe('tool context', () => {
  const echo = defineTool({
    name: 'thing_echo',
    title: 'Echo',
    description: 'Echoes.',
    input: { word: z.string(), times: z.number().int().default(1) },
    write: false,
    run: async (_ctx, a) => reply(a.word.repeat(a.times)),
  });
  const save = defineTool({
    name: 'thing_save',
    title: 'Save',
    description: 'Saves a page.',
    input: {},
    write: true,
    run: async (ctx) => {
      const res = await ctx.session.editPage(ids.sales, 'p1', (p) => void (p.page.componentConfig = [{ componentId: 'cd-x' }]));
      return { ...reply(`saved ${res.version}`), audit: { reportId: ids.sales, version: res.version } };
    },
  });
  const batch = defineTool({
    name: 'thing_batch',
    title: 'Batch',
    description: 'Runs other tools by name.',
    input: { steps: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) })) },
    write: false,
    run: async (ctx, a) => {
      const out: string[] = [];
      for (const s of a.steps) out.push(resultText(await runTool(ctx, s.tool, s.args)));
      return reply(out.join(','));
    },
  });

  it('lets a tool run other registered tools by name, with their input checked', async () => {
    const { call } = await setup({ tools: [echo, save, batch] });
    expect(await call('thing_batch', { steps: [{ tool: 'thing_echo', args: { word: 'ab' } }, { tool: 'thing_echo', args: { word: 'c', times: 2 } }] })).toEqual({
      text: 'ab,cc',
      isError: false,
    });
    expect((await call('thing_batch', { steps: [{ tool: 'thing_echo', args: {} }] })).text).toMatch(/thing_echo: word: /);
    // Write tools are off, so the batch cannot reach them either.
    expect((await call('thing_batch', { steps: [{ tool: 'thing_save', args: {} }] })).text).toMatch(/No tool "thing_save" \(write tools are off/);
  });

  it('with dry_run on, runs write tools without saving and says what it would have sent', async () => {
    const { call, fetched, audited } = await setup({ tools: [save], writesEnabled: true, dryRun: true });
    const res = await call('thing_save');
    expect(res.text).toMatch(/^saved dry-run-1\nDry run \(dry_run is on\): nothing was saved\. Would have sent: updatePage\.$/);
    expect(fetched).toEqual([`getReport:${ids.sales}`]);
    expect(audited).toEqual([{ tool: 'thing_save', result: 'ok', detail: 'dry run: updatePage not sent' }]);
  });

  it('saves for real with dry_run off', async () => {
    const { call, fetched } = await setup({ tools: [save], writesEnabled: true });
    expect((await call('thing_save')).text).toBe('saved 10');
    expect(fetched).toEqual([`getReport:${ids.sales}`, `updatePage:${ids.sales}`]);
  });

  it("shows the extensions in an owning tool's input, for the client and for runTool", async () => {
    const update = defineTool({
      name: 'thing_update',
      title: 'Update',
      description: 'Updates.',
      input: (ext) => ({ component_id: z.string(), ...ext.updaterInput() }),
      write: false,
      run: async (ctx, a) => reply(ctx.ext.updaterValues(a).map(([u, v]) => `${u.key}=${String(v)}`).join(',')),
    });
    const u = { key: 'date_range', input: z.string().describe('Date range'), apply: () => undefined };
    const { call, client } = await setup({ tools: [update, batch], extensions: [{ group: 'chart-options', extensions: { updaters: [u] } }] });
    const listed = (await client.listTools()).tools.find((t) => t.name === 'thing_update')!;
    expect(Object.keys(listed.inputSchema.properties ?? {})).toEqual(['component_id', 'date_range']);
    expect(listed.inputSchema.required).toEqual(['component_id']);
    expect((await call('thing_update', { component_id: 'cd-1', date_range: 'last 7 days' })).text).toBe('date_range=last 7 days');
    expect((await call('thing_batch', { steps: [{ tool: 'thing_update', args: { component_id: 'cd-1', date_range: 1 } }] })).text).toMatch(/thing_update: date_range: /);
  });

  it('audits write tools run by another tool, and dry-runs them when dry_run is on', async () => {
    const real = await setup({ tools: [save, batch], writesEnabled: true });
    expect((await real.call('thing_batch', { steps: [{ tool: 'thing_save', args: {} }] })).text).toBe('saved 10');
    expect(real.audited).toEqual([{ tool: 'thing_save', reportId: ids.sales, version: '10', result: 'ok' }]);
    const dry = await setup({ tools: [save, batch], writesEnabled: true, dryRun: true });
    expect((await dry.call('thing_batch', { steps: [{ tool: 'thing_save', args: {} }] })).text).toMatch(/^saved dry-run-1\nDry run/);
    expect(dry.fetched).toEqual([`getReport:${ids.sales}`]);
    expect(dry.audited).toEqual([{ tool: 'thing_save', result: 'ok', detail: 'dry run: updatePage not sent' }]);
  });

  it('refuses to start when two groups claim the same extension key', async () => {
    const u = { key: 'filters', input: z.string(), apply: () => undefined };
    await expect(
      setup({ extensions: [{ group: 'a', extensions: { updaters: [u] } }, { group: 'b', extensions: { updaters: [u] } }] }),
    ).rejects.toThrow(/updater "filters" is given by both a and b/);
  });
});
