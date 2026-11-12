import { commonEntries } from './common.js';
import { compositionEntries } from './composition.js';
import { invalid } from './store.js';

// The client interprets natural language. This policy maps that explicit
// analytical purpose to supported structures without guessing business metrics.
export const purposes = ['trend', 'comparison', 'share', 'kpi', 'detail', 'relationship', 'overview', 'cross_tab'] as const;
export type AnalysisPurpose = typeof purposes[number];
export interface TemplateRecommendation {
  template_id: string;
  reason: string;
  alternatives: Array<{ template_id: string; reason: string }>;
}
interface Choice { template_id: string; reason: string; }
const choices: Record<AnalysisPurpose, readonly Choice[]> = {
  trend: [
    { template_id: 'common-time-trend', reason: '날짜에 따른 측정값의 변화를 선으로 보여줍니다.' },
    { template_id: 'common-area-trend', reason: '시간에 따른 크기나 계열별 누적 변화를 면적으로 보여줄 때 선택합니다.' },
  ],
  comparison: [
    { template_id: 'common-category-bars', reason: '분류별 측정값의 크기를 막대 길이로 비교합니다.' },
    { template_id: 'common-category-line', reason: '분류에 의미 있는 순서가 있을 때 선택하고, 순서 설정도 확인합니다.' },
    { template_id: 'common-mixed-series', reason: '같은 분류에서 두 지표를 함께 비교할 때 선택하고, 두 지표의 단위와 집계를 각각 확인합니다.' },
  ],
  share: [
    { template_id: 'common-radial-share', reason: '현재 차트에 포함된 분류별 값이 전체에서 차지하는 비중을 보여줍니다.' },
    { template_id: 'common-detail-table', reason: '분류별 수치와 비중을 함께 읽어야 할 때 선택하며, percent_of_total 옵션을 사용합니다.' },
  ],
  kpi: [{ template_id: 'common-kpi', reason: '선택한 기간의 핵심 지표를 하나의 값으로 보여줍니다. 이전 기간 비교는 별도 옵션으로 지정합니다.' }],
  detail: [{ template_id: 'common-detail-table', reason: '분류별 측정값을 정확한 수치로 읽을 수 있는 표입니다.' }],
  relationship: [{ template_id: 'common-xy-scatter', reason: '분류별 두 수치의 관계를 X·Y 좌표로 보여줍니다. 상관관계만으로 인과관계를 뜻하지는 않습니다.' }],
  overview: [{ template_id: 'common-overview-section', reason: '하나의 지표를 핵심 값·시간 추이·분류별 비중으로 함께 살펴보는 요약 섹션입니다.' }],
  cross_tab: [{ template_id: 'common-pivot-table', reason: '두 분류를 행과 열로 교차해 측정값을 비교합니다.' }],
};

export function recommendTemplate(purpose: AnalysisPurpose, templateId?: string): TemplateRecommendation {
  const available = choices[purpose];
  if (!available) throw invalid(`Unknown analysis purpose "${purpose}".`);
  const selected = templateId === undefined ? available[0]! : available.find(choice => choice.template_id === templateId);
  if (!selected) throw invalid(`Template "${templateId}" does not match purpose "${purpose}". Choose ${available.map(choice => choice.template_id).join(', ')}.`);
  // Input requirements stay owned by the actual common/composition entries.
  // A removed implementation must not survive as an executable recommendation.
  const entries = [...commonEntries(), ...compositionEntries()];
  if (!entries.some(entry => entry.template_id === selected.template_id)) throw invalid(`Template "${selected.template_id}" is unavailable.`);
  return { ...selected, alternatives: available.filter(choice => choice !== selected).map(choice => ({ ...choice })) };
}
