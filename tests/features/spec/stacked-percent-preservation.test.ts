import { describe, expect, it } from 'vitest';

import { resultText } from '../../../src/core/tool.js';
import { CREATED, fake, type Json } from './fake.js';

describe('native percentage stacks survive specification recreation', () => {
  it('preserves a 100% stack whose preset still names ordinary stacking', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'stacked_column', dimensions: ['day'], metrics: [{ field: 'value' }], breakdown: 'category' });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const property = original.propertyConfig.componentProperty.barChartProperty;
    property.show100Stack = true;
    delete property.orientation;
    delete property.showStack;
    const before = structuredClone(original);
    const exported = await f.exportSpec({ style: 'all' });
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty.barChartProperty;
    expect(restored.show100Stack).toBe(true);
    expect(exported.spec.pages[0].components[0].type).toBe('stacked_100_column');
    expect(original).toEqual(before);
  });
  it.each([
    ['stacked_bar', 'barChartProperty', undefined, 'stacked_100_bar'],
    ['stacked_column', 'barChartProperty', 1, 'stacked_100_bar'],
    ['stacked_bar', 'barChartProperty', 0, 'stacked_100_column'],
    ['stacked_area', 'areaChartProperty', undefined, 'stacked_100_area'],
  ] as const)('uses the active percentage mode and orientation of %s', async (type, key, orientation, expected) => {
    const f = fake();
    const added = await f.add('chart_add', { type, dimensions: ['day'], metrics: [{ field: 'value' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const original = f.original.page[0]!.page.componentConfig![0] as Json;
    const property = original.propertyConfig.componentProperty[key];
    property.show100Stack = true;
    if (orientation === undefined) delete property.orientation; else property.orientation = orientation;
    const exported = await f.exportSpec({ style: 'none' });
    expect(exported.spec.pages[0].components[0].type).toBe(expected);
    const applied = await f.run('report_spec_apply', { spec: exported.spec });
    expect(applied.isError, resultText(applied)).not.toBe(true);
    const restored = (f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).propertyConfig.componentProperty[key];
    expect(restored.show100Stack).toBe(true);
    expect(restored.showStack).toBe(true);
    if (key === 'barChartProperty') expect(restored.orientation).toBe(expected === 'stacked_100_bar' ? 1 : 0);
  });

  it.each(['column', 'stacked_column', 'bar', 'stacked_bar', 'area', 'stacked_area'])('does not change %s without an active percentage toggle', async type => {
    const f = fake();
    const added = await f.add('chart_add', { type, dimensions: ['day'], metrics: [{ field: 'value' }] });
    expect(added.isError, resultText(added)).not.toBe(true);
    const exported = await f.exportSpec({ style: 'all' });
    expect(exported.spec.pages[0].components[0].type).toBe(type);
  });

});
