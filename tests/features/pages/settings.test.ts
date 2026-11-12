import { describe, expect, it } from 'vitest';

import { parseDateRange } from '../../../src/features/pages/dates.js';
import { entries, looker, pageProp, report, SOURCE, type Json } from './fake.js';

describe('page_settings_update', () => {
  it('page.settings.scope.page: requires a setting before reading the report', async () => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { scope: 'page', page: 'B' })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('page.settings.scope.page: saves only the chosen page and leaves other pages unchanged', async () => {
    const fake = looker(report(['First', 'Second']));
    await fake.run('page_settings_update', { scope: 'page', page: 'Second', data_source: 'ds1' });
    expect(fake.saves('updatePage')).toHaveLength(1);
    expect(fake.saves('updatePage')[0]!.body.pageId).toBe('p2');
    expect(pageProp(fake.doc, 1).dataset).toEqual({ datasetType: 1, datasetId: SOURCE });
    expect(pageProp(fake.doc).dataset).toBeUndefined();
    expect(fake.saves('updateReport')).toHaveLength(0);
  });

  it('page.settings.scope.report: saves report defaults once, preserves the theme and reports page-only arguments', async () => {
    const doc = report();
    const prop = (doc.report.propertyConfig as Json).reportProperty;
    prop.dateRangeDimension = 'qt_day';
    doc.report.conceptDefs = [{ name: 'qt_day' }];
    const fake = looker(doc);
    const text = await fake.run('page_settings_update', { scope: 'report', page: 'B', date_range: 'Last 7 days', style: { 'Page background': '#FFFFFF' } });
    expect(fake.saves('updateReport')).toHaveLength(1);
    expect(fake.saves('updatePage')).toHaveLength(0);
    expect((doc.report.propertyConfig as Json).reportProperty).toEqual({ themeConfig: 'theme-demo', coordinatedColoring: true, dateRangeDimension: 'qt_day', dateDuration: { startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 } });
    expect(text).toContain('Not applied');
    expect(text).toContain('style');
    expect(text).toContain('page');
  });

  it('page.settings.scope.report: default data source changes preserve the theme', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { scope: 'report', data_source: 'ds1' });
    expect((fake.doc.report.propertyConfig as Json).reportProperty).toEqual({ themeConfig: 'theme-demo', coordinatedColoring: true, dataset: { datasetType: 1, datasetId: SOURCE } });
  });

  it.each(['ds1', SOURCE, 'Demo data'])('page.settings.data_source: accepts source reference %s', async (data_source) => {
    const fake = looker();
    await fake.run('page_settings_update', { data_source });
    expect(pageProp(fake.doc).dataset).toEqual({ datasetType: 1, datasetId: SOURCE });
  });

  it('page.settings.data_source: unknown sources are invalid and list known source names without saving', async () => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { data_source: 'missing' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Demo data') });
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.settings.date_range_dimension: stores a date concept and removes the previous date concept only', async () => {
    const doc = report();
    pageProp(doc).dateRangeDimension = 'qt_old';
    doc.page[0]!.page.conceptDefs = [{ name: 'qt_old' }, { name: 'qt_keep' }];
    const fake = looker(doc);
    await fake.run('page_settings_update', { date_range_dimension: 'day' });
    const name = pageProp(doc).dateRangeDimension;
    const defs = doc.page[0]!.page.conceptDefs! as Json[];
    expect(name).toMatch(/^qt_/);
    expect(defs).toHaveLength(2);
    expect(defs.find((d) => d.name === name)!.queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
    expect(defs.find((d) => d.name === 'qt_old')).toBeUndefined();
    expect(defs.find((d) => d.name === 'qt_keep')).toBeDefined();
    expect(pageProp(doc).dataset).toEqual({ datasetType: 1, datasetId: SOURCE });
  });

  it('page.settings.date_range_dimension: rejects a numeric field without saving', async () => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { date_range_dimension: 'amount' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('not a date field') });
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.settings.date_range_dimension: inherits the report source when a report has multiple sources', async () => {
    const doc = report();
    doc.report.resource!.datasourceAlias!.push({ alias: 'ds2', datasourceId: 'alternate-source' });
    (doc.report.propertyConfig as Json).reportProperty.dataset = { datasetType: 1, datasetId: SOURCE };
    const fake = looker(doc);
    await fake.run('page_settings_update', { date_range_dimension: 'day' });
    expect(pageProp(doc).dataset.datasetId).toBe(SOURCE);
  });

  it('page.settings.date_range.preset: uses chart-compatible date offsets and handles auto', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { date_range_dimension: 'day', date_range: 'last 7 days' });
    expect(pageProp(fake.doc).dateDuration).toEqual({ startOffsetUnit: 3, startOffset: 7, endOffsetUnit: 3, endOffset: 1 });
    await fake.run('page_settings_update', { date_range: 'Last 28 days' });
    expect(pageProp(fake.doc).dateDuration).toEqual({ startOffsetUnit: 3, startOffset: 28, endOffsetUnit: 3, endOffset: 1 });
    await fake.run('page_settings_update', { date_range: 'Auto date range' });
    expect(pageProp(fake.doc).dateDuration).toBeUndefined();
  });

  it('page.settings.date_range.preset: unknown names list choices and missing date fields prevent writes', async () => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { date_range: 'Last 8 days' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Last 28 days') });
    expect(fake.calls).toHaveLength(0);
    await expect(fake.run('page_settings_update', { date_range: 'Last 7 days' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('date_range_dimension') });
    expect(fake.saves()).toHaveLength(0);
  });

  it.each([
    ['Today', 3, 0, 3, 0], ['Yesterday', 3, 1, 3, 1],
    ['Last week (starts Sunday)', 4, 1, 4, 1], ['Last week (starts Monday)', 5, 1, 5, 1],
    ['Last month', 6, 1, 6, 1], ['Last quarter', 7, 1, 7, 1], ['Last year', 8, 1, 8, 1],
    ['This week (starts Sunday)', 4, 0, 4, 0], ['This week (starts Monday)', 5, 0, 5, 0],
    ['This week to date (starts Sunday)', 4, 0, 3, 1], ['This week to date (starts Monday)', 5, 0, 3, 1],
    ['This month', 6, 0, 6, 0], ['This month to date', 6, 0, 3, 1],
    ['This quarter', 7, 0, 7, 0], ['This quarter to date', 7, 0, 3, 1],
    ['This year', 8, 0, 8, 0], ['This year to date', 8, 0, 3, 1],
  ])('page.settings.date_range.preset: %s respects period boundaries', (name, su, so, eu, eo) => {
    expect(parseDateRange(name)).toEqual({ startOffsetUnit: su, startOffset: so, endOffsetUnit: eu, endOffset: eo });
  });

  it('page.settings.date_range.fixed: stores anchors without offsets', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { date_range_dimension: 'day', date_range: '2026-01-01..2026-01-31' });
    expect(pageProp(fake.doc).dateDuration).toEqual({ startAnchor: '20260101', endAnchor: '20260131' });
  });

  it.each(['2026-02-30..2026-03-01', '2026-03-01..2026-01-01', '2026/01/01..2026/01/02'])('page.settings.date_range.fixed: rejects invalid dates %s before any request', async (date_range) => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { date_range_dimension: 'day', date_range })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('page.settings.filter.reuse: attaches an existing key without saving the report or duplicating a key', async () => {
    const doc = report();
    (doc.report.resource as Json).filter = { entry: [{ key: 'filterexisting', value: { name: 'Known filter' } }] };
    const fake = looker(doc);
    await fake.run('page_settings_update', { filters: [{ name: 'Known filter' }] });
    await fake.run('page_settings_update', { filters: [{ name: 'Known filter' }] });
    expect(pageProp(doc).filters).toEqual(['filterexisting']);
    expect(fake.saves('updateReport')).toHaveLength(0);
  });

  it('page.settings.filter.reuse: ignores replacement conditions on an existing name and reports it', async () => {
    const doc = report();
    (doc.report.resource as Json).filter = { entry: [{ key: 'filterexisting', value: { name: 'Known filter', datasourceId: SOURCE } }] };
    const fake = looker(doc);
    const text = await fake.run('page_settings_update', { filters: [{ name: 'Known filter', field: 'missing', condition: 'bad' }] });
    expect(pageProp(doc).filters).toEqual(['filterexisting']);
    expect(fake.saves('updateReport')).toHaveLength(0);
    expect(text).toContain('Not applied');
    expect(text).toContain('reused');
  });

  it('page.settings.filter.reuse: a missing named filter lists available names without saving', async () => {
    const doc = report();
    (doc.report.resource as Json).filter = { entry: [{ key: 'filterexisting', value: { name: 'Known filter' } }] };
    const fake = looker(doc);
    await expect(fake.run('page_settings_update', { filters: [{ name: 'none' }] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Known filter') });
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.settings.filter.single: creates numeric filters before attaching their keys to the page', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { filters: [{ name: 'Positive amount', field: 'amount', condition: 'gt', values: ['0'] }] });
    const entry = entries(fake.doc)[0]!;
    expect(entry.key).toMatch(/^filter[a-z0-9]{10}$/);
    expect(entry.value).toMatchObject({ name: 'Positive amount', datasourceId: SOURCE, version: 3, filterDefinition: { filterExpression: { filterConditionType: 'GT', conceptType: 1, numberValues: [0], stringValues: [], include: true, queryTimeTransformation: { dataTransformation: { sourceFieldName: '_amount_' } } } } });
    expect(pageProp(fake.doc).filters).toEqual([entry.key]);
    expect(fake.saves().map((c) => c.endpoint)).toEqual(['updateReport', 'updatePage']);
  });

  it('page.settings.filter.single: exclude is false include and between needs two values', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { filters: [{ name: 'Excluded', field: 'amount', condition: 'between', values: ['10', '20'], exclude: true }] });
    expect(entries(fake.doc)[0]!.value.filterDefinition.filterExpression).toMatchObject({ filterConditionType: 'BT', numberValues: [10, 20], include: false });
    const bad = looker();
    await expect(bad.run('page_settings_update', { filters: [{ name: 'Bad', field: 'amount', condition: 'between', values: ['10'] }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(bad.saves()).toHaveLength(0);
  });

  it.each([
    ['equals', 'EQ'], ['=', 'EQ'], ['Equal to (=)', 'EQ'], ['contains', 'PT'], ['starts_with', 'BW'], ['regexp_match', 'RM'], ['regexp_contains', 'RC'], ['gt', 'GT'], ['>', 'GT'], ['gte', 'GTE'], ['>=', 'GTE'], ['lt', 'LT'], ['<', 'LT'], ['lte', 'LTE'], ['<=', 'LTE'],
  ])('page.settings.filter.single: condition %s compiles to %s', async (condition, code) => {
    const fake = looker();
    await fake.run('page_settings_update', { filters: [{ name: 'Condition', field: 'region', condition, values: ['sample'] }] });
    expect(entries(fake.doc)[0]!.value.filterDefinition.filterExpression).toMatchObject({ filterConditionType: code, stringValues: ['sample'], numberValues: [], conceptType: 0 });
  });

  it('page.settings.filter.single: in accepts many text values and null takes no values', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { filters: [{ name: 'Regions', field: 'region', condition: 'in', values: ['North', 'South'] }, { name: 'Null', field: 'region', condition: 'is_null' }] });
    expect(entries(fake.doc)[0]!.value.filterDefinition.filterExpression).toMatchObject({ filterConditionType: 'IN', stringValues: ['North', 'South'] });
    expect(entries(fake.doc)[1]!.value.filterDefinition.filterExpression).toMatchObject({ filterConditionType: 'NU', stringValues: [], numberValues: [] });
    const bad = looker();
    await expect(bad.run('page_settings_update', { filters: [{ name: 'Null', field: 'region', condition: 'is_null', values: ['x'] }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(bad.saves()).toHaveLength(0);
  });

  it('page.settings.filter.single: rollback removes new filters if the page save fails', async () => {
    const fake = looker(report(), { failPage: true });
    await expect(fake.run('page_settings_update', { filters: [{ name: 'New', field: 'region', condition: '=', values: ['North'] }] })).rejects.toThrow('page save failed');
    expect(entries(fake.doc)).toEqual([]);
    expect(fake.saves('updateReport')).toHaveLength(2);
  });

  it('page.settings.filter.and_or: nested clauses encode (A OR B) AND C and single groups collapse', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { filters: [{ name: 'Mixed', clauses: [[{ field: 'amount', condition: 'gt', values: ['10'] }, { field: 'amount', condition: 'lt', values: ['2'] }], [{ field: 'amount', condition: 'gte', values: ['0'] }]] }] });
    const def = entries(fake.doc)[0]!.value.filterDefinition;
    expect(def).toMatchObject({ and: { filterDefinitions: [{ or: { filterDefinitions: [{ filterExpression: { filterConditionType: 'GT', numberValues: [10] } }, { filterExpression: { filterConditionType: 'LT', numberValues: [2] } }] } }, { filterExpression: { filterConditionType: 'GTE', numberValues: [0] } }] } });
    const single = looker();
    await single.run('page_settings_update', { filters: [{ name: 'Single', clauses: [[{ field: 'region', condition: '=', values: ['North'] }]] }] });
    expect(entries(single.doc)[0]!.value.filterDefinition.filterExpression.filterConditionType).toBe('EQ');
  });

  it.each([
    { name: 'Bad', field: 'amount', clauses: [[{ field: 'amount', condition: 'gt', values: ['1'] }]] },
    { name: 'Bad', clauses: [[]] },
  ])('page.settings.filter.and_or: invalid compound filters do not save', async (filter) => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { filters: [filter] })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.saves()).toHaveLength(0);
  });

  it('page.settings.filter.and_or: report scope stores the definition and reference in one report save', async () => {
    const fake = looker();
    await fake.run('page_settings_update', { scope: 'report', filters: [{ name: 'Report filter', field: 'amount', condition: 'gt', values: ['0'] }] });
    expect(fake.saves().map((c) => c.endpoint)).toEqual(['updateReport']);
    expect((fake.doc.report.propertyConfig as Json).reportProperty.filters).toEqual([entries(fake.doc)[0]!.key]);
  });

  it('page.settings.style: writes page color and size and lists unknown labels', async () => {
    const fake = looker();
    const text = await fake.run('page_settings_update', { style: { 'Page background': '#EFEFEF', 'Height (px)': '1500', Glow: 'x', 'Page background#2': '#FFFFFF' } });
    expect(pageProp(fake.doc).backgroundColor).toEqual({ color: '#EFEFEF', opacity: 1 });
    expect((fake.doc.page[0]!.page.attributeConfig as Json).pageAttribute.height).toBe(1500);
    expect(text).toContain('Not applied');
    expect(text).toContain('Glow');
    expect(text).toContain('Page background#2');
  });

  it.each([{ 'Page background': '#12' }, { 'Height (px)': -1 }, { 'Height (px)': 1.5 }])('page.settings.style: bad style values fail before network requests', async (style) => {
    const fake = looker();
    await expect(fake.run('page_settings_update', { style })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('page.settings.style: style alone in report scope only reports Not applied', async () => {
    const fake = looker();
    expect(await fake.run('page_settings_update', { scope: 'report', style: { 'Page background': '#FFFFFF' } })).toContain('Not applied');
    expect(fake.saves()).toHaveLength(0);
  });
});
