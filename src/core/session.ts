import { randomBytes } from 'node:crypto';

import type { Rap } from '../looker/rap.js';
import { getReportBody } from '../looker/reports.js';
import { explain, LookerError } from './errors.js';

// Every write goes the same way: read the definition, change a copy, take a
// snapshot to undo to, save it with the version it was read at. Looker
// Studio saves whole documents and answers version "-1" (saving nothing) when
// someone saved in between; then the edit is applied once more to the fresh
// document. Edits must therefore be repeatable: "set this component's box",
// not "move it 10 px".

type Json = Record<string, unknown>;

// A page as getReport returns it. chartCondition sits beside `page` and holds
// conditional formatting: it must go back with every save, or it is lost.
export interface PageDoc {
  pageId: string;
  version?: string;
  position?: number;
  chartCondition?: Json[];
  page: {
    componentConfig?: Json[];
    groupConfig?: Json[];
    conceptDefs?: Json[];
    propertyConfig?: Json;
    attributeConfig?: Json;
  } & Json;
}

export interface NavItem {
  page?: { pageId: string; displayName?: string; hiddenFromViewer?: boolean } & Json;
  section?: { sectionId?: string; displayName?: string; navItems?: NavItem[] } & Json;
}

export interface ReportDoc {
  shareable: { id: string; name: string } & Json;
  version?: string;
  page: PageDoc[];
  report: {
    componentConfig?: Json[];
    conceptDefs?: Json[];
    propertyConfig?: Json;
    attributeConfig?: Json;
    resource?: { datasourceAlias?: Array<{ datasourceId: string; alias: string }> } & Json;
  } & Json;
  chartCondition?: Json[];
  navigationInfo?: { navItems?: NavItem[] } & Json;
}

export interface WriteResult {
  version: string;
  // Revision to restore to undo this write (shared by writes close together).
  snapshot?: string;
  // The report changed meanwhile and the edit was applied to the new version.
  reapplied: boolean;
}

// A page to add: an empty one unless `page` is given (a duplicate).
export interface NewPage {
  displayName: string;
  pageId?: string;
  page?: PageDoc['page'];
  chartCondition?: Json[];
}

export interface PagesResult extends WriteResult {
  // Ids of the pages added, in the order given.
  pageIds: string[];
  navigationInfo?: ReportDoc['navigationInfo'];
}

export interface SessionOptions {
  // Take a named revision before the first write to a report (default true).
  snapshots?: boolean;
  // Writes to the same report within this time share one snapshot.
  snapshotEveryMs?: number;
  now?: () => number;
}

export class ReportSession {
  // Sent with every save, as the editor does.
  readonly sessionId = `kds${randomBytes(6).toString('hex')}`;
  private readonly snapshots = new Map<string, { at: number; revision?: string }>();

  constructor(
    private readonly rap: Rap,
    private readonly opts: SessionOptions = {},
  ) {}

  async load(reportId: string): Promise<ReportDoc> {
    const res = await this.rap.call<{ reportConfig?: ReportDoc }>('getReport', getReportBody(reportId, true));
    if (!res.reportConfig) throw new LookerError('not_found', `Report ${reportId} not found, or this account cannot open it.`);
    return res.reportConfig;
  }

  // Changes one page. `edit` gets a copy to change in place.
  async editPage(reportId: string, pageId: string, edit: (page: PageDoc, doc: ReportDoc) => void, label = 'edit'): Promise<WriteResult> {
    return this.write(reportId, label, async (doc) => {
      const page = doc.page.find((p) => p.pageId === pageId);
      if (!page) throw new LookerError('not_found', `Page ${pageId} is not in report ${reportId}.`);
      edit(page, doc);
      const res = await this.rap.call<{ version?: string }>('updatePage', {
        reportId,
        pageId,
        pageRequest: pageRequest(page),
        sessionId: this.sessionId,
        version: String(page.version ?? doc.version ?? 0),
      });
      return res.version;
    });
  }

