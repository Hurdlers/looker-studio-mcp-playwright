import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import type { CommonBinding } from './common-contract.js';
import { commonLayoutHeight } from './layout.js';

export const SECTION_TEMPLATE_ID = 'common-overview-section';
export const sectionOptionsInput = z.object({
  date_control: z.boolean().default(true).describe('섹션 안의 세 차트가 함께 사용하는 기간 선택기를 넣습니다.'),
  dimension_control: z.boolean().default(true).describe('섹션의 분류 필드를 고르는 드롭다운을 넣습니다.'),
  density: z.enum(['compact', 'comfortable']).default('comfortable').describe('compact는 여백과 제목 반복을 줄입니다. 기본 comfortable은 기존 배치를 유지합니다.'),
  table_rows: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(20), z.literal(25), z.literal(50), z.literal(100)]).optional().describe('표의 페이지당 표시 행 수. 조회 데이터나 필터를 자르지 않고 표 높이를 함께 계산합니다.'),
  decimal_precision: z.number().int().min(0).max(20).optional().describe('KPI에만 적용할 표시 소수 자릿수. 생략하면 원래 형식 유지.'),
}).strict();
export interface SectionThemeTokens {
  background: string;
  text: string;
  muted: string;
  accent: string;
  font: string;
}
export interface SectionInput {
  template_id: string;
  report_id: string;
  page?: string | number | undefined;
  data_source?: string | undefined;
  bindings: Record<string, CommonBinding>;
  texts?: Record<string, string> | undefined;
  date_range?: string | undefined;
  position?: { left: number; top: number } | undefined;
  size?: { width: number; height?: number | undefined } | undefined;
  section_options?: { date_control?: boolean | undefined; dimension_control?: boolean | undefined; decimal_precision?: number | undefined; density?: 'compact' | 'comfortable' | undefined; table_rows?: 1 | 5 | 10 | 20 | 25 | 50 | 100 | undefined } | undefined;
}
export interface SectionPlan {
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
  width: number;
  height: number;
  notes: string[];
}

export function sectionEntry() {
  return {
    template_id: SECTION_TEMPLATE_ID, name: '지표·추이·비중 요약 섹션',
    purpose: '제목·설명·기간/분류 선택기와 KPI·시간 추이·분류별 비중표를 같은 데이터 역할로 조립합니다.',
    implementation: 'built_in_composition', validation: 'supported_pending_review', addable: true,
    design_family: 'project_theme', sizing: 'explicit_container_size',
    roles: [
      { key: 'metric', name: '공통 측정값', kind: 'metric', required: true },
      { key: 'date', name: '공통 날짜', kind: 'date', required: true },
      { key: 'dimension', name: '분류와 필터 기준', kind: 'dimension', required: true },
    ],
    text_inputs: [{ key: 'title', required: false }, { key: 'description', required: false }],
    supported_options: ['date_control', 'dimension_control', 'decimal_precision', 'density', 'table_rows'],
    layout: { minimum_width: 600, default_width: 1120, wide_threshold: 1000, height: '내용과 폭에 따라 계산; 명시 높이는 필요한 높이 이상이어야 함' },
    notes: [
      '전체 요소를 한 그룹으로 묶어 그룹 내 컨트롤과 차트를 함께 사용합니다.',
      '기간 선택기가 있으면 초기 기간은 선택기에만 적용하고 차트의 고정 기간은 설정하지 않습니다.',
      'KPI와 추이·표는 같은 지표 정의를 사용하되 각 차트의 측정기준에 맞춰 집계합니다.',
      '비중은 현재 필터를 적용한 분류별 지표 값의 합계 기준이며, 날짜별 평균선은 주문 한 건당 평균이 아닙니다.',
      '단일 소스의 세 역할을 연결하는 기본 섹션입니다. 검증된 원본 레시피와 별개로 사용자 검수 전입니다.',
    ],
  };
}

// Conservative text space for the compact header. This is a creation-time
// estimate; font rendering still belongs to Looker Studio. Explicit line breaks
// and longer labels get more room instead of being clipped to a fixed box.
function compactTextHeight(text: string, width: number, fontSize: number, minimum: number): number {
  const available = Math.max(1, width - 16);
  const lines = text.split(/\r?\n/).reduce((count, line) => {
    const units = [...line].reduce((sum, character) => sum + (character.charCodeAt(0) < 128 ? 0.65 : 1.1), 0);
    return count + Math.max(1, Math.ceil(units * fontSize / available));
  }, 0);
  return Math.max(minimum, lines * Math.ceil(fontSize * 1.5) + 4);
}

