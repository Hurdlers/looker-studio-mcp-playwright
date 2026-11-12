import { describe, expect, it } from 'vitest';

import { RECORD_COUNT } from '../../../src/core/components.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
import { runTool } from '../../../src/core/tool.js';
import { communityMetadata, extensions } from '../../../src/features/community/index.js';
import { readCommunityStyle } from '../../../src/features/community/style.js';
import { CUSTOM, definition, GAUGE, harness, properties as p, REPORT, settings, setup, SUNBURST, type Json } from './helpers.js';

const error = (code = 'invalid', message?: string) => ({ code, ...(message ? { message: expect.stringContaining(message) } : {}) });
const styleEntries = (component: Json) => p(component).thirdPartyVizProperty.keyConfig as Json[];
const value = (component: Json, key: string) => fromMapValue(styleEntries(component).find((entry) => entry.key === `tp_${key}`)?.value);
const custom = { name: undefined, manifest_path: CUSTOM };

describe('registered community visualizations', () => {
  it('community.add.gallery: registers the featured card before saving a component without consent', async () => {
    const h = harness();
    await h.add({ name: 'gAuGe' });
    expect((h.doc.report.resource as Json).communityVizResource).toEqual([{ vizId: GAUGE }]);
    expect(h.last()).toMatchObject({ type: GAUGE, preset: 'default', propertyConfig: { componentProperty: { thirdPartyVizProperty: { keyConfig: [], isMigrated: true } } } });
    expect(h.writes().map((entry) => entry.endpoint)).toEqual(['updateReport', 'updatePage']);
  });

  it('community.add.gallery: refuses unapproved data access before loading or changing the report', async () => {
    const h = harness(); h.registrations[GAUGE]!.approvalState = 0;
    const before = structuredClone(h.doc);
    await expect(h.add()).rejects.toMatchObject(error('refused', 'allow_data_access'));
    expect(h.calls.map((entry) => entry.endpoint)).toEqual(['getCommunityVizRegistrationInfo']);
    expect(h.doc).toEqual(before);
  });

  it('community.add.gallery: grants only visualization consent with an explicit opt-in before saving', async () => {
    const h = harness(); h.registrations[GAUGE]!.approvalState = 0;
    await h.add({ allow_data_access: true });
    expect(h.writes().map((entry) => entry.endpoint)).toEqual(['grantConsent', 'updateReport', 'updatePage']);
    expect(h.writes()[0]!.body).toEqual({ vizPermitted: { reportId: REPORT, vizId: `${GAUGE}::gauge`, manifestFingerprint: 'example-fingerprint', type: 1 } });
  });

  it('community.add.gallery: searches the full gallery and lists loaded card names for an unknown name', async () => {
    const h = harness();
    h.registrations['gs://viz.supermetrics.com'] = { ...structuredClone(h.registrations[GAUGE]), manifest: { components: [{ id: 'smGanttChart', name: 'Example Gantt', privileges: [] }] } };
    await h.add({ name: 'example gantt' });
    expect(h.last().type).toBe('gs://viz.supermetrics.com\u00a0smGanttChart');
    h.clear();
    await expect(h.add({ name: 'No Such Viz' })).rejects.toMatchObject(error('not_found', 'Gauge, Sunburst, Example Gantt'));
    expect(h.writes()).toEqual([]);
  });

  it('community.add.gallery: honors allowed states and refuses denied or unknown consent states', async () => {
    for (const state of [1, 4]) {
      const h = harness(); h.registrations[GAUGE]!.approvalState = state;
      await h.add(); expect(h.writes().some((entry) => entry.endpoint === 'grantConsent')).toBe(false);
    }
    for (const state of [2, 99]) {
      const h = harness(); h.registrations[GAUGE]!.approvalState = state;
      await expect(h.add({ allow_data_access: true })).rejects.toMatchObject(error(state === 2 ? 'refused' : 'format_changed'));
      expect(h.writes()).toEqual([]);
    }
  });

  it('community.add.manifest: trims the path and uses the first manifest component with a nonbreaking separator', async () => {
    const h = harness(); h.registrations[SUNBURST]!.approvalState = 1;
    await h.add({ name: undefined, manifest_path: `  ${SUNBURST}  `, dimensions: ['platform'], metrics: [{ field: 'uses' }] });
    expect(h.calls[0]!.body).toEqual({ reportId: REPORT, manifestPath: SUNBURST });
    expect(h.last().type).toBe(`${SUNBURST}\u00a0sunburst_v1`);
    expect((h.doc.report.resource as Json).communityVizResource[0].vizId).toBe(h.last().type);
  });

  for (const input of [{ name: undefined }, { manifest_path: CUSTOM }, { name: undefined, manifest_path: 'http://x/viz' }, { name: '' }, { name: undefined, manifest_path: 'gs://bad path/viz' }])
    it(`community.add.manifest: rejects invalid name/path selection ${JSON.stringify(input)} without Rap`, async () => {
      const h = harness(); await expect(h.add(input)).rejects.toMatchObject(error()); expect(h.calls).toEqual([]);
    });

  it('community.add.manifest: registration failure or missing fingerprint cannot save or grant consent', async () => {
    const h = harness();
    await expect(h.add({ name: undefined, manifest_path: 'gs://chart-example-bucket/missing' })).rejects.toMatchObject(error('invalid', 'Could not read'));
    expect(h.writes()).toEqual([]);
    h.registrations[SUNBURST]!.manifestFingerprint = '';
    await expect(h.add({ name: undefined, manifest_path: SUNBURST, allow_data_access: true })).rejects.toMatchObject(error('format_changed', 'fingerprint'));
    expect(h.writes()).toEqual([]);
  });

  it('community.add.manifest: rejects malformed registration/configuration before report writes', async () => {
    for (const change of [{ manifest: { components: {} } }, { config: 'not-json' }, { config: JSON.stringify({ data: {} }) }, { config: JSON.stringify({ style: [{ elements: [{}] }] }) }]) {
      const h = harness(); Object.assign(h.registrations[CUSTOM]!, change);
      await expect(h.add(custom)).rejects.toMatchObject(error('format_changed')); expect(h.writes()).toEqual([]);
    }
  });

  it('community.add.manifest: validation finishes before consent and a failed page save rolls report resources back', async () => {
    const h = harness(); h.registrations[CUSTOM]!.approvalState = 0;
    await expect(h.add({ ...custom, allow_data_access: true, style: { Direction: 'Diagonal' } })).rejects.toMatchObject(error());
    expect(h.writes()).toEqual([]);
    const before = structuredClone(h.doc.report);
    h.clear(); h.failNextPage();
    await expect(h.add()).rejects.toMatchObject(error('invalid', 'page save failed'));
    expect(h.writes().map((entry) => entry.endpoint)).toEqual(['updateReport', 'updatePage', 'updateReport']);
    expect(h.doc.report.resource).toEqual(before.resource); expect(h.doc.report.componentConfig).toEqual(before.componentConfig); expect(h.components()).toEqual([]);
  });

  it('community.add.gallery: dry run records resource/page/consent writes and leaves the real document unchanged', async () => {
    const h = harness(); h.ctx.config.dryRun = true; h.registrations[GAUGE]!.approvalState = 0;
    const before = structuredClone(h.doc);
    const text = await h.add({ allow_data_access: true });
    expect(text).toContain('Would add'); expect(text).toContain('nothing was saved');
    expect(h.writes()).toEqual([]); expect(h.doc).toEqual(before);
  });
});

