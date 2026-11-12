import { describe, expect, it } from 'vitest';

import { ReportSession, type ReportDoc } from '../src/core/session.js';
import type { Rap } from '../src/looker/rap.js';

// A Looker Studio that keeps one report and answers like the real one.
function looker(opts: { changeBeforeSave?: number; failPageSaves?: boolean; failReportSaves?: boolean; failAllPageSaves?: boolean } = {}) {
  let changes = opts.changeBeforeSave ?? 0;
  const doc: ReportDoc = {
    shareable: { id: 'r1', name: 'R' },
    version: '10',
    page: [
      {
        pageId: 'p1',
        version: '100',
        chartCondition: [{ chartId: 'cd-a', conditionalFormat: { rule: [{ color: 'red' }] } }],
        page: { componentConfig: [{ componentId: 'cd-a', type: 'kpi-metric' }], propertyConfig: {}, attributeConfig: {} },
      },
    ],
    report: { componentConfig: [], propertyConfig: {}, attributeConfig: {}, resource: { datasourceAlias: [] } },
    chartCondition: [],
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'One' } }] },
  };
  const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      const b = body as Record<string, unknown>;
      calls.push({ endpoint, body: b });
      const page = doc.page[0]!;
      switch (endpoint) {
        case 'getReport':
          return { reportConfig: b.includePages === false ? { ...structuredClone(doc), page: [] } : structuredClone(doc) } as T;
        case 'updateReport': {
          if (b.reportName !== undefined) {
            doc.shareable.name = String(b.reportName);
            doc.version = String(Number(doc.version) + 1);
            return {} as T;
          }
          if (opts.failReportSaves) throw new Error('updateReport returned HTTP 500');
          if (b.version !== doc.version) return { version: '-1' } as T;
          const req = b.reportRequest as { componentConfig: unknown[]; chartCondition: unknown[]; resource: unknown };
          doc.report = { ...doc.report, componentConfig: req.componentConfig as never, resource: req.resource as never };
          doc.chartCondition = req.chartCondition as never;
          doc.version = String(Number(doc.version) + 1);
          return { version: doc.version } as T;
        }
        case 'createPages': {
          const pages = b.pages as Array<{ pageId: string; displayName: string; page: never; chartCondition: never }>;
          const at = (b.position as { index: number }).index;
          doc.page.push(...pages.map((p) => ({ pageId: p.pageId, version: '1', page: p.page, chartCondition: p.chartCondition })));
          doc.navigationInfo!.navItems!.splice(at, 0, ...pages.map((p) => ({ page: { pageId: p.pageId, displayName: p.displayName } })));
          doc.version = String(Number(doc.version) + 1);
          return { navigationInfo: structuredClone(doc.navigationInfo) } as T;
        }
        case 'deletePages': {
          const ids = b.pageIds as string[];
          doc.page = doc.page.filter((p) => !ids.includes(p.pageId));
          doc.navigationInfo!.navItems = doc.navigationInfo!.navItems!.filter((i) => !ids.includes(i.page?.pageId ?? ''));
          doc.version = String(Number(doc.version) + 1);
          return { navigationInfo: structuredClone(doc.navigationInfo) } as T;
        }
        case 'restoreRevision':
          doc.version = String(Number(doc.version) + 1);
          return {} as T;
        case 'updatePage': {
          if (opts.failAllPageSaves) throw new Error('updatePage returned HTTP 500');
          if (opts.failPageSaves && calls.filter((c) => c.endpoint === 'updatePage').length === 1) throw new Error('updatePage returned HTTP 500');
          if (changes-- > 0) {
            // Someone else saved first.
            page.version = String(Number(page.version) + 1);
            page.page.componentConfig!.push({ componentId: 'cd-theirs', type: 'simple-description' });
          }
          if (b.version !== page.version) return { version: '-1' } as T;
          const req = b.pageRequest as { componentConfig: unknown[]; chartCondition: unknown[]; fieldMask: number[] };
          page.page.componentConfig = req.componentConfig as never;
          if (req.fieldMask.includes(5)) page.chartCondition = req.chartCondition as never;
          page.version = String(Number(page.version) + 1);
          return { version: page.version } as T;
        }
        case 'updateReportNavigationInfo': {
          if (b.version !== doc.version) return { version: '-1' } as T;
          doc.navigationInfo = b.navigationInfo as never;
          doc.version = String(Number(doc.version) + 1);
          return { version: doc.version } as T;
        }
        case 'createNamedRevision':
          return {} as T;
        case 'getRevisions':
          return {
            revisionInfo: calls
              .filter((c) => c.endpoint === 'createNamedRevision')
              .map((c, i) => ({ revisionNumber: 7 + i, revisionAnnotation: { name: c.body.name } })),
          } as T;
        default:
          throw new Error(`unexpected ${endpoint}`);
      }
    },
    callMany: async () => [],
  };
  return { rap, doc, calls };
}

