import { z } from 'zod';

import { fieldConcept, place, resolveField, type Position } from '../../core/components.js';
import { grantVizConsent, resolveSource } from '../../core/datasource.js';
import { isDryRun } from '../../core/dryrun.js';
import { LookerError } from '../../core/errors.js';
import type { UpdateTarget } from '../../core/extensions.js';
import { pageArg, pageComponents, pageSize, resolvePage } from '../../core/page.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { buildCommunity, metricConcept, type FieldInput } from './component.js';
import { manifestPath, selectRegistration, type Json } from './registration.js';
import { applyCommunityStyle, applyCommunityTitle } from './style.js';

const fieldName = z.string().trim().min(1).describe('데이터 소스의 필드 이름 또는 ID.');
const metricsInput = z.array(z.object({
  field: fieldName, aggregation: z.enum(['none', 'avg', 'count', 'count_distinct', 'max', 'min', 'sum']).optional().describe('이 지표에 적용할 집계. 생략하면 필드의 기본 집계를 씁니다.'),
  label: z.string().trim().min(1).optional().describe('이 지표에 표시할 이름.'),
})).default([]).describe('첫 Metric 또는 Primary field 칸에 넣을 지표. Record Count도 받을 수 있습니다.');
const positionInput = z.object({
  left: z.number().int().min(0).max(20000).optional().describe('왼쪽 위치. 리포트 픽셀 단위입니다.'),
  top: z.number().int().min(0).max(20000).optional().describe('위쪽 위치. 리포트 픽셀 단위입니다.'),
  width: z.number().int().min(10).max(20000).optional().describe('너비. 10에서 20000픽셀까지입니다.'),
  height: z.number().int().min(10).max(20000).optional().describe('높이. 10에서 20000픽셀까지입니다.'),
}).optional().describe('위치와 크기. 위치를 생략하면 왼쪽 40픽셀, 가장 아래 컴포넌트보다 20픽셀 아래에 놓습니다.');
const seriesInput = z.array(z.object({
  metric: z.string().trim().min(1).describe('차트에 보이는 지표 이름.'),
  type: z.enum(['line', 'bars']).optional().describe('선 또는 막대.'),
  axis: z.enum(['left', 'right']).optional().describe('왼쪽 또는 오른쪽 축.'),
  color: z.string().optional().describe('계열 색. #RRGGBB 형식입니다.'),
})).default([]).describe('커뮤니티 시각화의 계열 설정은 적용하지 않고 항목마다 Not applied로 알립니다.');
const sortsInput = z.array(z.object({ field: fieldName, ascending: z.boolean().default(false).describe('true이면 오름차순이며 기본은 내림차순입니다.') })).max(10).optional().describe('데이터 요청의 정렬 순서. 시각화가 그 순서를 화면에 반영하는지는 구현마다 다릅니다.');

interface Args extends FieldInput {
  report_id: string;
  page?: string | number;
  name?: string;
  manifest_path?: string;
  allow_data_access: boolean;
  data_source?: string;
  title?: string;
  position?: Partial<Position>;
  style?: Record<string, unknown>;
  filters?: unknown;
  date_range?: string;
  sorts?: Array<{ field: string; ascending: boolean }>;
  series: Array<{ metric: string; color?: string }>;
  comparison?: string;
  value_colors?: unknown;
  reference_lines?: unknown;
  reference_bands?: unknown;
  conditional_formats?: unknown;
}

