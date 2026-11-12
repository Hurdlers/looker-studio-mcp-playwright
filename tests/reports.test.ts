import { describe, expect, it } from 'vitest';

import type { Rap } from '../src/looker/rap.js';
import { getReport, listReports, outlineReport, type RawReportConfig } from '../src/looker/reports.js';

function fakeRap(responses: Record<string, unknown>) {
  const calls: Array<{ endpoint: string; body: unknown }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => {
      calls.push({ endpoint, body });
      return responses[endpoint] as T;
    },
    callMany: async () => {
      throw new Error('not used');
    },
  };
  return { rap, calls };
}

const shareable = (id: string, name: string, modified: number) => ({
  id,
  type: 0,
  name,
  ownerDisplayName: 'Team',
  createdDate: '1700000000000',
  modifiedDate: String(modified),
  viewedByMeDate: '1700000500000',
  trashed: false,
});

describe('listReports', () => {
  it('asks for every report matching the filter and sorts by last modified', async () => {
    const { rap, calls } = fakeRap({
      getShareableList: {
        shareableConfig: [shareable('a', 'Old', 1700000100000), shareable('b', 'New', 1700000900000)],
      },
    });

    const reports = await listReports(rap, { query: 'GA4', owned: true });

    expect(calls[0]).toMatchObject({
      endpoint: 'getShareableList',
      body: { type: [0], trashed: false, titleContains: 'GA4', ownedByMe: true, sharedWithMe: false, fromHomePage: false },
    });
    expect(reports.map((r) => r.id)).toEqual(['b', 'a']);
    expect(reports[0]).toEqual({
      id: 'b',
      name: 'New',
      owner: 'Team',
      created: new Date(1700000000000).toISOString(),
      modified: new Date(1700000900000).toISOString(),
      viewedByMe: new Date(1700000500000).toISOString(),
      url: 'https://lookerstudio.google.com/reporting/b',
    });
  });

  it('cuts the list at limit', async () => {
    const { rap } = fakeRap({
      getShareableList: { shareableConfig: [1, 2, 3].map((n) => shareable(`r${n}`, `R${n}`, n)) },
    });

    expect(await listReports(rap, { limit: 2 })).toHaveLength(2);
  });

  it('copes with an empty answer', async () => {
    const { rap } = fakeRap({ getShareableList: {} });

    expect(await listReports(rap)).toEqual([]);
  });
});

describe('getReport', () => {
  it('reads the report without marking it viewed or touching the live draft', async () => {
    const cfg = { shareable: { id: 'r1', name: 'R' }, page: [], report: {} };
    const { rap, calls } = fakeRap({ getReport: { reportConfig: cfg } });

    expect(await getReport(rap, 'r1')).toBe(cfg);
    expect(calls[0]?.body).toMatchObject({
      reportId: 'r1',
      includePages: true,
      updateViewedDate: false,
      updateFirestore: false,
    });
  });
});

describe('outlineReport', () => {
  const box = (left: number, top: number, width: number, height: number) => ({
    attributeConfig: { componentAttribute: { left, top, width, height } },
  });

  const cfg: RawReportConfig = {
    shareable: { id: 'r1', name: 'Sales' },
    version: '42',
    page: [
      {
        pageId: 'p2',
        position: 1,
        page: {
          attributeConfig: { pageAttribute: { name: 'Untitled copy', height: 1200 } },
          componentConfig: [{ componentId: 'c3', type: 'simple-table', datasourceId: 'ds-b', ...box(0, 0, 500, 300) }],
        },
      },
      {
        pageId: 'p1',
        position: 0,
        page: {
          attributeConfig: { pageAttribute: { name: 'Raw name' } },
          componentConfig: [
            { componentId: 'c1', type: 'kpi-metric', datasourceId: 'ds-a', ...box(40, 120, 360, 120) },
            { componentId: 'c2', type: 'simple-description', ...box(40, 20, 600, 50) },
          ],
        },
      },
    ],
    report: {
      componentConfig: [{ componentId: 'h1', type: 'generic-shape', ...box(0, 0, 1200, 100) }],
      resource: { datasourceAlias: [{ datasourceId: 'ds-a', alias: 'ds0' }] },
      attributeConfig: { reportAttribute: { width: 1200, height: 900 } },
      propertyConfig: { reportProperty: { themeConfig: 'theme1' } },
    },
    navigationInfo: {
      navItems: [
        {
          section: {
            displayName: 'Overview',
            navItems: [{ page: { pageId: 'p1', displayName: 'Summary' } }],
          },
        },
      ],
    },
  };

  it('orders pages, names them like the navigation and keeps each component box', () => {
    const outline = outlineReport(cfg);

    expect(outline).toMatchObject({
      id: 'r1',
      name: 'Sales',
      version: '42',
      canvas: { width: 1200, height: 900 },
      themeId: 'theme1',
      datasourceAliases: [{ alias: 'ds0', datasourceId: 'ds-a' }],
      reportLevel: [{ id: 'h1', type: 'generic-shape', x: 0, y: 0, width: 1200, height: 100 }],
      componentTypes: { 'kpi-metric': 1, 'simple-description': 1, 'simple-table': 1, 'generic-shape': 1 },
    });
    expect(outline.pages.map((p) => [p.id, p.name, p.section])).toEqual([
      ['p1', 'Summary', 'Overview'],
      ['p2', 'Untitled copy', undefined],
    ]);
    expect(outline.pages[0]?.components[0]).toEqual({
      id: 'c1',
      type: 'kpi-metric',
      x: 40,
      y: 120,
      width: 360,
      height: 120,
      datasourceId: 'ds-a',
    });
    expect(outline.pages[1]?.height).toBe(1200);
  });

  it('follows the navigation order, which can differ from page positions', () => {
    const outline = outlineReport({
      ...cfg,
      navigationInfo: {
        navItems: [
          { page: { pageId: 'p2', displayName: 'Overview' } },
          { section: { displayName: 'More', navItems: [{ page: { pageId: 'p1', displayName: 'Detail' } }] } },
        ],
      },
    });

    expect(outline.pages.map((p) => p.id)).toEqual(['p2', 'p1']);
  });
});
