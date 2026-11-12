import { describe, expect, it } from 'vitest';
import { fake, ORIGINAL } from '../spec/fake.js';
import { resultText } from '../../../src/core/tool.js';
import { commonChartArgs } from '../../../src/features/component-templates/common.js';
import { prepareProjectPresentation } from '../../../src/features/component-templates/presentation.js';

const cases = [
  { template_id: 'common-category-bars', bindings: { dimension: 'category', metric: 'value' } },
  { template_id: 'common-radial-share', bindings: { dimension: 'category', metric: 'value' }, common_options: { donut: true } },
  { template_id: 'common-area-trend', bindings: { date: 'day', metric: 'value', breakdown: 'category' }, common_options: { stack: 'percent' as const } },
  { template_id: 'common-category-line', bindings: { dimension: 'category', metric: 'value' } },
  { template_id: 'common-mixed-series', bindings: { dimension: 'category', metric: { field: 'value', label: 'Total', aggregation: 'sum' as const }, secondary_metric: { field: 'value', label: 'Average', aggregation: 'avg' as const } }, common_options: { secondary_axis: true } },
  { template_id: 'common-pivot-table', bindings: { row: 'category', column: 'day', metric: 'value' }, common_options: { heatmap: true } },
  { template_id: 'common-xy-scatter', bindings: { dimension: 'category', x_metric: { field: 'value', label: 'X' }, y_metric: { field: 'value', label: 'Y' }, size_metric: { field: 'value', label: 'Size' } } },
];
describe('expanded common structures', () => {
  for (const input of cases) it(`creates ${input.template_id} with accepted styles through the public common tool`, async () => {
    const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] common structures';
    const result = JSON.parse(resultText(await f.run('component_template_add', { report_id: ORIGINAL, ...input })));
    expect(result.saved).toBe(true); expect(result.component_count).toBe(1);
    expect(result.creation).not.toMatch(/Not applied|unsupported style/i);
    const before = f.original.page[0]!.page.componentConfig![0]!;
    const after = prepareProjectPresentation(before);
    expect(after.conceptDefs).toEqual(before.conceptDefs);
    const planned = commonChartArgs({ report_id: ORIGINAL, ...input });
    expect(planned.args.type).toBeTruthy();
  });
});
