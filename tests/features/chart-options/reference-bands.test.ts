import { describe, expect, it } from 'vitest';

import { referenceBandsUpdater, referenceLinesUpdater } from '../../../src/features/chart-options/appearance.js';
import { chartProperty } from '../../../src/features/chart-options/common.js';
import { fake, type Json } from '../spec/fake.js';

function component(bands: Json[]) {
  return { type: 'simple-linechart', propertyConfig: { componentProperty: { lineChartProperty: { referenceBandProperty: bands } } } };
}
const placeholder = () => ({ referenceBandAxis: 0, referenceBandShowLabel: true, referenceBandLineWeight: 2,
  referenceBandLineStyle: 0, referenceBandOpacity: 1, referenceBandShowValueInLabel: false });
const read = (bands: Json[]) => referenceBandsUpdater.read!(component(bands), {} as never);

describe('native reference band export', () => {
  it('keeps hexadecimal color spelling stable through native reference line and band roundtrips', async () => {
    const original = component([{ referenceLineNumberValueBandStart: 0, referenceLineNumberValueBandEnd: 10, referenceBandFillColor: { color: '#aBcDeF' } }]);
    const property = chartProperty(original);
    property.referenceLineProperty = [{ referenceLineType: 0, referenceLineNumberValue: 0, referenceLineWeight: 2, referenceLineColor: { color: '#f5d669' } }];
    const before = structuredClone(original);
    const lines = referenceLinesUpdater.read!(original, {} as never) as Json[];
    const bands = referenceBandsUpdater.read!(original, {} as never) as Json[];
    expect(lines[0]!.color).toBe('#F5D669');
    expect(bands[0]!.color).toBe('#ABCDEF');
    const restored = component([]);
    await referenceLinesUpdater.apply({ component: restored } as never, lines, {} as never);
    await referenceBandsUpdater.apply({ component: restored } as never, bands, {} as never);
    expect(referenceLinesUpdater.read!(restored, {} as never)).toEqual(lines);
    expect(referenceBandsUpdater.read!(restored, {} as never)).toEqual(bands);
    expect(original).toEqual(before);
  });
  it('does not turn reserved empty native slots into undefined bounds', () => {
    expect(read(Array.from({ length: 10 }, placeholder))).toEqual([]);
  });

  it('preserves zero and negative numeric bounds and does not change the native definition', () => {
    const bands = [placeholder(), { ...placeholder(), referenceLineTypeBandStart: 0, referenceLineNumberValueBandStart: 0,
      referenceLineTypeBandEnd: 0, referenceLineNumberValueBandEnd: 10, referenceBandLabel: 'Target', referenceBandFillColor: { color: '#112233' } },
    { referenceLineNumberValueBandStart: -10, referenceLineNumberValueBandEnd: 0 }];
    const before = structuredClone(bands);
    expect(read(bands)).toEqual([{ from: 0, to: 10, label: 'Target', color: '#112233' }, { from: -10, to: 0 }]);
    expect(bands).toEqual(before);
  });

  it.each([
    { referenceLineTypeBandStart: 1, referenceLineMetricBandStart: 'metric', referenceLineNumberValueBandEnd: 10 },
    { referenceLineTypeBandEnd: 2, referenceLineParameterBandEnd: 'parameter', referenceLineNumberValueBandStart: 0 },
    { referenceLineTypeBandStart: 1 },
    { referenceLineTypeBandStart: 9 },
    { referenceLineDateValueBandStart: '20260101', referenceLineDateValueBandEnd: '20260131' },
    { referenceLineNumberValueBandStart: 0 },
    { referenceLineNumberValueBandStart: 10, referenceLineNumberValueBandEnd: 0 },
    { referenceLineNumberValueBandStart: 0, referenceLineNumberValueBandEnd: Number.POSITIVE_INFINITY },
  ])('rejects an active unsupported or malformed band so the spec exporter can report loss: %j', (band) => {
    expect(() => read([band])).toThrow(/reference band/i);
  });

  it('exports numeric bands while omitting empty slots, and notes unsupported bindings rather than silently losing them', async () => {
    const f = fake();
    const added = await f.add('chart_add', { type: 'line', dimensions: ['category'], metrics: [{ field: 'value' }] });
    expect(added.isError).not.toBe(true);
    const chart = f.original.page[0]!.page.componentConfig![0] as Json;
    const prop = chartProperty(chart);
    prop.referenceBandProperty = [placeholder(), { referenceLineNumberValueBandStart: 0, referenceLineNumberValueBandEnd: 10 }];
    const numeric = await f.exportSpec({ style: 'all' });
    expect(numeric.spec.pages[0].components[0].reference_bands).toEqual([{ from: 0, to: 10 }]);
    expect((await f.run('report_spec_apply', { spec: numeric.spec })).isError).not.toBe(true);
    prop.referenceBandProperty.push({ referenceLineTypeBandStart: 1, referenceLineMetricBandStart: 'metric' });
    const unsupported = await f.exportSpec({ style: 'all' });
    expect(unsupported.spec.pages[0].components[0]).not.toHaveProperty('reference_bands');
    expect(unsupported.text).toMatch(/reference_bands could not be exported:.*reference band/i);
  });
});
