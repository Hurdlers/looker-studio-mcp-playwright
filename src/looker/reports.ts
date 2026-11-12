import type { Rap } from './rap.js';

// Shapes of the internal API, limited to the fields we read.
interface RawShareable {
  id: string;
  name: string;
  ownerDisplayName?: string;
  createdDate?: string;
  modifiedDate?: string;
  viewedByMeDate?: string;
  trashed?: boolean;
}

interface RawComponent {
  componentId: string;
  type: string;
  datasourceId?: string;
  attributeConfig?: { componentAttribute?: { left?: number; top?: number; width?: number; height?: number } };
}

interface RawPage {
  pageId: string;
  position?: number;
  page: {
    componentConfig?: RawComponent[];
    attributeConfig?: { pageAttribute?: { name?: string; height?: number; width?: number } };
  };
}

interface RawNavItem {
  page?: { pageId: string; displayName?: string };
  section?: { displayName?: string; navItems?: RawNavItem[] };
}

export interface RawReportConfig {
  shareable: RawShareable;
  version?: string;
  page: RawPage[];
  report: {
    componentConfig?: RawComponent[];
    resource?: { datasourceAlias?: Array<{ datasourceId: string; alias: string }> };
    attributeConfig?: { reportAttribute?: { width?: number; height?: number } };
    propertyConfig?: { reportProperty?: { themeConfig?: string } };
  };
  navigationInfo?: { navItems?: RawNavItem[] };
}

export interface ReportListItem {
  id: string;
  name: string;
  owner: string;
  created: string;
  modified: string;
  viewedByMe: string;
  url: string;
}

export interface ListReportsOptions {
  query?: string;
  owned?: boolean;
  sharedWithMe?: boolean;
  limit?: number;
}

export function reportUrl(id: string): string {
  return `https://lookerstudio.google.com/reporting/${id}`;
}

// Every report the account can open, in one call (the home page's own list).
export async function listReports(rap: Rap, opts: ListReportsOptions = {}): Promise<ReportListItem[]> {
  const res = await rap.call<{ shareableConfig?: RawShareable[] }>('getShareableList', {
    type: [0],
    trashed: false,
    titleContains: opts.query ?? '',
    shareableIds: [],
    sharedWithMe: opts.sharedWithMe ?? false,
    ownedByMe: opts.owned ?? false,
    fromHomePage: false,
    aclModes: [],
    projectNumbers: [],
    reportType: [],
  });
  const reports = (res.shareableConfig ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    owner: s.ownerDisplayName ?? '',
    created: isoDate(s.createdDate),
    modified: isoDate(s.modifiedDate),
    viewedByMe: isoDate(s.viewedByMeDate),
    url: reportUrl(s.id),
  }));
  reports.sort((a, b) => b.modified.localeCompare(a.modified));
  return opts.limit ? reports.slice(0, opts.limit) : reports;
}

// includePages false leaves out every page (components, charts, texts): the
// report-level part still lists the data sources.
export function getReportBody(reportId: string, includePages: boolean): Record<string, unknown> {
  return {
    reportId,
    includePages,
    // The editor sends true for both: a read must not touch "last viewed" or
    // the collaborative draft.
    updateViewedDate: false,
    updateFirestore: false,
    draftRequestMode: 2,
    mobileFriendlyView: false,
  };
}

// The whole report definition: pages, components, styles, data sources.
export async function getReport(rap: Rap, reportId: string): Promise<RawReportConfig> {
  const res = await rap.call<{ reportConfig: RawReportConfig }>('getReport', getReportBody(reportId, true));
  return res.reportConfig;
}

export interface ComponentOutline {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  datasourceId?: string;
}

export interface PageOutline {
  id: string;
  name: string;
  section?: string;
  height?: number;
  components: ComponentOutline[];
}

export interface ReportOutline {
  id: string;
  name: string;
  version?: string;
  canvas: { width?: number; height?: number };
  themeId?: string;
  datasourceAliases: Array<{ alias: string; datasourceId: string }>;
  reportLevel: ComponentOutline[];
  pages: PageOutline[];
  componentTypes: Record<string, number>;
}

export function outlineReport(cfg: RawReportConfig): ReportOutline {
  // The navigation's order is the one viewers see; page positions can differ.
  const nav = new Map<string, { order: number; name?: string; section?: string }>();
  const walk = (items: RawNavItem[] = [], section?: string): void => {
    for (const item of items) {
      if (item.page)
        nav.set(item.page.pageId, {
          order: nav.size,
          ...pick('name', item.page.displayName),
          ...pick('section', section),
        });
      if (item.section) walk(item.section.navItems, item.section.displayName);
    }
  };
  walk(cfg.navigationInfo?.navItems);

  const types: Record<string, number> = {};
  const outline = (c: RawComponent): ComponentOutline => {
    types[c.type] = (types[c.type] ?? 0) + 1;
    const a = c.attributeConfig?.componentAttribute ?? {};
    return {
      id: c.componentId,
      type: c.type,
      x: a.left ?? 0,
      y: a.top ?? 0,
      width: a.width ?? 0,
      height: a.height ?? 0,
      ...pick('datasourceId', c.datasourceId),
    };
  };

  const reportLevel = (cfg.report.componentConfig ?? []).map(outline);
  const rank = (p: RawPage): [number, number] => [nav.get(p.pageId)?.order ?? Infinity, p.position ?? 0];
  const pages = [...cfg.page]
    .sort((a, b) => {
      const [na, pa] = rank(a);
      const [nb, pb] = rank(b);
      return na === nb ? pa - pb : na - nb;
    })
    .map((p): PageOutline => {
      const attr = p.page.attributeConfig?.pageAttribute ?? {};
      const entry = nav.get(p.pageId);
      return {
        id: p.pageId,
        name: entry?.name ?? attr.name ?? p.pageId,
        ...pick('section', entry?.section),
        ...pick('height', attr.height),
        components: (p.page.componentConfig ?? []).map(outline),
      };
    });
  const attr = cfg.report.attributeConfig?.reportAttribute ?? {};
  return {
    id: cfg.shareable.id,
    name: cfg.shareable.name,
    ...pick('version', cfg.version),
    canvas: { ...pick('width', attr.width), ...pick('height', attr.height) },
    ...pick('themeId', cfg.report.propertyConfig?.reportProperty?.themeConfig),
    datasourceAliases: (cfg.report.resource?.datasourceAlias ?? []).map((d) => ({
      alias: d.alias,
      datasourceId: d.datasourceId,
    })),
    reportLevel,
    pages,
    componentTypes: types,
  };
}

function isoDate(ms: string | undefined): string {
  return ms ? new Date(Number(ms)).toISOString() : '';
}

// Optional properties without undefined values (exactOptionalPropertyTypes).
function pick<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