  // Changes the report-level part: report components, theme, canvas, data source aliases.
  async editReport(reportId: string, edit: (doc: ReportDoc) => void, label = 'edit report'): Promise<WriteResult> {
    return this.write(reportId, label, async (doc) => {
      edit(doc);
      const res = await this.rap.call<{ version?: string }>('updateReport', {
        reportRequest: reportRequest(doc),
        reportId,
        sessionId: this.sessionId,
        version: String(doc.version ?? 0),
      });
      return res.version;
    });
  }

  // Changes page names, order and visibility.
  async editNavigation(reportId: string, edit: (items: NavItem[], doc: ReportDoc) => void, label = 'edit pages'): Promise<WriteResult> {
    return this.write(reportId, label, async (doc) => {
      const navigationInfo = doc.navigationInfo ?? { navItems: [] };
      navigationInfo.navItems ??= [];
      edit(navigationInfo.navItems, doc);
      const res = await this.rap.call<{ version?: string }>('updateReportNavigationInfo', {
        reportId,
        navigationInfo,
        sessionId: this.sessionId,
        version: String(doc.version ?? 0),
      });
      return res.version;
    });
  }

  // Gives the report a new name. updateReport with reportName alone changes
  // nothing else and sends no version.
  async renameReport(reportId: string, name: string, label = 'rename report'): Promise<WriteResult> {
    const title = name.trim();
    if (!title) throw new LookerError('invalid', 'A report name cannot be empty.');
    return this.direct(reportId, label, () => {}, async () => {
      await this.rap.call('updateReport', { reportId, reportName: title });
    });
  }

  // Adds pages at `position` (index among the top-level pages, optionally in
  // a section); at the end when omitted.
  async createPages(
    reportId: string,
    pages: NewPage[],
    position?: { index: number; sectionId?: string },
    label = 'add pages',
  ): Promise<PagesResult> {
    if (!pages.length) throw new LookerError('invalid', 'No pages to add.');
    const requests = pages.map((p) => newPageRequest(p));
    let navigationInfo: ReportDoc['navigationInfo'];
    const res = await this.direct(reportId, label, () => {}, async (head) => {
      const at = position ?? { index: head.navigationInfo?.navItems?.length ?? 0 };
      const made = await this.rap.call<{ navigationInfo?: ReportDoc['navigationInfo'] }>('createPages', {
        reportId,
        pages: requests,
        position: at,
        sessionId: this.sessionId,
      });
      navigationInfo = made?.navigationInfo;
    });
    return { ...res, pageIds: requests.map((r) => r.pageId), ...(navigationInfo ? { navigationInfo } : {}) };
  }

  // Removes pages. The last page cannot go: a report always has one.
  async deletePages(reportId: string, pageIds: string[], label = 'delete pages'): Promise<PagesResult> {
    if (!pageIds.length) throw new LookerError('invalid', 'No pages to delete.');
    let navigationInfo: ReportDoc['navigationInfo'];
    const check = (head: ReportDoc): void => {
      const all = navPageIds(head.navigationInfo?.navItems ?? []);
      const missing = pageIds.filter((id) => !all.includes(id));
      if (missing.length) throw new LookerError('not_found', `Page(s) ${missing.join(', ')} not in report ${reportId}.`);
      if (all.every((id) => pageIds.includes(id)))
        throw new LookerError('invalid', 'A report keeps at least one page: add another page before deleting this one.');
    };
    const res = await this.direct(reportId, label, check, async () => {
      const done = await this.rap.call<{ navigationInfo?: ReportDoc['navigationInfo'] }>('deletePages', {
        reportId,
        pageIds,
        sessionId: this.sessionId,
      });
      navigationInfo = done?.navigationInfo;
    });
    return { ...res, pageIds, ...(navigationInfo ? { navigationInfo } : {}) };
  }

  // Puts the report back as it was at a revision (getRevisions numbers).
  // A snapshot of the state the restore overwrites is taken first (always a
  // new one: a recent snapshot may predate later writes), so the restore can
  // be undone too. The next write takes a fresh snapshot: the old ones
  // predate the restore.
  async restore(reportId: string, revision: string | number, label = `restore revision ${revision}`): Promise<WriteResult> {
    if (String(revision).trim() === '') throw new LookerError('invalid', 'Name the revision to restore (a revisionNumber from getRevisions).');
    this.snapshots.delete(reportId);
    const res = await this.direct(reportId, label, () => {}, async () => {
      await this.rap.call('restoreRevision', { entityId: reportId, entityType: 1, revisionNumber: revision });
    });
    this.snapshots.delete(reportId);
    return res;
  }

