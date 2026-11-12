/** Presentation rules only. Private reference reports and their data are never
 * loaded here. Deliberately excludes fields, calculations, periods and filters. */
export interface StylePolicySummary {
  name: 'team-v1';
  version: 1;
  applied: string[];
  overridden: string[];
  warnings: string[];
}
export const STYLE_POLICY_FAMILIES = ['kpi', 'time-trend', 'detail-table'] as const;
export function supportsStylePolicy(family: string): boolean {
  return (STYLE_POLICY_FAMILIES as readonly string[]).includes(family);
}


export function planStylePolicy(family: string, explicit: {
  design_rules?: 'team-v1' | undefined;
  show_values?: boolean | undefined;
  data_bars?: boolean | undefined;
}): { defaults: { show_values?: boolean; data_bars?: boolean }; summary?: StylePolicySummary } {
  if (!explicit.design_rules) return { defaults: {} };
  const summary: StylePolicySummary = { name: 'team-v1', version: 1,
    applied: ['theme.inherit', 'data.preserve', 'typography.preserve'], overridden: [], warnings: [] };
  const defaults: { show_values?: boolean; data_bars?: boolean } = {};
  if (family === 'time-trend') {
    defaults.show_values = true;
    (explicit.show_values === false ? summary.overridden : summary.applied).push('trend.points-and-values');
    if (explicit.show_values !== false) summary.warnings.push('값 라벨은 기본 표시합니다. 실제 관측점 수와 글자 길이는 알 수 없으므로 렌더에서 겹침을 확인하고, 필요하면 폭을 늘리거나 show_values를 명시하세요.');
    summary.warnings.push('평균선은 스타일 규칙만으로 추가하지 않습니다. 분석 의도에 맞을 때 average_line을 명시하세요.');
  } else if (family === 'detail-table') {
    defaults.data_bars = true;
    (explicit.data_bars === false ? summary.overridden : summary.applied).push('table.bar-with-value');
    if (explicit.data_bars !== false) summary.warnings.push('막대의 의미 적합성은 자동 검사하지 않습니다. 비교 가능한 수치인지 확인하고 비율·음수·비가산 지표는 data_bars:false 또는 별도 표현을 검토하세요.');
    summary.warnings.push('합계·비중·조건부 서식은 자동으로 추가하지 않습니다. 집계 의미와 강조 조건을 별도로 지정하세요.');
  } else if (family === 'kpi') {
    summary.applied.push('kpi.shared-alignment');
    summary.warnings.push('고정 글자 크기·증감의 좋고 나쁨·비교 기간을 새로 정하지 않습니다. 현재 표현과 명시한 비교를 유지합니다.');
  }
  return { defaults, summary };
}