describe('community field inputs and placement', () => {
  it('community.setup.dimensions: maps standard dimension titles to numbered field slots', async () => {
    const h = harness(); h.registrations[CUSTOM]!.config = JSON.stringify({ data: [{ elements: [{ id: 'arbitraryDimId', type: 'DIMENSION', label: 'Dimension' }] }] });
    await h.add({ ...custom, dimensions: ['platform'] });
    expect(setup(h.last(), 'dimensions', '0')).toEqual([definition(h.last(), '_platform_').name]);
    expect(setup(h.last(), 'dimensions', 'arbitraryDimId')).toBeUndefined();
  });

  it('community.setup.dimensions: exposes a nonstandard title and rejects blank fields before writing', async () => {
    const h = harness(); h.registrations[CUSTOM]!.config = JSON.stringify({ data: [{ elements: [{ id: 'category', type: 'DIMENSION', label: 'Row category' }] }] });
    await expect(h.add({ ...custom, dimensions: ['platform'] })).rejects.toMatchObject(error('invalid', 'Row category'));
    expect(h.writes()).toEqual([]); h.clear();
    await expect(h.add({ dimensions: [''] })).rejects.toMatchObject(error()); expect(h.calls).toEqual([]);
  });

  it('community.setup.metrics: stores the aggregate code, label and built-in Record Count', async () => {
    const h = harness();
    await h.add({ metrics: [{ field: 'uses', aggregation: 'sum', label: '사용 수' }] });
    expect(setup(h.last(), 'metrics', '0')).toEqual([definition(h.last(), '_uses_').name]);
    expect(definition(h.last(), '_uses_').queryTimeTransformation).toMatchObject({ dataTransformation: { sourceFieldName: '_uses_', aggregation: 6 }, displayTransformation: { displayName: '사용 수' } });
    await h.add({ metrics: [{ field: 'Record Count' }] }); expect(definition(h.last(), RECORD_COUNT)).toBeDefined();
  });

  for (const [aggregation, code] of Object.entries({ none: 0, avg: 1, count: 2, count_distinct: 3, max: 4, min: 5, sum: 6 }))
    it(`community.setup.metrics: encodes ${aggregation} as ${code}`, async () => {
      const h = harness(); await h.add({ metrics: [{ field: 'uses', aggregation }] });
      expect(definition(h.last(), '_uses_').queryTimeTransformation.dataTransformation.aggregation).toBe(code);
    });

  it('community.setup.metrics: supports Auto without an override and refuses unsupported aggregation or absent metric inputs', async () => {
    const h = harness(); await h.add({ metrics: [{ field: 'Auto result' }] });
    expect(definition(h.last(), '_auto_').queryTimeTransformation.dataTransformation).not.toHaveProperty('aggregation');
    h.clear();
    await expect(h.add({ metrics: [{ field: 'Auto result', aggregation: 'sum' }] })).rejects.toMatchObject(error('invalid', 'Auto'));
    await expect(h.add({ metrics: [{ field: 'platform', aggregation: 'sum' }] })).rejects.toMatchObject(error('invalid', 'count_distinct'));
    h.registrations[CUSTOM]!.config = JSON.stringify({ data: [] });
    await expect(h.add({ ...custom, metrics: [{ field: 'uses' }] })).rejects.toMatchObject(error('invalid', 'fields'));
    expect(h.writes()).toEqual([]); h.clear();
    await expect(h.add({ metrics: [{ field: '' }] })).rejects.toMatchObject(error()); expect(h.calls).toEqual([]);
  });

  it('community.setup.slots: maps exact case-insensitive titles and keeps dimensions and metrics numbered separately', async () => {
    const h = harness(); h.registrations[CUSTOM]!.config = JSON.stringify({ data: [{ elements: [
      { id: 'a', type: 'DIMENSION', label: 'Stage' }, { id: 'b', type: 'METRIC', label: 'Value' },
      { id: 'c', type: 'DIMENSION', label: 'Details' }, { id: 'd', type: 'METRIC', label: 'Other value' },
    ] }] });
    await h.add({ ...custom, fields: { stage: ['platform'], VALUE: ['uses'], Details: ['day'], 'Other value': ['errors'] } });
    expect(setup(h.last(), 'dimensions', '0')).toEqual([definition(h.last(), '_platform_').name]);
    expect(setup(h.last(), 'metrics', '0')).toEqual([definition(h.last(), '_uses_').name]);
    expect(setup(h.last(), 'dimensions', '1')).toEqual([definition(h.last(), '_day_').name]);
    expect(setup(h.last(), 'metrics', '1')).toEqual([definition(h.last(), '_errors_').name]);
    h.clear(); await expect(h.add({ ...custom, fields: { 'No such slot': ['platform'] } })).rejects.toMatchObject(error('invalid', 'Stage, Value, Details, Other value'));
    expect(h.writes()).toEqual([]);
  });

  it('community.setup.slots: fields replace the standard list and enforce manifest limits', async () => {
    const h = harness();
    await h.add({ metrics: [{ field: 'uses' }], fields: { metric: ['errors'] } });
    expect(setup(h.last(), 'metrics', '0')).toEqual([definition(h.last(), '_errors_').name]);
    expect(definition(h.last(), '_uses_')).toBeUndefined(); h.clear();
    for (const fields of [{ Metric: [] }, { Metric: ['uses', 'errors'] }])
      await expect(h.add({ fields })).rejects.toMatchObject(error('invalid', 'needs 1 to 1'));
    expect(h.writes()).toEqual([]);
  });

  it('community.setup.data_source: selects by name, alias or id, and defaults to the first report source', async () => {
    const h = harness();
    for (const data_source of ['B', 'ds2', 'ds-b']) {
      await h.add({ data_source }); expect(h.last().datasourceId).toBe('ds-b'); expect(p(h.last()).dataset).toEqual({ datasetType: 1, datasetId: 'ds-b' });
    }
    await h.add(); expect(h.last().datasourceId).toBe('ds-a'); h.clear();
    await expect(h.add({ data_source: 'C' })).rejects.toMatchObject(error('not_found', 'datasource_add')); expect(h.writes()).toEqual([]);
    (h.doc.report.resource as Json).datasourceAlias = [];
    await expect(h.add()).rejects.toMatchObject(error('invalid', 'datasource_add')); expect(h.writes()).toEqual([]);
  });

  it('community.place.layout: accepts page selectors and stores exact position and size', async () => {
    const h = harness();
    for (const page of ['Page 2', 'page-b', 2]) {
      await h.add({ page, position: { left: 40, top: 500, width: 600, height: 400 } });
      expect(h.last('page-b').attributeConfig.componentAttribute).toMatchObject({ left: 40, top: 500, width: 600, height: 400 });
      expect(h.writes().at(-1)!.body.pageId).toBe('page-b');
    }
    expect(h.components('page-a')).toEqual([]);
  });

  it('community.place.layout: uses the lower component edge without clamping the canvas and reports overflow', async () => {
    const h = harness(); h.doc.page[0]!.page.componentConfig = [{ componentId: 'cd-existing', attributeConfig: { componentAttribute: { top: 100, height: 200 } } }];
    await h.add(); expect(h.last().attributeConfig.componentAttribute).toMatchObject({ left: 40, top: 320, width: 400, height: 300 });
    const text = await h.add({ position: { top: 1200 } }); expect(text).toContain('beyond');
    expect(h.last().attributeConfig.componentAttribute.top).toBe(1200);
    h.clear(); await expect(h.add({ page: 'Nope' })).rejects.toMatchObject(error('not_found')); expect(h.writes()).toEqual([]);
  });

  for (const position of [{ width: 5 }, { left: 20001 }, { top: -1 }, { height: 20001 }])
    it(`community.place.layout: rejects invalid geometry ${JSON.stringify(position)} before any Rap`, async () => {
      const h = harness(); await expect(h.add({ position })).rejects.toMatchObject(error()); expect(h.calls).toEqual([]);
    });
});

