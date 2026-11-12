import { expect, it } from 'vitest';
import { applyStyle, type StyleLabel } from '../src/core/style.js';

it('removes only opted-in automatic properties without creating missing containers', () => {
  const labels: StyleLabel[] = [
    { label: 'Height', kind: 'number', path: 'chart.height', auto: true },
    { label: 'Font', kind: 'text', path: 'missing.font', auto: true },
  ];
  const component = { propertyConfig: { componentProperty: { chart: { height: 160, keep: 1 } } } };
  applyStyle(component, labels, { Height: 'Auto', Font: 'Auto' });
  expect(component.propertyConfig.componentProperty).toEqual({ chart: { keep: 1 } });
  expect(() => applyStyle(component, [{ label: 'Height', kind: 'number', path: 'chart.height' }], { Height: 'Auto' })).toThrow();
});
