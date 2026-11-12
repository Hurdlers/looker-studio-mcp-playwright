/** Describes the public structures, not the business meaning of source fields.
 * Native-kind switches are deliberately distinct from style-only choices. */
interface OptionEffect {
  category: 'analysis' | 'structure' | 'presentation';
  meaning: string;
}
const effects: Record<string, OptionEffect> = {
  comparison: { category: 'analysis', meaning: '비교 기간을 선택합니다. KPI는 증감률, 시간 추이는 비교 기간 선, 상세 표는 증감 열로 표시합니다. 날짜와 비교 목적을 먼저 확인합니다.' },
  average_line: { category: 'analysis', meaning: '표시된 날짜별 집계값의 평균 참조선을 추가합니다.' },
  percent_of_total: { category: 'analysis', meaning: '필터를 적용한 차트 합계 대비 비중 열을 추가합니다.' },
  dimension_order: { category: 'analysis', meaning: '범주의 순서를 정합니다. 날짜 범주선은 연속 시간축과 다릅니다.' },
  stack: { category: 'analysis', meaning: '누적 종류를 선택합니다. percent는 각 기본 범주 안의 계열 합계가 분모입니다.' },
  orientation: { category: 'structure', meaning: '가로·세로 막대 종류를 선택합니다. 단순 색 변경과 구분합니다.' },
  donut: { category: 'structure', meaning: '원형·도넛 종류를 선택합니다. 지표와 집계는 유지합니다.' },
  secondary_axis: { category: 'structure', meaning: '둘째 지표를 별도 축에 놓습니다. 서로 다른 축의 높이를 같은 수치로 비교하지 않습니다.' },
  heatmap: { category: 'structure', meaning: '피벗의 native 종류를 열지도로 선택합니다. 상세 표의 비중 열 스타일과 별개입니다.' },
  density: { category: 'presentation', meaning: '글자와 배치의 밀도를 선택합니다.' },
  surface: { category: 'presentation', meaning: '개별 차트의 표면과 테두리를 선택합니다.' },
  visible_rows: { category: 'presentation', meaning: '표의 페이지당 표시 행 수와 필요한 높이를 지정합니다.' },
  show_values: { category: 'presentation', meaning: '값 라벨과 점 표시를 선택합니다. 실제 밀도에서 가독성을 확인합니다.' },
  emphasis: { category: 'presentation', meaning: '명시한 지표의 숫자 크기를 구분합니다. 중요도를 새로 판단하지 않습니다.' },
  data_bars: { category: 'presentation', meaning: '기존 지표 열을 숫자가 보이는 막대로 표현합니다.' },
  decimal_precision: { category: 'presentation', meaning: '숫자의 표시 소수 자릿수를 정합니다. 원래 값을 계산하거나 변환하지 않습니다.' },
  progress: { category: 'presentation', meaning: '비교 기간 값 대비 현재 값을 KPI 아래 막대로 표시합니다. 비교 기간이나 계산은 바꾸지 않습니다.' },
  comparison_label: { category: 'presentation', meaning: '비교 값 옆의 문구를 정합니다. 비교 기간이나 계산은 바꾸지 않습니다.' },
  design_rules: { category: 'presentation', meaning: '지원하는 차트의 표시 기본값을 적용합니다. 평균이나 비중 계산을 추가하지 않습니다.' },
  presentation: { category: 'presentation', meaning: '상세 표의 머리글과 이미 선택한 비중 열의 표현만 바꿉니다.' },
};

export function describeOptionEffects(options: readonly string[]): Record<string, OptionEffect> {
  return Object.fromEntries(options.map(option => {
    const effect = effects[option];
    if (!effect) throw new Error(`Missing option effect description: ${option}`);
    return [option, { ...effect }];
  }));
}
