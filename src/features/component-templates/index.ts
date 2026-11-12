import { regionEntries, REGION_KINDS } from './region-catalog.js';
import { outlinePage } from './page-outline.js';
import { buildReport } from './report-build.js';
import { pageControlsInput } from './page-controls.js';
import { z } from 'zod';

import { instantiateComponentRecipe, replaceRecipeValues } from '../../core/component-library.js';
import { resolveSource } from '../../core/datasource.js';
import { fromMapValue } from '../../core/mapvalue.js';
import { pageArg, resolvePage, freeSpot } from '../../core/page.js';
import { defineTool, text } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { AGGREGATIONS, type AggregationName } from '../chart-core/common.js';
import { parseDuration } from '../chart-options/dates.js';
import { catalog, invalid, loadRecipe, publicEntry, roleLabel, verified } from './store.js';
import { addCommonTemplate, commonEntries, commonOptionsInput, isCommonTemplate } from './common.js';
import { commonAnalysisInput } from './common-analysis-input.js';
import { addComposition, compositionEntries, isComposition } from './composition.js';
import { sectionOptionsInput } from './section.js';
import { navigationInput } from './navbar.js';
import { projectThemeUpdater } from './presentation.js';
import { updateTemplate } from './update.js';
import { purposes } from './intent.js';
import { planTemplate } from './plan.js';
import { connectionInput } from './plan-source.js';
import { calculatedFieldInput } from './plan-calculated.js';
import { addComponentPage } from './page-add.js';
import { patchTemplate } from './patch.js';
import { metricPatchInput } from './patch-metrics.js';
import { chartAdd } from '../chart-core/chart-add.js';
import { controlAdd } from '../controls/add.js';
import { componentArrangeTool } from '../layout/arrange.js';
import { componentUpdateTool } from '../layout/update.js';
import { shapeAdd } from '../static/shape.js';
import { textAdd } from '../static/text.js';

