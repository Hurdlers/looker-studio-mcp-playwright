import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';

import { adcTokenSource } from '../../src/bigquery/access.js';
import { BigQueryClient } from '../../src/core/bigquery.js';
import { checkPage } from '../../src/core/check.js';
import { createContext } from '../../src/core/context.js';
import { Extensions } from '../../src/core/extensions.js';
import { listPages } from '../../src/core/page.js';
import { ReportSession } from '../../src/core/session.js';
import { resultText, runTool } from '../../src/core/tool.js';
import { parseConfig } from '../../src/config.js';
import { FEATURE_EXTENSIONS, FEATURE_TOOLS } from '../../src/features/registry.generated.js';
import type { Rap } from '../../src/looker/rap.js';
import { buildServer } from '../../src/mcp/server.js';
import { labPrefix, openLane, sweep, track } from './lab.js';

type Json = Record<string, any>;

it('creates, checks, renders, restores and deletes a report through the integrated tools', async () => {
  const project = process.env.LOOKER_STUDIO_MCP_LAB_TABLE?.split('.')[0];
  if (!project) throw new Error('Set LOOKER_STUDIO_MCP_LAB_TABLE=project.dataset.table for the live tests.');
  const laneNumber = Number(process.env.LANE ?? 1);
  expect([1, 2, 3]).toContain(laneNumber);
  const lane = await openLane(laneNumber);
  let client: Client | undefined;
  let server: ReturnType<typeof buildServer> | undefined;
  let reportId = '';

  // Track immediately after persistence, including a partially failed creation.
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown, timeout?: number, mode?: Parameters<Rap['call']>[3]): Promise<T> => {
      const value = await lane.rap.call<T>(endpoint, body, timeout, mode);
      if (endpoint === 'persistTempReport') {
        const made = (value as Json).reportConfig?.shareable;
        if (made?.id && made.name?.startsWith(labPrefix(laneNumber))) await track(lane, made.id, made.name);
      }
      return value;
    },
    callMany: (requests, options) => lane.rap.callMany(requests, options),
  };
  const ctx = createContext({
    rap, session: new ReportSession(rap), worker: lane.worker,
    bigquery: new BigQueryClient(adcTokenSource()),
    config: parseConfig({ writes_enabled: true, billing_project: project }, lane.dir), home: lane.dir,
    tools: FEATURE_TOOLS, ext: new Extensions(FEATURE_EXTENSIONS),
  });
  const call = async (name: string, args: Json) => {
    const response = await runTool(ctx, name, args);
    expect(response.isError, resultText(response)).not.toBe(true);
    return resultText(response);
  };
  const add = async (name: string, args: Json) => {
    const answer = await call(name, { report_id: reportId, page: 'Overview', ...args });
    const id = /cd-[a-f0-9]{10}/.exec(answer)?.[0];
    expect(id).toBeDefined();
    return id!;
  };
  const exportSpec = async (): Promise<Json> => {
    const answer = await call('report_spec_export', { report_id: reportId, style: 'main' });
    return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(answer)![1]!);
  };
  const checkCharts = async () => {
    const doc = await lane.session.load(reportId);
    const pages = [];
    for (const page of listPages(doc)) {
      const checks = await checkPage(rap, doc, page.pageId);
      expect(checks.every(check => check.ok && (check.rows ?? 0) > 0)).toBe(true);
      pages.push({ page: page.name, checks: checks.map(check => ({ id: check.componentId, type: check.type, ok: check.ok, rows: check.rows })) });
    }
    return pages;
  };
  const renderPages = async () => {
    const doc = await lane.session.load(reportId);
    const pages = [];
    for (const page of listPages(doc)) {
      const answer = await call('report_render', { report_id: reportId, page: page.pageId });
      const pdf = /^PDF: (.+)$/m.exec(answer)?.[1];
      const png = /^PNG: (.+)$/m.exec(answer)?.[1];
      expect(pdf).toBeDefined(); expect(png).toBeDefined();
      pages.push({ page: page.name, png: readFileSync(png!), text: execFileSync('pdftotext', [pdf!, '-'], { encoding: 'utf8' }) });
    }
    return pages;
  };

  try {
    const sql = "SELECT 'android' AS platform, DATE '2026-01-15' AS day, 11 AS uses, 2 AS errors UNION ALL SELECT 'ios', DATE '2026-01-20', 23, 1 UNION ALL SELECT 'web', DATE '2026-02-10', 37, 0";
    const targets = "SELECT 'android' AS platform, 3 AS goal UNION ALL SELECT 'ios',4 UNION ALL SELECT 'web',5";
    expect(await call('bq_query_run', { project_id: project, sql: 'SELECT 71 AS expected_total, 76 AS expected_adjusted', max_rows: 1 })).toContain('76');
    const name = `${labPrefix(laneNumber)} integration contract`;
    const made = await call('report_create', { name, project_id: project, sql, source_name: 'Fixture traffic' });
    reportId = /\|\s*([a-f0-9-]{36})\s*\|/i.exec(made)![1]!;
    await call('datasource_add', { report_id: reportId, project_id: project, sql: targets, source_name: 'Fixture targets' });
    await call('theme_update', { report_id: reportId, preset: 'Constellation', canvas: { width: 1400, height: 1000 } });
    await call('page_rename', { report_id: reportId, page: 1, name: 'Overview' });
    await call('page_add', { report_id: reportId, name: 'Details' });
    await call('parameter_add', { report_id: reportId, data_source: 'Fixture traffic', name: 'Target', id: 'target_value', data_type: 'Number (whole)', values: [5, 10], default_value: 5 });
    await call('calculated_field_add', { report_id: reportId, data_source: 'Fixture traffic', name: 'Adjusted uses', formula: 'SUM(uses) + target_value' });
    await call('blend_create', { report_id: reportId, name: 'Fixture joined', tables: [{ data_source: 'Fixture traffic', dimensions: ['platform'], metrics: ['uses'] }, { data_source: 'Fixture targets', dimensions: ['platform'], metrics: ['goal'] }], joins: [{ type: 'left outer', keys: [['platform', 'platform']] }] });
    const shape = await add('shape_add', { shape: 'rectangle', background: '#E8EAF6', position: { left: 20, top: 15, width: 1360, height: 80 } });
    await add('text_add', { text: 'Integration reference', font_size: 28, bold: true, color: '#153347', position: { left: 40, top: 30, width: 1000, height: 60 } });
    const bar = await add('chart_add', { type: 'bar', data_source: 'Fixture traffic', dimensions: ['platform'], metrics: [{ field: 'uses' }], title: 'Filtered traffic', filters: [{ name: 'Selected platforms', field: 'platform', condition: 'in', values: ['android', 'ios'] }], date_range: '2026-01-01..2026-01-31', reference_lines: [{ value: 15, label: 'Reference', color: '#FF00FF' }], position: { left: 20, top: 180, width: 650, height: 300 } });
    const treemap = await add('chart_add', { type: 'treemap', data_source: 'Fixture traffic', dimensions: ['platform'], metrics: [{ field: 'uses' }], position: { left: 710, top: 180, width: 650, height: 300 } });
    await add('chart_add', { type: 'table', data_source: 'Fixture joined', dimensions: ['platform'], metrics: [{ field: 'uses' }, { field: 'goal' }], title: 'Joined totals', position: { left: 20, top: 520, width: 650, height: 350 } });
    await add('control_add', { kind: 'drop_down', data_source: 'Fixture traffic', field: 'Target', position: { left: 20, top: 115, width: 300, height: 40 } });
    await add('community_viz_add', { name: 'Gauge', data_source: 'Fixture traffic', metrics: [{ field: 'uses', aggregation: 'sum' }], position: { left: 710, top: 520, width: 650, height: 350 } });
    await call('chart_add', { report_id: reportId, page: 'Details', type: 'scorecard', data_source: 'Fixture traffic', metrics: [{ field: 'Adjusted uses' }], title: 'Adjusted total', position: { left: 40, top: 100, width: 600, height: 350 } });
    await call('batch_apply', { report_id: reportId, actions: [{ tool: 'component_update', args: { component_id: treemap, position: { left: 710, top: 190, width: 650, height: 300 } } }, { tool: 'page_list', args: {} }] });

    const baseline = await exportSpec();
    const beforeChecks = await checkCharts();
    expect(beforeChecks.flatMap(page => page.checks.map(check => check.rows))).toEqual([2, 3, 3, 1, 1, 1]);
    expect(await call('report_check', { report_id: reportId })).toContain('6 normal / 6 total');
    const beforeRenders = await renderPages();
    expect(beforeRenders[0]!.text).toContain('71'); expect(beforeRenders[1]!.text).toContain('76');

    server = buildServer({ browser: ctx.browser, worker: lane.worker, rap, session: ctx.session, audit: ctx.audit, home: lane.dir, config: ctx.config, bigquery: ctx.bigquery }, 'test');
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    client = new Client({ name: 'integration-contract', version: '1' });
    await client.connect(clientSide);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names.sort()).toEqual(FEATURE_TOOLS.map(tool => tool.name).sort());
    for (const old of ['browser_status', 'list_reports', 'get_report', 'screenshot_report', 'scope_scan']) expect(names).not.toContain(old);
    for (const tool of ['page_list', 'report_check']) {
      const response = await client.callTool({ name: tool, arguments: { report_id: reportId } }) as {
        isError?: boolean; content: Array<{ type: string; text?: string }>;
      };
      expect(response.isError).not.toBe(true);
      const text = response.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
      expect(text).toContain(tool === 'page_list' ? 'Details' : '6 normal / 6 total');
    }
    await client.close(); client = undefined;
    await server.close(); server = undefined;

    // There is no public checkpoint tool; create one as a fixture, then select
    // and restore it through the public version tools.
    const checkpoint = `Integration baseline ${Date.now()}`;
    await rap.call('createNamedRevision', { reportId, name: checkpoint, aiGenerated: false });
    expect(await call('version_list', { report_id: reportId })).toContain(checkpoint);
    await call('batch_apply', { report_id: reportId, actions: [
      { tool: 'component_update', args: { component_id: shape, position: { left: 120, top: 35, width: 1100, height: 100 }, style: { Background: '#FF1493' } } },
      { tool: 'component_update', args: { component_id: bar, filters: [{ name: 'Android only', field: 'platform', condition: 'equals', values: ['android'] }] } },
      { tool: 'text_add', args: { page: 'Overview', text: 'Changed content', position: { left: 800, top: 100, width: 400, height: 60 } } },
    ] });
    expect(await exportSpec()).not.toEqual(baseline);
    expect((await checkCharts()).flatMap(page => page.checks).find(check => check.id === bar)?.rows).toBe(1);
    expect(await call('version_list', { report_id: reportId })).toContain(checkpoint);
    expect(await call('version_restore', { report_id: reportId, version: checkpoint })).toContain('Restored report');
    expect(await exportSpec()).toEqual(baseline);
    expect(await checkCharts()).toEqual(beforeChecks);
    expect(await call('report_check', { report_id: reportId })).toContain('6 normal / 6 total');
    const restoredRenders = await renderPages();
    expect(restoredRenders).toHaveLength(beforeRenders.length);
    for (const [i, restored] of restoredRenders.entries()) {
      expect(restored.page).toBe(beforeRenders[i]!.page);
      expect(restored.text).toBe(beforeRenders[i]!.text);
      expect(restored.png.equals(beforeRenders[i]!.png)).toBe(true);
    }

    await call('report_delete', { report_id: reportId, confirm_name: name });
    const trash = await rap.call<Json>('getShareableList', { type: [0], trashed: true, titleContains: labPrefix(laneNumber), shareableIds: [reportId], sharedWithMe: false, ownedByMe: true, fromHomePage: false, aclModes: [] });
    expect(trash.shareableConfig.some((item: Json) => item.id === reportId)).toBe(true);
  } finally {
    try { await client?.close(); }
    finally {
      try { await server?.close(); }
      finally {
        try {
          const deleted = await sweep(lane);
          if (reportId) expect(deleted).toContain(reportId);
        } finally { await lane.worker.cdp('Emulation.setFocusEmulationEnabled', { enabled: false }); }
      }
    }
  }
});
