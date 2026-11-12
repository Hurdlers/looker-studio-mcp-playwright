import { LookerError } from '../../core/errors.js';
import { roleBinding, type CommonFamilyDefinition, type FamilyChartPlan, type FamilyPlanInput } from './common-contract.js';

export const advancedDefinitions: CommonFamilyDefinition[] = [
  {
    template_id: 'common-pivot-table', family: 'pivot-table', name: '공통 교차 집계표',
    purpose: '행과 열의 교차점에 지표를 집계하며 선택적으로 열지도로 표현합니다.',
    required: ['row', 'column', 'metric'], optional: ['date'], options: ['heatmap'],
    role_kinds: { row: 'dimension', column: 'dimension', metric: 'metric', date: 'date' },
  },
  {
    template_id: 'common-xy-scatter', family: 'xy-scatter', name: '공통 산점·버블',
    purpose: '분류별 X·Y 지표를 점으로 표시하며 크기 지표가 있으면 버블로 표현합니다.',
    required: ['dimension', 'x_metric', 'y_metric'], optional: ['size_metric', 'date'], options: [],
    role_kinds: { dimension: 'dimension', x_metric: 'metric', y_metric: 'metric', size_metric: 'metric', date: 'date' },
  },
];

/** Only translates role contracts to existing chart_add inputs. The existing
 * chart kinds retain responsibility for source types, aggregation and slots. */
export function planAdvanced(input: FamilyPlanInput): FamilyChartPlan | undefined {
  const def = advancedDefinitions.find(d => d.template_id === input.template_id);
  if (!def) return undefined;
  for (const key of Object.keys(input.options)) {
    if (!def.options.includes(key)) throw new LookerError('invalid', `Option "${key}" does not apply to ${def.template_id}.`);
  }
  for (const key of Object.keys(input.bindings)) {
    if (![...def.required, ...def.optional].includes(key)) throw new LookerError('invalid', `Unknown role "${key}" for ${def.template_id}.`);
    const binding = roleBinding(input, key)!;
    if (!binding.field.trim()) throw new LookerError('invalid', `${key} needs a nonempty field.`);
    if (def.role_kinds[key] !== 'metric' && (binding.aggregation !== undefined || binding.label !== undefined)) {
      throw new LookerError('invalid', `Role "${key}" accepts a field only; aggregation and label belong to metric roles.`);
    }
  }
  for (const key of def.required) if (!roleBinding(input, key)) throw new LookerError('invalid', `Missing required role "${key}".`);

  if (def.family === 'pivot-table') {
    const heatmap = input.options.heatmap;
    if (heatmap !== undefined && typeof heatmap !== 'boolean') throw new LookerError('invalid', 'heatmap must be true or false.');
    return {
      type: heatmap ? 'pivot_heatmap' : 'pivot_table',
      dimensions: [roleBinding(input, 'row')!.field],
      metrics: [{ ...roleBinding(input, 'metric')! }],
      fields: { 'Column dimension': [roleBinding(input, 'column')!.field] },
      notes: ['행과 열의 교차 집계를 유지합니다. 열지도는 집계값의 표현이며 비중으로 계산하지 않습니다.'],
    };
  }

  const size = roleBinding(input, 'size_metric');
  return {
    type: size ? 'bubble' : 'scatter',
    dimensions: [roleBinding(input, 'dimension')!.field],
    // Keep resolved metric objects in positional order. Sending field names
    // through Setup overrides would lose distinct labels/aggregations when
    // multiple roles intentionally use the same source field.
    metrics: [
      { ...roleBinding(input, 'x_metric')! },
      { ...roleBinding(input, 'y_metric')! },
      ...(size ? [{ ...size }] : []),
    ],
    notes: ['X·Y·크기 지표의 집계와 단위는 각각 유지합니다. 크기 역할은 비음수 크기 지표를 선택해야 하며 렌더러가 버블의 표시 크기를 정합니다.'],
  };
}
