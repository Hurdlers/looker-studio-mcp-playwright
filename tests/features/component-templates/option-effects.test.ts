import { describe, expect, it } from 'vitest';
import { commonEntries } from '../../../src/features/component-templates/common.js';
import { describeOptionEffects } from '../../../src/features/component-templates/option-effects.js';
import { resultText } from '../../../src/core/tool.js';
import { fake } from '../spec/fake.js';

describe('common option discovery boundaries', () => {
  it('exposes the distinction through public template inspection', async () => {
    const f = fake();
    const result = await f.run('component_template_inspect', { template_id: 'common-detail-table' });
    expect(result.isError).toBeFalsy();
    const metadata = JSON.parse(resultText(result));
    expect(metadata.option_effects.percent_of_total.category).toBe('analysis');
    expect(metadata.option_effects.presentation.category).toBe('presentation');
    expect(metadata.supported_options).toContain('presentation');
    expect(f.writes()).toEqual([]);
  });
  it('describes every exposed option of all ten structures without promoting source semantics', () => {
    const entries = commonEntries();
    expect(entries).toHaveLength(10);
    for (const entry of entries) {
      const effects = describeOptionEffects(entry.supported_options);
      expect(Object.keys(effects)).toEqual(entry.supported_options);
      expect(entry.validation).toBe('supported_pending_review');
      for (const effect of Object.values(effects)) expect(effect.meaning.length).toBeGreaterThan(0);
    }
  });
  it('separates calculation and native kind choices from presentation', () => {
    const options = describeOptionEffects(['percent_of_total', 'stack', 'comparison', 'heatmap', 'donut', 'presentation', 'data_bars']);
    expect(options.percent_of_total?.category).toBe('analysis');
    expect(options.stack?.category).toBe('analysis');
    expect(options.comparison?.category).toBe('analysis');
    expect(options.heatmap?.category).toBe('structure');
    expect(options.donut?.category).toBe('structure');
    expect(options.presentation?.category).toBe('presentation');
    expect(options.data_bars?.category).toBe('presentation');
  });
});