function preflight(input: Args): string {
  if ((input.name === undefined) === (input.manifest_path === undefined)) throw new LookerError('invalid', 'Choose exactly one of name or manifest_path for the visualization.');
  if (input.name !== undefined && !input.name.trim()) throw new LookerError('invalid', 'name must be a nonempty gallery card name.');
  if (input.manifest_path !== undefined) manifestPath(input.manifest_path);
  if (input.comparison !== undefined && input.comparison.toLowerCase() !== 'none')
    throw new LookerError('invalid', 'comparison is unavailable for community visualizations. Remove it or use None; the visualization keeps its own controls.');
  for (const key of ['value_colors', 'reference_lines', 'reference_bands', 'conditional_formats'] as const)
    if (input[key] !== undefined) throw new LookerError('invalid', `${key} is a built-in chart setting and cannot be applied to a community visualization. Leave it out and use the visualization\'s own style labels.`);
  for (const entry of input.series)
    if (entry.color !== undefined && !/^#[0-9a-f]{6}$/i.test(entry.color)) throw new LookerError('invalid', 'series color must have six hex digits, such as #1A73E8.');
  try { return parseReportId(input.report_id); }
  catch { throw new LookerError('invalid', 'report_id must be a report id or a Looker Studio report URL.'); }
}

async function applyShared(ctx: ToolContext, key: 'filters' | 'date_range', value: unknown, target: UpdateTarget): Promise<string | undefined> {
  const updater = ctx.ext.updater(key);
  if (!updater) throw new LookerError('invalid', `${key} support is not installed in this server. Leave it out or enable the chart settings group.`);
  const parsed = updater.input.safeParse(value);
  if (!parsed.success) throw new LookerError('invalid', `${key}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  const note = await updater.apply(target, parsed.data, ctx);
  return typeof note === 'string' ? note : undefined;
}

export const communityVizAdd = defineTool({
  name: 'community_viz_add', title: 'Add a community visualization',
  description: 'Places a registered community visualization on a report page using a gallery card name or a Cloud Storage manifest. Use it for third-party charts with their own field inputs and style labels; a visualization that needs data access is refused unless allow_data_access is explicitly true, and field names and settings are checked before the report is saved. Filters and date ranges use the same inputs as chart_add; comparison, reference lines, conditional formatting and dimension-value colors are unavailable here.',
  input: (ext) => ({
    report_id: z.string().min(1).describe('리포트 ID 또는 리포트 URL.'), page: pageArg.optional().describe('페이지 ID, 이름 또는 1부터 센 번호. 생략하면 첫 페이지입니다.'),
    name: z.string().optional().describe('갤러리 카드의 이름. manifest_path와 둘 중 하나만 지정합니다.'),
    manifest_path: z.string().optional().describe('직접 배포한 시각화의 gs://버킷/경로. name과 함께 지정할 수 없습니다.'),
    allow_data_access: z.boolean().default(false).describe('시각화의 데이터 접근 동의가 필요할 때만 true로 명시합니다. 기본은 동의하지 않습니다.'),
    data_source: z.string().trim().min(1).optional().describe('리포트의 데이터 소스 이름, 별칭 또는 ID. 생략하면 첫 데이터 소스입니다.'),
    dimensions: z.array(fieldName).default([]).describe('첫 Dimension 또는 Row dimension 칸에 넣을 차원. 다른 제목의 칸은 fields로 지정합니다.'),
    metrics: metricsInput,
    fields: z.record(z.string().trim().min(1), z.array(fieldName)).optional().describe('시각화가 정한 설정 칸 제목별 필드 목록. 기존 목록을 이 값으로 바꿉니다.'),
    title: z.string().optional().describe('시각화의 제목 설정 칸에 넣을 글자. 해당 칸이 없으면 Not applied로 알립니다.'),
    position: positionInput,
    style: z.record(z.string().min(1), z.unknown()).optional().describe('시각화의 스타일 라벨별 값. 색은 #RRGGBB, 스위치는 true/false, 선택칸은 표시 문구를 쓰며 Label#2는 같은 라벨의 두 번째 칸입니다.'),
    filters: (ext.updater('filters')?.input ?? z.array(z.unknown())).optional().describe('차트와 같은 이름 기반 필터. 기존 필터를 재사용하거나 새 조건 필터를 만듭니다.'),
    date_range: z.string().optional().describe('Last 7 days 같은 프리셋, Auto date range, 또는 YYYY-MM-DD..YYYY-MM-DD.'),
    sorts: sortsInput, series: seriesInput,
    comparison: z.string().optional().describe('커뮤니티 시각화는 None만 받습니다.'),
    value_colors: z.unknown().optional().describe('커뮤니티 시각화에서는 지원하지 않습니다.'),
    reference_lines: z.unknown().optional().describe('커뮤니티 시각화에서는 지원하지 않습니다.'),
    reference_bands: z.unknown().optional().describe('커뮤니티 시각화에서는 지원하지 않습니다.'),
    conditional_formats: z.unknown().optional().describe('커뮤니티 시각화에서는 지원하지 않습니다.'),
  }),
  write: true,
  run: async (ctx, args) => {
    const input = args as unknown as Args;
    const reportId = preflight(input);
    const registration = await selectRegistration(ctx, reportId, input);
    const needsConsent = registration.approvalState !== 1 && registration.approvalState !== 4;
    if (registration.approvalState === 2) throw new LookerError('refused', `Data access for ${registration.name} is denied for this report. Choose another visualization.`);
    if (needsConsent && !input.allow_data_access) throw new LookerError('refused', `${registration.name} needs permission to read this report's data. Review the visualization and call again with allow_data_access: true if you agree.`);
    if (needsConsent && ![0, 3].includes(registration.approvalState)) throw new LookerError('format_changed', `Unknown consent state ${registration.approvalState} for ${registration.name}. No consent or report changes were sent.`);
    if (needsConsent && !registration.fingerprint) throw new LookerError('format_changed', 'The visualization registration has no consent fingerprint. No permission was granted.');

    const doc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, input.page);
    const aliases = doc.report.resource?.datasourceAlias ?? [];
    let source: Awaited<ReturnType<typeof resolveSource>>;
    try { source = await resolveSource(ctx.rap, doc, input.data_source ?? aliases[0]?.alias); }
    catch (error) {
      if (error instanceof LookerError) throw new LookerError(error.code, `${error.message} Connect a source with datasource_add first or choose one of the report's sources.`);
      throw error;
    }
    const component = buildCommunity(registration, input, { datasourceId: source.datasourceId, fields: source.fields });
    const bottom = Math.max(0, ...pageComponents(doc, pageId).map((entry) => { const box = entry.attributeConfig?.componentAttribute as Json | undefined; return Number(box?.top ?? 0) + Number(box?.height ?? 0); }));
    const defaults = component.attributeConfig.componentAttribute;
    const box: Position = { left: input.position?.left ?? 40, top: input.position?.top ?? bottom + 20, width: input.position?.width ?? Number(defaults.width ?? 400), height: input.position?.height ?? Number(defaults.height ?? 300) };
    place(component, box);
    const notApplied = [...applyCommunityTitle(component, registration.config, input.title), ...applyCommunityStyle(component, registration.config, input.style), ...input.series.map((entry) => `series: ${entry.metric}`)];
    const work = structuredClone(doc);
    const page = work.page.find((entry) => entry.pageId === pageId)!;
    const target = { component, page, doc: work };
    const notes: string[] = [];
    if (input.filters !== undefined) { const note = await applyShared(ctx, 'filters', input.filters, target); if (note) notes.push(note); }
    if (input.date_range !== undefined) { const note = await applyShared(ctx, 'date_range', input.date_range, target); if (note) notes.push(note); }
    if (input.sorts !== undefined) {
      component.propertyConfig.componentProperty.sort = input.sorts.map((sort) => {
        const wanted = resolveField(source.fields, sort.field);
        let concept = component.conceptDefs.find((entry: Json) => entry.queryTimeTransformation?.dataTransformation?.sourceFieldName === wanted.id);
        if (!concept) {
          const numeric = wanted.semanticType !== undefined ? [12, 13, 14, 15, 28, 33].includes(wanted.semanticType) : [1, 4, 5, 6, 10, 11, 12].includes(wanted.aggregation);
          concept = numeric ? metricConcept(wanted, { field: sort.field }) : fieldConcept(wanted);
          component.conceptDefs.push(concept);
        }
        return { sortColumn: concept.name, sortDir: sort.ascending ? 0 : 1 };
      });
      notes.push('Data sorting is configured; this visualization decides how that order appears.');
    }

    const resource = (work.report.resource ??= {}) as Json;
    const resources: Json[] = (resource.communityVizResource ??= []);
    if (!resources.some((entry) => entry.vizId === registration.vizId)) resources.push({ vizId: registration.vizId });
    if (needsConsent) await grantVizConsent(ctx.rap, reportId, registration.consentId, registration.fingerprint);
    const addToPage = (saved: { page: Json }): void => {
      const components: Json[] = (saved.page.componentConfig ??= []);
      if (!components.some((entry) => entry.componentId === component.componentId)) components.push(structuredClone(component));
    };
    const old = (doc.report.resource ?? {}) as Json;
    const addedResources = resources.filter((entry) => !(old.communityVizResource ?? []).some((previous: Json) => previous.vizId === entry.vizId));
    const addedFilters: Json[] = (resource.filter?.entry ?? []).filter((entry: Json) => !(old.filter?.entry ?? []).some((previous: Json) => previous.key === entry.key));
    const changedReport = addedResources.length > 0 || addedFilters.length > 0;
    const saved = changedReport ? await ctx.session.editReportThenPage(reportId, pageId, {
      report: (fresh) => {
        const current = (fresh.report.resource ??= {}) as Json;
        const viz: Json[] = (current.communityVizResource ??= []);
        for (const entry of addedResources) if (!viz.some((existing) => existing.vizId === entry.vizId)) viz.push(structuredClone(entry));
        if (addedFilters.length) {
          const filters: Json[] = ((current.filter ??= {}).entry ??= []);
          for (const entry of addedFilters) if (!filters.some((existing) => existing.key === entry.key)) filters.push(structuredClone(entry));
        }
      }, page: addToPage,
    }, `add community visualization ${registration.name}`) : await ctx.session.editPage(reportId, pageId, addToPage, `add community visualization ${registration.name}`);

    if (!ctx.dryRun && !isDryRun(ctx.rap)) {
      const after = await ctx.session.load(reportId);
      const found = after.page.flatMap((entry) => entry.page.componentConfig ?? []).find((entry) => entry.componentId === component.componentId);
      const registered = ((after.report.resource as Json | undefined)?.communityVizResource ?? []).some((entry: Json) => entry.vizId === registration.vizId);
      if (!found || found.type !== registration.vizId || !registered) throw new LookerError('format_changed', `The visualization was not found in the saved page and report resources. Inspect the report before retrying; undo with version_restore if needed.`);
    }
    const canvas = pageSize(doc, pageId);
    if (box.left + box.width > canvas.width || box.top + box.height > canvas.height) notes.push(`The visualization reaches beyond the ${canvas.width}x${canvas.height} page. Increase the page size to see it all.`);
    return { ...text([
      `${ctx.dryRun ? 'Would add' : 'Added'} ${registration.name} (${registration.vizId}) as ${component.componentId} on page ${pageId}, reading "${source.name}" (${source.alias}).`,
      `Position ${box.left}, ${box.top}; size ${box.width}x${box.height}.`,
      ...(notApplied.length ? [`Not applied: ${notApplied.join(', ')}`] : []), ...notes,
      ...(saved.snapshot ? [`To undo, restore revision ${saved.snapshot} with version_restore.`] : []),
    ].join('\n')), audit: { reportId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}) } };
  },
});