  // Two saves that belong together: the report part (a filter, a data source
  // alias) then a page that uses it. When the page save fails, the report
  // part is put back as it was and the page's error is thrown.
  async editReportThenPage(
    reportId: string,
    pageId: string,
    edit: { report: (doc: ReportDoc) => void; page: (page: PageDoc, doc: ReportDoc) => void },
    label = 'edit report and page',
  ): Promise<WriteResult> {
    let before: Pick<ReportDoc, 'report' | 'chartCondition'> | undefined;
    const first = await this.editReport(
      reportId,
      (doc) => {
        before = structuredClone({ report: doc.report, chartCondition: doc.chartCondition ?? [] });
        edit.report(doc);
      },
      label,
    );
    return this.second(reportId, first, () => this.editPage(reportId, pageId, edit.page, label), () =>
      this.editReport(reportId, (doc) => Object.assign(doc, structuredClone(before)), `undo ${label}`),
    );
  }

  // The other order: a page first (taking a component out), then the report
  // (putting it at report level). When the report save fails, the page is
  // put back.
  async editPageAndReport(
    reportId: string,
    pageId: string,
    edit: { page: (page: PageDoc, doc: ReportDoc) => void; report: (doc: ReportDoc) => void },
    label = 'edit page and report',
  ): Promise<WriteResult> {
    let before: Pick<PageDoc, 'page' | 'chartCondition'> | undefined;
    const first = await this.editPage(
      reportId,
      pageId,
      (page, doc) => {
        before = structuredClone({ page: page.page, chartCondition: page.chartCondition ?? [] });
        edit.page(page, doc);
      },
      label,
    );
    return this.second(reportId, first, () => this.editReport(reportId, edit.report, label), () =>
      this.editPage(reportId, pageId, (page) => Object.assign(page, structuredClone(before)), `undo ${label}`),
    );
  }

  private async second(
    reportId: string,
    first: WriteResult,
    save: () => Promise<WriteResult>,
    undo: () => Promise<WriteResult>,
  ): Promise<WriteResult> {
    try {
      const res = await save();
      return { ...res, ...(first.snapshot ? { snapshot: first.snapshot } : {}), reapplied: first.reapplied || res.reapplied };
    } catch (err) {
      await undo().catch((undoErr: unknown) => {
        // The report is left half-saved. The code is the second save's own
        // (what went wrong); the message says how to get back.
        const where = first.snapshot ? `restore revision ${first.snapshot}` : 'check the report';
        throw new LookerError(
          explain(err)?.code ?? 'busy',
          `The second save failed (${(err as Error).message}) and putting back the first failed too (${(undoErr as Error).message}): the report is half-saved, ${where} of report ${reportId}.`,
        );
      });
      throw err;
    }
  }

  // Writes that are not whole documents (rename, add or remove pages,
  // restore) send no version, so there is nothing to retry: check, snapshot,
  // send, then read the version they left. `head` is the report without its
  // pages, read before sending; `check` throws before anything is written.
  private async direct(
    reportId: string,
    label: string,
    check: (head: ReportDoc) => void,
    send: (head: ReportDoc) => Promise<void>,
  ): Promise<WriteResult> {
    const head = await this.head(reportId);
    check(head);
    const snapshot = await this.snapshot(reportId, label);
    await send(head);
    const version = (await this.head(reportId)).version;
    if (!version) throw new LookerError('format_changed', `Report ${reportId} has no version after ${label}: Looker Studio may have changed its internal API.`);
    return { version, ...(snapshot ? { snapshot } : {}), reapplied: false };
  }

  // The report without its pages: names, navigation, version (cheap).
  private async head(reportId: string): Promise<ReportDoc> {
    const res = await this.rap.call<{ reportConfig?: ReportDoc }>('getReport', getReportBody(reportId, false));
    if (!res.reportConfig) throw new LookerError('not_found', `Report ${reportId} not found, or this account cannot open it.`);
    return res.reportConfig;
  }