type Json = Record<string, any>;
const print = (value: unknown) => text(JSON.stringify(value, null, 2));
const list = defineTool({
  name: 'component_template_list', title: 'Find a styled component',
  description: 'Finds ready-made chart designs by name or purpose without opening a customer report. Use this before creating a styled dashboard; each entry gives a template_id, required data roles and design family. Region entries are read-only composition descriptions (addable:false): use their region_kind in component_page_add.regions, not component_template_add. Saved designs require verification; built-in common structures are available with verified_only:false and retain their separate supported_pending_review status.',
  input: { query: z.string().default('').describe('찾을 디자인의 이름이나 용도. 예: 비중, 추이, 카드.'), verified_only: z.boolean().default(true).describe('실제 생성·렌더를 검증한 버전만 표시합니다.'), limit: z.number().int().min(1).max(100).default(30).describe('최대 결과 수.') },
  write: false,
  run: async (ctx, input) => {
    const query = input.query.trim().toLowerCase();
    const library = await catalog(ctx).catch(error => {
      if (!ctx.config.componentLibrary && error?.code === 'not_found') return { entries: [], validation: {} };
      throw error;
    });
    const { entries, validation } = library;
    const hits = entries.filter(e => (!input.verified_only || verified(e, validation)) && (!query || `${e.name} ${e.purpose} ${e.id} ${(e.keywords ?? []).join(' ')} ${e.roles.map(roleLabel).join(' ')}`.toLowerCase().includes(query)));
    const templates = [...hits.map(e => publicEntry(e, validation)), ...(input.verified_only ? [] : [...commonEntries(query), ...compositionEntries(query), ...regionEntries(query)])];
    // The list is for choosing. Per-option explanations and repeated fields stay in inspect.
    const brief = templates.slice(0, input.limit).map(entry => { const { option_effects: _effects, analytical_inputs: _inputs, ...rest } = entry as Record<string, unknown>; return rest; });
    return print({ total: templates.length, templates: brief, details: 'Each option and constraint is explained by component_template_inspect for one template_id.' });
  },
});
const inspect = defineTool({
  name: 'component_template_inspect', title: 'Read component input requirements',
  description: 'Shows data roles, value types, layout requirements and any installed analysis contract for a saved design. Read the original calculation, aggregation, filter and grain constraints before binding new fields; distinguish reusing a design from changing its business metric. Common structures also expose option_effects to distinguish analytical, native-kind and presentation choices; these do not validate a new source business meaning. Private source identifiers and raw formulas are not returned.',
  input: { template_id: z.string().describe('component_template_list에서 고른 ID.') }, write: false,
  run: async (ctx, input) => {
    const region = regionEntries().find(entry => entry.template_id === input.template_id);
    if (region) return print(region);
    if (isComposition(input.template_id)) return print(compositionEntries().find(e => e.template_id === input.template_id));
    if (isCommonTemplate(input.template_id)) return print(commonEntries().find(e => e.template_id === input.template_id));
    const { item, validation } = await loadRecipe(ctx, input.template_id); return print(publicEntry(item, validation, true));
  },
});
const templateInput = {
  report_id: z.string().describe('대상 리포트 ID 또는 URL.'),
  template_id: z.string().describe('검증된 디자인 ID.'),
  page: pageArg.optional().describe('추가할 페이지. 생략하면 첫 페이지.'),
  data_source: z.string().optional().describe('대상 리포트에 연결된 데이터 소스 이름·별칭·ID.'),
  bindings: z.record(z.string(), z.union([z.string(), z.object({ field: z.string().min(1), aggregation: z.enum(Object.keys(AGGREGATIONS) as [AggregationName, ...AggregationName[]]).optional().describe('SUM(...)처럼 자체 집계하는 계산 필드는 aggregation을 생략합니다.'), label: z.string().optional() })])).describe('역할 이름을 실제 필드 이름/ID 또는 {field,aggregation?,label?}에 연결합니다.'),
  texts: z.record(z.string(), z.string()).optional().describe('선택적 짧은 제목. 생략하면 준비된 기본 제목.'),
  date_range: z.string().optional().describe('기간 비교 디자인에는 필수입니다. 예: 2026-11-01..2026-11-03 또는 Last 7 days.'),
  ...commonAnalysisInput,
  position: z.object({ left: z.number().finite().min(0), top: z.number().finite().min(0) }).optional().describe('선택적 위치. 공통 차트는 생략하면 기존 요소와 겹치지 않는 곳에 자동 배치합니다.'),
  size: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).optional().describe('공통 구조 전용 크기. 준비된 원본 디자인의 크기 변경에는 사용할 수 없습니다.'),
  section_options: sectionOptionsInput.optional().describe('공통 요약 섹션의 기간·분류 컨트롤과 KPI 표시 옵션.'),
  navigation: navigationInput.optional().describe('공통 NavBar의 같은 보고서 페이지 메뉴.'),
  common_options: commonOptionsInput.optional().describe('공통 구조의 분석·표현 옵션. compact 밀도, 배경, 표 표시 행 수 등을 지정하며 원본 디자인 경로에서는 사용할 수 없습니다.'),
  preview: z.boolean().default(false).describe('저장 없이 역할·테마·배치를 검사합니다.'),
};
const add = defineTool({
  name: 'component_template_add', title: 'Add a saved design with new data',
  description: 'Adds a verified styled component using fields from the target report data source. Choose the template and inspect its roles first; provide bindings and an explicit date range for comparison designs. Saved-design styles are loaded from the installed library. Built-in common structures (discover them with verified_only:false) instead use the target report theme, explicit size and common_options; they are separately marked pending user review. common-overview-section is an analytical composition that includes a mean reference line and a percent-of-total table, so select it only when those analyses are intended; it composes charts, text and grouped controls; common-navbar creates same-report page links. Compositions preflight all child tools and save the completed page group once.',
  input: templateInput, write: true,
  run: async (ctx, input) => {
    if (isComposition(input.template_id)) return addComposition(ctx, input);
    if (input.section_options !== undefined || input.navigation !== undefined) throw invalid('section_options and navigation apply only to their corresponding compositions.');
    if (isCommonTemplate(input.template_id)) return addCommonTemplate(ctx, input);
    if (input.size !== undefined || input.common_options !== undefined || input.sort_by !== undefined || input.sort_ascending !== undefined || input.field_formats !== undefined)
      throw invalid('size, common_options, sort_by, sort_ascending and field_formats apply only to built-in common structures.');
    const { recipe, item, validation } = await loadRecipe(ctx, input.template_id);
    if (!verified(item, validation)) throw invalid(`Template "${input.template_id}" is not verified for creation${item.blockers?.length ? ': '+item.blockers.join('; ') : ''}.`);
    const reportId = parseReportId(input.report_id), doc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, input.page);
    const source = await resolveSource(ctx.rap, doc, input.data_source);
    const spot = input.position ?? freeSpot(doc, pageId, { width: recipe.width, height: recipe.height });
    const position = { left: spot.left, top: spot.top };
    const built = instantiateComponentRecipe(recipe, { data_source_id: source.datasourceId, fields: source.fields, bindings: input.bindings,
      ...(input.texts ? { texts: input.texts } : {}), left: position.left, top: position.top });
    const comparison = built.components.some(c => c.propertyConfig?.componentProperty?.compareDateDuration);
    if (comparison && !input.date_range) throw invalid('This comparison design needs date_range as well as its date field binding.');
    if (input.date_range) {
      const duration = parseDuration(input.date_range);
      for (const c of built.components) { const p = c.propertyConfig?.componentProperty; if (p?.dateRangeDimension) { if (duration) p.dateDuration = structuredClone(duration); else delete p.dateDuration; } }
    }
    const themeId = `component_theme_${item.theme_hash}`, currentTheme = (doc.report.propertyConfig as Json | undefined)?.reportProperty?.themeConfig;
    const hasContent = doc.page.some(p => (p.page.componentConfig ?? []).length > 0) || (doc.report.componentConfig?.length ?? 0) > 0;
    if (hasContent && currentTheme !== themeId) throw invalid('The target report already uses another design family. Choose a template from the same design_family or create an empty report.');
    const summary = { template_id: input.template_id, report_id: reportId, page_id: pageId, data_source: source.name, position, size: { width: built.width, height: built.height }, component_count: built.components.length, notes: built.notes };
    if (input.preview || ctx.dryRun) return print({ ...summary, preview: true, saved: false });
    const saved = await ctx.session.editReportThenPage(reportId, pageId, {
      report: d => {
        if (built.theme_encoding) {
          const resource = (d.report.resource ??= {}) as Json;
          const themes = resource.theme ??= { value: [] }; themes.value ??= [];
          if (!themes.value.some((value: Json) => (fromMapValue(value) as Json | undefined)?.id === themeId)) themes.value.push(replaceRecipeValues(built.theme_encoding, new Map([['$theme', themeId]])));
          (((d.report.propertyConfig ??= {}) as Json).reportProperty ??= {}).themeConfig = themeId;
        }
        const attr = (((d.report.attributeConfig ??= {}) as Json).reportAttribute ??= {});
        attr.width = Math.max(attr.width ?? 0, position.left + built.width + 40); attr.height = Math.max(attr.height ?? 0, position.top + built.height + 40);
      },
      page: p => {
        if (built.page_background) (((p.page.propertyConfig ??= {}) as Json).pageProperty ??= {}).backgroundColor = structuredClone(built.page_background);
        const components = p.page.componentConfig ??= [], ids = new Set(components.map(c => c.componentId));
        for (const c of built.components) if (!ids.has(c.componentId)) components.push(structuredClone(c));
        const attr = (((p.page.attributeConfig ??= {}) as Json).pageAttribute ??= {});
        attr.width = Math.max(attr.width ?? 0, position.left + built.width + 40); attr.height = Math.max(attr.height ?? 0, position.top + built.height + 40);
      },
    }, `add component template ${input.template_id}`);
    return { ...print({ ...summary, saved: true, component_ids: built.components.map(c => c.componentId), version: saved.version, undo_revision: saved.snapshot }), audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}), detail: `component template ${input.template_id}` } };
  },
});
const update = defineTool({
  name: 'component_template_update', title: 'Update a common chart or composition',
  description: 'Reconfigures one existing built-in common chart or a section/navigation group in a single page save. Supply its component_id or group_id and the complete desired template configuration, including all bindings and options to retain. This is a full template reconfiguration: omitted optional settings use template defaults; only omitted position and size retain the target bounds. Preview validates without saving. Other page content is preserved. Saved-library recipes and nested groups are not supported.',
  input: {
    ...templateInput,
    page: pageArg.optional().describe('대상 차트나 그룹이 있는 페이지. 생략하면 대상 ID로 찾습니다.'),
    data_source: templateInput.data_source.describe('새 데이터 소스. 생략하면 대상의 기존 소스를 유지하며, 여러 소스가 섞였으면 명시해야 합니다.'),
    position: templateInput.position.describe('새 위치. 생략하면 대상의 현재 위치를 유지합니다.'),
    size: templateInput.size.describe('새 크기. 생략하면 대상의 현재 경계를 유지합니다.'),
    bindings: templateInput.bindings.describe('변경 후 유지할 모든 역할의 필드·집계를 지정합니다. 일부 역할만 수정하는 입력이 아닙니다.'),
    component_id: z.string().min(1).optional().describe('수정할 공통 차트 ID. 그룹 수정 시에는 생략합니다.'),
    group_id: z.string().min(1).optional().describe('수정할 요약 섹션 또는 메뉴 그룹 ID. component_id와 동시에 지정할 수 없습니다.'),
  },
  write: true,
  run: updateTemplate,
});
const plan = defineTool({
  name: 'component_template_plan', title: 'Plan a chart from an analytical purpose',
  description: 'Recommends a common chart or overview section for an explicit analytical purpose and resolves its data roles. The client interprets natural language and confirms business definitions first. An explicit BigQuery connection or calculated_field returns needs_preparation with one validated prerequisite and a continuation to run after it succeeds; it does not invent future source or field IDs. Missing fields, ambiguous names or unspecified aggregations return issues without an executable chart call. Ready plans include the exact add or update call after a write-free public-tool preflight. Planning never executes the returned calls or infers business formulas. Updates require the complete desired configuration.',
  input: {
    report_id: templateInput.report_id,
    purpose: z.enum(purposes).describe('사용자의 분석 목적: 추이 trend, 분류 비교 comparison, 비중 share, 핵심값 kpi, 상세표 detail, 관계 relationship, 요약 섹션 overview, 교차표 cross_tab.'),
    template_id: z.string().optional().describe('추천 기본값 대신 선택할 같은 목적의 공통 구조 ID.'),
    data_source: templateInput.data_source,
    connection: connectionInput.optional().describe('아직 연결되지 않은 BigQuery 테이블·뷰·쿼리. data_source와 함께 지정할 수 없습니다. 연결 호출과 연결 후 재계획 입력을 반환합니다.'),
    calculated_field: calculatedFieldInput.optional().describe('먼저 만들 계산 필드 한 개. 수식을 검사하고 생성 호출과 재계획 입력을 반환합니다. 새 소스도 필요하면 연결부터 진행합니다.'),
    bindings: templateInput.bindings.optional().describe('사용자가 원하는 필드와 집계를 역할에 연결합니다. 생략하면 필요한 역할과 소스 필드를 알려줍니다. 일반 측정항목은 집계를 명시하고 Auto 필드는 집계를 생략합니다.'),
    page: pageArg.optional(), texts: templateInput.texts, date_range: templateInput.date_range,
    ...commonAnalysisInput,
    position: templateInput.position, size: templateInput.size,
    common_options: templateInput.common_options, section_options: templateInput.section_options,
    target: z.object({
      component_id: z.string().min(1).optional().describe('수정할 기존 공통 차트 ID.'),
      group_id: z.string().min(1).optional().describe('수정할 기존 요약 섹션 그룹 ID.'),
    }).strict().optional().describe('수정 계획일 때만 지정하며 두 ID 중 하나만 사용합니다. 생략하면 새로 추가할 계획입니다.'),
  },
  write: false,
  run: (ctx, input) => planTemplate(ctx, input, [add, update, chartAdd, controlAdd, componentArrangeTool, componentUpdateTool, shapeAdd, textAdd]),
});
const pageItemInput = z.object({
  key: z.string().trim().min(1).max(80).refine(value => value !== '$sidebar' && value !== '$tabs', 'Reserved navigation key').describe('결과에서 찾을 고유 항목 이름.'),
  template_id: templateInput.template_id, bindings: templateInput.bindings,
  data_source: templateInput.data_source, texts: templateInput.texts, date_range: templateInput.date_range,
  ...commonAnalysisInput,
  common_options: templateInput.common_options, section_options: templateInput.section_options,
  span: z.number().int().min(1).max(4).optional().describe('차지할 열 수. 차트는 기본1, 요약 섹션은 기본 전체 열입니다.'),
  height: z.number().int().positive().max(20000).optional().describe('항목 높이. 생략하면 차트 기본 높이 또는 섹션 내용에 필요한 높이입니다.'),
}).strict().meta({ id: 'PageItem' });
const regionDesignInput = z.object({
  surface: z.enum(['outlined', 'plain']).optional(),
  heading: z.enum(['plain', 'band']).optional(),
}).strict();
const pageDesignInput = regionDesignInput.extend({
  table_header: z.enum(['text', 'accent']).optional().describe('상세 표와 교차표의 머리글 배경. text는 테마 글자색(기본), accent는 테마 강조색(브랜드 색)과 강조 글자색을 씁니다. appearance와 함께 쓸 때 적용됩니다.'),
}).strict();
const pageHeaderInput = z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(400).optional(),
  band_color: z.string().regex(/^#[\da-fA-F]{6}$/).optional().describe('머리 영역 배경색(#RRGGBB). 프로젝트 브랜드 색을 지정합니다. 글자는 흰색과 테마 글자색 중 더 잘 읽히는 색을 씁니다. 차트 막대·도넛·표 강조색은 바뀌지 않으며 theme_update의 settings {"Series colors": [...]}로 따로 정합니다.'),
  logo: z.object({ image: z.string().min(1).describe('로컬 파일 경로, https:// 이미지 주소 또는 data:image URI.'), width: z.number().int().min(24).max(600).optional(), height: z.number().int().min(16).max(200).optional(), alt_text: z.string().max(200).optional() }).strict().optional()
    .describe('제목 앞에 놓는 로고. 기본 144×48. 페이지 저장 뒤 별도 단계로 올리며 실패해도 페이지는 유지되고 결과에 표시합니다.'),
}).strict();
const pageTabsInput = navigationInput.pick({ items: true }).strict();
const pageAdd = defineTool({
  name: 'component_page_add', title: 'Arrange common components on an empty page',
  description: 'Builds an automatically arranged page from common charts and overview sections, with an optional left sidebar. Supply an empty existing page, connected data roles and either ordered items or regions, never both. Determine the analytical items from the request and data definitions before choosing layout; layout adapts to that item count. Appearance changes presentation, not the intended metrics or time-axis meaning. Regions compose kpi-group, kpi-trend, table-trend, table-share or a free block of 1-8 common charts under one title, with optional design surface/heading. The grid reduces columns when minimum chart widths require it and measures sections at their allocated width. An optional header reserves its own space; compact density reduces whitespace and fit_height fits the empty canvas to its content. All child tools are preflighted before one page save; preview saves nothing. Existing page content and report-level components are refused. This is creation-time layout, not viewport-responsive reflow.',
  input: {
    report_id: templateInput.report_id, page: pageArg.optional().describe('구성할 빈 페이지. 생략하면 첫 페이지.'),
    width: z.number().int().min(320).max(20000).optional().describe('페이지 폭. 생략하면 현재 페이지 폭을 사용합니다.'),
    columns: z.number().int().min(1).max(4).default(2).describe('요청하는 열 수. 차트 최소 폭이 부족하면 자동으로 줄입니다.'),
    gap: z.number().int().min(0).max(1000).optional().describe('차트와 행 사이의 간격(px). 기본24, compact는16.'),
    density: z.enum(['comfortable', 'compact']).optional().describe('compact는 작은 헤더·간격·차트 높이로 정보 밀도를 높입니다. 항목별 옵션이 우선합니다.'),
    fit_height: z.boolean().optional().describe('빈 페이지의 높이를 실제 내용에 맞춥니다. compact는 기본true, 기존 모드는false.'),
    appearance: z.literal('outlined-report').optional().describe('공통 10종의 보고서 표현. 종류별로 지원되는 제목·범례·축·표 글꼴 역할을 적용하고 분석 설정과 계열 역할을 유지합니다. 상세 표는 기본5행·32px행높이에 필요한 공간을 확보합니다. 요약 섹션에는 적용하지 않습니다.'),
    controls: pageControlsInput.optional(),
    content_frame: z.object({ title: z.string().trim().min(1).max(160) }).strict().optional().describe('본문 차트 전체를 테마 표면과 제목으로 묶습니다. 페이지 필터 범위를 바꾸는 그룹은 만들지 않습니다.'),
    header: pageHeaderInput.optional().describe('상단 제목과 선택적 설명·브랜드 색·로고. 자동 배치 영역 위에 필요한 공간만 확보합니다.'),
    padding: z.number().int().min(0).max(1000).default(24).describe('페이지 바깥 여백(px).'),
    items: z.array(pageItemInput).min(1).max(30).optional().describe('기존 자동 배치 차트 목록. regions와 둘 중 하나만 지정합니다.'),
    regions: z.array(z.object({
      key: z.string().trim().min(1).max(80).describe('페이지 안에서 고유한 영역 이름.'),
      kpi_columns: z.union([z.literal(1), z.literal(2)]).optional().describe('kpi-trend의 KPI 열 수. 생략 시 기존 1열. 2열은 KPI 2~4개에 사용하며 좁은 폭에서는 아래로 줄바꿈합니다.'),
      kind: z.enum(REGION_KINDS).describe('분석 영역 구조. block은 공통 차트 1~8개를 자유롭게 묶습니다: KPI는 왼쪽에 모으고, 나머지는 입력 순서대로 한 행에 최대 3개씩 고르게 나눠(4개는 2+2) 놓습니다. 다른 종류는 component_template_list에서 region- 접두어로 찾고 inspect에서 하위 차트 종류를 확인합니다.'),
      title: z.string().trim().min(1).max(160),
      share: z.number().int().min(2).max(10).optional().describe('페이지 폭을 12등분했을 때 이 영역이 차지하는 칸 수. share가 있는 연속된 영역은 합이 12를 넘기 전까지 좌우로 나란히 놓이고 같은 높이를 씁니다. 생략하면 한 행 전체를 씁니다.'),
      design: regionDesignInput.optional().describe('이 영역의 표현. 지정한 속성만 페이지 design보다 우선합니다.'),
      items: z.array(pageItemInput).min(1).max(30).describe('영역의 하위 차트. key는 페이지 전체에서 고유하게 지정합니다. 종류별 순서·개수는 inspect를 따르며 span과 중첩 구성은 받지 않고 height는 허용합니다.'),
    }).strict()).min(1).max(20).optional().describe('제목과 표면을 공유하는 분석 영역 목록. items와 둘 중 하나만 지정합니다.'),
    design: pageDesignInput.optional().describe('분석 영역의 테마 기반 기본 표현. regions에서만 사용하며 생략 시 외곽선 표면과 일반 제목입니다. regions[].design의 명시 속성이 우선합니다.'),
    sidebar: z.object({
      width: z.number().int().min(160).max(20000).default(240).describe('왼쪽 사이드바 폭.'),
      title: z.string().optional().describe('사이드바 브랜드 제목.'),
      navigation: navigationInput.pick({ items: true }).strict().describe('이미 존재하는 같은 보고서 페이지로 이동하는 메뉴.'),
    }).strict().optional().describe('왼쪽 사이드바. 콘텐츠와 겹치지 않는 영역을 따로 확보합니다.'),
    tabs: pageTabsInput.optional().describe('머리 영역 아래 한 줄로 놓는 페이지 탭. 이미 존재하는 같은 보고서 페이지로 이동하며 현재 페이지를 테마 강조색으로 표시합니다. 탭으로 묶을 페이지를 모두 먼저 만든 뒤, 각 페이지를 구성할 때 같은 tabs를 지정합니다. 강조색은 구성 시점의 테마에서 읽으므로 theme_update(Accent background color 또는 Brand color)를 먼저 적용합니다.'),
    replace: z.object({ confirm_page_name: z.string().min(1).describe('다시 구성할 페이지의 현재 이름. 정확히 일치해야 합니다.') }).strict().optional()
      .describe('이미 내용이 있는 페이지를 다시 구성합니다. 그 페이지의 기존 차트·글·필터를 모두 지우고 새 구성을 한 번의 저장으로 넣습니다. 구성을 바꿔 달라는 요청(분류나 지표 교체 등)에 씁니다: component_page_outline을 새 입력으로 다시 호출한 뒤 같은 page와 이 값을 더해 넘깁니다. 저장 전 스냅숏으로 되돌릴 수 있습니다. 다른 페이지는 바뀌지 않습니다.'),
    preview: templateInput.preview,
  },
  write: true,
  run: addComponentPage,
});
const patch = defineTool({
  name: 'component_template_patch', title: 'Replace metrics while preserving chart settings',
  description: 'Replaces selected metric source fields in an existing chart or flat group without rebuilding its template. Source and concept IDs, titles, metric labels, styles, placement, date ranges, filters and percent-of-total calculations are retained; all matching metric occurrences are updated together in one page save. This first partial-edit path supports metrics within one data source only. Unit changes require an explicit format choice; metric-dependent conditions, fixed reference values and ambiguous references are returned for review without saving. Use component_update for explicit title, label or style edits.',
  input: {
    report_id: templateInput.report_id,
    page: pageArg.optional().describe('수정 대상이 있는 페이지. 생략하면 대상 ID로 찾습니다.'),
    component_id: z.string().min(1).optional().describe('부분 수정할 차트 ID. group_id와 동시에 지정할 수 없습니다.'),
    group_id: z.string().min(1).optional().describe('측정항목을 함께 교체할 평면 그룹 ID.'),
    metrics: z.array(metricPatchInput).min(1).max(20).describe('같은 소스의 기존→새 측정항목 연결. 해당 필드를 사용하는 모든 측정항목 자리를 교체합니다.'),
    preview: templateInput.preview,
  }, write: true,
  run: patchTemplate,
});
const outlineMetricsInput = z.array(z.object({
      field: z.string().trim().min(1).describe('측정항목 이름 또는 ID.'),
      aggregation: z.string().optional().describe('Auto 지표는 생략하고 나머지는 sum, count_distinct 등 집계를 명시합니다. 소스 목록에 dimension으로 표시된 숫자 필드도 집계를 명시하면 지표로 쓸 수 있습니다.'),
      label: z.string().trim().min(1).max(60).optional().describe('차트에 표시할 이름. 생략하면 필드 이름.'),
    }).strict()).min(1).max(8).describe('사용자가 보려는 지표. 첫 지표가 추이와 분류별 구역의 기준입니다. 도구가 지표를 더하지 않습니다.');
