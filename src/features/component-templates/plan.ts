import { resolveSource } from '../../core/datasource.js';
import { dryRunContext } from '../../core/dryrun.js';
import { resolvePage } from '../../core/page.js';
import { errorMessage, resultText, runTool, text, type Tool, type ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { aggregationLabel, allowedAggregations } from '../chart-core/common.js';
import { typeLabel } from '../data-sources/types.js';
import { sourceRefs } from '../data-sources/sources.js';
import { commonEntries } from './common.js';
import { compositionEntries, type CompositionInput } from './composition.js';
import { recommendTemplate, type AnalysisPurpose } from './intent.js';
import { planBindings, type BindingIssue } from './plan-bindings.js';
import { planSource, type ConnectionInput } from './plan-source.js';
import { planCalculatedField, type CalculatedFieldInput } from './plan-calculated.js';

export interface PlanInput extends Omit<CompositionInput, 'template_id' | 'bindings' | 'preview'> {
  purpose: AnalysisPurpose;
  template_id?: string | undefined;
  bindings?: CompositionInput['bindings'] | undefined;
  connection?: ConnectionInput | undefined;
  calculated_field?: CalculatedFieldInput | undefined;
  target?: { component_id?: string | undefined; group_id?: string | undefined } | undefined;
}
const print = (value: unknown) => text(JSON.stringify(value, null, 2));

/** The caller interprets intent and business meaning; this planner resolves
 * explicit roles and validates the exact public-tool call without saving it. */
export async function planTemplate(ctx: ToolContext, input: PlanInput, compilerTools: Tool[]) {
  let recommendation;
  try { recommendation = recommendTemplate(input.purpose, input.template_id); }
  catch (error) { return print({ status: 'invalid', issues: [{ code: 'template_mismatch', message: errorMessage(error) }], fields: [] }); }
  const entry = [...commonEntries(), ...compositionEntries()].find(e => e.template_id === recommendation.template_id)!;
  const base = { purpose: input.purpose, recommendation, required_roles: entry.roles,
    notes: ['의도 해석과 지표의 업무 정의는 클라이언트가 확인합니다. 이 계획은 필드·집계·생성 입력의 기술적 유효성을 검사합니다.',
      ...(input.target ? ['수정은 전체 구성 재적용입니다. 유지할 제목·기간·옵션을 모두 전달해야 하며 생략한 옵션은 기본값을 사용합니다.'] : [])] };
  const reportId = parseReportId(input.report_id), doc = await ctx.session.load(reportId);
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  let requestedPage: string | undefined;
  if (input.page !== undefined) {
    try { requestedPage = resolvePage(doc, input.page); }
    catch (error) { return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'invalid_page', message: errorMessage(error) }] }); }
  }
  if (input.target && Boolean(input.target.component_id) === Boolean(input.target.group_id))
    return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'invalid_target', message: 'component_id 또는 group_id 중 하나를 지정하세요.' }] });
  if (input.target) {
    const target = input.target;
    const hits = doc.page.filter(p => target.group_id ? p.page.groupConfig?.some(g => g.groupId === target.group_id) : p.page.componentConfig?.some(c => c.componentId === target.component_id));
    if (hits.length !== 1 || (recommendation.template_id === 'common-overview-section') !== !!target.group_id)
      return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'invalid_target', message: '선택한 구조와 일치하는 고유한 수정 대상 ID를 지정하세요.' }] });
    if (requestedPage !== undefined && requestedPage !== hits[0]!.pageId)
      return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'invalid_target', message: '지정한 페이지에 수정 대상이 없습니다. 대상의 페이지를 지정하세요.' }] });
  }
  if (input.connection) {
    if (input.data_source !== undefined)
      return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'conflicting_source', message: '기존 data_source 또는 새 connection 중 하나만 지정하세요.' }] });
    const prepared = await planSource(ctx, reportId, input.connection);
    if (prepared.issues.length || !prepared.preparation)
      return print({ ...base, ...prepared, status: 'invalid' });
    const refs = aliases.length ? await sourceRefs(ctx.rap, doc) : [];
    const name = prepared.source_name!.trim().toLowerCase();
    if (refs.some(r => [r.name, r.alias, r.datasourceId].some(value => value.trim().toLowerCase() === name)))
      return print({ ...base, status: 'invalid', fields: prepared.fields, issues: [{ code: 'source_name_exists', message: '같은 이름이나 별칭의 소스가 이미 있습니다. 기존 data_source를 선택하거나 새 source_name을 지정하세요.' }] });
    const { connection: _connection, ...remaining } = input;
    return print({ ...base, status: 'needs_preparation', fields: prepared.fields, issues: [], validation: prepared.validation,
      preparation_available: ctx.config.writesEnabled && !ctx.config.dryRun && !ctx.dryRun,
      preparation: [prepared.preparation], estimated_bytes: prepared.estimated_bytes,
      continuation: { tool: 'component_template_plan', arguments: { ...remaining, report_id: reportId, data_source: prepared.source_name } },
      notes: [...base.notes, ...prepared.notes] });
  }
  let sourceRef = input.data_source;
  if (!sourceRef && input.target) {
    const target = input.target;
    const members = doc.page.flatMap(p => {
      const membership = target.group_id ? p.page.groupConfig?.find(g => g.groupId === target.group_id)?.componentId : [target.component_id];
      const ids = Array.isArray(membership) ? membership : [];
      return (p.page.componentConfig ?? []).filter(c => ids.includes(c.componentId));
    });
    const sources = [...new Set(members.map(c => c.datasourceId).filter((id): id is string => typeof id === 'string' && !!id))];
    if (sources.length === 1) sourceRef = sources[0];
  }
  if (!sourceRef && aliases.length !== 1)
    return print({ ...base, status: 'needs_input', fields: [], sources: aliases.map(a => ({ id: a.datasourceId, alias: a.alias })),
      issues: [{ code: 'source_required', message: aliases.length ? '사용할 데이터 소스를 지정하세요.' : '먼저 데이터 소스를 연결하세요. BigQuery는 bq_table_describe로 구조를 확인한 뒤 datasource_add로 연결할 수 있습니다.' }] });
  let source;
  try { source = await resolveSource(ctx.rap, doc, sourceRef); }
  catch (error) { return print({ ...base, status: 'invalid', fields: [], issues: [{ code: 'source_unavailable', message: errorMessage(error) }] }); }
  const fields = source.fields.map(f => ({ id: f.id, name: f.name, data_type: f.dataType, semantic_type: f.semanticType,
    type: typeLabel(f.semanticType), default_aggregation: aggregationLabel(f.aggregation), allowed_aggregations: allowedAggregations(f) }));
  if (input.calculated_field) {
    const prepared = await planCalculatedField(ctx, reportId, source.datasourceId, input.calculated_field);
    if (prepared.issues.length || !prepared.preparation)
      return print({ ...base, status: 'invalid', fields, issues: prepared.issues, validation: prepared.validation });
    const { calculated_field: _calculation, ...remaining } = input;
    return print({ ...base, status: 'needs_preparation', fields, issues: [], validation: prepared.validation,
      preparation_available: ctx.config.writesEnabled && !ctx.config.dryRun && !ctx.dryRun,
      preparation: [prepared.preparation], continuation: { tool: 'component_template_plan', arguments: { ...remaining, report_id: reportId, data_source: source.datasourceId } },
      notes: [...base.notes, '계산 필드를 실제 생성한 뒤 다시 계획하여 새 필드의 ID·자료형·집계를 확인합니다.'] });
  }
  const planned = planBindings(source.fields, entry.roles.map(role => ({ ...role, kind: role.kind ?? 'unknown' })), input.bindings ?? {});
  const issues: BindingIssue[] = [...planned.issues];
  const needsInput = new Set(['missing_binding', 'ambiguous_field', 'aggregation_required']);
  if (issues.length) return print({ ...base, fields, status: issues.every(i => needsInput.has(i.code)) ? 'needs_input' : 'invalid', issues });
  const { purpose: _purpose, target, template_id: _template, connection: _connection, calculated_field: _calculation, ...desired } = input;
  const args: Record<string, unknown> = { ...desired, report_id: reportId, template_id: recommendation.template_id,
    data_source: source.datasourceId, bindings: planned.bindings, ...(target ?? {}) };
  if (input.purpose === 'share' && recommendation.template_id === 'common-detail-table') {
    if (input.common_options?.percent_of_total === false)
      return print({ ...base, fields, status: 'invalid', issues: [{ code: 'share_required', message: '비중 표에는 percent_of_total:true가 필요합니다.' }] });
    args.common_options = { ...input.common_options, percent_of_total: true };
  }
  const tool = target ? 'component_template_update' : 'component_template_add';
  const dry = dryRunContext(ctx).ctx;
  // Write-disabled servers can still inspect a plan. Only this isolated dry
  // context receives the fixed compiler tools; the live registry stays intact.
  dry.tools = new Map([...ctx.tools, ...compilerTools.map(t => [t.name, t] as const)]);
  try {
    const result = await runTool(dry, tool, { ...args, preview: true });
    if (result.isError) throw new Error(resultText(result));
    const preview = JSON.parse(resultText(result));
    if (preview.saved) throw new Error('Planning unexpectedly reported a save.');
    return print({ ...base, status: 'ready', fields, issues: [], source: { id: source.datasourceId, alias: source.alias, name: source.name },
      validation: 'public_tool_preflight', execution_available: ctx.config.writesEnabled && !ctx.config.dryRun && !ctx.dryRun,
      execution: { tool, arguments: args }, preview: { position: preview.position, size: preview.size, canvas: preview.canvas, component_count: preview.component_count, notes: preview.notes } });
  } catch (error) {
    return print({ ...base, status: 'invalid', fields, issues: [{ code: 'preflight_failed', message: errorMessage(error) }] });
  }
}