  private async write(reportId: string, label: string, save: (doc: ReportDoc) => Promise<string | undefined>): Promise<WriteResult> {
    const snapshot = await this.snapshot(reportId, label);
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = await save(await this.load(reportId));
      if (version && version !== '-1') return { version, ...(snapshot ? { snapshot } : {}), reapplied: attempt > 0 };
    }
    throw new LookerError(
      'version_conflict',
      `Report ${reportId} kept changing while saving (someone is editing it): read it again and retry.`,
    );
  }

  private async snapshot(reportId: string, label: string): Promise<string | undefined> {
    if (this.opts.snapshots === false) return undefined;
    const now = this.opts.now?.() ?? Date.now();
    const last = this.snapshots.get(reportId);
    if (last && now - last.at < (this.opts.snapshotEveryMs ?? 60_000)) return last.revision;
    const name = `looker-studio-mcp: before ${label} · ${new Date(now).toISOString()}`;
    const made = await this.rap.call<{ revisionNumber?: string | number }>('createNamedRevision', {
      reportId,
      name,
      aiGenerated: false,
    });
    const revision = made?.revisionNumber !== undefined ? String(made.revisionNumber) : await this.findRevision(reportId, name);
    this.snapshots.set(reportId, { at: now, ...(revision ? { revision } : {}) });
    return revision;
  }

  private async findRevision(reportId: string, name: string): Promise<string | undefined> {
    const res = await this.rap.call<{ revisionInfo?: Array<{ revisionNumber?: string | number; revisionAnnotation?: unknown }> }>(
      'getRevisions',
      { entityId: reportId, entityType: 1 },
    );
    const hit = (res.revisionInfo ?? []).find((r) => JSON.stringify(r.revisionAnnotation ?? '').includes(name));
    return hit?.revisionNumber !== undefined ? String(hit.revisionNumber) : undefined;
  }
}

// Groups, components and conditional formats. Include the condition mask
// even for an empty list so removing the final rule is saved too.
export function pageRequest(p: PageDoc): Json {
  return {
    fieldMask: [4, 3, 5],
    componentConfig: p.page.componentConfig ?? [],
    groupConfig: p.page.groupConfig ?? [],
    chartCondition: p.chartCondition ?? [],
    conceptDefs: p.page.conceptDefs ?? [],
    propertyConfig: p.page.propertyConfig,
    attributeConfig: p.page.attributeConfig,
    pageId: p.pageId,
  };
}

export function reportRequest(doc: ReportDoc): Json {
  return {
    componentConfig: doc.report.componentConfig ?? [],
    chartCondition: doc.chartCondition ?? [],
    conceptDefs: doc.report.conceptDefs ?? [],
    propertyConfig: doc.report.propertyConfig,
    attributeConfig: doc.report.attributeConfig,
    resource: doc.report.resource ?? { datasourceAlias: [] },
  };
}

// What createPages takes for one page. A new page is empty, named in its
// pageAttribute as the editor does.
function newPageRequest(p: NewPage): Json & { pageId: string } {
  const pageId = p.pageId ?? newPageId();
  const page = structuredClone(p.page) ?? {};
  const attributeConfig = (page.attributeConfig ?? { pageAttribute: { datasourceConfigVersion: 2, displayConfigVersion: 0 } }) as Json;
  attributeConfig.pageAttribute = { ...(attributeConfig.pageAttribute as Json | undefined), name: p.displayName };
  return {
    pageId,
    page: {
      componentConfig: page.componentConfig ?? [],
      groupConfig: page.groupConfig ?? [],
      conceptDefs: page.conceptDefs ?? [],
      propertyConfig: page.propertyConfig ?? { pageProperty: { filters: [], inheritFilters: true } },
      attributeConfig,
    },
    displayName: p.displayName,
    chartCondition: p.chartCondition ?? [],
  };
}

// Page ids look like the editor's: p_ and ten hex digits.
export function newPageId(): string {
  return `p_${randomBytes(5).toString('hex')}`;
}

// Every page in navigation order, sections included.
export function navPageIds(items: NavItem[]): string[] {
  return items.flatMap((i) => [...(i.page ? [i.page.pageId] : []), ...navPageIds(i.section?.navItems ?? [])]);
}
