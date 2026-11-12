import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { freeSpot, listPages, pageArg, pageComponents, pageSize, resolvePage } from '../src/core/page.js';
import type { ReportDoc } from '../src/core/session.js';

const box = (id: string, left: number, top: number, width: number, height: number) => ({
  componentId: id,
  type: 'shape',
  attributeConfig: { componentAttribute: { left, top, width, height } },
});

function doc(): ReportDoc {
  return {
    shareable: { id: 'r1', name: 'R' },
    report: { attributeConfig: { reportAttribute: { width: 1000, height: 800 } }, componentConfig: [box('cd-header', 0, 0, 1000, 60)] },
    navigationInfo: {
      navItems: [
        { page: { pageId: 'pB', displayName: 'Overview' } },
        { section: { displayName: 'Detail', navItems: [{ page: { pageId: 'pA', displayName: 'Traffic', hiddenFromViewer: true } }] } },
        { page: { pageId: 'p2', displayName: '2' } },
      ],
    },
    page: [
      { pageId: 'pA', position: 0, page: { componentConfig: [] } },
      { pageId: 'pB', position: 1, page: { componentConfig: [box('cd-a', 20, 80, 400, 200)], attributeConfig: { pageAttribute: { width: 1400 } } } },
      { pageId: 'p2', position: 2, page: {} },
      { pageId: 'pLost', position: 3, page: { attributeConfig: { pageAttribute: { name: 'Orphan' } } } },
    ],
  };
}

describe('pages', () => {
  it('lists pages in navigation order, numbered from 1, then pages the navigation misses', () => {
    expect(listPages(doc())).toEqual([
      { pageId: 'pB', name: 'Overview', number: 1 },
      { pageId: 'pA', name: 'Traffic', section: 'Detail', hidden: true, number: 2 },
      { pageId: 'p2', name: '2', number: 3 },
      { pageId: 'pLost', name: 'Orphan', number: 4 },
    ]);
  });

  it('finds a page by id, name, or number, the first page when omitted', () => {
    const d = doc();
    expect(resolvePage(d)).toBe('pB');
    expect(resolvePage(d, 'pA')).toBe('pA');
    expect(resolvePage(d, ' traffic ')).toBe('pA');
    expect(resolvePage(d, 2)).toBe('pA');
    // A page named "2" wins over the second page.
    expect(resolvePage(d, '2')).toBe('p2');
    expect(resolvePage(d, 4)).toBe('pLost');
    expect(() => resolvePage(d, 9)).toThrow(/No page "9".*1\. Overview \(pB\); 2\. Detail › Traffic \(pA\)/);
    expect(pageArg.parse(3)).toBe(3);
    expect(() => z.object({ page: pageArg }).parse({ page: 0 })).toThrow();
  });

  it("uses the page's own size before the canvas", () => {
    expect(pageSize(doc(), 'pB')).toEqual({ width: 1400, height: 800 });
    expect(pageSize(doc(), 'pA')).toEqual({ width: 1000, height: 800 });
  });

  it('counts report-level components as on every page', () => {
    expect(pageComponents(doc(), 'pB').map((c) => c.componentId)).toEqual(['cd-a', 'cd-header']);
  });
});

describe('freeSpot', () => {
  it('finds the highest, then leftmost, place that overlaps nothing', () => {
    // pB is wider than the canvas: room beside the report-level header.
    expect(freeSpot(doc(), 'pB', { width: 300, height: 100 })).toEqual({ left: 1020, top: 20, width: 300, height: 100 });
    // Too wide for that: below the header, right of cd-a.
    expect(freeSpot(doc(), 'pB', { width: 400, height: 100 })).toEqual({ left: 440, top: 80, width: 400, height: 100 });
    // Too wide to sit beside cd-a: under it.
    expect(freeSpot(doc(), 'pB', { width: 1000, height: 100 })).toEqual({ left: 20, top: 300, width: 1000, height: 100 });
    expect(freeSpot(doc(), 'pA', { width: 200, height: 50 })).toEqual({ left: 20, top: 80, width: 200, height: 50 });
  });

  it('narrows a component wider than the page', () => {
    expect(freeSpot(doc(), 'pA', { width: 5000, height: 50 }).width).toBe(960);
  });

  it('keeps clear of a report-level component that overlaps the first free row', () => {
    const d = doc();
    (d.report.componentConfig as unknown[]).push(box('cd-side', 0, 60, 300, 400));
    // Not at left 20 under the header: the report-level side bar is there.
    expect(freeSpot(d, 'pA', { width: 200, height: 50 })).toEqual({ left: 320, top: 80, width: 200, height: 50 });
  });

  it('keeps clear of boxes kept in the page groups', () => {
    const d = doc();
    d.page[0]!.page.groupConfig = [{ groupId: 'g1', attributeConfig: { groupAttribute: { left: 20, top: 80, width: 960, height: 100 } } }];
    expect(freeSpot(d, 'pA', { width: 200, height: 50 })).toMatchObject({ left: 20, top: 200 });
  });

  it('says when a full page has to grow for the spot', () => {
    const d = doc();
    d.page[0]!.page.componentConfig = [box('cd-full', 0, 60, 1000, 740)];
    expect(freeSpot(d, 'pA', { width: 200, height: 50 })).toEqual({ left: 20, top: 820, width: 200, height: 50, beyondPage: true });
  });
});
