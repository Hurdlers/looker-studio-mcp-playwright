/** Hand-authored composition descriptions. No saved customer designs or data. */
export const REGION_KINDS = ['kpi-group', 'kpi-trend', 'table-trend', 'table-share', 'block'] as const;
const definitions = [
  { kind: 'kpi-group', name: '지표 묶음 영역', purpose: '여러 지표를 한 제목 아래 비교하는 분석 영역', children: ['common-kpi'], order: 'common-kpi 2~6개', min: 2, max: 6 },
  { kind: 'kpi-trend', name: '지표와 추이 영역', purpose: '요약 지표와 시간 변화 추이를 함께 읽는 분석 영역', children: ['common-kpi', 'common-time-trend', 'common-category-line'], order: '앞에 common-kpi 1~4개, 마지막에 common-time-trend 또는 명시적으로 선택한 common-category-line 1개', min: 2, max: 5 },
  { kind: 'table-trend', name: '상세 표와 추이 영역', purpose: '분류별 상세 표와 시간 추이를 함께 읽는 분석 영역', children: ['common-detail-table', 'common-time-trend', 'common-category-line'], order: 'common-detail-table 1개 다음 common-time-trend 또는 명시적으로 선택한 common-category-line 1개', min: 2, max: 2 },
  { kind: 'table-share', name: '상세 표와 비중 영역', purpose: '분류별 상세 표와 구성 비중 차트를 함께 읽는 분석 영역', children: ['common-detail-table', 'common-radial-share'], order: 'common-detail-table 1개 다음 common-radial-share 1개', min: 2, max: 2 },
  { kind: 'block', name: '자유 구성 영역', purpose: '한 질문에 필요한 공통 차트를 한 제목 아래 자유롭게 묶는 분석 영역', children: ['common-kpi', 'common-time-trend', 'common-category-line', 'common-detail-table', 'common-radial-share', 'common-category-bars', 'common-area-trend', 'common-mixed-series', 'common-pivot-table', 'common-xy-scatter'], order: '공통 차트 1~8개. KPI는 왼쪽에 묶고(3개 이상이면 두 열) 첫 차트 행을 옆에 둡니다. 나머지는 입력 순서대로 한 행에 최대 3개씩, 행마다 개수를 고르게 나눠 배치합니다(4개는 2+2). 한 행 안에서 원형은 좁게, 교차표는 넓게 잡습니다', min: 1, max: 8 },
] as const;
export function regionEntries(query = '') {
  const needle = query.trim().toLowerCase();
  return definitions.filter(d => `region-${d.kind} ${d.name} ${d.purpose}`.toLowerCase().includes(needle)).map(d => ({
    template_id: `region-${d.kind}`, name: d.name, purpose: d.purpose,
    implementation: 'built_in_region', validation: 'supported_pending_review', addable: false,
    composition_tool: 'component_page_add', region_kind: d.kind,
    roles: [{ key: 'items', required: true, description: '하위 차트마다 template_id와 bindings를 지정합니다. 필드·집계·기간은 해당 차트의 입력 계약을 따릅니다.' }],
    ...(d.kind === 'kpi-trend' ? { layout_options: { kpi_columns: [1, 2], default_kpi_columns: 1 }, layout_notes: ['kpi_columns:2는 KPI 2~4개를 두 열로 배치합니다. 폭이 부족하면 KPI 격자 아래에 추이를 두고, 더 좁으면 KPI도 한 열로 줄입니다.'] } : {}),
    child_templates: [...d.children], item_count: { min: d.min, max: d.max }, item_order: d.order,
    constraints: ['component_template_add로 추가하지 않습니다. component_page_add.regions에 region_kind를 kind로 넣습니다.',
      'regions와 기존 items 중 하나만 지정합니다. 영역마다 고유 key, title, 하위 items가 필요합니다.',
      '영역 안에서는 span과 중첩 구성을 받지 않습니다. height는 지정할 수 있습니다.',
      '페이지 controls를 지정하면 모든 차트의 소스와 date 역할이 controls와 같아야 합니다. controls가 없으면 영역마다 다른 소스를 사용할 수 있습니다.',
      '영역은 시각적 배치이며 새로운 필터 범위나 데이터 집계를 만들지 않습니다.',
      ...(['kpi-trend', 'table-trend'].includes(d.kind) ? ['common-category-line은 명시적으로 선택할 때만 사용하며 common-time-trend를 자동 대체하지 않습니다.',
        '날짜를 범주로 사용하면 동간격으로 배치되어 누락일의 시간 간격을 보존하지 않습니다. 호출자가 원본 날짜 형식과 정렬 순서를 확인해야 합니다.',
        'common-category-line의 dimension과 페이지 controls용 date 역할은 별개입니다. 페이지 controls 사용 시 date는 같은 소스의 지정 날짜 필드여야 합니다.'] : [])],
    design_scope: '페이지 design은 기본값이며 regions[].design에서 지정한 속성이 우선합니다.',
    design_variants: { surface: ['outlined', 'plain'], heading: ['plain', 'band'] },
    notes: ['테마와 가용 폭을 사용하는 범용 구성입니다. 특정 원본 디자인의 복제나 검수 완료를 뜻하지 않습니다.'],
  }));
}
