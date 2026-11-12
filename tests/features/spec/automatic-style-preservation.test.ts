import { expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { chartProperty } from '../../../src/features/chart-options/common.js';
import { CREATED, fake, type Json } from './fake.js';

it.each([undefined, 0, 1])('preserves automatic layout and transparent grid with opacity %s', async (opacity) => {
  const f = fake();
  const added = await f.add('chart_add', { type: 'combo', dimensions: ['day'], metrics: [{ field: 'value' }], reference_lines: [{ value: 10 }] });
  expect(added.isError, resultText(added)).not.toBe(true);
  const original = f.original.page[0]!.page.componentConfig![0] as Json;
  const p = chartProperty(original);
  delete p.chartDisplayProperty;
  delete p.legendProperty;
  delete p.axisAndGridProperty.axisFontSize;
  p.axisAndGridProperty.gridColor = { color: 'transparent', ...(opacity === undefined ? {} : { opacity }) };
  delete p.referenceLineProperty[0].referenceLineWeight;
  const exported = await f.exportSpec({ style: 'all' });
  expect(exported.spec.pages[0].components[0].style['Chart area height']).toBe('Auto');
  expect(exported.spec.pages[0].components[0].reference_lines[0].weight).toBe('Auto');
  const applied = await f.run('report_spec_apply', { spec: exported.spec });
  expect(applied.isError, resultText(applied)).not.toBe(true);
  const restored = chartProperty(f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json);
  expect(restored.chartDisplayProperty?.chartAreaHeight).toBeUndefined();
  expect(restored.legendProperty?.legendAlignment).toBeUndefined();
  expect(restored.axisAndGridProperty.axisFontSize).toBeUndefined();
  expect(restored.axisAndGridProperty.gridColor).toEqual({ color: 'transparent' });
  expect(restored.referenceLineProperty[0]).not.toHaveProperty('referenceLineWeight');
});

it('keeps the existing reference-line creation default and fractional explicit weight', async () => {
  const f = fake();
  const added = await f.add('chart_add', { type: 'combo', dimensions: ['day'], metrics: [{ field: 'value' }],
    reference_lines: [{ value: 0 }, { value: 10, weight: 0.5 }] });
  expect(added.isError, resultText(added)).not.toBe(true);
  const p = chartProperty(f.original.page[0]!.page.componentConfig![0] as Json);
  expect(p.referenceLineProperty.map((line: Json) => line.referenceLineWeight)).toEqual([2, 0.5]);
});


it('recreates a server-normalized empty automatic row-height array', async () => {
  const f = fake();
  await f.add('chart_add', { type: 'table', dimensions: ['category'], metrics: [{ field: 'value' }] });
  const original = f.original.page[0]!.page.componentConfig![0] as Json;
  chartProperty(original).rowsHeight = [];
  const exported = await f.exportSpec({ style: 'all' });
  expect(exported.spec.pages[0].components[0].style['Row heights']).toBe('Auto');
  const applied = await f.run('report_spec_apply', { spec: exported.spec });
  expect(applied.isError, resultText(applied)).not.toBe(true);
  expect(chartProperty(f.reports[CREATED]!.page[0]!.page.componentConfig![0] as Json).rowsHeight).toBeUndefined();
});


it('preserves transparent theme settings instead of restoring preset grid colors', async () => {
  const f = fake();
  await f.add('theme_update', { preset: 'Default', settings: { 'Grid color': 'transparent', Background: { color: '#123456', opacity: 0 } } });
  const exported = await f.exportSpec({ style: 'all' });
  expect(exported.spec.theme.settings['Grid color']).toBe('transparent');
  expect(exported.spec.theme.settings.Background).toEqual({ color: '#123456', opacity: 0 });
  const applied = await f.run('report_spec_apply', { spec: exported.spec });
  expect(applied.isError, resultText(applied)).not.toBe(true);
  const restored = await f.exportSpec({ report_id: CREATED, style: 'all' });
  expect(restored.spec.theme.settings['Grid color']).toBe('transparent');
  expect(restored.spec.theme.settings.Background).toEqual({ color: '#123456', opacity: 0 });
});
