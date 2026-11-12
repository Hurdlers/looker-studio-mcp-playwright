import { describe, expect, it } from 'vitest';

import type { BigQueryClient } from '../src/core/bigquery.js';
import { createContext } from '../src/core/context.js';
import { createReport } from '../src/core/create.js';
import { DRY_RUN_PAGE, DRY_RUN_REPORT, DryRap, dryRunContext, isWrite } from '../src/core/dryrun.js';
import { getReportBody } from '../src/looker/reports.js';
import type { ReportDoc } from '../src/core/session.js';
import type { Rap, RapOutcome, RapRequest } from '../src/looker/rap.js';

function report(): ReportDoc {
  return {
    shareable: { id: 'r1', name: 'R' },
    version: '5',
    report: {},
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'One' } }] },
    page: [{ pageId: 'p1', version: '9', page: { componentConfig: [{ componentId: 'cd-a', type: 'kpi-metric' }] } }],
  };
}

function fakeRap() {
  const sent: string[] = [];
  const rap: Rap = {
    call: async <T>(endpoint: string) => {
      sent.push(endpoint);
      if (endpoint === 'getReport') return { reportConfig: report() } as T;
      return { endpoint } as T;
    },
    callMany: async <T>(requests: RapRequest[]) => {
      sent.push(...requests.map((r) => r.endpoint));
      return requests.map((r) => ({ ok: true, value: { endpoint: r.endpoint } })) as RapOutcome<T>[];
    },
  };
  return { rap, sent };
}

