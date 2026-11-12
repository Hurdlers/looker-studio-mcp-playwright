import { describe, expect, it } from 'vitest';

import { RECORD_COUNT } from '../../../src/core/components.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
import { attr, looker, prop, report, slot, source, SOURCE, type Json } from './fake.js';

describe('control_add kinds and data', () => {
  it('control.kind.drop_down: saves the dropdown, field, Record Count and exact box in one page write', async () => {
    const f = looker();
    const out = await f.add({ kind: 'drop_down', field: 'device', position: { left: 40, top: 40, width: 300, height: 40 } });
    const c = f.components()[0]!;
    expect(c).toMatchObject({ type: 'dimension-filter', preset: 'default', datasourceId: SOURCE });
    expect(prop(c).dimensionFilterProperty).toMatchObject({ controlMode: 0, expandable: true });
    expect(attr(c)).toMatchObject({ left: 40, top: 40, width: 300, height: 40 });
    expect(slot(c).map(source)).toEqual(['_device_']);
    expect(slot(c, 'metrics').map(source)).toEqual([RECORD_COUNT]);
    expect(slot(c, 'metrics')[0]!.queryTimeTransformation).not.toHaveProperty('displayTransformation');
    expect(f.saves('updatePage')).toHaveLength(1);
    expect(f.saves('updateReport')).toHaveLength(0);
    expect(out).toContain(c.componentId);
  });
  it('control.kind.drop_down: a missing field performs no write', async () => {
    const f = looker();
    await expect(f.add({ kind: 'drop_down' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
  });
  it.each([
    ['control.kind.fixed_size_list', 'fixed_size_list', 'device', 'control-open-list', 0, 300],
    ['control.kind.input_box', 'input_box', 'device', 'control-textbox', 1, 70],
    ['control.kind.advanced_filter', 'advanced_filter', 'device', 'control-search-all', 1, 70],
    ['control.kind.slider', 'slider', 'n', 'control-slider', 2, 80],
    ['control.kind.checkbox', 'checkbox', 'flag', 'control-checkbox', 3, 40],
  ])('%s: builds its preset and editor defaults', async (_id, kind, field, preset, mode, height) => {
    const f = looker();
    await f.add({ kind, field });
    const c = f.components()[0]!;
    expect(c.preset).toBe(preset);
    expect(prop(c).dimensionFilterProperty).toMatchObject({ controlMode: mode, expandable: false });
    expect(attr(c)).toMatchObject({ width: 300, height });
    if (kind !== 'fixed_size_list') expect(slot(c, 'metrics')).toEqual([]);
    if (kind === 'input_box') expect(prop(c).dimensionFilterProperty).toMatchObject({ showFilterCondition: false, labelPosition: 2 });
    if (kind === 'advanced_filter') expect(prop(c).dimensionFilterProperty.showFilterCondition).toBe(true);
    if (kind === 'checkbox') expect(prop(c).dimensionFilterProperty.labelPosition).toBe(4);
    if (kind === 'fixed_size_list' || kind === 'slider') {
      const behavior = fromMapValue(c.behavior) as Json;
      expect(behavior.onSelect[0]).toMatchObject({ action: 'lego-dimension-filter', isControl: true });
      expect(behavior.onSelect[0].init.dConcept).toEqual(slot(c)[0]);
    }
  });
  it.each(['slider', 'checkbox', 'preset_filter'])('control.kind.%s: refuses incompatible fields before saving', async (kind) => {
    const f = looker();
    await expect(f.add({ kind, field: 'device' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
  });
  it('control.kind.date_range: keeps the verified default range without a source or field', async () => {
    const doc = report(); doc.report.resource!.datasourceAlias = [];
    const f = looker(doc);
    await f.add({ kind: 'date_range' });
    const c = f.components()[0]!;
    expect(c.type).toBe('simple-daterangepicker');
    expect(c.datasourceId).toBeUndefined();
    expect(fromMapValue(c.behavior)).toEqual({ onSelect: [{ action: 'lego-change-date-range', isControl: true, init: { dateRange: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 } } }] });
    await expect(f.add({ kind: 'date_range', field: 'device' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(1);
  });
  it('control.kind.data_control: remains blocked because BigQuery is unsupported; creates nothing', async () => {
    const f = looker();
    await expect(f.add({ kind: 'data_control' })).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('BigQuery') });
    expect(f.calls).toEqual([]);
    expect(f.components()).toEqual([]);
  });
  it('control.kind.dimension_control: a source dimension is required', async () => {
    const f = looker();
    await f.add({ kind: 'dimension_control', field: 'device' });
    const c = f.components()[0]!;
    expect(c).toMatchObject({ type: 'dimension-control', datasourceId: SOURCE });
    expect(slot(c).map(source)).toEqual(['_device_']);
    await expect(f.add({ kind: 'dimension_control' })).rejects.toMatchObject({ code: 'invalid' });
  });
  it('control.kind.button: a new unlinked button needs no source', async () => {
    const doc = report(); doc.report.resource!.datasourceAlias = [];
    const f = looker(doc);
    await f.add({ kind: 'button' });
    const c = f.components()[0]!;
    expect(c.type).toBe('button');
    expect(prop(c).buttonProperty).toMatchObject({ text: 'New Button', actionType: 1, linkType: 1, linkUrl: '', internalLink: '' });
    expect(attr(c)).toMatchObject({ width: 200, height: 40 });
    expect(c.datasourceId).toBeUndefined();
  });
  it('control.field: display name and source id resolve to the same unaggregated field', async () => {
    const f = looker();
    for (const field of ['device', '_device_']) await f.add({ kind: 'drop_down', field });
    for (const c of f.components()) {
      expect(slot(c).map(source)).toEqual(['_device_']);
      expect(slot(c)[0]!.queryTimeTransformation.dataTransformation).not.toHaveProperty('aggregation');
    }
    await expect(f.add({ kind: 'drop_down', field: 'nope' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('country') });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it('control.metric: stores default SUM and descending metric sort, rejects slots absent from other kinds', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device', metric: 'n' });
    const c = f.components()[0]!;
    expect(slot(c, 'metrics').map(source)).toEqual(['_n_']);
    expect(slot(c, 'metrics')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(6);
    expect(prop(c).sort).toEqual([{ sortDir: 1, sortColumn: slot(c, 'metrics')[0]!.name }]);
    await expect(f.add({ kind: 'input_box', field: 'device', metric: 'n' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(1);
  });
  it('control.data_source: chooses named/aliased sources and reports missing names', async () => {
    const doc = report(); doc.report.resource!.datasourceAlias!.push({ alias: 'ds2', datasourceId: 'second-source' });
    const f = looker(doc);
    for (const data_source of ['ds2', 'Other data']) await f.add({ kind: 'drop_down', field: 'device', data_source });
    for (const c of f.components()) expect(c).toMatchObject({ datasourceId: 'second-source', propertyConfig: { componentProperty: { dataset: { datasetType: 1, datasetId: 'second-source' } } } });
    await expect(f.add({ kind: 'drop_down', field: 'device', data_source: 'nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('Sample data') });
    await expect(f.add({ kind: 'date_range', data_source: 'ds2' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it('control.data_source: defaults to the most used source on the target page, ties use first alias', async () => {
    const doc = report(); doc.report.resource!.datasourceAlias!.push({ alias: 'ds2', datasourceId: 'second-source' });
    (doc.page[1]!.page.componentConfig as Json[]).push({ componentId: 'cd-existing', datasourceId: 'second-source' });
    const f = looker(doc);
    await f.add({ kind: 'drop_down', field: 'device' });
    await f.add({ kind: 'drop_down', field: 'device', page: 'Detail' });
    expect(f.components()[0]!.datasourceId).toBe(SOURCE);
    expect(f.components(1)[1]!.datasourceId).toBe('second-source');
  });
});

describe('control_add settings', () => {
  it('control.placement: supports report URL, named/id pages, exact pixels and bottom placement', async () => {
    const f = looker();
    f.components().push({ componentId: 'cd-existing', type: 'simple-description', attributeConfig: { componentAttribute: { left: 0, top: 300, width: 100, height: 100 } } });
    await f.add({ kind: 'drop_down', field: 'device', report_id: 'https://lookerstudio.google.com/reporting/12345678-1234-4234-8234-123456789012/page/p_aaa' });
    expect(attr(f.components()[1]!)).toMatchObject({ left: 40, top: 420, width: 300, height: 40 });
    for (const page of ['Detail', 'p_bbb']) await f.add({ kind: 'button', page, position: { left: 100, top: 200, width: 320, height: 48 } });
    expect(f.components(1)).toHaveLength(2);
    expect(attr(f.components(1)[0]!)).toMatchObject({ left: 100, top: 200, width: 320, height: 48 });
    await expect(f.add({ kind: 'button', position: { width: 5 } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.add({ kind: 'button', page: 'Nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringContaining('Overview') });
    expect(f.saves('updatePage')).toHaveLength(3);
  });
  it('control.style: applies labels and warns for unknown labels; bad options save nothing', async () => {
    const f = looker();
    const out = await f.add({ kind: 'drop_down', field: 'device', style: { 'Fixed-size': true, 'Single-select': true, Background: '#151B33', Nope: 1 } });
    expect(prop(f.components()[0]!).dimensionFilterProperty).toMatchObject({ expandable: false, singleSelect: true, backgroundAndBorderProperty: { background: { color: '#151B33', opacity: 1 } } });
    expect(out).toContain('Not applied: Nope');
    await expect(f.add({ kind: 'drop_down', field: 'device', style: { 'Label position': 'Diagonal' } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Top') });
    expect(f.saves('updatePage')).toHaveLength(1);
  });
  it('control.fields: replaces named slots in order, applies after field/metric, validates maxima/titles', async () => {
    const f = looker();
    await f.add({ kind: 'dimension_control', fields: { Dimension: ['device', 'country'] } });
    expect(slot(f.components()[0]!).map(source)).toEqual(['_device_', '_country_']);
    await f.add({ kind: 'drop_down', field: 'device', metric: 'n', fields: { 'control field': ['country'], Metric: [] } });
    expect(slot(f.components()[1]!).map(source)).toEqual(['_country_']);
    expect(slot(f.components()[1]!, 'metrics')).toEqual([]);
    expect(f.components()[1]!.conceptDefs).toHaveLength(1);
    for (const fields of [{ Nope: ['device'] }, { 'Control field': ['device', 'country'] }]) await expect(f.add({ kind: 'drop_down', field: 'device', fields })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.add({ kind: 'dimension_control', fields: { Dimension: [] } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it('control.filters / control.kind.preset_filter: Boolean field + shared report filter saved before the page', async () => {
    const f = looker();
    await f.add({ kind: 'preset_filter', field: 'flag', filters: [{ name: 'only mobile', field: 'device', condition: 'equals', values: ['mobile'] }] });
    const entries = (f.doc.report.resource as Json).filter.entry;
    expect(entries).toHaveLength(1);
    expect(entries[0].value).toMatchObject({ name: 'only mobile', datasourceId: SOURCE, filterDefinition: { filterExpression: { include: true, stringValues: ['mobile'] } } });
    const c = f.components()[0]!;
    expect(c).toMatchObject({ type: 'button', preset: 'button-filter' });
    expect(prop(c)).toMatchObject({ buttonProperty: { actionType: 3 }, filters: [entries[0].key] });
    expect(slot(c).map(source)).toEqual(['_flag_']);
    expect(f.saves().map((c) => c.endpoint)).toEqual(['updateReport', 'updatePage']);
    expect(fromMapValue(c.behavior)).toEqual({ onSelect: [{ action: 'lego-dimension-filter', isControl: true }] });
    await expect(f.add({ kind: 'preset_filter' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.add({ kind: 'preset_filter', field: 'flag', button: { action: 'link', url: 'https://example.com' } })).rejects.toMatchObject({ code: 'invalid' });
  });
  it('control.filters: reuses same-source named filters with warning and no duplicate report save', async () => {
    const f = looker();
    const filters = [{ name: 'only mobile', field: 'device', condition: 'equals', values: ['mobile'] }];
    await f.add({ kind: 'fixed_size_list', field: 'device', filters });
    const out = await f.add({ kind: 'fixed_size_list', field: 'device', filters });
    expect(out).toContain('reused');
    expect(f.saves('updateReport')).toHaveLength(1);
    expect(prop(f.components()[0]!).filters).toEqual(prop(f.components()[1]!).filters);
    await expect(f.add({ kind: 'fixed_size_list', field: 'device', filters: [{ name: 'missing' }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(2);
  });
  it('control.filters: compound AND/OR filters use the common serializer', async () => {
    const f = looker();
    await f.add({ kind: 'fixed_size_list', field: 'device', filters: [{ name: 'complex', clauses: [[{ field: 'device', condition: 'equals', values: ['mobile'] }, { field: 'country', condition: 'equals', values: ['us'] }], [{ field: 'n', condition: 'gt', values: [15], exclude: true }]] }] });
    const definition = (f.doc.report.resource as Json).filter.entry[0].value.filterDefinition;
    expect(definition.and.filterDefinitions[0].or.filterDefinitions).toHaveLength(2);
    expect(definition.and.filterDefinitions[1].filterExpression).toMatchObject({ numberValues: [15], include: false });
  });
  it('control.date_range: shares fixed/preset/auto parsing and writes picker protobuf behavior', async () => {
    const f = looker();
    await f.add({ kind: 'date_range', date_range: '2026-01-01..2026-01-31' });
    expect(fromMapValue(f.components()[0]!.behavior)).toEqual({ onSelect: [{ action: 'lego-change-date-range', isControl: true, init: { dateRange: { startAnchor: '20260101', endAnchor: '20260131' } } }] });
    await f.add({ kind: 'date_range', date_range: 'Auto date range' });
    expect((fromMapValue(f.components()[1]!.behavior) as Json).onSelect[0].init).toEqual({});
    await f.add({ kind: 'drop_down', field: 'device', date_range: 'Last 28 days' });
    expect(prop(f.components()[2]!).dateDuration).toEqual({ startOffsetUnit: 3, startOffset: 28, endOffsetUnit: 3, endOffset: 1 });
    expect(prop(f.components()[2]!)).not.toHaveProperty('dateRangeDimension');
    for (const date_range of ['Last 3 days', '2026-02-31..2026-03-03', '2026-02-02..2026-01-01']) await expect(f.add({ kind: 'date_range', date_range })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.add({ kind: 'dimension_control', field: 'device', date_range: 'Today' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves('updatePage')).toHaveLength(3);
  });
  it('control.comparison: only None is accepted and no compareDateDuration is written', async () => {
    const f = looker();
    await expect(f.add({ kind: 'date_range', comparison: 'Previous period' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('chart') });
    await expect(f.add({ kind: 'drop_down', field: 'device', comparison: 'Previous year' })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.calls).toEqual([]);
    await f.add({ kind: 'date_range', comparison: 'None' });
    expect(prop(f.components()[0]!)).not.toHaveProperty('compareDateDuration');
  });
  it.each([
    ['series', [{ metric: 'n', color: '#FF0000' }]], ['value_colors', { mobile: '#FF0000' }],
    ['reference_lines', [{ value: 3 }]], ['reference_bands', [{ from: 1, to: 2 }]], ['conditional_formats', [{ rules: [[{ field: 'n', condition: 'gt', value: 15 }]], background_color: '#FF00FF' }]],
  ])('control.chart_only_settings: refuses %s before any report write', async (key, value) => {
    const f = looker();
    await expect(f.add({ kind: 'drop_down', field: 'device', [key]: value })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining(String(key)) });
    expect(f.saves()).toEqual([]);
  });
});

it('parameter dropdowns store variable references without fabricating physical field concepts', async () => {
  const parameters = [{ key: 'choice', value: { parameterDisplayConfiguration: { displayName: 'Device choice' }, parametersModifiedByRoles: [{ key: 2, value: { dataType: 1 } }] } }];
  const f = looker(report(), { parameters });
  await f.add({ kind: 'drop_down', field: 'Device choice' });
  await f.add({ kind: 'drop_down', fields: { 'Control field': ['choice'] } });
  for (const c of f.components()) {
    expect(prop(c).dimensionFilterProperty).toMatchObject({ controlParameter: { parameterKey: 'choice' }, singleSelect: true });
    expect(slot(c)).toEqual([]);
    expect(slot(c, 'metrics').map(source)).toEqual([RECORD_COUNT]);
    expect(c.conceptDefs).toHaveLength(1);
  }
  const replaced = looker(report(), { parameters });
  await replaced.add({ kind: 'drop_down', field: 'choice', fields: { 'Control field': ['device'] } });
  expect(prop(replaced.components()[0]!).dimensionFilterProperty).not.toHaveProperty('controlParameter');
  const bad = looker(report(), { parameters });
  await expect(bad.add({ kind: 'dimension_control', field: 'choice' })).rejects.toMatchObject({ code: 'invalid' });
  await expect(bad.add({ kind: 'drop_down', field: 'device', metric: 'choice' })).rejects.toMatchObject({ code: 'invalid' });
  expect(bad.saves()).toEqual([]);
});


describe('source-backed control metrics', () => {
  it('does not invent Record Count when a source does not provide it', async () => {
    const f = looker(report(), { recordCount: false });
    await f.add({ kind: 'drop_down', field: 'device' });
    expect(slot(f.components()[0]!, 'metrics')).toEqual([]);
    expect(prop(f.components()[0]!).sort).toEqual([]);
  });
  it('keeps an explicit real metric when Record Count is absent', async () => {
    const f = looker(report(), { recordCount: false });
    await f.add({ kind: 'drop_down', field: 'device', metric: 'n' });
    expect(slot(f.components()[0]!, 'metrics').map(source)).toEqual(['_n_']);
  });
  it('repairs a list metric through component_update and preserves its field and appearance', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device' });
    const c = f.components()[0]!;
    const before = structuredClone(c.attributeConfig);
    await f.run('component_update', { component_id: c.componentId, fields: { Metric: ['n'] } });
    expect(slot(f.components()[0]!, 'metrics').map(source)).toEqual(['_n_']);
    expect(slot(f.components()[0]!).map(source)).toEqual(['_device_']);
    expect(f.components()[0]!.attributeConfig).toEqual(before);
    const concept = slot(f.components()[0]!, 'metrics')[0]!;
    expect(prop(f.components()[0]!).sort[0].sortColumn).toBe(concept.name);
  });
  it('does not save empty required fields or metrics on a slider', async () => {
    const f = looker();
    await f.add({ kind: 'slider', field: 'n' });
    const c = f.components()[0]!;
    const saves = f.saves().length;
    await expect(f.run('component_update', { component_id: c.componentId, fields: { 'Control field': [] } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(f.run('component_update', { component_id: c.componentId, fields: { Metric: ['n'] } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toHaveLength(saves);
  });
});
