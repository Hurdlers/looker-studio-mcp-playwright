import { describe, expect, it } from 'vitest';

import { ReportSession } from '../../../src/core/session.js';
import { looker, prop, report, type Json } from './fake.js';

describe('control save safety', () => {
  it('control.placement: retrying a page version conflict inserts only one unique component', async () => {
    const f = looker(report(), { conflictPage: true });
    await f.add({ kind: 'button' });
    expect(f.saves('updatePage')).toHaveLength(2);
    expect(f.components()).toHaveLength(1);
    expect(f.components()[0]!.componentId).toMatch(/^cd-[a-f0-9]{10}$/);
    expect(f.doc.page[0]!.chartCondition).toEqual([{ chartId: 'cd-existing', rule: 'kept' }]);
    expect(f.doc.chartCondition).toEqual([{ chartId: 'cd-report', rule: 'kept' }]);
  });
  it('control.filters: a failed page write rolls back the newly saved filter and preserves the original', async () => {
    const doc = report();
    (doc.report.resource as Json).filter = { entry: [{ key: 'old', value: { name: 'old', datasourceId: 'unrelated-source' } }] };
    const before = structuredClone(doc.report);
    const f = looker(doc, { failPage: true });
    await expect(f.add({ kind: 'drop_down', field: 'device', filters: [{ name: 'new', field: 'device', condition: 'equals', values: ['mobile'] }] })).rejects.toThrow('sample page failure');
    expect(doc.report).toEqual(before);
    expect(f.components()).toEqual([]);
    expect(f.saves().map((c) => c.endpoint)).toEqual(['updateReport', 'updatePage', 'updateReport']);
  });
  it('control.filters: invalid later style leaves no partial filter or component', async () => {
    const f = looker();
    await expect(f.add({ kind: 'drop_down', field: 'device', filters: [{ name: 'new', field: 'device', condition: 'equals', values: ['mobile'] }], style: { 'Label position': 'Diagonal' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.doc.report.resource).not.toHaveProperty('filter');
    expect(f.components()).toEqual([]);
    expect(f.saves()).toEqual([]);
  });
  it('control.placement: dry_run plans report+page writes while preserving all live state', async () => {
    const f = looker(report(), { dryRun: true });
    const before = structuredClone(f.doc);
    const out = await f.add({ kind: 'preset_filter', field: 'flag', filters: [{ name: 'new', field: 'device', condition: 'equals', values: ['mobile'] }] });
    expect(out).toContain('Would add preset_filter');
    expect(out).toContain('updateReport, updatePage');
    expect(f.saves()).toEqual([]);
    expect(f.doc).toEqual(before);
  });
  it('control.placement: the session creates an undo revision before first write', async () => {
    const f = looker();
    f.ctx.session = new ReportSession(f.rap);
    const out = await f.add({ kind: 'button' });
    expect(f.saves().map((c) => c.endpoint)).toEqual(['createNamedRevision', 'updatePage']);
    expect(out).toContain('restore revision 31');
  });
  it('control.fields: field-list errors are specific and an empty required slot cannot be saved', async () => {
    const f = looker();
    await expect(f.add({ kind: 'dimension_control', fields: { Nope: ['device'] } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Dimension') });
    await expect(f.add({ kind: 'checkbox', field: 'flag', fields: { 'Control field': ['device'] } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('Boolean') });
    await expect(f.add({ kind: 'dimension_control', fields: { Dimension: Array(21).fill('device') } })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('20') });
    expect(f.saves()).toEqual([]);
  });
  it('control.kind.button: empty filters are harmless without a source and style changes no other components', async () => {
    const doc = report(); doc.report.resource!.datasourceAlias = [];
    const f = looker(doc);
    await f.add({ kind: 'button', filters: [], style: { Text: 'Go', 'Font size': 18 } });
    expect(prop(f.components()[0]!).buttonProperty).toMatchObject({ text: 'Go', fontSize: 18 });
    expect(f.calls.filter((c) => ['getBlockDatasource', 'getDatasourceList'].includes(c.endpoint))).toEqual([]);
  });
  it('control.style: slider and text panel labels map to saved control property names', async () => {
    const f = looker();
    await f.add({ kind: 'slider', field: 'n', style: { 'Slider mode': 'Locked min', 'Min value': 2, 'Max value': 50, 'Show text boxes': false, 'Step size': 2, 'Show tick marks': true, 'Tick interval': 4, 'Button text size': 18, 'List text size': 12, 'Check box border color': '#123456' } });
    expect(prop(f.components()[0]!).dimensionFilterProperty).toMatchObject({ sliderMode: 2, sliderMinValue: 2, sliderMaxValue: 50, sliderShowTextBoxes: false, sliderStepSize: 2, sliderShowTicks: true, sliderTickSize: 4, labelFontSize: 18, itemFontSize: 12, checkboxBorderColor: { color: '#123456', opacity: 1 } });
  });
});
