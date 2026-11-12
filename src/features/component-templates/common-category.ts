import { LookerError } from '../../core/errors.js';
import { roleBinding, type CommonFamilyDefinition, type FamilyChartPlan, type FamilyPlanInput } from './common-contract.js';

export const categoryDefinitions: CommonFamilyDefinition[] = [
  {
    template_id: 'common-category-bars', family: 'category-bars', name: '공통 범주별 막대',
    purpose: '범주별 지표를 가로·세로 막대로 비교하고, 계열이 있으면 일반 누적 또는 범주별 100% 누적으로 표시',
    required: ['dimension', 'metric'], optional: ['date', 'breakdown'], options: ['orientation', 'stack', 'show_values'],
    role_kinds: { dimension: 'dimension', metric: 'metric', date: 'date', breakdown: 'dimension' },
  },
  {
    template_id: 'common-radial-share', family: 'radial-share', name: '공통 원형·도넛',
    purpose: '필터를 적용한 범주별 지표의 구성 비중을 원형 또는 도넛 조각으로 표시',
    required: ['dimension', 'metric'], optional: ['date'], options: ['donut'],
    role_kinds: { dimension: 'dimension', metric: 'metric', date: 'date' },
  },
];

/** Build only public chart_add arguments. Data validation, native stack flags,
 * source formats and filtering remain on the existing chart creation path. */
export function planCategory(input: FamilyPlanInput): FamilyChartPlan | undefined {
  const def = categoryDefinitions.find(entry => entry.template_id === input.template_id);
  if (!def) return undefined;
  const invalid = (message: string): never => { throw new LookerError('invalid', message); };
  for (const key of Object.keys(input.options)) {
    if (!def.options.includes(key)) invalid(`Option "${key}" does not apply to ${def.template_id}.`);
  }
  for (const key of Object.keys(input.bindings)) {
    if (![...def.required, ...def.optional].includes(key)) invalid(`Unknown role "${key}" for ${def.template_id}.`);
    const bound = roleBinding(input, key)!;
    if (!bound.field.trim()) invalid(`Role "${key}" needs a nonempty field.`);
    if (def.role_kinds[key] !== 'metric' && (bound.aggregation !== undefined || bound.label !== undefined)) {
      invalid(`Role "${key}" accepts a field only; aggregation and label belong to metric.`);
    }
  }
  for (const key of def.required) if (!roleBinding(input, key)) invalid(`Missing required role "${key}".`);
  const dimension = roleBinding(input, 'dimension')!.field;
  const metric = { ...roleBinding(input, 'metric')! };
  if (def.family === 'radial-share') {
    if (input.options.donut !== undefined && typeof input.options.donut !== 'boolean') invalid('donut must be true or false.');
    return {
      type: input.options.donut === true ? 'donut' : 'pie', dimensions: [dimension], metrics: [metric],
      notes: ['원형·도넛 조각의 비중은 현재 필터가 적용된 범주별 지표를 기준으로 합니다. 원래 지표의 집계·단위를 변경하거나 percent_of_total 계산을 덧붙이지 않습니다.'],
    };
  }
  const orientation = input.options.orientation ?? 'vertical', stack = input.options.stack ?? 'none';
  if (!['vertical', 'horizontal'].includes(orientation as string)) invalid('orientation must be vertical or horizontal.');
  if (!['none', 'absolute', 'percent'].includes(stack as string)) invalid('stack must be none, absolute or percent.');
  const breakdown = roleBinding(input, 'breakdown')?.field;
  if (stack !== 'none' && !breakdown) invalid('Stacked common bars need a breakdown role. Bind the categories to stack within each primary category.');
  const kind = orientation === 'horizontal' ? 'bar' : 'column';
  return {
    type: stack === 'percent' ? `stacked_100_${kind}` : stack === 'absolute' ? `stacked_${kind}` : kind,
    dimensions: [dimension], metrics: [metric], ...(breakdown ? { breakdown } : {}),
    notes: stack === 'percent'
      ? ['100% 누적의 분모는 각 기본 범주 안의 계열 합계입니다. 보고서 전체 합계 대비 비중과 다르며, 원래 지표의 집계·필터는 유지합니다.']
      : stack === 'absolute'
        ? ['일반 누적은 각 기본 범주 안에서 계열 값을 원래 단위 그대로 더해 표시합니다.']
        : [],
  };
}
