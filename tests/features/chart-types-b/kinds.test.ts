import { describe, expect, it } from 'vitest';

import { RECORD_COUNT, type BuildContext } from '../../../src/core/components.js';
import type { SourceField } from '../../../src/core/datasource.js';
import { Extensions } from '../../../src/core/extensions.js';
import { createContext } from '../../../src/core/context.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import type { Rap, RapRequest, RapOutcome } from '../../../src/looker/rap.js';
import { tools as chartCoreTools } from '../../../src/features/chart-core/index.js';
import { chartKinds, extensions, setupSlots, tools } from '../../../src/features/chart-types-b/index.js';

type Json = Record<string, any>;
const fieldNames = ['d', 'n', 'm', 'a', 'b', 'k', 'x', 'y', 's', 'e', 'g', 'mn', 'q1', 'md', 'q3', 'mx', 'lo', 'op', 'cl', 'hi', 'src', 'dst', 'step', 'task', 'country', 'latlng', 'route', 'id', 'from_city', 'to_city'];
const textFields = new Set(['a', 'b', 'k', 'g', 'src', 'dst', 'step', 'task', 'id']);
const fields: SourceField[] = fieldNames.map((name) => ({
  id: `_${name}_`, name, dataType: textFields.has(name) ? 0 : 5, aggregation: textFields.has(name) ? 0 : 6,
  semanticType: name === 'country' ? 16 : name.endsWith('_city') ? 24 : name === 'latlng' ? 35 : name === 'd' || name === 's' || name === 'e' ? 2 : textFields.has(name) ? 32 : 33,
}));
const buildContext: BuildContext = { datasourceId: 'source-id', fields };
const metrics = (...names: string[]) => names.map((field) => ({ field }));
const kind = (key: string) => chartKinds.find((k) => k.key === key)!;
const build = (key: string, spec: Json = {}) => kind(key).build({ dimensions: [], metrics: [], ...spec }, buildContext);
const validate = (key: string, spec: Json = {}) => kind(key).validate({ dimensions: [], metrics: [], ...spec });
const slot = (c: Json, which: 'dimensions' | 'metrics', key: string): Json[] => {
  const names = c.propertyConfig.componentProperty[which]?.labeledConcepts.find((entry: Json) => entry.key === key)?.value.conceptNames ?? [];
  return names.map((name: string) => c.conceptDefs.find((concept: Json) => concept.name === name));
};
const refs = (c: Json, which: 'dimensions' | 'metrics', key: string) => slot(c, which, key).map((c) => c.queryTimeTransformation.dataTransformation.sourceFieldName);
const expectInvalid = (key: string, spec: Json = {}, message?: RegExp) => {
  try {
    validate(key, spec);
    expect.fail('invalid input was accepted');
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid' });
    if (message) expect((error as Error).message).toMatch(message);
  }
};

const valid: Record<string, Json> = {
  sparkline: { dimensions: ['d'], metrics: metrics('n') }, histogram: { dimensions: ['n'] },
  geo: { dimensions: ['country'], metrics: metrics('n') },
  bubble_map: { dimensions: ['country'], metrics: metrics('n') },
  filled_map: { fields: { Location: ['country'], 'Color metric': ['n'] } },
  heatmap_map: { fields: { Location: ['latlng'], Weight: ['n'] } },
  line_map: { fields: { Location: ['id'], 'Geospatial field': ['route'], 'Thickness metric': ['n'] } },
  connection_map: { dimensions: ['from_city', 'to_city'], metrics: metrics('n') },
  combo_map: { dimensions: ['country'], metrics: metrics('n', 'm') },
  treemap: { dimensions: ['a', 'b'], metrics: metrics('n') }, gauge: { metrics: metrics('n') }, gauge_ranges: { metrics: metrics('n') }, bullet: { metrics: metrics('n') },
  bubble: { dimensions: ['k'], metrics: metrics('x', 'y', 'n') },
  boxplot: { dimensions: ['g'], metrics: metrics('mn', 'q1', 'md', 'q3', 'mx') },
  candlestick: { dimensions: ['d'], metrics: metrics('lo', 'op', 'cl', 'hi') },
  sankey: { dimensions: ['src', 'dst'], metrics: metrics('n') }, waterfall: { dimensions: ['step'], metrics: metrics('n') },
  timeline: { fields: { 'Row label': ['task'], 'Start time': ['s'], 'End time': ['e'] } },
  funnel: { dimensions: ['step'], metrics: metrics('n') }, funnel_stepped: { dimensions: ['step'], metrics: metrics('n') }, funnel_triangle: { dimensions: ['step'], metrics: metrics('n') },
};