const outlineDimensionsInput = z.array(z.string().trim().min(1)).max(6).optional().describe('첫 지표를 나눠 볼 분류 필드. 생략하면 지표 현황 구역만 만들고 쓸 수 있는 분류를 알려줍니다.');
const outlineCrossInput = z.array(z.object({ row: z.string().trim().min(1), column: z.string().trim().min(1) }).strict()).max(3).optional().describe('교차표로 볼 분류 쌍. 열은 값이 8개 이하여야 합니다.');
const outlineTrendInput = z.object({
      by: z.enum(['day', 'week', 'month']).optional().describe('추이의 날짜 묶음. 기본 day. 긴 기간은 week나 month로 묶습니다.'),
      with_second_metric: z.boolean().optional().describe('둘째 지표를 추이에 함께 그립니다. 첫 지표는 막대, 둘째 지표는 오른쪽 축의 선이 됩니다. 지정할 때만 넣습니다.'),
    }).strict().optional().describe('추이를 그리는 방식.');
const outlineIncludeInput = z.object({
      share_column: z.boolean().optional().describe('분류별 표의 전체 대비 비중 열. 기본 true.'),
      daily_share: z.boolean().optional().describe('값이 6개 이하인 분류의 날짜별 100% 누적 막대(기간 14일 이하). 기본 true.'),
      filters: z.boolean().optional().describe('고른 분류 중 값이 12개 이하인 것의 페이지 필터(최대 2개). 기본 true.'),
      trend_comparison: z.boolean().optional().describe('추이에 비교 기간 선을 함께 그립니다. 기본 false. 팀 보고서는 증감을 KPI 카드에만 표시하므로, 고객이 추이 차트에서 이전 기간과 겹쳐 보기를 분명히 요청한 경우에만 true로 합니다.'),
      table_comparison: z.boolean().optional().describe('분류별 표에 지표마다 증감 열을 넣습니다(이때 비중 열은 빠집니다). 기본 false. 팀 보고서는 증감을 KPI 카드에만 표시하므로, 고객이 표에 증감 열을 분명히 요청한 경우에만 true로 합니다.'),
      kpi_progress: z.boolean().optional().describe('comparison을 지정했을 때 KPI 아래에 비교 기간 대비 진행 막대를 넣습니다. 이때 KPI의 비교 값은 증감률 대신 비교 기간 대비 비율로 표시됩니다. 기본 false.'),
      overview: z.boolean().optional().describe('지표 묶음과 첫 지표 추이 영역. 기본 true. 여러 페이지 보고서에서 같은 지표의 현황을 이미 앞 페이지에 둔 분류별 분석 페이지는 false로 해 반복을 피합니다.'),
    }).strict().optional().describe('도구가 기본으로 넣는 부분. 요청에 없으면 false로 끕니다.');