describe('ReportSession', () => {
  it('saves changed conditional formats and clears the last one through the page field mask', async () => {
    const { rap, doc } = looker();
    const session = new ReportSession(rap);
    const condition = { chartId: 'cd-a', conditionalFormat: { rule: [{ color: 'blue' }] } };
    await session.editPage('r1', 'p1', (page) => { page.chartCondition = [condition]; });
    expect(doc.page[0]!.chartCondition).toEqual([condition]);
    await session.editPage('r1', 'p1', (page) => { page.chartCondition = []; });
    expect(doc.page[0]!.chartCondition).toEqual([]);
  });
  it('saves a page with its version and keeps the conditional formatting', async () => {
    const { rap, doc, calls } = looker();
    const session = new ReportSession(rap);

    const res = await session.editPage('r1', 'p1', (p) => {
      p.page.componentConfig!.push({ componentId: 'cd-b', type: 'simple-table' });
    });

    expect(res).toEqual({ version: '101', snapshot: '7', reapplied: false });
    const save = calls.find((c) => c.endpoint === 'updatePage')!.body;
    expect(save).toMatchObject({ reportId: 'r1', pageId: 'p1', version: '100', sessionId: session.sessionId });
    expect((save.pageRequest as { chartCondition: unknown[] }).chartCondition).toEqual(doc.page[0]!.chartCondition);
    expect(doc.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-a', 'cd-b']);
  });

  it('applies the edit again when someone saved in between, keeping their change', async () => {
    const { rap, doc } = looker({ changeBeforeSave: 1 });

    const res = await new ReportSession(rap).editPage('r1', 'p1', (p) => {
      p.page.componentConfig!.push({ componentId: 'cd-b', type: 'simple-table' });
    });

    expect(res.reapplied).toBe(true);
    expect(doc.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-a', 'cd-theirs', 'cd-b']);
  });

  it('gives up with version_conflict when the report keeps changing', async () => {
    const { rap } = looker({ changeBeforeSave: 5 });

    await expect(new ReportSession(rap).editPage('r1', 'p1', () => {})).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('takes one snapshot for writes close together, and none when turned off', async () => {
    let now = 0;
    const a = looker();
    const session = new ReportSession(a.rap, { now: () => now });
    await session.editPage('r1', 'p1', () => {});
    now = 30_000;
    await session.editNavigation('r1', (items) => (items[0]!.page!.displayName = 'Renamed'));
    expect(a.calls.filter((c) => c.endpoint === 'createNamedRevision')).toHaveLength(1);
    expect(a.doc.navigationInfo?.navItems?.[0]?.page?.displayName).toBe('Renamed');

    const b = looker();
    await new ReportSession(b.rap, { snapshots: false }).editPage('r1', 'p1', () => {});
    expect(b.calls.some((c) => c.endpoint === 'createNamedRevision')).toBe(false);
  });

  it('reports a page that is not there', async () => {
    const { rap } = looker();
    await expect(new ReportSession(rap, { snapshots: false }).editPage('r1', 'nope', () => {})).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ReportSession writes beyond one document', () => {
  const endpoints = (calls: Array<{ endpoint: string }>) => calls.map((c) => c.endpoint);

  it('renames the report with a snapshot first and answers the new version', async () => {
    const { rap, doc, calls } = looker();
    const res = await new ReportSession(rap).renameReport('r1', '  New name ');

    expect(doc.shareable.name).toBe('New name');
    expect(calls.find((c) => c.endpoint === 'updateReport')!.body).toEqual({ reportId: 'r1', reportName: 'New name' });
    expect(endpoints(calls).indexOf('createNamedRevision')).toBeLessThan(endpoints(calls).indexOf('updateReport'));
    expect(res).toEqual({ version: '11', snapshot: '7', reapplied: false });
    await expect(new ReportSession(rap).renameReport('r1', '   ')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('adds an empty page at the end, named as the editor names it', async () => {
    const { rap, doc, calls } = looker();
    const session = new ReportSession(rap, { snapshots: false });
    const res = await session.createPages('r1', [{ displayName: 'Second' }]);

    expect(res.pageIds).toHaveLength(1);
    expect(res.pageIds[0]).toMatch(/^p_[0-9a-f]{10}$/);
    expect(res.version).toBe('11');
    const body = calls.find((c) => c.endpoint === 'createPages')!.body;
    expect(body).toEqual({
      reportId: 'r1',
      sessionId: session.sessionId,
      position: { index: 1 },
      pages: [
        {
          pageId: res.pageIds[0],
          displayName: 'Second',
          chartCondition: [],
          page: {
            componentConfig: [],
            groupConfig: [],
            conceptDefs: [],
            propertyConfig: { pageProperty: { filters: [], inheritFilters: true } },
            attributeConfig: { pageAttribute: { datasourceConfigVersion: 2, displayConfigVersion: 0, name: 'Second' } },
          },
        },
      ],
    });
    expect(doc.navigationInfo?.navItems?.map((i) => i.page?.displayName)).toEqual(['One', 'Second']);
  });

  it('adds a copy where it is told, keeping its components and conditional formatting', async () => {
    const { rap, doc, calls } = looker();
    const source = structuredClone(doc.page[0]!);
    await new ReportSession(rap, { snapshots: false }).createPages(
      'r1',
      [{ displayName: 'Copy of One', pageId: 'p_0000000001', page: source.page, chartCondition: source.chartCondition! }],
      { index: 0 },
    );

    const body = calls.find((c) => c.endpoint === 'createPages')!.body as { pages: Array<{ page: { componentConfig: unknown[]; attributeConfig: unknown }; chartCondition: unknown[] }>; position: unknown };
    expect(body.position).toEqual({ index: 0 });
    expect(body.pages[0]!.page.componentConfig).toEqual(source.page.componentConfig);
    expect(body.pages[0]!.chartCondition).toEqual(source.chartCondition);
    expect(body.pages[0]!.page.attributeConfig).toEqual({ pageAttribute: { name: 'Copy of One' } });
    expect(doc.navigationInfo?.navItems?.[0]?.page?.pageId).toBe('p_0000000001');
  });

  it('deletes pages, but never the last one or one that is not there', async () => {
    const { rap, doc, calls } = looker();
    const session = new ReportSession(rap, { snapshots: false });
    await expect(session.deletePages('r1', ['p1'])).rejects.toMatchObject({ code: 'invalid' });
    await expect(session.deletePages('r1', ['nope'])).rejects.toMatchObject({ code: 'not_found' });
    expect(endpoints(calls)).not.toContain('deletePages');

    const { pageIds } = await session.createPages('r1', [{ displayName: 'Two' }]);
    const res = await session.deletePages('r1', pageIds);
    expect(calls.find((c) => c.endpoint === 'deletePages')!.body).toEqual({ reportId: 'r1', pageIds, sessionId: session.sessionId });
    expect(res.navigationInfo?.navItems?.map((i) => i.page?.pageId)).toEqual(['p1']);
    expect(doc.page.map((p) => p.pageId)).toEqual(['p1']);
  });

  it('restores a revision after a snapshot of what it overwrites, and takes a fresh snapshot before the next write', async () => {
    let now = 0;
    const { rap, calls } = looker();
    const session = new ReportSession(rap, { now: () => now });
    await session.editPage('r1', 'p1', () => {});
    // Within the snapshot window, yet a new snapshot: the page changed since the last one.
    const res = await session.restore('r1', '7');
    now = 1_000;
    await session.editPage('r1', 'p1', () => {});

    const sent = endpoints(calls).filter((e) => e !== 'getReport' && e !== 'getRevisions');
    expect(sent).toEqual(['createNamedRevision', 'updatePage', 'createNamedRevision', 'restoreRevision', 'createNamedRevision', 'updatePage']);
    expect(calls.filter((c) => c.endpoint === 'createNamedRevision')[1]!.body.name).toMatch(/^looker-studio-mcp: before restore revision 7 · /);
    expect(calls.find((c) => c.endpoint === 'restoreRevision')!.body).toEqual({ entityId: 'r1', entityType: 1, revisionNumber: '7' });
    expect(res).toEqual({ version: '11', snapshot: '8', reapplied: false });
  });

  it('checks a page deletion before taking a snapshot, and refuses an empty one', async () => {
    const { rap, calls } = looker();
    const session = new ReportSession(rap);
    await expect(session.deletePages('r1', [])).rejects.toMatchObject({ code: 'invalid' });
    await expect(session.deletePages('r1', ['p1'])).rejects.toMatchObject({ code: 'invalid' });
    await expect(session.deletePages('r1', ['nope'])).rejects.toMatchObject({ code: 'not_found' });
    expect(endpoints(calls).filter((e) => e !== 'getReport')).toEqual([]);
  });

  it('saves the report part, then the page that uses it', async () => {
    const { rap, doc } = looker();
    const res = await new ReportSession(rap, { snapshots: false }).editReportThenPage('r1', 'p1', {
      report: (d) => d.report.resource!.datasourceAlias!.push({ datasourceId: 'dsF', alias: 'ds1' }),
      page: (p) => p.page.componentConfig!.push({ componentId: 'cd-f', type: 'dimension-filter' }),
    });

    expect(res.reapplied).toBe(false);
    expect(doc.report.resource?.datasourceAlias).toEqual([{ datasourceId: 'dsF', alias: 'ds1' }]);
    expect(doc.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-a', 'cd-f']);
  });

  it('puts the report part back when the page save fails', async () => {
    const { rap, doc, calls } = looker({ failPageSaves: true });
    const err = await new ReportSession(rap, { snapshots: false })
      .editReportThenPage('r1', 'p1', {
        report: (d) => d.report.resource!.datasourceAlias!.push({ datasourceId: 'dsF', alias: 'ds1' }),
        page: (p) => p.page.componentConfig!.push({ componentId: 'cd-f', type: 'dimension-filter' }),
      })
      .catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/updatePage returned HTTP 500/);
    expect(endpoints(calls).filter((e) => e === 'updateReport')).toHaveLength(2);
    expect(doc.report.resource?.datasourceAlias).toEqual([]);
    expect(doc.page[0]!.page.componentConfig!.map((c) => c.componentId)).toEqual(['cd-a']);
  });

  it('puts the page back, conditional formatting included, when the report save after it fails', async () => {
    const { rap, doc } = looker({ failReportSaves: true });
    const before = structuredClone(doc.page[0]!);
    await expect(
      new ReportSession(rap, { snapshots: false }).editPageAndReport('r1', 'p1', {
        page: (p) => {
          p.page.componentConfig = [];
          p.chartCondition = [];
        },
        report: (d) => d.report.componentConfig!.push({ componentId: 'cd-a', type: 'kpi-metric' }),
      }),
    ).rejects.toThrow(/updateReport returned HTTP 500/);

    expect(doc.page[0]!.page.componentConfig).toEqual(before.page.componentConfig);
    expect(doc.page[0]!.chartCondition).toEqual(before.chartCondition);
  });

  it('says the report is half-saved, and how to get back, when the second save and the undo both fail', async () => {
    const { rap: inner, doc, calls } = looker({ failAllPageSaves: true });
    const rap: Rap = {
      ...inner,
      call: async (endpoint, body) => {
        // The report save works once; putting it back fails.
        if (endpoint === 'updateReport' && calls.some((c) => c.endpoint === 'updateReport')) throw new Error('updateReport returned HTTP 503');
        return inner.call(endpoint, body);
      },
    };
    const err = await new ReportSession(rap)
      .editReportThenPage('r1', 'p1', {
        report: (d) => d.report.resource!.datasourceAlias!.push({ datasourceId: 'dsF', alias: 'ds1' }),
        page: (p) => p.page.componentConfig!.push({ componentId: 'cd-f', type: 'dimension-filter' }),
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // Not a version conflict: the code says what failed (a plain 500 here: busy).
    expect(err).toMatchObject({ code: 'busy', message: expect.stringMatching(/half-saved, restore revision 7 of report r1/) });
    expect(doc.report.resource?.datasourceAlias).toEqual([{ datasourceId: 'dsF', alias: 'ds1' }]);
    expect(endpoints(calls).filter((e) => e === 'updatePage')).toHaveLength(1);
  });

  it('says the same when the page went first and both the report save and putting the page back fail', async () => {
    const { rap, calls } = looker({ failReportSaves: true });
    const flaky: Rap = {
      ...rap,
      call: async (endpoint, body) => {
        // The page save works once; putting it back fails.
        if (endpoint === 'updatePage' && calls.some((c) => c.endpoint === 'updatePage')) throw new Error('updatePage returned HTTP 500');
        return rap.call(endpoint, body);
      },
    };
    await expect(
      new ReportSession(flaky, { snapshots: false }).editPageAndReport('r1', 'p1', {
        page: (p) => (p.page.componentConfig = []),
        report: (d) => d.report.componentConfig!.push({ componentId: 'cd-a', type: 'kpi-metric' }),
      }),
    ).rejects.toMatchObject({ code: 'busy', message: expect.stringMatching(/updateReport returned HTTP 500.*updatePage returned HTTP 500.*half-saved, check the report/) });
  });
});