describe('additional chart kinds', () => {
  it('registers 22 unique kinds with no independent tools', () => {
    const ext = new Extensions([{ group: 'chart-types-b', extensions }]);
    expect(ext.chartKinds()).toHaveLength(22);
    expect(tools).toEqual([]);
    for (const k of chartKinds) expect(ext.kindOf(build(k.key, valid[k.key]!))?.key).toBe(k.key);
  });

  it('chart.type.sparkline: uses the sparkline preset and preserves field roles', () => {
    const c = build('sparkline', valid.sparkline);
    expect(c).toMatchObject({ type: 'simple-linechart', preset: 'sparkline' });
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_d_']);
    expect(refs(c, 'dimensions', 'breakdown')).toEqual([]);
    expect(refs(c, 'metrics', 'primary')).toEqual(['_n_']);
    expect(slot(c, 'metrics', 'primary')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(6);
  });
  it('chart.type.sparkline: rejects missing or excess dimensions and missing metrics', () => {
    expectInvalid('sparkline', { metrics: metrics('n') });
    expectInvalid('sparkline', { dimensions: ['d', 'a'], metrics: metrics('n') });
    expectInvalid('sparkline', { dimensions: ['d'] });
    expectInvalid('sparkline', { dimensions: ['d'], metrics: Array.from({ length: 21 }, () => ({ field: 'n' })) });
  });
  it('chart.type.histogram: supplies Record Count as the hidden metric', () => {
    const c = build('histogram', valid.histogram);
    expect(c.type).toBe('simple-histogram');
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_n_']);
    expect(refs(c, 'metrics', 'primary')).toEqual([RECORD_COUNT]);
    expect(slot(c, 'metrics', 'primary')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(6);
  });
  it('chart.type.histogram: rejects explicit metrics and wrong dimension counts', () => {
    expectInvalid('histogram', { dimensions: ['n'], metrics: metrics('n') });
    expectInvalid('histogram');
    expectInvalid('histogram', { dimensions: ['n', 'm'] });
  });
  it('chart.type.geo: puts the region and value in their primary inputs with geographic semantics', () => {
    const c = build('geo', valid.geo);
    expect(c.type).toBe('simple-geomap');
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_country_']);
    expect(refs(c, 'metrics', 'primary')).toEqual(['_n_']);
    expect(slot(c, 'dimensions', 'primary')[0]!.queryTimeTransformation.displayTransformation.outputSemanticInfo.semanticConfig).toEqual([{ semanticType: 16 }]);
  });
  it('chart.type.geo: rejects breakdowns and a second metric', () => {
    expectInvalid('geo', { ...valid.geo, breakdown: 'a' });
    expectInvalid('geo', { ...valid.geo, metrics: metrics('n', 'm') });
  });
  it('chart.type.bubble_map: supports named map inputs and leaves unused inputs empty', () => {
    const c = build('bubble_map', { fields: { Location: ['country'], Size: ['n'] } });
    expect(c).toMatchObject({ type: 'google-map', preset: 'default' });
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_country_']);
    expect(refs(c, 'metrics', 'size')).toEqual(['_n_']);
    for (const key of ['bubble_color', 'tooltip', 'connect_with']) expect(refs(c, 'dimensions', key)).toEqual([]);
    for (const key of ['bubble_color', 'geography', 'additional_layer_metric']) expect(refs(c, 'metrics', key)).toEqual([]);
  });
  it('chart.type.bubble_map: maps positional dimensions/metrics and rejects empty input', () => {
    const c = build('bubble_map', valid.bubble_map);
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_country_']);
    expect(refs(c, 'metrics', 'size')).toEqual(['_n_']);
    expectInvalid('bubble_map');
  });
  it('chart.type.filled_map: retains the color settings and uses Color metric', () => {
    const c = build('filled_map', valid.filled_map);
    expect(c).toMatchObject({ type: 'google-map', preset: 'choropleth' });
    expect(c.propertyConfig.componentProperty.googleMapProperty).toBeDefined();
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_country_']);
    expect(refs(c, 'metrics', 'bubble_color')).toEqual(['_n_']);
  });
  it('chart.type.filled_map: lists supported titles for an unknown input', () => {
    expectInvalid('filled_map', { fields: { 'No such slot': ['country'] } }, /Location, Color dimension, Tooltip/);
  });
  it('chart.type.heatmap_map: treats Weight and Weight metric as the same input', () => {
    for (const title of ['Weight', 'Weight metric']) {
      const c = build('heatmap_map', { fields: { Location: ['latlng'], [title]: ['n'] } });
      expect(c).toMatchObject({ type: 'google-map', preset: 'with-heatmap-layer' });
      expect(refs(c, 'dimensions', 'primary')).toEqual(['_latlng_']);
      expect(refs(c, 'metrics', 'size')).toEqual(['_n_']);
    }
  });
  it('chart.type.heatmap_map: rejects empty input', () => expectInvalid('heatmap_map'));
  it('chart.type.line_map: uses a geography aggregate and the thickness metric', () => {
    const c = build('line_map', valid.line_map);
    expect(c).toMatchObject({ type: 'google-map', preset: 'line-map' });
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_id_']);
    expect(refs(c, 'metrics', 'geography')).toEqual(['_route_']);
    expect(refs(c, 'metrics', 'size')).toEqual(['_n_']);
    expect(slot(c, 'metrics', 'geography')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(16);
  });
  it('chart.type.line_map: rejects empty input', () => expectInvalid('line_map'));
  it('chart.type.connection_map: accepts positional endpoints and the Location fields title', () => {
    for (const input of [valid.connection_map, { fields: { 'Location fields': ['from_city', 'to_city'], 'Thickness metric': ['n'] } }]) {
      const c = build('connection_map', input);
      expect(c).toMatchObject({ type: 'google-map', preset: 'connection_map' });
      expect(refs(c, 'dimensions', 'connect_with')).toEqual(['_from_city_', '_to_city_']);
      expect(refs(c, 'dimensions', 'primary')).toEqual([]);
      expect(refs(c, 'metrics', 'size')).toEqual(['_n_']);
    }
  });
  it('chart.type.connection_map: rejects more than ten endpoints', () => {
    expectInvalid('connection_map', { fields: { 'Location fields': Array(11).fill('from_city') } }, /10/);
  });
  it('chart.type.combo_map: assigns its two default layer metrics', () => {
    const c = build('combo_map', valid.combo_map);
    expect(c).toMatchObject({ type: 'google-map', preset: 'combo_map' });
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_country_']);
    expect(refs(c, 'metrics', 'bubble_color')).toEqual(['_n_']);
    expect(refs(c, 'metrics', 'additional_layer_metric')).toEqual(['_m_']);
  });
  it('chart.type.combo_map: asks for named inputs when a third metric has no default input', () => {
    expectInvalid('combo_map', { ...valid.combo_map, metrics: metrics('n', 'm', 'x') }, /fields/);
  });
  it('chart.type.treemap: keeps the hierarchy and leaves color inputs empty', () => {
    const c = build('treemap', valid.treemap);
    expect(c.type).toBe('simple-treemap');
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_a_', '_b_']);
    expect(refs(c, 'metrics', 'primary')).toEqual(['_n_']);
    expect(refs(c, 'dimensions', 'color')).toEqual([]);
    expect(refs(c, 'metrics', 'color')).toEqual([]);
  });
  it('chart.type.treemap: rejects excess metrics, breakdowns and a sixth hierarchy level', () => {
    expectInvalid('treemap', { ...valid.treemap, metrics: metrics('n', 'm') });
    expectInvalid('treemap', { ...valid.treemap, breakdown: 'k' });
    expectInvalid('treemap', { ...valid.treemap, dimensions: Array(6).fill('a') });
  });
  for (const [key, preset] of [['gauge', 'default'], ['gauge_ranges', 'with-ranges'], ['bullet', 'default']]) {
    it(`chart.type.${key}: creates the metric-only ${preset} preset`, () => {
      const c = build(key!, valid[key!]!);
      expect(c).toMatchObject({ type: key === 'bullet' ? 'bulletchart' : 'gauge-viz', preset });
      expect(refs(c, 'metrics', 'primary')).toEqual(['_n_']);
      expect(c.propertyConfig.componentProperty.dimensions?.labeledConcepts ?? []).toEqual([]);
    });
    it(`chart.type.${key}: rejects dimensions and excess metrics`, () => {
      expectInvalid(key!, { dimensions: ['a'], metrics: metrics('n') });
      expectInvalid(key!, { metrics: metrics('n', 'm') });
    });
  }
  it('chart.type.bubble: distributes the X, Y and size metrics in order', () => {
    const c = build('bubble', valid.bubble);
    expect(c).toMatchObject({ type: 'simple-scatterchart', preset: 'bubble' });
    expect(refs(c, 'metrics', 'x_metric')).toEqual(['_x_']);
    expect(refs(c, 'metrics', 'y_metric')).toEqual(['_y_']);
    expect(refs(c, 'metrics', 'bubble_size')).toEqual(['_n_']);
  });
  it('chart.type.bubble: rejects a single metric, a fourth metric and breakdowns', () => {
    expectInvalid('bubble', { dimensions: ['k'], metrics: metrics('x') });
    expectInvalid('bubble', { dimensions: ['k'], metrics: metrics('x', 'y', 'n', 'm') });
    expectInvalid('bubble', { ...valid.bubble, breakdown: 'a' });
  });
  for (const [key, preset, seriesType, values] of [
    ['boxplot', 'boxplot', 2, ['mn', 'q1', 'md', 'q3', 'mx']],
    ['candlestick', 'candlesticks', 3, ['lo', 'op', 'cl', 'hi']],
  ] as const) {
    it(`chart.type.${key}: preserves the value order and sets all twenty series`, () => {
      const c = build(key, valid[key]);
      expect(c).toMatchObject({ type: 'simple-combochart', preset });
      expect(refs(c, 'metrics', 'primary')).toEqual(values.map((name) => `_${name}_`));
      expect(c.propertyConfig.componentProperty.comboChartProperty.seriesProperty).toHaveLength(20);
      expect(c.propertyConfig.componentProperty.comboChartProperty.seriesProperty.every((entry: Json) => entry.seriesType === seriesType)).toBe(true);
    });
    it(`chart.type.${key}: rejects an incorrect value count`, () => {
      expectInvalid(key, { dimensions: ['g'], metrics: metrics(...(key === 'boxplot' ? ['mn', 'q1', 'md', 'q3'] : ['lo', 'op', 'cl', 'hi', 'mx'])) });
    });
  }
  it('chart.type.sankey: puts endpoints and weight in the different input groups', () => {
    const c = build('sankey', valid.sankey);
    expect(c.type).toBe('simple-sankey');
    expect(refs(c, 'dimensions', 'primary')).toEqual(['_src_', '_dst_']);
    expect(refs(c, 'dimensions', 'sankey_weight')).toEqual([]);
    expect(refs(c, 'metrics', 'sankey_weight')).toEqual(['_n_']);
  });
  it('chart.type.sankey: rejects incorrect endpoint or weight counts', () => {
    expectInvalid('sankey', { dimensions: ['src'], metrics: metrics('n') });
    expectInvalid('sankey', { dimensions: ['src', 'dst', 'a'], metrics: metrics('n') });
    expectInvalid('sankey', { dimensions: ['src', 'dst'], metrics: metrics('n', 'm') });
  });
  for (const [key, preset] of [['waterfall', 'default'], ['funnel', 'default'], ['funnel_stepped', 'stepped-bar'], ['funnel_triangle', 'inverted-triangle']]) {
    it(`chart.type.${key}: uses the correct preset and the step/value fields`, () => {
      const c = build(key!, valid[key!]!);
      expect(c).toMatchObject({ type: key === 'waterfall' ? 'simple-waterfall' : 'simple-funnel', preset });
      expect(refs(c, 'dimensions', 'primary')).toEqual(['_step_']);
      expect(refs(c, 'metrics', 'primary')).toEqual(['_n_']);
    });
    it(`chart.type.${key}: rejects breakdowns and a second metric`, () => {
      expectInvalid(key!, { ...valid[key!]!, breakdown: 'a' });
      expectInvalid(key!, { ...valid[key!]!, metrics: metrics('n', 'm') });
    });
  }
  it('chart.type.timeline: fills the named timeline inputs and leaves optional inputs empty', () => {
    const c = build('timeline', valid.timeline);
    expect(c.type).toBe('simple-timeline');
    expect(refs(c, 'dimensions', 'rowLabel')).toEqual(['_task_']);
    expect(refs(c, 'dimensions', 'startTime')).toEqual(['_s_']);
    expect(refs(c, 'dimensions', 'endTime')).toEqual(['_e_']);
    for (const key of ['barLabel', 'duration', 'tooltip']) expect(refs(c, 'dimensions', key)).toEqual([]);
    expect(c.propertyConfig.componentProperty.metrics.labeledConcepts).toEqual([]);
  });
  it('chart.type.timeline: rejects metrics, positional dimensions and empty fields with the input titles', () => {
    expectInvalid('timeline', { ...valid.timeline, metrics: metrics('n') }, /Row label.*Start time/);
    expectInvalid('timeline', { dimensions: ['task', 's'] }, /fields.*Row label.*Start time/);
    expectInvalid('timeline', { fields: {} });
  });
  it('provides the same Setup metadata for chart creation and inspection', () => {
    expect(setupSlots(build('line_map', valid.line_map)).find((s) => s.title === 'Geospatial field')).toMatchObject({ key: 'geography', aggregation: 16 });
    expect(setupSlots(build('timeline', valid.timeline)).map((s) => s.title)).toEqual(['Row label', 'Bar label', 'Start time', 'End time', 'Duration', 'Tooltip']);
  });
  it('preserves explicit concept labels and aggregation when placing default metrics', () => {
    const concept = { id: 't0.custom', name: 'custom', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_n_', aggregation: 1 }, displayTransformation: { displayName: 'Average value' } } };
    const c = build('gauge', { metrics: metrics('n'), concepts: { metrics: [concept] } });
    expect(slot(c, 'metrics', 'primary')[0]).toMatchObject(concept);
  });
  it('named input values override positional values and duplicate aliases are rejected', () => {
    const c = build('bubble_map', { dimensions: ['country'], metrics: metrics('n'), fields: { Size: ['m'] } });
    expect(refs(c, 'metrics', 'size')).toEqual(['_m_']);
    expectInvalid('bubble_map', { fields: { Location: ['country'], Size: ['n'], 'Weight metric': ['m'] } }, /twice/);
  });

  for (const chartKind of chartKinds) {
    it(`chart.type.${chartKind.key}: chart_add saves and reads the same preset and field assignments`, async () => {
      const { ctx, calls } = fake();
      await runTool(ctx, 'chart_add', { report_id: REPORT, type: chartKind.key, ...valid[chartKind.key] });
      const sent = calls.filter((call) => call.endpoint === 'updatePage');
      expect(sent).toHaveLength(1);
      const saved = sent[0]!.body.pageRequest.componentConfig[0];
      expect(saved).toMatchObject({ type: chartKind.type, preset: chartKind.preset });
      if (chartKind.type === 'simple-geomap') expect(saved.propertyConfig.componentProperty.row).toBe(5000);
      if (chartKind.type === 'google-map') expect(saved.propertyConfig.componentProperty.row).toBe(3500);
      const expected = build(chartKind.key, valid[chartKind.key]!);
      for (const which of ['dimensions', 'metrics'] as const)
        for (const input of expected.propertyConfig.componentProperty[which]?.labeledConcepts ?? [])
          expect(refs(saved, which, input.key)).toEqual(refs(expected, which, input.key));
      if (chartKind.key === 'line_map')
        expect(slot(saved, 'metrics', 'geography')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(16);
      if (chartKind.key === 'timeline' || chartKind.type === 'google-map') {
        const inspected = await runTool(ctx, 'component_inspect', { report_id: REPORT, component_id: saved.componentId });
        expect(resultText(inspected)).toContain(chartKind.key === 'timeline' ? 'Row label' : 'Location');
      }
    });
  }
  const invalidCases: Array<[string, Json]> = [
    ['sparkline', { metrics: metrics('n') }], ['sparkline', { dimensions: ['d', 'a'], metrics: metrics('n') }], ['sparkline', { dimensions: ['d'] }],
    ['histogram', { dimensions: ['n'], metrics: metrics('n') }], ['histogram', {}],
    ['geo', { ...valid.geo, breakdown: 'a' }], ['geo', { ...valid.geo, metrics: metrics('n', 'm') }],
    ['bubble_map', {}], ['filled_map', { fields: { 'No such slot': ['country'] } }], ['heatmap_map', {}], ['line_map', {}],
    ['connection_map', { fields: { 'Location fields': Array(11).fill('from_city') } }], ['combo_map', { ...valid.combo_map, metrics: metrics('n', 'm', 'x') }],
    ['treemap', { ...valid.treemap, metrics: metrics('n', 'm') }], ['treemap', { ...valid.treemap, breakdown: 'k' }], ['treemap', { ...valid.treemap, dimensions: Array(6).fill('a') }],
    ['gauge', { dimensions: ['a'], metrics: metrics('n') }], ['gauge', { metrics: metrics('n', 'm') }],
    ['gauge_ranges', { dimensions: ['a'], metrics: metrics('n') }], ['bullet', { metrics: metrics('n', 'm') }],
    ['bubble', { dimensions: ['k'], metrics: metrics('x') }], ['bubble', { dimensions: ['k'], metrics: metrics('x', 'y', 'n', 'm') }], ['bubble', { ...valid.bubble, breakdown: 'a' }],
    ['boxplot', { dimensions: ['g'], metrics: metrics('mn', 'q1', 'md', 'q3') }],
    ['candlestick', { dimensions: ['d'], metrics: metrics('lo', 'op', 'cl', 'hi', 'mx') }],
    ['sankey', { dimensions: ['src'], metrics: metrics('n') }], ['sankey', { dimensions: ['src', 'dst'], metrics: metrics('n', 'm') }],
    ['waterfall', { ...valid.waterfall, breakdown: 'a' }], ['waterfall', { ...valid.waterfall, metrics: metrics('n', 'm') }],
    ['timeline', { metrics: metrics('n') }], ['timeline', { dimensions: ['task'] }], ['timeline', { fields: {} }],
    ['funnel', { ...valid.funnel, breakdown: 'a' }], ['funnel', { ...valid.funnel, metrics: metrics('n', 'm') }],
  ];
  for (const [key, input] of invalidCases)
    it(`chart.type.${key}: rejects ${JSON.stringify(input)} before reading or saving`, async () => {
      const { ctx, calls } = fake();
      await expect(runTool(ctx, 'chart_add', { report_id: REPORT, type: key, ...input })).rejects.toMatchObject({ code: 'invalid' });
      expect(calls).toEqual([]);
    });
});



const REPORT = '11111111-2222-4333-8444-555555555555';
function fake() {
  const doc: ReportDoc = {
    shareable: { id: REPORT, name: 'Test report' }, version: '1', chartCondition: [],
    report: { resource: { datasourceAlias: [{ datasourceId: 'source-id', alias: 'ds1' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'page-a', displayName: 'Overview' } }] },
    page: [{ pageId: 'page-a', version: '1', chartCondition: [], page: { componentConfig: [] } }],
  };
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const answer = (endpoint: string, body: Json): unknown => {
    calls.push({ endpoint, body: structuredClone(body) });
    switch (endpoint) {
      case 'getReport': return { reportConfig: structuredClone(doc) };
      case 'getDatasourceList': return { datasourceInfo: [{ shareableConfig: { id: 'source-id', name: 'Test source' }, isEmbedded: true }] };
      case 'getSchema': return { schema: { dimensions: [], metrics: [] } };
      case 'getBlockDatasource': return { published: { datasourceId: 'source-id', datasourceBlock: { fields: fields.map((field) => ({
        columnType: 1, field: { ns: 't0', name: field.id }, outputName: field.name, dataType: field.dataType,
        defaultAggregationType: field.aggregation, outputSemanticInfo: { semanticConfig: [{ semanticType: field.semanticType }] },
      })) } } };
      case 'updatePage': {
        doc.page[0]!.page = structuredClone(body.pageRequest);
        doc.version = String(Number(doc.version) + 1);
        doc.page[0]!.version = doc.version;
        return { version: doc.version };
      }
      default: throw new Error(`Unexpected endpoint: ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => answer(endpoint, body as Json) as T,
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> => requests.map((request) => ({ ok: true, value: answer(request.endpoint, request.body as Json) as T })),
  };
  const ctx = createContext({ rap, ext: new Extensions([{ group: 'chart-types-b', extensions }]), tools: chartCoreTools });
  return { ctx, calls };
}
