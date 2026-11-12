import { tmpdir } from 'node:os';

import { z } from 'zod';

import { parseConfig } from '../../../src/config.js';
import { blankTemplate, setSlot, template } from '../../../src/core/components.js';
import { createContext } from '../../../src/core/context.js';
import { LookerError } from '../../../src/core/errors.js';
import { Extensions, type ChartKind, type ComponentUpdater } from '../../../src/core/extensions.js';
import { ReportSession, type ReportDoc } from '../../../src/core/session.js';
import type { StyleTable } from '../../../src/core/style.js';
import { runTool, type ToolContext, type ToolResult } from '../../../src/core/tool.js';
import { RapError, type Rap, type RapOutcome, type RapRequest } from '../../../src/looker/rap.js';
import { tools } from '../../../src/features/chart-core/index.js';

export type Json = Record<string, any>;

export const REPORT = '11111111-2222-4333-8444-555555555555';

// A data source column as getBlockDatasource answers it.
export const column = (id: string, name: string, semanticType: number, aggregation: number): Json => ({
  columnType: 1,
  outputName: name,
  dataType: semanticType === 33 ? 5 : 0,
  defaultAggregationType: aggregation,
  outputSemanticInfo: { semanticConfig: [{ semanticType }] },
  field: { ns: 't0', name: id },
});

export const RECORD_COUNT_COLUMN: Json = {
  columnType: 1,
  outputName: 'Record Count',
  dataType: 5,
  defaultAggregationType: 7,
  field: { ns: 't0', name: 'datastudio_record_count_system_field_id_98323387' },
};

export const FIELDS_4TA = [
  column('_sessions_', 'sessions', 33, 6),
  column('_device_category_', 'Device Category', 32, 0),
  column('_date_', 'date', 2, 0),
  column('_pageviews_', 'pageviews', 33, 6),
  RECORD_COUNT_COLUMN,
];

export function report(): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'R' },
    version: '5',
    chartCondition: [],
    report: { componentConfig: [], resource: { datasourceAlias: [{ datasourceId: 'dsA', alias: 'ds1' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }] },
    page: [{ pageId: 'p1', version: '9', chartCondition: [], page: { componentConfig: [{ componentId: 'cd-old0000001', type: 'simple-description' }] } }],
  };
}