const pageOutline = defineTool({
  name: 'component_page_outline', title: 'Outline page regions from chosen metrics and breakdowns',
  description: 'Proposes the titled regions of a report page for metrics and breakdown dimensions the caller has chosen, as ready component_page_add input. It reads how many values each breakdown has in the period and picks the chart form from that: a share ring with a table for a few values, ranked horizontal bars with a table for some, a paged table for many, and a heat-map cross table sized to its rows. It adds a KPI group with the first metric\'s trend. Charts by breakdown use the first metric; the other metrics appear as value columns in each breakdown table. A comparison goes to the KPIs only; a comparison line in the trend and change columns in tables are opt-in through include. It never chooses a metric, a breakdown, a comparison or an average line by itself, and lists the unused dimensions instead of adding them. Give page, header, tabs and design here to get a page_add value that component_page_add accepts unchanged. It does add other views of the same chosen metric - the KPI and trend overview, a share-of-total column in tables, a daily 100% stacked bar for short periods, and filters for the chosen breakdowns - each of which include can switch off; the result notes say what was added. Nothing is saved.',
  input: {
    report_id: templateInput.report_id,
    data_source: templateInput.data_source,
    date: z.string().trim().min(1).describe('기간과 추이에 쓸 날짜 필드 이름 또는 ID.'),
    date_range: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/).describe('고정 기간 YYYY-MM-DD..YYYY-MM-DD. 이 기간의 값 개수로 차트 형태를 정합니다.'),
    metrics: outlineMetricsInput,
    dimensions: outlineDimensionsInput,
    cross: outlineCrossInput,
    comparison: z.string().optional().describe('KPI 기간 비교. 예: Previous period. 지정할 때만 넣습니다.'),
    comparison_label: z.string().trim().min(1).max(40).optional().describe('비교 값 옆 문구.'),
    average_line: z.boolean().optional().describe('추이에 평균 참조선을 넣습니다. 지정할 때만 넣습니다.'),
    trend: outlineTrendInput,
    include: outlineIncludeInput,
    page: pageArg.optional().describe('구성할 빈 페이지. 지정하면 결과 page_add에 그대로 들어갑니다.'),
    header: pageHeaderInput.optional().describe('component_page_add의 header와 같습니다. 지정하면 결과 page_add에 그대로 들어갑니다.'),
    tabs: pageTabsInput.optional().describe('component_page_add의 tabs와 같습니다. 지정하면 결과 page_add에 그대로 들어갑니다.'),
    design: pageDesignInput.optional().describe('component_page_add의 design과 같습니다. 지정하면 결과 page_add에 그대로 들어갑니다.'),
    replace: z.object({ confirm_page_name: z.string().min(1) }).strict().optional().describe('component_page_add의 replace와 같습니다. 이미 만든 페이지의 구성을 바꿀 때 지정하면 결과 page_add에 그대로 들어갑니다.'),
  },
  write: false,
  run: (ctx, input) => outlinePage(ctx, input),
});
const reportBuild = defineTool({
  name: 'component_report_add', title: 'Build an outlined multi-page report',
  description: 'Builds several report pages in one call from chosen metrics and breakdowns: it makes the pages (reusing the single empty page of a new report for the first one), groups them into sections of the report\'s own page menu when sections are given, outlines each page from the value counts of its breakdowns as component_page_outline does, and composes it with the shared brand header. Rename source fields first; give brand_color here to set the theme and every header band together. Every page is checked before anything is written; each page is then saved on its own, so if a later page fails the earlier ones stay and the result says which page failed. preview plans all pages without writing. It never adds metrics or breakdowns of its own.',
  input: {
    report_id: templateInput.report_id,
    data_source: templateInput.data_source,
    date: z.string().trim().min(1).describe('기간과 추이에 쓸 날짜 필드 이름 또는 ID.'),
    date_range: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/).describe('모든 페이지에 적용할 고정 기간 YYYY-MM-DD..YYYY-MM-DD.'),
    comparison: z.string().optional().describe('기간 비교. 예: Previous period. 증감은 KPI 카드에 표시됩니다. "직전 기간 대비 증감" 같은 요청은 이것만으로 충족합니다.'),
    comparison_label: z.string().trim().min(1).max(40).optional().describe('KPI 비교 값 옆 문구.'),
    brand_color: z.string().regex(/^#[\da-fA-F]{6}$/).optional().describe('브랜드 색(#RRGGBB) 하나. 보고서 테마의 강조색과 차트 색 계열, 모든 페이지의 머리 영역 배경을 함께 맞춥니다. 고객이 브랜드 색을 주면 이것 하나만 지정합니다.'),
    header: z.object({
      description: z.string().max(400).optional().describe('모든 페이지 머리에 넣을 설명. 페이지별 description이 우선합니다.'),
      band_color: z.string().regex(/^#[\da-fA-F]{6}$/).optional().describe('머리 영역 배경색(#RRGGBB). 생략하면 brand_color를 쓰고, 그것도 없으면 테마 표면색(흰색)입니다.'),
      logo: z.object({ image: z.string().min(1), width: z.number().int().min(24).max(600).optional(), height: z.number().int().min(16).max(200).optional(), alt_text: z.string().max(200).optional() }).strict().optional().describe('제목 앞 로고.'),
    }).strict().optional().describe('모든 페이지가 함께 쓰는 머리 영역. 제목은 페이지마다 다르게 들어갑니다.'),
    design: pageDesignInput.optional().describe('모든 페이지의 영역 표현. component_page_add의 design과 같습니다.'),
    tabs: z.boolean().optional().describe('페이지 안에 탭 줄을 추가로 넣습니다. 기본 false: 페이지 이동은 보고서의 기본 페이지 메뉴(왼쪽)로 합니다. true면 같은 section의 페이지끼리(section이 없으면 모든 페이지를) 탭으로 연결합니다.'),
    pages: z.array(z.object({
      name: z.string().trim().min(1).max(40).describe('페이지 이름. 페이지 메뉴와 탭에 표시됩니다.'),
      section: z.string().trim().min(1).max(40).optional().describe('보고서 페이지 메뉴의 구역 이름. 같은 section을 가진 연속된 페이지를 한 구역으로 묶습니다. 예: 개요, 획득, 행동 분석, 주문 분석. 팀 보고서는 페이지를 주제별 구역으로 묶습니다. 페이지가 셋 이상이면 관련 페이지에 같은 section을 지정합니다.'),
      section_icon: z.string().regex(/^[a-z0-9_]{2,40}$/).optional().describe('메뉴 구역의 Material 아이콘 이름. 구역의 첫 페이지에 지정한 값을 씁니다. 생략하면 구역 이름에 맞춰 고릅니다(개요·현황 dashboard, 사용자 face, 획득 groups, 행동 explore, 상품 shopping_cart, 주문·매출 storefront, 재사용 trending_up, 광고 campaign, 그 외 article).'),
      icon: z.string().regex(/^[a-z0-9_]{2,40}$/).optional().describe('이 페이지의 메뉴 아이콘(Material 아이콘 이름). 구역 없는 첫 페이지는 생략하면 home.'),
      title: z.string().trim().min(1).max(160).optional().describe('머리 영역 제목. 생략하면 페이지 이름.'),
      description: z.string().max(400).optional(),
      metrics: outlineMetricsInput,
      dimensions: outlineDimensionsInput,
      cross: outlineCrossInput,
      trend: outlineTrendInput,
      include: outlineIncludeInput,
      average_line: z.boolean().optional().describe('이 페이지의 추이에 평균 참조선을 넣습니다.'),
    }).strict()).min(1).max(8).describe('만들 페이지. 페이지마다 보려는 지표와 분류를 지정합니다.'),
    preview: z.boolean().optional().describe('true면 모든 페이지의 구성안만 반환하고 아무것도 쓰지 않습니다.'),
  },
  write: true,
  run: (ctx, input) => buildReport(ctx, input),
});
export const tools = [list, inspect, add, update, plan, pageOutline, pageAdd, reportBuild, patch];

export const extensions: import('../../core/extensions.js').FeatureExtensions = { updaters: [projectThemeUpdater] };
