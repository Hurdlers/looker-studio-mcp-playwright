import { describe, expect, it } from 'vitest';

import { RECORD_COUNT } from '../../../src/core/components.js';
import { fromMapValue } from '../../../src/core/mapvalue.js';
import { looker, prop, report, slot, source, type Json } from './fake.js';

const sorted = (component: Json) => prop(component).sort.map((sort: Json) => ({
  field: source(component.conceptDefs.find((concept: Json) => concept.name === sort.sortColumn)),
  ascending: sort.sortDir === 0,
}));

describe('portable control settings', () => {
  it('keeps dimension and metric display names independently from their source names', async () => {
    for (const kind of ['drop_down', 'fixed_size_list']) {
      const f = looker();
      await f.add({ kind, field: 'device', metric: 'n', labels: { device: 'Device group', _n_: 'Observed count' } });
      const component = f.components()[0]!;
      expect(slot(component)[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('Device group');
      expect(slot(component, 'metrics')[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('Observed count');
      expect(slot(component).map(source)).toEqual(['_device_']);
      expect(slot(component, 'metrics').map(source)).toEqual(['_n_']);
      expect(slot(component, 'metrics')[0]!.queryTimeTransformation.dataTransformation.aggregation).toBe(6);
      if (kind === 'fixed_size_list') {
        const behavior = fromMapValue(component.behavior) as Json;
        expect(behavior.onSelect[0].init.dConcept.queryTimeTransformation.displayTransformation.displayName).toBe('Device group');
      }
      expect(f.saves('updatePage')).toHaveLength(1);
      await f.run('component_update', { component_id: component.componentId, labels: { _device_: 'Updated group' } });
      expect(slot(f.components()[0]!)[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('Updated group');
      if (kind === 'fixed_size_list') {
        const behavior = fromMapValue(f.components()[0]!.behavior) as Json;
        expect(behavior.onSelect[0].init.dConcept.queryTimeTransformation.displayTransformation.displayName).toBe('Updated group');
      }
    }
  });

  it('keeps source-field and Record Count sorts, and replaces the complete list on update', async () => {
    for (const kind of ['drop_down', 'fixed_size_list']) {
      const f = looker();
      await f.add({ kind, field: 'device', metric: 'n', labels: { device: 'Device group' }, sorts: [{ field: 'country', ascending: true }] });
      const component = f.components()[0]!;
      expect(sorted(component)).toEqual([{ field: '_country_', ascending: true }]);
      expect(slot(component, 'metrics').map(source)).toEqual(['_n_']);
      expect(slot(component)[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('Device group');
      await f.run('component_update', { component_id: component.componentId, sorts: [{ field: 'Record Count', ascending: false }] });
      expect(sorted(f.components()[0]!)).toEqual([{ field: RECORD_COUNT, ascending: false }]);
      await f.run('component_update', { component_id: component.componentId, sorts: [{ field: 'device', ascending: false }] });
      expect(sorted(f.components()[0]!)).toEqual([{ field: '_device_', ascending: false }]);
      await f.run('component_update', { component_id: component.componentId, sorts: [] });
      expect(prop(f.components()[0]!).sort).toEqual([]);
    }
  });

  it('keeps the default Record Count concept when sorting a dimension directly', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device', sorts: [{ field: 'device', ascending: false }] });
    const component = f.components()[0]!;
    expect(sorted(component)).toEqual([{ field: '_device_', ascending: false }]);
    expect(slot(component, 'metrics').map(source)).toEqual([RECORD_COUNT]);
    await f.run('component_update', { component_id: component.componentId, sorts: [{ field: 'Record Count', ascending: false }] });
    expect(sorted(f.components()[0]!)).toEqual([{ field: RECORD_COUNT, ascending: false }]);
  });

  it('keeps source-field identity when another field has the same display name', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device', metric: 'n', labels: { device: 'n' }, sorts: [{ field: 'n', ascending: false }] });
    const component = f.components()[0]!;
    expect(sorted(component)).toEqual([{ field: '_n_', ascending: false }]);
    await f.run('component_update', { component_id: component.componentId, labels: { n: 'Count label' } });
    expect(slot(f.components()[0]!)[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('n');
    expect(slot(f.components()[0]!, 'metrics')[0]!.queryTimeTransformation.displayTransformation.displayName).toBe('Count label');
  });

  it('keeps an explicit date dimension for automatic ranges and applies None after a duration', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device', date_range_dimension: 'day' });
    const component = f.components()[0]!;
    const dateConcept = component.conceptDefs.find((concept: Json) => concept.name === prop(component).dateRangeDimension);
    expect(source(dateConcept)).toBe('_day_');
    expect(prop(component)).not.toHaveProperty('dateDuration');
    await f.add({ kind: 'fixed_size_list', field: 'device', date_range: 'Last 7 days', date_range_dimension: 'None' });
    expect(prop(f.components()[1]!)).not.toHaveProperty('dateRangeDimension');
    expect(prop(f.components()[1]!)).not.toHaveProperty('dateDuration');
    const rejected = looker();
    await expect(rejected.add({ kind: 'date_range', date_range_dimension: 'day' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('data source') });
    expect(rejected.calls).toEqual([]);
  });

  it.each([
    { labels: { device: '' } },
    { labels: { device: 'Group', missing: 'Unknown' } },
    { labels: { country: 'Unselected field' } },
    { sorts: [{ field: 'missing', ascending: true }] },
    { sorts: [{ field: 'device', ascending: 'descending' }] },
    { sorts: [{ field: 'device', ascending: true }, { field: 'country', ascending: false }] },
    { sorts: [{ field: 'device', ascending: true }, { field: '_device_', ascending: false }] },
    { sorts: Array.from({ length: 11 }, () => ({ field: 'device', ascending: true })) },
  ])('rejects invalid field settings before any save: %j', async extra => {
    const f = looker();
    await expect(f.add({ kind: 'drop_down', field: 'device', ...extra })).rejects.toMatchObject({ code: 'invalid' });
    expect(f.saves()).toEqual([]);
    expect(f.components()).toEqual([]);
  });

  it('does not change an existing control when a label or sort is invalid', async () => {
    const f = looker();
    await f.add({ kind: 'drop_down', field: 'device', labels: { device: 'Original group' } });
    const before = structuredClone(f.doc), id = f.components()[0]!.componentId;
    f.calls.length = 0;
    for (const settings of [
      { labels: { device: 'Changed group', missing: 'Unknown' } },
      { sorts: [{ field: 'missing', ascending: false }] },
    ]) {
      await expect(f.run('component_update', { component_id: id, ...settings })).rejects.toMatchObject({ code: 'invalid' });
      expect(f.doc).toEqual(before);
      expect(f.saves()).toEqual([]);
    }
  });

  it('previews new labels and sorting without persisting the control', async () => {
    const f = looker(report(), { dryRun: true });
    const before = structuredClone(f.doc);
    const text = await f.add({ kind: 'fixed_size_list', field: 'device', labels: { device: 'Preview group' }, sorts: [{ field: 'country', ascending: true }] });
    expect(text).toContain('Would add');
    expect(f.doc).toEqual(before);
    expect(f.saves()).toEqual([]);
  });

  it.each(['labels', 'sorts'])('refuses %s on other control kinds before reading the report', async key => {
    const f = looker();
    await expect(f.add({ kind: 'input_box', field: 'device', [key]: key === 'labels' ? { device: 'Group' } : [] })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('drop_down') });
    expect(f.calls).toEqual([]);
  });

  it.each(['labels', 'sorts'])('refuses %s on parameter controls without changing their definition', async key => {
    const parameters = [{ key: 'choice', value: { parameterDisplayConfiguration: { displayName: 'Choice' }, parametersModifiedByRoles: [{ key: 2, value: { dataType: 1 } }] } }];
    const f = looker(report(), { parameters });
    const value = key === 'labels' ? { Choice: 'Group' } : [{ field: 'Record Count', ascending: false }];
    await expect(f.add({ kind: 'drop_down', field: 'Choice', [key]: value })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('parameter') });
    expect(f.saves()).toEqual([]);
    await f.add({ kind: 'drop_down', field: 'Choice' });
    const before = structuredClone(f.doc);
    f.calls.length = 0;
    await expect(f.run('component_update', { component_id: f.components()[0]!.componentId, [key]: value })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('parameter') });
    expect(f.saves()).toEqual([]);
    expect(f.doc).toEqual(before);
  });
});
