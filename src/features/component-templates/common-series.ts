import { LookerError } from '../../core/errors.js';
import { roleBinding, type CommonFamilyDefinition, type FamilyChartPlan, type FamilyPlanInput } from './common-contract.js';

export const seriesDefinitions: CommonFamilyDefinition[] = [
  {
    template_id: 'common-area-trend', family: 'area-trend', name: '공통 영역 추이',
    purpose: '날짜별 지표를 영역으로 표시하며 계열별 누적·100% 비중을 선택합니다.',
    required: ['date', 'metric'], optional: ['breakdown'], options: ['stack'],
    role_kinds: { date: 'date', metric: 'metric', breakdown: 'dimension' },
  },
  {
    template_id: 'common-category-line', family: 'category-line', name: '공통 범주축 선',
    purpose: '범주별 지표를 선으로 연결합니다. 시간 전용 축과 구분합니다.',
    required: ['dimension', 'metric'], optional: ['date', 'breakdown'], options: ['show_values', 'dimension_order'],
    role_kinds: { dimension: 'dimension', metric: 'metric', date: 'date', breakdown: 'dimension' },
  },
  {
    template_id: 'common-mixed-series', family: 'mixed-series', name: '공통 복합 계열',
    purpose: '같은 범주의 첫 지표는 막대, 둘째 지표는 선으로 표시하며 보조축을 명시적으로 선택합니다.',
    required: ['dimension', 'metric', 'secondary_metric'], optional: ['date'], options: ['secondary_axis'],
    role_kinds: { dimension: 'dimension', metric: 'metric', secondary_metric: 'metric', date: 'date' },
  },
];

function invalid(message: string): never { throw new LookerError('invalid', message); }
function required(input: FamilyPlanInput, role: string) {
  const binding = roleBinding(input, role);
  if (!binding?.field.trim()) invalid(`Role "${role}" needs a field.`);
  return binding;
}

/** Map common roles to existing chart_add kinds. Native fields, aggregation
 * validation, date handling and series persistence remain owned by chart_add. */
export function planSeries(input: FamilyPlanInput): FamilyChartPlan | undefined {
  const definition = seriesDefinitions.find(d => d.template_id === input.template_id);
  if (!definition) return undefined;
  for (const key of Object.keys(input.options)) {
    if (!definition.options.includes(key)) invalid(`Option "${key}" does not apply to ${input.template_id}.`);
  }
  const metric = required(input, 'metric');
  const breakdown = roleBinding(input, 'breakdown')?.field;
  if (input.template_id === 'common-area-trend') {
    const stack = input.options.stack ?? 'none';
    if (!['none', 'absolute', 'percent'].includes(String(stack))) invalid('stack must be none, absolute or percent.');
    if (stack !== 'none' && !breakdown) invalid('Stacked areas need a breakdown role; one undivided metric has no separate series to stack.');
    return {
      type: stack === 'percent' ? 'stacked_100_area' : stack === 'absolute' ? 'stacked_area' : 'area',
      dimensions: [required(input, 'date').field], metrics: [{ ...metric }],
      ...(breakdown ? { breakdown } : {}),
      notes: stack === 'percent'
        ? ['100% 영역의 분모는 각 날짜에서 현재 필터를 적용한 계열 값의 합계입니다. 전체 기간 합계 대비 비중과 다릅니다.']
        : [],
    };
  }
  if (input.template_id === 'common-category-line') {
    const dimension = required(input, 'dimension').field;
    const order = input.options.dimension_order;
    if (order !== undefined && order !== 'ascending' && order !== 'descending') invalid('dimension_order must be ascending or descending.');
    return {
      type: 'line', dimensions: [dimension], metrics: [{ ...metric }],
      ...(order === undefined ? {} : { sort: { field: dimension, ascending: order === 'ascending' } }),
      ...(breakdown ? { breakdown } : {}),
      notes: ['범주의 표시 순서에 따라 선의 의미가 달라집니다. 시간 전용 축이 아니므로 범주 순서를 확인하세요.', '날짜를 범주로 연결하면 날짜 사이 간격이 달라도 같은 간격으로 표시될 수 있습니다. 시간 간격이 중요한 분석에는 시간 전용 추이를 사용하세요.'],
    };
  }
  const secondary = required(input, 'secondary_metric');
  const secondaryAxis = input.options.secondary_axis ?? false;
  if (typeof secondaryAxis !== 'boolean') invalid('secondary_axis must be true or false.');
  const metricName = metric.label?.trim() ? metric.label : metric.field;
  const secondaryName = secondary.label?.trim() ? secondary.label : secondary.field;
  if (metricName.toLowerCase() === secondaryName.toLowerCase()) {
    invalid('The two mixed-series metrics need distinct display names. Give a different label to each metric.');
  }
  return {
    // Explicit labels make series lookup stable even when a binding uses a field ID.
    type: 'combo', dimensions: [required(input, 'dimension').field], metrics: [{ ...metric, label: metricName }, { ...secondary, label: secondaryName }],
    series: [
      { metric: metricName, type: 'bars', axis: 'left' },
      { metric: secondaryName, type: 'line', axis: secondaryAxis ? 'right' : 'left' },
    ],
    style: { 'Show axis labels#3': secondaryAxis, 'Show axis title#3': false, 'Show axis line#3': false },
    notes: [secondaryAxis
      ? '첫 지표는 왼쪽 축, 둘째 지표는 오른쪽 축입니다. 서로 다른 축의 높이를 같은 수치로 비교하지 마세요.'
      : '두 지표는 같은 왼쪽 축을 사용합니다. 단위나 크기가 다른 지표라면 secondary_axis를 명시적으로 선택하세요.'],
  };
}