describe('community style and data options', () => {
  it('community.style.title: writes both typed title settings and the matching display mirror', async () => {
    const h = harness(); await h.add({ ...custom, title: '사용 수 게이지' });
    expect(styleEntries(h.last())).toContainEqual({ key: 'tp_showTitle', value: { boolValue: true } });
    expect(styleEntries(h.last())).toContainEqual({ key: 'tp_title', value: { strValue: '사용 수 게이지' } });
    for (const entry of styleEntries(h.last())) expect(h.last().keyConfig.display.keyConfig).toContainEqual({ ...entry, stateKey: entry.key, dominant: 2 });
    expect(p(h.last()).thirdPartyVizProperty.isMigrated).toBe(true);
  });

  it('community.style.title: warns about absent title controls while still saving the visualization', async () => {
    const h = harness(); const text = await h.add({ title: 'Example title' });
    expect(text).toContain('Not applied: Show title, title'); expect(styleEntries(h.last())).toEqual([]);
    const config = structuredClone(settings); config.style![0]!.elements = [{ id: 'heading', label: 'Heading', type: 'TEXTINPUT', options: { placeholder: 'Chart title' } }];
    h.registrations[CUSTOM]!.config = JSON.stringify(config);
    const partial = await h.add({ ...custom, title: 'Heading text' }); expect(partial).toContain('Not applied: Show title'); expect(value(h.last(), 'heading')).toBe('Heading text');
  });

  it('community.style.settings: converts labels to typed values, handles duplicates, and mirrors every write', async () => {
    const h = harness(); await h.add({ ...custom, style: { 'bar color': '#ff0000', 'Show labels': false, Direction: 'Horizontal', 'Bar color#2': '#0000FF', Opacity: '80%', Size: '12', Font: 'Arial' } });
    expect(value(h.last(), 'barColor')).toEqual({ color: '#FF0000', opacity: 1 });
    expect(value(h.last(), 'showLabels')).toBe(false); expect(value(h.last(), 'dir')).toBe('horizontal');
    expect(value(h.last(), 'otherColor')).toEqual({ color: '#0000FF', opacity: 1 });
    expect(value(h.last(), 'alpha')).toBe(0.8); expect(value(h.last(), 'size')).toBe(12); expect(value(h.last(), 'font')).toBe('Arial');
    const color = styleEntries(h.last()).find((entry) => entry.key === 'tp_barColor')!;
    expect(color.value.mapValue.entry).toContainEqual({ key: 'opacity', value: { int64Value: '1' } });
    for (const entry of styleEntries(h.last())) expect(h.last().keyConfig.display.keyConfig).toContainEqual({ ...entry, stateKey: entry.key, dominant: 2 });
    expect(readCommunityStyle(h.last(), settings)).toMatchObject({ 'Bar color#2': { color: '#0000FF', opacity: 1 }, 'Show labels': false, Direction: 'horizontal' });
  });

  it('community.style.settings: validates select, color, checkbox and opacity values before any save', async () => {
    for (const [style, detail] of [[{ Direction: 'Diagonal' }, 'Horizontal'], [{ 'Bar color': '#FF00' }, 'six'], [{ 'Show labels': 'false' }, 'true or false'], [{ Opacity: '1' }, 'percentage']] as const) {
      const h = harness(); await expect(h.add({ ...custom, style })).rejects.toMatchObject(error('invalid', detail)); expect(h.writes()).toEqual([]);
    }
    const h = harness(); const text = await h.add({ ...custom, style: { Nope: 1 } }); expect(text).toContain('Not applied: Nope');
  });

  it('community.data.filters: reuses a filter without a report save when registration already exists', async () => {
    const h = harness(); (h.doc.report.resource as Json).communityVizResource = [{ vizId: GAUGE }];
    (h.doc.report.resource as Json).filter = { entry: [{ key: 'filter123', value: { name: 'Mobile', datasourceId: 'ds-a' } }] };
    await h.add({ filters: [{ name: 'Mobile' }] });
    expect(p(h.last()).filters).toEqual(['filter123']); expect(h.writes().map((entry) => entry.endpoint)).toEqual(['updatePage']);
    expect((h.doc.report.resource as Json).communityVizResource).toHaveLength(1);
  });

  it('community.data.filters: saves a new condition once before attaching the new key to its page', async () => {
    const h = harness(); await h.add({ filters: [{ name: 'Mobile', field: 'platform', condition: 'equals', values: ['mobile'] }] });
    const filter = (h.doc.report.resource as Json).filter.entry[0];
    expect(filter.value).toMatchObject({ name: 'Mobile', datasourceId: 'ds-a', filterDefinition: { filterExpression: { filterConditionType: 'EQ', stringValues: ['mobile'] } } });
    expect(p(h.last()).filters).toEqual([filter.key]); expect(h.writes().map((entry) => entry.endpoint)).toEqual(['updateReport', 'updatePage']);
  });

  it('community.data.date_range: reuses the same preset, fixed-date and automatic duration handling as charts', async () => {
    const h = harness(); await h.add({ date_range: 'Last 7 days' });
    expect(p(h.last()).dateDuration).toEqual({ startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 });
    expect(p(h.last()).dateRangeDimension).toBe(definition(h.last(), '_day_').name);
    await h.add({ date_range: '2026-10-01..2026-10-02' }); expect(p(h.last()).dateDuration).toEqual({ startAnchor: '20261001', endAnchor: '20261002' });
    await h.add({ date_range: 'Auto date range' }); expect(p(h.last())).not.toHaveProperty('dateDuration');
    h.clear(); await expect(h.add({ date_range: 'Last 9 days' })).rejects.toMatchObject(error('invalid', 'Last 28 days')); expect(h.writes()).toEqual([]);
  });

  it('community.data.sorts: replaces default sorting with two ordered fields and includes undisplayed sort concepts', async () => {
    const h = harness(); await h.add({ metrics: [{ field: 'uses' }], sorts: [{ field: 'errors' }, { field: 'day', ascending: true }] });
    expect(p(h.last()).sort).toEqual([{ sortColumn: definition(h.last(), '_errors_').name, sortDir: 1 }, { sortColumn: definition(h.last(), '_day_').name, sortDir: 0 }]);
    expect(definition(h.last(), '_errors_').queryTimeTransformation.dataTransformation.aggregation).toBe(6);
    expect(setup(h.last(), 'metrics', '0')).toEqual([definition(h.last(), '_uses_').name]);
    await h.add({ sorts: [] }); expect(p(h.last()).sort).toEqual([]);
  });

  it('community.data.comparison: rejects a comparison before registration but permits None without enabling comparison', async () => {
    const h = harness(); await expect(h.add({ comparison: 'Previous period' })).rejects.toMatchObject(error('invalid', 'comparison')); expect(h.calls).toEqual([]);
    await h.add({ comparison: 'None' }); expect(p(h.last())).not.toHaveProperty('compareDateDuration');
  });

  it('community.data.series: warns per metric, saves no series keys, and rejects empty names before Rap', async () => {
    const h = harness(); const text = await h.add({ series: [{ metric: '사용 수', type: 'line' }, { metric: 'Other', color: '#FF0000' }] });
    expect(text).toContain('Not applied: series: 사용 수, series: Other'); expect(h.writes().filter((entry) => entry.endpoint === 'updatePage')).toHaveLength(1);
    expect(JSON.stringify(h.last())).not.toContain('series'); h.clear();
    await expect(h.add({ series: [{ metric: '' }] })).rejects.toMatchObject(error()); expect(h.calls).toEqual([]);
  });

  for (const [id, key, input] of [
    ['community.data.value_colors', 'value_colors', { mobile: '#00FF00' }],
    ['community.data.references', 'reference_lines', [{ value: 100 }]],
    ['community.data.references', 'reference_bands', [{ from: 1, to: 2 }]],
    ['community.data.conditional_formats', 'conditional_formats', [{ rules: [] }]],
  ] as const)
    it(`${id}: refuses ${key} before registration and leaves the report unchanged`, async () => {
      const h = harness(); const before = structuredClone(h.doc);
      await expect(h.add({ [key]: input })).rejects.toMatchObject(error('invalid', key)); expect(h.calls).toEqual([]); expect(h.doc).toEqual(before);
    });
});