// A Looker Studio answering for one report and its data sources, recording
// every request.
export function looker(doc: ReportDoc = report(), sources: Record<string, { name: string; fields: Json[] }> = { dsA: { name: '4 Demo', fields: FIELDS_4TA } }) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const answer = (endpoint: string, b: Json): unknown => {
    switch (endpoint) {
      case 'getReport':
        return { reportConfig: structuredClone(b.includePages === false ? { ...doc, page: [] } : doc) };
      case 'createNamedRevision':
        return { revisionNumber: 41 };
      case 'updatePage': {
        const page = doc.page.find((p) => p.pageId === b.pageId)!;
        const r = b.pageRequest;
        page.page = { ...page.page, componentConfig: r.componentConfig, groupConfig: r.groupConfig, conceptDefs: r.conceptDefs };
        page.chartCondition = r.chartCondition;
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      }
      case 'updateReport': {
        const r = b.reportRequest;
        doc.report = { ...doc.report, componentConfig: r.componentConfig, resource: r.resource };
        doc.chartCondition = r.chartCondition;
        doc.version = String(Number(doc.version) + 1);
        return { version: doc.version };
      }
      case 'getBlockDatasource': {
        const s = sources[b.datasourceId];
        if (!s) throw new RapError(endpoint, 404, 'not found');
        return { published: { datasourceId: b.datasourceId, datasourceBlock: { name: s.name, fields: s.fields } } };
      }
      case 'getSchema':
        return { schema: { dimensions: [], metrics: [] } };
      case 'getDatasourceList':
        return {
          datasourceInfo: (b.shareableIds as string[]).flatMap((id) => (sources[id] ? [{ shareableConfig: { id, name: sources[id]!.name }, isEmbedded: true }] : [])),
        };
      default:
        throw new Error(`unexpected ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: body as Json });
      return answer(endpoint, body as Json) as T;
    },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> =>
      requests.map((r) => {
        calls.push({ endpoint: r.endpoint, body: r.body as Json });
        try {
          return { ok: true, value: answer(r.endpoint, r.body as Json) as T };
        } catch (e) {
          return { ok: false, status: (e as RapError).status ?? 0, error: (e as Error).message };
        }
      }),
  };
  return { rap, doc, calls };
}

export const WRITES = ['createNamedRevision', 'updatePage', 'updateReport'];
export const writes = (calls: Array<{ endpoint: string }>) => calls.filter((c) => WRITES.includes(c.endpoint)).map((c) => c.endpoint);
export const sentOnce = (calls: Array<{ endpoint: string; body: Json }>, endpoint: string): Json => {
  const hits = calls.filter((c) => c.endpoint === endpoint);
  if (hits.length !== 1) throw new Error(`${endpoint} sent ${hits.length} times`);
  return hits[0]!.body;
};

// Stand-ins for the chart kinds other groups register: the template, a
// count rule, and (scatter, pivot) slots of their own.
function kind(key: string, type: string, preset: string | undefined, rule: (spec: Json) => void, place?: (c: Json, spec: Json) => void, title?: string): ChartKind {
  return {
    key,
    type,
    ...(preset ? { preset } : {}),
    ...(title ? { title } : {}),
    build: (spec) => {
      rule(spec);
      const c = blankTemplate(template(type, preset));
      c.componentId = template(type, preset).componentId;
      if (preset) c.preset = preset;
      place?.(c, spec);
      return c;
    },
  };
}
const invalid = (m: string) => new LookerError('invalid', m);
const needMetrics = (spec: Json) => {
  if (!spec.metrics.length) throw invalid('needs a metric');
};

export const KINDS: ChartKind[] = [
  kind('table', 'simple-table', 'default', needMetrics, undefined, 'Table'),
  kind('scorecard', 'kpi-metric', 'default', (s) => {
    if (s.dimensions.length) throw invalid('no dimensions');
  }, undefined, 'Scorecard'),
  kind('column', 'simple-barchart', 'default', needMetrics, undefined, 'Column chart'),
  kind('stacked_bar', 'simple-barchart', 'vertical-stacked', needMetrics, undefined, 'Stacked bar chart'),
  kind('stacked_area', 'simple-areachart', 'default', needMetrics),
  kind('pie', 'simple-piechart', 'default', needMetrics),
  kind('pivot_table', 'pivot-table', 'default', needMetrics, (c, spec) => {
    const dims = spec.concepts.dimensions as Json[];
    c.propertyConfig.componentProperty.pivotTableProperty.pivotDisplayConfig.row = dims.map((d) => ({ sort: [{ sortDir: 0, sortColumn: d.name }] }));
  }),
  kind('scatter', 'simple-scatterchart', 'default', needMetrics, (c, spec) => {
    const m = spec.concepts.metrics as Json[];
    ['x_metric', 'y_metric', 'bubble_size'].forEach((k, i) => m[i] && setSlot(c, 'metrics', k, [m[i]!]));
  }),
];

export const STYLES: StyleTable[] = [
  {
    type: 'kpi-metric',
    labels: [
      { label: 'Title', kind: 'text', path: 'kpiMetricProperty.chartTitleProperty.chartTitleText' },
      { label: 'Background', kind: 'color', path: 'kpiMetricProperty.backgroundColor' },
      { label: 'Compact numbers', kind: 'toggle', path: 'kpiMetricProperty.compactNumbers' },
    ],
  },
];

export function ext(updaters: ComponentUpdater[] = []): Extensions {
  return new Extensions([
    { group: 'chart-types-a', extensions: { chartKinds: KINDS, styles: STYLES } },
    ...(updaters.length ? [{ group: 'chart-options', extensions: { updaters } }] : []),
  ]);
}

export function context(rap: Rap, opts: { dryRun?: boolean; updaters?: ComponentUpdater[] } = {}): ToolContext {
  return createContext({
    rap,
    session: new ReportSession(rap),
    config: parseConfig({ writes_enabled: true, dry_run: opts.dryRun === true }, tmpdir()),
    ext: ext(opts.updaters),
    tools,
  });
}

export const run = (ctx: ToolContext, name: string, args: Json): Promise<ToolResult> => runTool(ctx, name, args);

export const textOf = (res: ToolResult) => res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');

// The component added by the one updatePage sent.
export function added(calls: Array<{ endpoint: string; body: Json }>, before: string[] = ['cd-old0000001']): Json {
  const body = sentOnce(calls, 'updatePage');
  const fresh = (body.pageRequest.componentConfig as Json[]).filter((c) => !before.includes(c.componentId));
  if (fresh.length !== 1) throw new Error(`${fresh.length} new components`);
  return fresh[0]!;
}

export const slot = (c: Json, kind: 'dimensions' | 'metrics', key: string): string[] =>
  c.propertyConfig.componentProperty[kind].labeledConcepts.find((lc: Json) => lc.key === key)?.value.conceptNames;

export const def = (c: Json, name: string): Json => c.conceptDefs.find((d: Json) => d.name === name);

export const filterUpdater: ComponentUpdater = {
  key: 'filters',
  input: z.array(z.string()).describe('test filters'),
  apply: ({ component }, value) => {
    component.propertyConfig.componentProperty.filters = value as string[];
  },
};
