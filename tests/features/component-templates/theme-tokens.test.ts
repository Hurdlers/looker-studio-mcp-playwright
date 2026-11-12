import { describe, expect, it } from 'vitest';
import { compositionTheme, contrastRatio } from '../../../src/features/component-templates/theme-tokens.js';
import { toMapValue } from '../../../src/core/mapvalue.js';
import { fake, type Json } from '../spec/fake.js';

function themed(values: Record<string, string>) {
  const doc = fake().original;
  doc.report.propertyConfig = { reportProperty: { themeConfig: 'test-theme' } };
  (doc.report.resource as Json).theme = { value: [toMapValue({ id: 'test-theme', content: values })] };
  return compositionTheme(doc);
}

describe('secondary text color', () => {
  it('keeps a readable theme header color', () => {
    expect(themed({ themeBackground: '#FFFFFF', themeFontColor: '#202C36', themeComponentHeaderColor: '#616161' }).muted).toBe('#616161');
  });
  it('softens the theme text when the header color is unreadable on a dark surface', () => {
    const theme = themed({ themeBackground: '#22262E', themeFontColor: '#E9EDF3', themeComponentHeaderColor: '#616161' });
    expect(theme.muted).not.toBe('#616161');
    expect(theme.muted).not.toBe(theme.text);
    expect(contrastRatio(theme.muted, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#616161', '#22262E')).toBeLessThan(3);
  });
});