describe('community extension metadata', () => {
  it('community.setup.slots: publishes known chart kinds and a runtime descriptor for an arbitrary manifest', async () => {
    const h = harness();
    expect(extensions.chartKinds?.map((kind) => (kind as Json).creationTool)).toEqual(['community_viz_add', 'community_viz_add']);
    expect(extensions.chartKinds?.[0]?.slots).toMatchObject([{ title: 'Metric', kind: 'metrics', key: '0' }]);
    expect(() => extensions.chartKinds?.[0]?.validate?.({})).toThrow(/community_viz_add/);
    await h.add({ ...custom, style: { Direction: 'Vertical' } });
    const info = await communityMetadata(h.ctx, h.doc, h.last());
    expect(info).toMatchObject({ name: 'Example chart', creationTool: 'community_viz_add', slots: [{ title: 'Metric', key: '0' }], style: { Direction: 'vertical' } });
    expect(info?.controls).toContainEqual(expect.objectContaining({ label: 'Bar color', type: 'FILL_COLOR' }));
    expect(await communityMetadata(h.ctx, h.doc, { type: 'text' })).toBeUndefined();
  });

  it('community.add.gallery: accepts a full report URL through the common tool entry point', async () => {
    const h = harness(); await runTool(h.ctx, 'community_viz_add', { report_id: `https://lookerstudio.google.com/reporting/${REPORT}`, name: 'Gauge' });
    expect(h.calls[0]!.body.reportId).toBe(REPORT);
  });
});
