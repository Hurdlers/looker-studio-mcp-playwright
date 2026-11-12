import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, ORIGINAL, properties as p, SOURCE, specification, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());
const box = { left: 20, top: 20, width: 300, height: 40 };

describe('apply a report specification', () => {
  it('spec.apply.create: creates from the first named source and renames the default first page', async () => {
    const f = fake(); const spec = { ...specification(), name: 'Spec A', pages: [{ name: 'Main', components: [{ component: 'text', text: 'SPEC-OK', position: box }] }] };
    const body = resultText(await f.run('report_spec_apply', { spec }));
    expect(body).toContain(CREATED); expect(f.sent('createTempReport')[0]!.body.reportTitle).toBe('Spec A');
    expect(f.reports[CREATED]!.navigationInfo!.navItems![0]!.page!.displayName).toBe('Main');
    expect(f.reports[CREATED]!.page[0]!.page.componentConfig).toHaveLength(1);
    expect(f.audit.map((entry) => entry.tool)).toEqual(['report_spec_apply']);
    expect(f.audit[0]!.detail).toBe('spec "Spec A", 1 pages');
  });

  it('spec.apply.create: honors an override name and rejects unsupported versions before Rap', async () => {
    const f = fake(); await f.run('report_spec_apply', { spec: specification(), name: ' Copy B ' });
    expect(f.sent('createTempReport')[0]!.body.reportTitle).toBe('Copy B');
    f.clear(); await expect(f.run('report_spec_apply', { spec: { ...specification(), version: 2 } })).rejects.toMatchObject({ code: 'invalid' }); expect(f.calls).toEqual([]);
  });

  it('spec.apply.create: dry-run lists source/page actions and sends no writes', async () => {
    const f = fake({ dryRun: true }); const body = resultText(await f.run('report_spec_apply', { spec: specification() }));
    expect(body).toContain('report_create'); expect(body).toContain('datasource_add'); expect(body).toContain('page_rename'); expect(f.writes()).toEqual([]);
    expect(f.reports[CREATED]).toBeUndefined();
  });

  it('spec.apply.spec_file: rejects missing/both inputs and unreadable or invalid JSON without Rap', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spec-invalid-'));
    try {
      const path = join(folder, 'bad.json'); await writeFile(path, '{');
      for (const args of [{}, { spec: specification(), spec_path: path }, { spec_path: path }, { spec_path: `${path}.missing` }]) {
        const f = fake(); await expect(f.run('report_spec_apply', args)).rejects.toMatchObject({ code: 'invalid' }); expect(f.calls).toEqual([]);
      }
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('spec.apply.spec_file: resolves relative image files from the spec folder and preserves HTTP for the image tool to reject', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spec-relative-'));
    try {
      await writeFile(join(folder, 'logo.png'), Buffer.from([0, 1, 2]));
      const path = join(folder, 's.json'); await writeFile(path, JSON.stringify({ ...specification(), pages: [{ name: 'Overview', components: [{ component: 'image', image: 'logo.png', alt_text: 'Logo' }] }] }));
      const f = fake(); await f.run('report_spec_apply', { spec_path: path });
      expect(f.sent('uploadImage')[0]!.body).toMatchObject({ filename: 'logo.png', payload: 'AAEC' });
      const bad = fake(); await expect(bad.run('report_spec_apply', { spec: { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'image', image: 'http://ex.com/a.png' }] }] } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('https') }); expect(bad.writes()).toEqual([]);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('spec.apply.update: adds only missing pages/components, preserves the name/theme, and is repeatable', async () => {
    const f = fake(); await f.add('text_add', { text: 'Keep', position: box });
    const id = f.original.page[0]!.page.componentConfig![0]!.componentId;
    const spec = { ...specification(), theme: { preset: 'Constellation' }, pages: [{ name: 'Overview', components: [{ component: 'text', text: 'Keep', position: box }] }, { name: 'Details', components: [{ component: 'text', text: 'New', position: box }] }] };
    f.clear(); const result = resultText(await f.run('report_spec_apply', { report_id: ORIGINAL, name: 'Ignored', spec }));
    expect(result).toContain('name was not changed'); expect(f.original.shareable.name).toBe('Lab A');
    expect(f.original.page[0]!.page.componentConfig![0]!.componentId).toBe(id);
    expect(f.sent('updateReport').some((call) => call.body.reportName !== undefined)).toBe(false);
    f.clear(); expect(resultText(await f.run('report_spec_apply', { report_id: ORIGINAL, spec }))).toContain('Nothing was missing'); expect(f.writes()).toEqual([]);
  });

  it('spec.apply.data_sources: validates a new source and its dependent chart without asking the server for a virtual source', async () => {
    const f = fake(); const result = await f.run('report_spec_apply', { report_id: ORIGINAL, spec: {
      ...specification(), data_sources: [{ name: 'One', project_id: 'example-project', sql: 'SELECT 1 AS value' }],
      pages: [{ name: 'Overview', components: [{ component: 'chart', type: 'scorecard', data_source: 'One', metrics: [{ field: 'value' }] }] }],
    } });
    expect(result.isError, resultText(result)).toBe(false);
    expect(f.original.page[0]!.page.componentConfig).toHaveLength(1);
    expect(f.sent('getBlockDatasource').some((call) => String(call.body.datasourceId).startsWith('dry-run-'))).toBe(false);
  });

  it('spec.apply.validate: collects SQL, chart type and missing text problems before creating anything', async () => {
    const f = fake({ sqlError: true }); const spec = { ...specification(), data_sources: [...specification().data_sources, { project_id: 'example-project', sql: 'SELECT missing_column' }], pages: [{ name: 'Overview', components: [{ component: 'chart', type: 'nope' }, { component: 'text' }] }] };
    let message = ''; try { await f.run('report_spec_apply', { spec }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('datasource_add'); expect(message).toContain('missing_column'); expect(message).toContain('chart_add'); expect(message).toContain('text_add'); expect(message.match(/^\d+\./gm)).toHaveLength(3);
    expect(f.calls).toEqual([]);
  });

  it('spec.apply.validate: requires a fresh source and rejects unknown source references and legacy layout keys', async () => {
    const f = fake();
    await expect(f.run('report_spec_apply', { spec: { ...specification(), data_sources: [] } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('data source') }); expect(f.calls).toEqual([]); expect(f.bqCalls).toEqual([]);
    await expect(f.run('report_spec_apply', { spec: { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'text', text: 'A', data_source: 'ghost' }] }] } })).rejects.toMatchObject({ code: 'invalid' }); expect(f.writes()).toEqual([]);
    await expect(f.run('report_spec_apply', { spec: { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'chart', type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }], layout: { x: 40 } }] }] } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('layout') }); expect(f.writes()).toEqual([]);
  });

  for (const continue_on_error of [false, true])
    it(`spec.apply.continue_on_error: fresh runtime errors preserve previous successes and continuation=${continue_on_error}`, async () => {
      const f = fake(); const spec = { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'text', text: 'A' }, { component: 'chart', type: 'scorecard', metrics: [{ field: 'ghost' }] }, { component: 'text', text: 'B' }] }] };
      const result = await f.run('report_spec_apply', { spec, continue_on_error });
      expect(result.isError).toBe(true); expect(resultText(result)).toContain(continue_on_error ? '3 of 4 actions done' : '2 of 4 actions done');
      expect(f.reports[CREATED]!.page[0]!.page.componentConfig).toHaveLength(continue_on_error ? 2 : 1);
      expect(f.sent('updateRemovedState')).toHaveLength(0); expect(f.sent('restoreRevision')).toHaveLength(0);
    });

  it('spec.apply.pages: uses returned IDs for duplicate names, hides pages after creating a visible sibling, and keeps report components once', async () => {
    const f = fake(); const spec = { ...specification(), pages: [{ name: 'Repeated', hidden: true, components: [{ component: 'text', text: 'A' }] }, { name: 'Repeated', components: [{ component: 'text', text: 'B' }] }], report_components: [{ component: 'text', text: 'Everywhere', position: box }] };
    const result = await f.run('report_spec_apply', { spec }); expect(result.isError).toBe(false);
    const doc = f.reports[CREATED]!;
    expect(doc.page.map((page) => page.page.componentConfig!.length)).toEqual([1, 1]); expect(doc.report.componentConfig).toHaveLength(1);
    expect(doc.navigationInfo!.navItems![0]!.page!.hiddenFromViewer).toBe(true);
  });

  it('spec.apply.component.control: creates forward link destinations before their buttons', async () => {
    const f = fake(); const spec = { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'control', kind: 'button', button: { action: 'link', page: 'Details' } }] }, { name: 'Details' }] };
    const result = await f.run('report_spec_apply', { spec }); expect(result.isError).toBe(false);
    const doc = f.reports[CREATED]!, target = doc.page[1]!.pageId;
    expect(p(doc.page[0]!.page.componentConfig![0]!).buttonProperty.internalLink).toBe(target);
  });

  it('spec.apply.component.other: skips unsupported items and keeps a valid component without an error', async () => {
    const f = fake(); const result = await f.run('report_spec_apply', { spec: { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'other', panel: 'some-new-viz' }, { component: 'text', text: 'A' }] }] } });
    expect(result.isError).toBe(false); expect(resultText(result)).toContain('skipped some-new-viz'); expect(f.reports[CREATED]!.page[0]!.page.componentConfig).toHaveLength(1);
  });

  it('spec.apply.component.chart: selects the dedicated community tool from portable community specs', async () => {
    const f = fake(); const result = await f.run('report_spec_apply', { spec: { ...specification(), pages: [{ name: 'Overview', components: [{ component: 'community', name: 'Gauge', metrics: [{ field: 'value' }] }] }] } });
    expect(result.isError).toBe(false); expect(resultText(result)).toContain('community_viz_add');
    expect(f.reports[CREATED]!.page[0]!.page.componentConfig![0]!.type).toBe('google://devrel/gauge');
  });

  it('spec.roundtrip: recreates exported components, theme, image bytes, page names and report components', async () => {
    const f = fake();
    await f.add('theme_update', { preset: 'Constellation', canvas: { width: 1400, height: 1000 } });
    await f.add('text_add', { text: 'Sales', font_size: 28, bold: true, position: box });
    await f.add('shape_add', { shape: 'rectangle', background: '#E8EAF6', position: { left: 0, top: 0, width: 1200, height: 90 } });
    await f.add('line_add', { from: { x: 100, y: 100 }, to: { x: 400, y: 100 }, end: 'Pointer' });
    await f.add('image_add', { image: 'data:image/png;base64,AAEC', alt_text: 'Logo' });
    await f.add('chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }] });
    await f.add('page_add', { name: 'Details' });
    await f.add('control_add', { page: 'Details', kind: 'drop_down', field: 'category' });
    const first = (await f.exportSpec()).spec;
    const result = await f.run('report_spec_apply', { spec: first }); expect(result.isError).toBe(false);
    const next = (await f.exportSpec({ report_id: CREATED })).spec;
    delete first.name; delete next.name; expect(next).toEqual(first);
  });

  it('spec.roundtrip: keeps parameters, formulas, groups, bins, joins and a shared component in a complete fixture', async () => {
    const f = fake(); const fixture = JSON.parse(await readFile(new URL('../../../fixtures/spec/example.json', import.meta.url), 'utf8'));
    const result = await f.run('report_spec_apply', { spec: fixture }); expect(result.isError, resultText(result)).toBe(false);
    const first = (await f.exportSpec({ report_id: CREATED })).spec;
    expect(first.parameters).toHaveLength(1); expect(first.calculated_fields).toHaveLength(1); expect(first.group_fields).toHaveLength(1); expect(first.bin_fields).toHaveLength(1); expect(first.blends).toHaveLength(1); expect(first.report_components).toHaveLength(1);
    const recreated = await f.run('report_spec_apply', { spec: first }); expect(recreated.isError, resultText(recreated)).toBe(false);
    const next = (await f.exportSpec({ report_id: CREATED })).spec;
    delete first.name; delete next.name; expect(next).toEqual(first);
  });

  it('spec.roundtrip: reexports connector-canonicalized sources without creating duplicate original fields on the next apply', async () => {
    const f = fake({ nativeColumns: true });
    await f.add('calculated_field_add', { name: 'Double', formula: 'value*2', data_source: 'Metrics' });
    const initial = (await f.exportSpec()).spec;
    const applied = await f.run('report_spec_apply', { spec: initial }); expect(applied.isError, resultText(applied)).toBe(false);
    const next = (await f.exportSpec({ report_id: CREATED })).spec;
    expect(next.calculated_fields).toEqual([{ name: 'Double', formula: 'value*2', type: 'Number', aggregation: 'sum' }]);
    const reapplied = await f.run('report_spec_apply', { spec: next }); expect(reapplied.isError, resultText(reapplied)).toBe(false);
  });

  it('spec.roundtrip: regenerates chained calculated-field references using the newly created source IDs', async () => {
    const f = fake({ formulaResponse: (body) => {
      const spec = body.dataRequest.datasetSpec;
      const formula = spec.queryFields[0].dataTransformation.textFormula as string;
      if (formula === 'Twice*2') return 'UNKNOWN';
      const fields = f.sources[spec.dataset[0].datasourceId]?.block.datasourceBlock.fields ?? [];
      return [...formula.matchAll(/\bt0\.(calc_[a-z0-9_]+)/gi)].some((match) => !fields.some((field: Json) => field.field.name === match[1])) ? 'UNKNOWN' : undefined;
    } });
    await f.add('calculated_field_add', { name: 'Twice', formula: 'value*2' });
    await f.add('calculated_field_add', { name: 'Fourfold', formula: 'Twice*2' });
    const before = f.sources[SOURCE]!.block.datasourceBlock.fields.find((field: Json) => field.outputName === 'Twice').field.name;
    const initial = (await f.exportSpec()).spec;
    expect(initial.calculated_fields).toEqual([{ name: 'Twice', formula: 'value*2', type: 'Number', aggregation: 'sum' }, { name: 'Fourfold', formula: 'Twice*2', type: 'Number', aggregation: 'sum' }]);
    const result = await f.run('report_spec_apply', { spec: initial }); expect(result.isError, resultText(result)).toBe(false);
    const sourceId = f.reports[CREATED]!.report.resource!.datasourceAlias![0]!.datasourceId;
    const fields = f.sources[sourceId]!.block.datasourceBlock.fields as Json[];
    const after = fields.find((field) => field.outputName === 'Twice')!.field.name;
    expect(after).not.toBe(before);
    expect(fields.find((field) => field.outputName === 'Fourfold')).toMatchObject({ textFormula: `t0.${after}*2`, frontendTextFormula: `t0.${after}*2` });
    expect((await f.exportSpec({ report_id: CREATED })).spec.calculated_fields).toEqual(initial.calculated_fields);
  });
});