describe('dry-run context', () => {
  it('records saves instead of sending them, and later reads see them', async () => {
    const { rap, sent } = fakeRap();
    const dry = dryRunContext(createContext({ rap }));
    expect(dry.ctx.dryRun).toBe(true);

    const first = await dry.ctx.session.editPage('r1', 'p1', (p) => p.page.componentConfig!.push({ componentId: 'cd-b', type: 'kpi-metric' }));
    expect(first.version).toMatch(/^dry-run-/);
    await dry.ctx.session.editNavigation('r1', (items) => (items[0]!.page!.displayName = 'Renamed'));
    const after = await dry.ctx.session.load('r1');

    expect(after.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-a', 'cd-b']);
    expect(after.navigationInfo?.navItems?.[0]?.page?.displayName).toBe('Renamed');
    expect(dry.writes.map((w) => w.endpoint)).toEqual(['updatePage', 'updateReportNavigationInfo']);
    // getReport went out once; no write did.
    expect(sent).toEqual(['getReport']);
  });

  it('caches reads in a batch and answers writes there too', async () => {
    const { rap, sent } = fakeRap();
    const dry = dryRunContext(createContext({ rap }));
    const ask = [
      { endpoint: 'batchedDataV2', body: { a: 1 } },
      { endpoint: 'deletePages', body: { reportId: 'r1', pageIds: ['p1'] } },
    ];
    const one = await dry.ctx.rap.callMany(ask);
    const two = await dry.ctx.rap.callMany(ask);
    expect(one).toEqual(two);
    expect(one[1]).toEqual({ ok: true, value: {} });
    expect(sent).toEqual(['batchedDataV2']);
    expect(dry.writes.map((w) => w.endpoint)).toEqual(['deletePages', 'deletePages']);
  });

  it('records BigQuery DDL and deletes, and passes reads through', async () => {
    const calls: string[] = [];
    const bigquery = {
      config: { maxRows: 500, maxBytesBilled: 1e9 },
      dryRun: async () => (calls.push('dryRun'), { bytesProcessed: 10 }),
      ddl: async () => (calls.push('ddl'), {}),
      deleteTable: async () => void calls.push('deleteTable'),
      deletable: async () => void calls.push('deletable'),
    } as unknown as BigQueryClient;
    const dry = dryRunContext(createContext({ rap: fakeRap().rap, bigquery }));
    expect(await dry.ctx.bigquery.dryRun('p', 'SELECT 1')).toEqual({ bytesProcessed: 10 });
    await dry.ctx.bigquery.ddl('p', 'CREATE OR REPLACE VIEW `p.d.v` AS SELECT 1');
    await dry.ctx.bigquery.deleteTable('p', 'd', 'v');
    // The delete is checked (a read) like a real one, then recorded.
    expect(calls).toEqual(['dryRun', 'deletable']);
    expect(dry.writes).toEqual([
      { endpoint: 'bigquery.ddl', body: { project: 'p', sql: 'CREATE OR REPLACE VIEW `p.d.v` AS SELECT 1' } },
      { endpoint: 'bigquery.deleteTable', body: { project: 'p', dataset: 'd', table: 'v' } },
    ]);
  });

  it('makes a placeholder report that later steps can read and edit', async () => {
    const { rap, sent } = fakeRap();
    const dry = dryRunContext(createContext({ rap }));
    const made = await createReport(dry.ctx.rap, 'Sales');
    expect(made).toEqual({ reportId: DRY_RUN_REPORT, pageId: DRY_RUN_PAGE, name: 'Sales' });
    await dry.ctx.session.editPage(made.reportId, made.pageId, (p) => p.page.componentConfig!.push({ componentId: 'cd-new', type: 'kpi-metric' }));
    const doc = await dry.ctx.session.load(made.reportId);
    expect(doc.shareable.name).toBe('Sales');
    expect(doc.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-new']);
    expect(dry.writes.map((w) => w.endpoint)).toEqual(['createTempReport', 'persistTempReport', 'updatePage']);
    expect(sent).toEqual([]);
  });

  it('answers copyReport with the URL of a copy of the source', async () => {
    const { rap, sent } = fakeRap();
    const dry = new DryRap(rap, []);
    const res = await dry.call<{ url: string }>('copyReport', { reportId: 'r1', datasourceMap: '{}' }, undefined, 'form');
    const id = /\/reporting\/([^/]+)/.exec(res.url)![1]!;
    expect(id).toBe(DRY_RUN_REPORT);
    const copy = (await dry.call<{ reportConfig: ReportDoc }>('getReport', getReportBody(id, true))).reportConfig;
    expect(copy.page.map((p) => p.pageId)).toEqual(['p1']);
    expect(copy.shareable).toEqual({ id, name: 'Copy of R' });
    // Only the source was read.
    expect(sent).toEqual(['getReport']);
  });

  it('applies earlier saves to a report read later with another body', async () => {
    const { rap } = fakeRap();
    const dry = new DryRap(rap, []);
    await dry.call('getReport', getReportBody('r1', true));
    await dry.call('updateReport', { reportId: 'r1', reportName: 'Renamed' });
    await dry.call('createPages', {
      reportId: 'r1',
      pages: [{ pageId: 'p0', displayName: 'Zero', page: {} }],
      position: { index: 0 },
    });
    const other = (await dry.call<{ reportConfig: ReportDoc }>('getReport', getReportBody('r1', false))).reportConfig;
    expect(other.shareable.name).toBe('Renamed');
    expect(other.navigationInfo?.navItems?.map((n) => n.page?.pageId)).toEqual(['p0', 'p1']);
    expect(other.version).toBe('dry-run-2');
    await dry.call('deletePages', { reportId: 'r1', pageIds: ['p0'] });
    const again = (await dry.call<{ reportConfig: ReportDoc }>('getReport', getReportBody('r1', false))).reportConfig;
    expect(again.page.map((p) => p.pageId)).toEqual(['p1']);
    expect(again.version).toBe('dry-run-3');
  });

  it('knows writes by the guard list and by name', () => {
    expect(['updatePage', 'copyReport', 'renameDatasource', 'grantConsent'].every(isWrite)).toBe(true);
    expect(['getReport', 'batchedDataV2', 'getPdf', 'validateFormula'].some(isWrite)).toBe(false);
  });
});