/** Pure composition plan. The caller resolves one source, preflights every
 * existing tool, and saves/groups the complete section. No report-wide defaults
 * or existing report elements are changed by these steps. */
export function planSection(input: SectionInput, themeTokens?: SectionThemeTokens): SectionPlan {
  const invalid = (message: string): never => { throw new LookerError('invalid', message); };
  if (input.template_id !== SECTION_TEMPLATE_ID) invalid(`Unknown section "${input.template_id}".`);
  const options = sectionOptionsInput.parse(input.section_options ?? {});
  for (const key of Object.keys(input.bindings)) if (!['metric', 'date', 'dimension'].includes(key)) invalid(`Unknown section role "${key}".`);
  const binding = (key: string) => {
    const value = input.bindings[key];
    if (!value) return invalid(`Missing section role "${key}".`);
    const result = typeof value === 'string' ? { field: value } : value;
    if (!result.field.trim()) invalid(`Section role "${key}" needs a field.`);
    if (key !== 'metric' && (result.aggregation !== undefined || result.label !== undefined)) invalid(`Section role "${key}" accepts a field only.`);
    return result;
  };
  const metric = binding('metric'), date = binding('date').field, dimension = binding('dimension').field;
  for (const key of Object.keys(input.texts ?? {})) if (!['title', 'description'].includes(key)) invalid(`Unknown section text "${key}".`);
  const title = input.texts?.title ?? '성과 요약';
  const description = input.texts?.description?.trim();
  if (!title.trim()) invalid('A section title cannot be blank.');
  const width = input.size?.width ?? 1120;
  if (!Number.isInteger(width) || width < 600 || width > 20_000) invalid('Section width must be an integer from 600 to 20000 pixels.');
  const position = input.position ?? { left: 32, top: 32 };
  for (const [key, value] of Object.entries(position)) if (!Number.isInteger(value) || value < 0 || value > 20_000) invalid(`Section ${key} must be an integer from 0 to 20000.`);

  const compact = options.density === 'compact';
  const padding = 24, gap = compact ? 16 : 24, inner = width - padding * 2, wide = width >= 1000;
  const titleHeight = compact ? compactTextHeight(title, inner, 24, 32) : 44;
  const descriptionHeight = compact ? compactTextHeight(description ?? '', inner, 14, 24) : 48;
  const controlHeight = compact ? 36 : 44;
  const titleTop = padding;
  const descriptionTop = titleTop + titleHeight + 8;
  const controlsTop = description ? descriptionTop + descriptionHeight + gap : titleTop + titleHeight + gap;
  const controls = Number(options.date_control) + Number(options.dimension_control);
  // Keep room for the KPI's field label even when other child headings are hidden.
  const chartTop = controlsTop + (controls ? controlHeight + 24 : 0);
  const kpiHeight = compact ? 112 : wide ? 180 : 144, trendHeight = compact ? 250 : 320;
  const visibleRows = options.table_rows ?? (compact ? 5 : undefined);
  const tableMinimumHeight = visibleRows === undefined ? 300 : commonLayoutHeight('detail-table', options.density, visibleRows);
  const trendTop = wide ? chartTop : chartTop + kpiHeight + gap;
  const tableTop = trendTop + trendHeight + gap;
  const requiredHeight = tableTop + tableMinimumHeight + padding;
  const height = input.size?.height ?? requiredHeight;
  if (!Number.isInteger(height) || height < requiredHeight || height > 20_000) invalid(`Section height must be an integer from ${requiredHeight} to 20000 for this width and content.`);
  if (position.left + width > 20_000 || position.top + height > 20_000) invalid('The section exceeds the 20000px page coordinate limit.');
  const box = (left: number, top: number, w: number, h: number) => ({ left: position.left + left, top: position.top + top, width: w, height: h });
  const pageArgs = { report_id: input.report_id, ...(input.page === undefined ? {} : { page: input.page }) };
  const sourceArgs = { ...pageArgs, ...(input.data_source ? { data_source: input.data_source } : {}) };
  const theme = themeTokens;
  const steps: SectionPlan['steps'] = [];
  steps.push({ tool: 'shape_add', args: { ...pageArgs, shape: 'rectangle', position: box(0, 0, width, height),
    ...(theme ? { background: theme.background } : {}), border_radius: compact ? 10 : 16, style: { 'Border weight': 'None', 'Border shadow': false } } });
  // Text uses the project's native text color/font; only its typographic role
  // is fixed here, rather than embedding a white/light-theme font color.
  steps.push({ tool: 'text_add', args: { ...pageArgs, text: title, font_size: compact ? 24 : 30, bold: true, position: box(padding, titleTop, inner, titleHeight) } });
  if (description) steps.push({ tool: 'text_add', args: { ...pageArgs, text: description, font_size: 14, position: box(padding, descriptionTop, inner, descriptionHeight) } });
  const controlWidth = Math.min(320, Math.floor((inner - Math.max(0, controls - 1) * 16) / Math.max(1, controls)));
  const controlStyle = { 'Font size': compact ? 13 : 14, 'Border weight': compact ? '1' : 'None', 'Border radius': compact ? 6 : 8,
    ...(compact ? { 'Add border shadow': false } : {}),
    ...(theme ? { Background: compact ? theme.background : theme.accent, 'Font color': theme.text, Font: theme.font,
      ...(compact ? { 'Border color': theme.accent } : {}) } : {}) };
  let controlLeft = padding;
  if (options.date_control) {
    // A date picker has no data source/field slots. Its duration is a control
    // default, while the explicit date role stays on the charts below.
    steps.push({ tool: 'control_add', args: { ...pageArgs, kind: 'date_range', date_range: input.date_range ?? 'Auto date range',
      position: box(controlLeft, controlsTop, controlWidth, controlHeight), style: controlStyle } });
    controlLeft += controlWidth + 16;
  }
  if (options.dimension_control) steps.push({ tool: 'control_add', args: { ...sourceArgs, kind: 'drop_down', field: dimension, metric: metric.field,
    position: box(controlLeft, controlsTop, controlWidth, controlHeight), style: { ...controlStyle, 'Label position': 'Hidden', 'Allow "Select all"': true, 'Enable search box': true } } });

  const shared = { ...sourceArgs, ...(!options.date_control && input.date_range ? { date_range: input.date_range } : {}) };
  const metricTitle = metric.label?.trim() || metric.field;
  const kpiWidth = wide ? Math.min(320, Math.floor(inner * 0.3)) : inner;
  const trendLeft = wide ? padding + kpiWidth + gap : padding;
  const trendWidth = wide ? inner - kpiWidth - gap : inner;
  const child = (template_id: string, bindings: Record<string, CommonBinding>, text: string, left: number, top: number, w: number, h: number, common_options: Record<string, unknown>) => {
    steps.push({ tool: 'component_template_add', args: { ...shared, template_id, bindings, texts: { title: text },
      position: { left: position.left + left, top: position.top + top }, size: { width: w, height: h }, common_options: { ...(compact ? { density: 'compact', surface: 'plain' } : {}), ...common_options } } });
  };
  child('common-kpi', { metric: structuredClone(metric), date }, compact ? metricTitle : `전체 ${metricTitle}`, padding, chartTop, kpiWidth, kpiHeight,
    options.decimal_precision === undefined ? {} : { decimal_precision: options.decimal_precision });
  child('common-time-trend', { metric: structuredClone(metric), date }, compact ? '' : `기간별 ${metricTitle}`, trendLeft, trendTop, trendWidth, trendHeight, { average_line: true });
  child('common-detail-table', { metric: structuredClone(metric), date, dimension }, compact ? '' : `분류별 ${metricTitle}와 비중`, padding, tableTop, inner, height - tableTop - padding, { percent_of_total: true, ...(visibleRows === undefined ? {} : { visible_rows: visibleRows }) });
  return { steps, width, height, notes: [
    '같은 소스·날짜·지표 정의를 세 차트에 연결하며, 차트와 컨트롤은 전체 섹션 그룹으로 함께 저장해야 합니다.',
    options.date_control ? '기간 선택기에 초기 기간을 넣고 세 차트의 기간은 상속 상태로 둡니다.' : '기간 선택기 없이 세 차트에 같은 명시 기간을 적용합니다.',
    ...(compact ? ['compact는 공통 표면 위에 KPI·추이·표를 놓고 반복 제목과 컨트롤 그림자를 줄입니다.'] : []),
    ...(visibleRows === undefined ? [] : ['표 높이는 표시 행 수에 맞춘 기본값입니다. 조회 데이터나 필터의 범위는 바꾸지 않습니다.']),
    '폭에 따라 생성 시 배치가 달라집니다. 창 크기 변경에 따른 자동 반응형은 아닙니다.',
    ...(theme ? ['배경·컨트롤 색은 생성 시 프로젝트 테마 값으로 적용됩니다. 차트와 글자는 기본 테마 상속을 사용합니다.'] : []),
  ] };
}
