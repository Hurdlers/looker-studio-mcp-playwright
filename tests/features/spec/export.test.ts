import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { template } from '../../../src/core/components.js';
import { column, fake, properties as p, SOURCE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const components = (f: ReturnType<typeof fake>) => f.original.page[0]!.page.componentConfig as Json[];
const add = async (f: ReturnType<typeof fake>, tool: string, args: Json) => { await f.add(tool, args); return components(f).at(-1)!; };

describe('report specification export', () => {
  it('spec.export.read: keeps navigation order, every page component and one copy of report components without writes', async () => {
    const f = fake();
    for (const text of ['A', 'B', 'C']) await add(f, 'text_add', { text });
    await f.add('page_add', { name: 'Details' });
    await f.add('text_add', { page: 'Details', text: 'D' });
    f.original.report.componentConfig = [{ ...structuredClone(components(f)[0]), componentId: 'cd-shared' }];
    f.clear();
    const { spec } = await f.exportSpec();
    expect(spec.pages.map((page: Json) => page.name)).toEqual(['Overview', 'Details']);
    expect(spec.pages.map((page: Json) => page.components.length)).toEqual([3, 1]); expect(spec.report_components).toHaveLength(1);
    expect(f.writes()).toEqual([]); expect(f.sent('getReport')).toHaveLength(1);
    expect(f.sent('getReport')[0]!.body).toMatchObject({ updateViewedDate: false, updateFirestore: false });
  });

  it('spec.export.read: a failed source read preserves the other source and is reported explicitly', async () => {
    const f = fake(); f.original.report.resource!.datasourceAlias!.push({ datasourceId: 'missing', alias: 'ds2' });
    const { spec, text } = await f.exportSpec(); expect(spec.data_sources).toHaveLength(1); expect(text).toContain('missing: 읽지 못함');
  });

  it('spec.export.style_depth: main compares template values, none omits style, all includes label values', async () => {
    const f = fake(); await add(f, 'shape_add', { shape: 'rectangle', border_radius: 12, style: { 'Add border shadow': true } });
    const main = (await f.exportSpec()).spec.pages[0].components[0];
    expect(main.border_radius).toBe(12); expect(main.style).toEqual({ 'Add border shadow': true });
    expect((await f.exportSpec({ style: 'none' })).spec.pages[0].components[0]).not.toHaveProperty('style');
    const all = (await f.exportSpec({ style: 'all' })).spec.pages[0].components[0].style;
    expect(all).toMatchObject({ 'Border weight': 'None', 'Border style': 'Solid' });
  });

  it('spec.export.style_depth: omits transparent colors and normalizes exported hex colors', async () => {
    const f = fake(); const shape = await add(f, 'shape_add', { shape: 'rectangle', background: '#ffffff' });
    expect((await f.exportSpec()).spec.pages[0].components[0].background).toBe('#FFFFFF');
    p(shape).genericShapeProperty.backgroundAndBorderProperty.background = { color: 'transparent' };
    const output = (await f.exportSpec({ style: 'all' })).spec.pages[0].components[0];
    expect(output).not.toHaveProperty('background'); expect(output.style).not.toHaveProperty('Background color');
  });

  it('spec.export.style_depth: preserves main opacity and all text font faces without duplicating dedicated background keys', async () => {
    const f = fake(); await add(f, 'shape_add', { shape: 'rectangle', background: '#FFFFFF', style: { Opacity: '50%', 'Add border shadow': true } });
    const shape = (await f.exportSpec()).spec.pages[0].components[0];
    expect(shape.style).toEqual({ Opacity: '50%', 'Add border shadow': true });
    await add(f, 'text_add', { text: 'A', style: { Font: 'Arial' } });
    expect((await f.exportSpec({ style: 'all' })).spec.pages[0].components[1].style.Font).toBe('Arial');
  });

  it('spec.export.file: saves image bytes in a sibling folder with page/index names and reports spec_path', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spec-images-'));
    try {
      const f = fake(); await f.add('page_add', { name: 'Details' });
      await f.add('text_add', { page: 'Details', text: 'A' }); await f.add('text_add', { page: 'Details', text: 'B' });
      await f.add('image_add', { page: 'Details', image: 'data:image/jpeg;base64,AAEC' });
      const path = join(folder, 'new', 'sales.json');
      const { spec, text } = await f.exportSpec({ path });
      expect(spec.pages[1].components[2].image).toBe('sales-images/page2-2.jpg');
      expect(await readFile(join(folder, 'new', 'sales-images/page2-2.jpg'))).toEqual(Buffer.from([0, 1, 2]));
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(spec); expect(text).toContain('spec_path');
      expect(f.sent('getImageV2')[0]!.mode).toBe('get');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('spec.export.theme: reads the owning theme extension and exports only deviations from the preset', async () => {
    const f = fake(); await f.add('theme_update', { preset: 'Constellation', canvas: { width: 1400, height: 1000 }, settings: { 'Report background color': '#0B1020' } });
    const { spec } = await f.exportSpec();
    expect(spec.theme).toEqual({ preset: 'Constellation', settings: { 'Report background color': '#0B1020' }, canvas: { width: 1400, height: 1000 } });
  });

  it('spec.export.data_sources: keeps source names/order and the BigQuery table or SQL connection', async () => {
    const f = fake(); await f.add('datasource_add', { project_id: 'example-project', sql: 'SELECT 1 AS value', source_name: 'One' });
    const { spec } = await f.exportSpec();
    expect(spec.data_sources.map((source: Json) => source.name)).toEqual(['Metrics', 'One']);
    expect(spec.data_sources[1]).toEqual({ name: 'One', project_id: 'example-project', sql: 'SELECT 1 AS value' });
    expect(spec.data_sources[0]).toMatchObject({ dataset_id: 'example_data', table_id: 'traffic data' });
  });

  it('spec.export.data_sources: retains date-query parameters and reports deferred email sources without exporting their setting', async () => {
    const f = fake(); await f.add('datasource_add', { project_id: 'example-project', sql: 'SELECT @DS_START_DATE AS day', date_range_params: true, source_name: 'Dated' });
    expect((await f.exportSpec()).spec.data_sources[1]).toMatchObject({ name: 'Dated', date_range_params: true });
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig.sql = 'SELECT @DS_USER_EMAIL';
    const { spec, text } = await f.exportSpec(); expect(spec.data_sources.some((source: Json) => source.name === 'Metrics')).toBe(false); expect(text).toContain('deferred');
    expect(JSON.stringify(spec)).not.toContain('viewer_email_param');
  });

  it('exports a Sheets connection with false options, gid zero and field definitions without native credentials', async () => {
    const f = fake(), source = f.sources[SOURCE]!.block;
    source.blocks[0].connectorBlockConfig.connectorConfig = {
      datasourceType: 8,
      sheetsConfig: { key: 'example_spreadsheet', sheetId: '0', hasHeader: false, includeHiddenCells: false, includeFilteredCells: false, range: 'A1:C20',
        meta: { spreadsheetName: 'Example', worksheetName: 'Sales' }, context: { accessToken: 'fake-test-token' } },
    };
    source.datasourceBlock.fields.push({ ...column('calc_double', 'Double', 33), textFormula: 't0._value_ * 2' });
    const { spec, text } = await f.exportSpec();
    expect(spec.data_sources).toHaveLength(1);
    expect(spec.data_sources[0]).toMatchObject({ name: 'Metrics', connector: 'google_sheets', spreadsheet: 'example_spreadsheet', worksheet_id: '0',
      use_first_row_as_headers: false, include_hidden_and_filtered_cells: false, range: 'A1:C20' });
    expect(spec.data_sources[0]).not.toHaveProperty('project_id');
    expect(spec.calculated_fields).toEqual([{ name: 'Double', formula: 'value * 2', type: 'Number', aggregation: 'sum' }]);
    expect(text).not.toMatch(/fake-test-token|sheetsConfig|source was omitted/);
  });

  it('exports explicit Sheets options and numeric gid zero while omitting an absent range', async () => {
    const f = fake();
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = { datasourceType: 8, sheetsConfig: {
      key: 'example_spreadsheet', sheetId: 0, hasHeader: true, includeHiddenCells: true, includeFilteredCells: true,
    } };
    const { spec } = await f.exportSpec();
    expect(spec.data_sources[0]).toMatchObject({ connector: 'google_sheets', worksheet_id: '0', use_first_row_as_headers: true, include_hidden_and_filtered_cells: true });
    expect(spec.data_sources[0]).not.toHaveProperty('range');
  });

  it('reports missing saved Sheets options instead of guessing that they are enabled', async () => {
    for (const missing of ['hasHeader', 'includeHiddenCells', 'includeFilteredCells']) {
      const f = fake();
      const config: Json = { key: 'example_spreadsheet', sheetId: '0', hasHeader: true, includeHiddenCells: true, includeFilteredCells: true };
      delete config[missing];
      f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = { datasourceType: 8, sheetsConfig: config };
      const { spec, text } = await f.exportSpec();
      expect(spec.data_sources).toEqual([]);
      expect(text).toContain('saved defaults are unknown');
    }
  });

  it('reports and omits Sheets connections whose cell options cannot be reproduced or whose identity is missing', async () => {
    for (const config of [
      { key: 'example_spreadsheet', sheetId: '0', hasHeader: true, includeHiddenCells: true, includeFilteredCells: false },
      { key: 'example_spreadsheet', sheetId: '0', hasHeader: true, includeHiddenCells: false, includeFilteredCells: true },
      { key: 'example_spreadsheet' },
    ]) {
      const f = fake();
      f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig = { datasourceType: 8, sheetsConfig: config };
      const { spec, text } = await f.exportSpec();
      expect(spec.data_sources).toEqual([]);
      expect(text).toContain('source was omitted');
      expect(text).toContain('sheetId' in config ? 'cannot preserve both' : 'no spreadsheet or worksheet id');
    }
  });

  it('spec.export.fields: exports calculated/group/bin fields and typed parameters using source field names', async () => {
    const f = fake(), source = f.sources[SOURCE]!.block;
    source.datasourceBlock.fields.push(
      { ...column('calc_double', 'Double', 33), textFormula: 't0._value_ * \uE000target', frontendTextFormula: 'value * \uE000target' },
      { ...column('calc_group', 'Groups'), bucketedFieldConfig: { sourceField: '_category_', customGroups: { buckets: [{ displayName: 'Selected', filterConfig: { include: false, filterConditionType: 15, values: ['a'] } }, { displayName: 'Remaining', isRemainingValues: true }] } } },
      { ...column('calc_bin', 'Bins', 33), bucketedFieldConfig: { sourceField: '_value_', uniformBinConfig: { size: 100, min: 0, max: 1000 } } },
    );
    source.resource = { parameterConfiguration: { parameters: [{ key: 'target', value: { parameterDisplayConfiguration: { displayName: 'Target' }, parametersModifiedByRoles: [{ key: 1, value: { name: 'target', dataType: 4, options: [], defaultValue: [{ stringValue: '10' }] } }] } }] } };
    const { spec } = await f.exportSpec();
    expect(spec.calculated_fields).toEqual([{ name: 'Double', formula: 'value * target', type: 'Number', aggregation: 'sum' }]);
    expect(spec.bin_fields).toEqual([{ name: 'Bins', field: 'value', size: 100, min: 0, max: 1000 }]);
    expect(spec.group_fields).toEqual([{ name: 'Groups', field: 'category', groups: [{ name: 'Selected', condition: 'in', values: ['a'], exclude: true }], other_group: 'Remaining' }]);
    expect(spec.parameters).toEqual([{ name: 'Target', id: 'target', data_type: 'Number (whole)', default_value: 10 }]);
  });

  it('spec.export.fields: takes the native role-2 default rather than the empty role-1 placeholder', async () => {
    const f = fake(); f.sources[SOURCE]!.block.resource = { parameterConfiguration: { parameters: [{ key: 'target', value: { parameterDisplayConfiguration: { displayName: 'Target' }, parametersModifiedByRoles: [
      { key: 1, value: { name: 'target', dataType: 4, options: [], defaultValue: [{ label: '', stringValue: '' }], lock: 2, validation: {} } },
      { key: 2, value: { name: 'target', dataType: 4, options: [], defaultValue: [{ stringValue: '100' }], lock: 2, validation: {} } },
    ] } }] } };
    expect((await f.exportSpec()).spec.parameters).toEqual([{ name: 'Target', id: 'target', data_type: 'Number (whole)', default_value: 100 }]);
  });

  it('spec.export.fields: distinguishes native connector formulas from user-created calculations by metadata', async () => {
    const f = fake(), source = f.sources[SOURCE]!.block;
    source.datasourceBlock.fields = [
      { ...column('_day_', 'day', 2), createdBy: 1, immutableVersion: { ns: 't0', name: 'day' }, textFormula: 't0.day' },
      { ...column('_value_', 'Value label', 33), createdBy: 1, textFormula: 't0.value' },
      { ...column('calc_auto', 'Automatic', 33), createdBy: 3, textFormula: 't0.value' },
      { ...column('calc_native', 'Native calculation', 33), immutableVersion: { ns: 't0', name: 'value' }, textFormula: 't0.value' },
      { ...column('user_total', 'Total', 33), createdBy: 2, textFormula: 'SUM(t0._value_)', frontendTextFormula: 'SUM(value)' },
      { ...column('calc_legacy', 'Legacy', 33), textFormula: 't0._value_*2', frontendTextFormula: 'value*2' },
    ];
    expect((await f.exportSpec()).spec.calculated_fields).toEqual([{ name: 'Total', formula: 'SUM(value)', type: 'Number', aggregation: 'sum' }, { name: 'Legacy', formula: 'value*2', type: 'Number', aggregation: 'sum' }]);
  });

  it('spec.export.fields: replaces canonical field IDs with public names while preserving literals, comments and unrelated identifiers', async () => {
    const f = fake(), source = f.sources[SOURCE]!.block;
    const protectedText = `'t0.calc_previous \uE000target' + "calc_previous" /* t0.calc_previous */ -- calc_previous\n`;
    source.datasourceBlock.fields.push(
      { ...column('calc_previous', 'Double total', 33), textFormula: 't0._value_*2' },
      { ...column('calc_next', 'Next', 33), textFormula: 'ignored backend expression', frontendTextFormula: `SUM(t0.calc_previous) + calc_previous + t0._value_ + ${protectedText} + t1.calc_previous + t0.calc_previous_extra + calc_previous값 + \uE000target` },
    );
    expect((await f.exportSpec()).spec.calculated_fields).toEqual([
      { name: 'Double total', formula: 'value*2', type: 'Number', aggregation: 'sum' },
      { name: 'Next', formula: `SUM(Double total) + Double total + value + ${protectedText} + t1.calc_previous + t0.calc_previous_extra + calc_previous값 + target`, type: 'Number', aggregation: 'sum' },
    ]);
  });

  it('spec.export.blends: reverses a saved join tree into ordered source tables and named join keys', async () => {
    const f = fake(); await f.add('datasource_add', { project_id: 'example-project', sql: 'SELECT 1 AS value', source_name: 'One' });
    await f.add('blend_create', { name: 'Joined', tables: [{ data_source: 'Metrics', dimensions: ['category'], metrics: ['value'] }, { data_source: 'One', dimensions: ['category'], metrics: ['value'] }], joins: [{ type: 'left outer', keys: [['category', 'category']] }] });
    expect((await f.exportSpec()).spec.blends).toEqual([{ name: 'Joined', tables: [{ data_source: 'Metrics', dimensions: ['category'], metrics: ['value'] }, { data_source: 'One', dimensions: ['category'], metrics: ['value'] }], joins: [{ type: 'left outer', keys: [['category', 'category']] }] }]);
  });

  it('spec.export.filters: expands shared filters, grouped OR clauses, numeric values and missing keys', async () => {
    const f = fake(); const chart = await add(f, 'chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }], filters: [{ name: 'No web', field: 'category', condition: 'equals', values: ['web'], exclude: true }, { name: 'Either', clauses: [[{ field: 'category', condition: 'equals', values: ['a'] }, { field: 'category', condition: 'in', values: ['b', 'c'] }]] }] });
    p(chart).filters.push('missing-filter');
    const { spec, text } = await f.exportSpec();
    expect(spec.pages[0].components[0].filters).toEqual([{ name: 'No web', field: 'category', condition: 'equals', values: ['web'], exclude: true }, { name: 'Either', clauses: [[{ field: 'category', condition: 'equals', values: ['a'] }, { field: 'category', condition: 'in', values: ['b', 'c'] }]] }, { name: 'missing-filter' }]);
    expect(text).toContain('missing-filter');
  });

  it('spec.export.settings: includes data-source-only report defaults, fixed ranges and page style', async () => {
    const f = fake(); await f.add('page_settings_update', { scope: 'report', data_source: 'Metrics' });
    await f.add('page_settings_update', { date_range_dimension: 'day', date_range: '2026-09-01..2026-10-15', style: { 'Page background': '#FAFAFA', 'Height (px)': 1500 } });
    const { spec } = await f.exportSpec();
    expect(spec.report_settings).toEqual({ data_source: 'Metrics' });
    expect(spec.pages[0].settings).toMatchObject({ date_range: '2026-09-01..2026-10-15', date_range_dimension: 'day', style: { 'Page background': '#FAFAFA', 'Height (px)': 1500 } });
  });

  it('spec.export.chart: reverses labels, aggregation, title, sort, dates and conditional formatting', async () => {
    const f = fake(); const chart = await add(f, 'chart_add', { type: 'column', dimensions: ['category'], labels: { category: 'Segment' }, metrics: [{ field: 'value', aggregation: 'sum' }], title: 'By segment', date_range: 'Last 28 days', conditional_formats: [{ rules: [[{ field: 'value', condition: 'lt', value: '10' }]], background_color: '#FF0000' }] });
    const { spec } = await f.exportSpec(); const item = spec.pages[0].components[0];
    expect(item).toMatchObject({ component: 'chart', type: 'column', dimensions: ['category'], labels: { category: 'Segment' }, metrics: [{ field: 'value', aggregation: 'sum' }], title: 'By segment', date_range: 'Last 28 days' });
    expect(item).not.toHaveProperty('sort_by'); expect(item).not.toHaveProperty('data_source');
    expect(item.conditional_formats[0]).toMatchObject({ rules: [[{ field: 'value', condition: 'lt', value: '10' }]], background_color: '#FF0000' });
    p(chart).sort = [{ sortColumn: chart.conceptDefs[0].name, sortDir: 0 }];
    expect((await f.exportSpec()).spec.pages[0].components[0]).toMatchObject({ sort_by: 'Segment', sort_ascending: true });
  });

  it('spec.export.control: exports dropdown fields and button destinations/actions using the current tool vocabulary', async () => {
    const f = fake(); await f.add('page_add', { name: 'Details' });
    await add(f, 'control_add', { kind: 'drop_down', field: 'category' });
    await add(f, 'control_add', { kind: 'button', button: { action: 'link', page: 'Details', new_tab: false } });
    await add(f, 'control_add', { kind: 'button', button: { action: 'report_action', report_action: 'Reset filters' } });
    const output = (await f.exportSpec()).spec.pages[0].components;
    expect(output[0]).toMatchObject({ component: 'control', kind: 'drop_down', field: 'category' });
    expect(output[1].button).toEqual({ action: 'link', page: 'Details', new_tab: false });
    expect(output[2].button).toEqual({ action: 'report_action', report_action: 'Reset filters' });
  });

  it('spec.export.control: retains a parameter key and all dimension-control choices', async () => {
    const f = fake(); await f.add('parameter_add', { name: 'Target', id: 'target', data_type: 'Number (whole)', default_value: 100 });
    await add(f, 'control_add', { kind: 'drop_down', field: 'target' });
    await add(f, 'control_add', { kind: 'dimension_control', fields: { Dimension: ['category', 'day'] } });
    const items = (await f.exportSpec()).spec.pages[0].components;
    expect(items[0]).toMatchObject({ kind: 'drop_down', field: 'target' });
    expect(items[1].fields).toEqual({ Dimension: ['category', 'day'] });
  });

  it('spec.export.control: preserves an invite button definition without calling a sharing endpoint', async () => {
    const f = fake(); await add(f, 'control_add', { kind: 'button', button: { action: 'report_action', report_action: 'Invite people' } });
    const { spec } = await f.exportSpec();
    expect(spec.pages[0].components[0]).toMatchObject({ component: 'control', button: { action: 'report_action', report_action: 'Invite people' } });
    expect(f.calls.some((call) => /sharing|grantConsent/i.test(call.endpoint))).toBe(false);
  });

  it('spec.export.text: decodes whole-text formatting and blank lines', async () => {
    const f = fake(); await add(f, 'text_add', { text: 'Sales', font_size: 28, color: '#1A237E', bold: true, italic: true, align: 'center', background: '#E8EAF6' });
    expect((await f.exportSpec()).spec.pages[0].components[0]).toMatchObject({ component: 'text', text: 'Sales', font_size: 28, color: '#1A237E', bold: true, italic: true, align: 'center', background: '#E8EAF6' });
    p(components(f)[0]!).descriptionProperty.text = '<div>a</div><div><br></div><div>b</div>';
    const item = (await f.exportSpec()).spec.pages[0].components[0]; expect(item.text).toBe('a\n\nb'); expect(item).not.toHaveProperty('bold');
  });

  it('spec.export.shape: recognizes current shapes and legacy rectangles', async () => {
    const f = fake(); await add(f, 'shape_add', { shape: 'star', background: '#3B5998' });
    const legacy = { ...template('generic-shape'), type: 'shape', propertyConfig: { componentProperty: { shapeProperty: { backgroundAndBorderProperty: { border: { radius: 10 } } } } } };
    components(f).push(legacy);
    const items = (await f.exportSpec()).spec.pages[0].components;
    expect(items[0]).toMatchObject({ shape: 'star', background: '#3B5998' }); expect(items[1]).toMatchObject({ shape: 'rectangle', border_radius: 10 });
  });

  it('spec.export.image: uses data URIs for small uploads, preserves URL images, and notes oversized uploads', async () => {
    const f = fake(); const image = await add(f, 'image_add', { image: 'data:image/png;base64,AAEC', alt_text: 'Logo' });
    expect((await f.exportSpec()).spec.pages[0].components[0]).toMatchObject({ image: 'data:image/png;base64,AAEC', alt_text: 'Logo' });
    p(image).imageProperty.file.name = 'https://ex.com/a.png'; f.clear(); expect((await f.exportSpec()).spec.pages[0].components[0].image).toBe('https://ex.com/a.png'); expect(f.sent('getImageV2')).toHaveLength(0);
    p(image).imageProperty.file.name = 'large.png'; f.images.set(p(image).imageProperty.file.id, Buffer.alloc(700 * 1024).toString('base64'));
    const { spec, text } = await f.exportSpec(); expect(spec.pages[0].components[0]).toMatchObject({ component: 'other', panel: expect.stringContaining('KB') }); expect(text).toContain('path');
  });

  it('spec.export.line: keeps endpoints and markers and omits the redundant position', async () => {
    const f = fake(); await add(f, 'line_add', { from: { x: 67, y: 330 }, to: { x: 444, y: 330 }, color: '#FF8F00', border_style: 'Dashed', end: 'Pointer' });
    const item = (await f.exportSpec()).spec.pages[0].components[0];
    expect(item).toMatchObject({ component: 'line', from: { x: 67, y: 330 }, to: { x: 444, y: 330 }, color: '#FF8F00', border_style: 'Dashed', end: 'Pointer' }); expect(item).not.toHaveProperty('position');
  });

  it('spec.export.embed: exports a usable URL and marks an empty embed as other', async () => {
    const f = fake(); const embed = await add(f, 'embed_add', { url: 'https://example.com/x' });
    expect((await f.exportSpec()).spec.pages[0].components[0]).toMatchObject({ component: 'embed', url: 'https://example.com/x' });
    p(embed).framedExternalContentProperty.contentUrl = ''; expect((await f.exportSpec()).spec.pages[0].components[0]).toMatchObject({ component: 'other', panel: 'URL embed (no URL)' });
  });

  it('spec.export.other: uses community metadata and its dedicated tool while retaining unsupported components as notes', async () => {
    const f = fake(); await add(f, 'community_viz_add', { name: 'Gauge', metrics: [{ field: 'value' }] });
    components(f).push({ componentId: 'cd-unknown', type: 'some-new-viz', attributeConfig: { componentAttribute: { left: 1, top: 1, width: 20, height: 20 } } });
    const { spec, text } = await f.exportSpec();
    expect(spec.pages[0].components[0]).toMatchObject({ component: 'community', name: 'Gauge', metrics: [{ field: 'value', aggregation: 'sum' }] });
    expect(spec.pages[0].components[1]).toMatchObject({ component: 'other', panel: 'some-new-viz' }); expect(text).toContain('1 other component');
  });

  it('spec.export.other: reports a chart-only calculation that chart_add cannot recreate', async () => {
    const f = fake(); const chart = await add(f, 'chart_add', { type: 'scorecard', metrics: [{ field: 'value' }] });
    chart.conceptDefs[0].queryTimeTransformation.dataTransformation = { sourceType: 1, sourceFieldName: 'qt_expression', textFormula: 'SUM(t0._value_)*2' };
    const { spec, text } = await f.exportSpec(); expect(spec.pages[0].components[0].component).toBe('other'); expect(text).toContain('chart calculation');
  });

  it('spec.roundtrip: explicitly reports unsupported connectors, color scales, range parameters and custom bins', async () => {
    const f = fake(); const chart = await add(f, 'chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }] });
    f.original.page[0]!.chartCondition = [{ chartId: chart.componentId, conditionalFormat: { rule: [{ format: { scale: {} } }] } }];
    f.sources[SOURCE]!.block.blocks[0].connectorBlockConfig.connectorConfig.datasourceType = 999;
    const { text } = await f.exportSpec(); expect(text).toContain('지원하지 않는 커넥터'); expect(text).toContain('color scale');
  });

  it('spec.export.fields: qualifies fields with multiple sources and explicitly omits unsupported value ranges and custom bins', async () => {
    const f = fake(); await f.add('datasource_add', { project_id: 'example-project', sql: 'SELECT 1 AS value', source_name: 'One' });
    const source = f.sources[SOURCE]!.block;
    source.datasourceBlock.fields.push({ ...column('calc_x', 'Doubled', 33), textFormula: 'value*2' }, { ...column('calc_custom', 'Custom bands', 33), bucketedFieldConfig: { sourceField: '_value_', customBinConfig: { binBreakpoints: [0, 2, 7] } } });
    source.resource = { parameterConfiguration: { parameters: [{ key: 'limited', value: { parametersModifiedByRoles: [{ key: 1, value: { name: 'limited', dataType: 4, validation: { rangeMin: 0 }, options: [], defaultValue: [] } }] } }] } };
    const { spec, text } = await f.exportSpec(); expect(spec.calculated_fields).toEqual([{ data_source: 'Metrics', name: 'Doubled', formula: 'value*2', type: 'Number', aggregation: 'sum' }]);
    expect(spec.parameters).toEqual([]); expect(spec.bin_fields).toEqual([]); expect(text).toContain('limited'); expect(text).toContain('Custom bands');
  });
});
