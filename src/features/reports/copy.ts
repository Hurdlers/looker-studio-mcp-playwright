import { z } from 'zod';

import { buildConnectionConfig, findConnector } from '../../connectors/registry.js';
import { ga4Config } from '../../connectors/ga4.js';
import { editDatasource, renameDatasource, type BlockDatasource } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { reportUrl } from '../../looker/reports.js';
import { foldColumns, readColumns } from '../data-sources/columns.js';
import { reportIdInput, reportIdOf } from '../data-sources/inputs.js';
import { pickSource, sourceRefs, type SourceRef } from '../data-sources/sources.js';
import { checkConnector, checkQuery, consentNote, nameOf, planSource, sourceInput, type SourceInput, type SourcePlan } from './source.js';

type Json = Record<string, any>;
const replacementInput = z.object({
  original: z.string().describe('원본 데이터 소스의 별칭, id 또는 이름.'),
  reusable: z.string().optional().describe('대신 연결할 재사용 데이터 소스의 이름 또는 id. 다른 연결 입력과 함께 쓸 수 없습니다.'),
  ...sourceInput,
});
type Replacement = z.infer<typeof replacementInput>;
interface Prepared {
  input: Replacement;
  original: SourceRef;
  plan?: SourcePlan;
  reusableId?: string;
}

function usedIds(doc: ReportDoc): string[] {
  const components = [...doc.page.flatMap((page) => page.page.componentConfig ?? []), ...(doc.report.componentConfig ?? [])];
  return [...new Set([
    ...components.flatMap((component) => typeof component.datasourceId === 'string' ? [component.datasourceId] : []),
    ...(doc.report.resource?.datasourceAlias ?? []).map((alias) => alias.datasourceId),
  ])];
}

async function reusableId(ctx: ToolContext, wanted: string): Promise<string> {
  const result = await ctx.rap.call<{ datasourceInfo?: Array<{ shareableConfig?: { id?: string; name?: string }; isEmbedded?: boolean }> }>('getDatasourceList', { type: [1], trashed: false });
  const available = (result.datasourceInfo ?? []).filter((source) => !source.isEmbedded && source.shareableConfig?.id);
  const want = wanted.trim().toLowerCase();
  const matches = available.filter((source) => source.shareableConfig!.id!.toLowerCase() === want || source.shareableConfig!.name?.trim().toLowerCase() === want);
  if (matches.length !== 1)
    throw new LookerError('invalid', `Reusable source "${wanted}" ${matches.length ? 'is ambiguous' : 'was not found'}. Available: ${available.map((source) => source.shareableConfig?.name ?? source.shareableConfig?.id).join(', ') || 'none'}. Give an unambiguous name or id.`);
  return matches[0]!.shareableConfig!.id!;
}

async function reconnect(ctx: ToolContext, reportId: string, datasourceId: string, originalId: string, plan: SourcePlan): Promise<string | undefined> {
  if (datasourceId === originalId) throw new LookerError('refused', 'The copied source still has the original id: refusing to change the original data source.');
  const got = await ctx.rap.call<BlockDatasource>('getBlockDatasource', { datasourceId });
  if (got.embeddedInReportId !== reportId)
    throw new LookerError('refused', 'The copied source is not embedded in the new report: refusing to change a reusable or unrelated source.');
  const block = (got.draft ?? got.published) as Json | undefined;
  if (!block?.blocks?.[0]?.connectorBlockConfig) throw new LookerError('format_changed', 'The copied data source has no connector block.');
  const config = { ...structuredClone(block.blocks[0].connectorBlockConfig), connectorConfig: buildConnectionConfig(plan.connection, plan.params) };
  if (plan.connection.connector === 'bigquery') {
    // Reconnection retains existing field definitions. Keep their date mode
    // too: the default for a newly created source is not a legacy migration.
    const previous = block.blocks[0].connectorBlockConfig.connectorConfig;
    if (Object.prototype.hasOwnProperty.call(previous, 'useDatetimeType')) config.connectorConfig.useDatetimeType = previous.useDatetimeType;
    else delete config.connectorConfig.useDatetimeType;
  }
  const columns = await readColumns(ctx, config);
  const rename = 'sql' in plan.source ? plan.explicitName : true;
  await editDatasource(ctx.rap, reportId, datasourceId, (draft) => {
    const source = draft as Json;
    source.blocks[0].connectorBlockConfig = structuredClone(config);
    foldColumns(source, columns);
    source.blocks[0].fields = columns.filter((column) => column.mutableVersion);
    if (rename) source.datasourceBlock.name = plan.name;
  }, 'reconnect copied source');
  if (rename) await renameDatasource(ctx.rap, datasourceId, plan.name);
  return consentNote(ctx, datasourceId, plan.params);
}

export const reportCopy = defineTool({
  name: 'report_copy',
  title: 'Copy a report',
  description: 'Duplicates a report under a new title while preserving its data connections. Optionally replace named sources with reusable sources or reconnect the copied embedded sources to BigQuery tables or queries, Google Sheets or GA4 properties; reconnection must keep the original connector type. Queries and connector field access are checked before the copy is made and the original sources are left untouched.',
  input: {
    report_id: reportIdInput,
    name: z.string().describe('사본의 이름.'),
    data_sources: z.array(replacementInput).default([]).describe('바꿀 데이터 소스 목록. 생략하면 모든 연결을 그대로 복사합니다.'),
  },
  write: true,
  run: async (ctx, input) => {
    const name = nameOf(input.name, 'Copy name');
    const reportId = reportIdOf(input.report_id);
    const originals = input.data_sources.map((source) => nameOf(source.original, 'original').toLowerCase());
    if (new Set(originals).size !== originals.length) throw new LookerError('invalid', 'Each original data source may be replaced only once.');
    // Validate all inputs and queries before even reading the source report.
    const plans = new Map<Replacement, SourcePlan>();
    for (const source of input.data_sources) {
      checkConnector(source);
      if (source.reusable !== undefined) {
        nameOf(source.reusable, 'reusable');
        if (Object.keys(source).some((key) => !['original', 'reusable'].includes(key) && source[key as keyof Replacement] !== undefined))
          throw new LookerError('invalid', 'reusable cannot be combined with connector, project_id, source_name or other connection inputs.');
      } else plans.set(source, await planSource(ctx, source as SourceInput));
    }
    for (const plan of plans.values()) await checkQuery(ctx, plan);
    const doc = await ctx.session.load(reportId);
    const refs = input.data_sources.length ? await sourceRefs(ctx.rap, doc) : [];
    const prepared: Prepared[] = [];
    const resolved = new Set<string>();
    for (const source of input.data_sources) {
      const original = pickSource(refs, reportId, source.original);
      if (resolved.has(original.datasourceId)) throw new LookerError('invalid', 'Two replacements refer to the same original data source.');
      resolved.add(original.datasourceId);
      if (source.reusable !== undefined) prepared.push({ input: source, original, reusableId: await reusableId(ctx, source.reusable) });
      else {
        const got = await ctx.rap.call<BlockDatasource>('getBlockDatasource', { datasourceId: original.datasourceId });
        if (got.embeddedInReportId !== reportId)
          throw new LookerError('invalid', `Source "${original.name}" is reusable or belongs to another report. Only an embedded source can be reconnected while copying.`);
        const originalBlock = (got.draft ?? got.published) as Json | undefined;
        const originalConfig = originalBlock?.blocks?.[0]?.connectorBlockConfig?.connectorConfig;
        const originalConnector = findConnector(originalConfig);
        if (originalConnector?.id === 'ga4' && !ga4Config(originalConfig))
          throw new LookerError('refused', 'The original GA4 source has settings this connector cannot preserve. Reconnection cannot silently remove segments or unknown connection options.');
        const plan = plans.get(source)!;
        if (originalConnector?.id !== plan.connection.connector)
          throw new LookerError('refused', 'Copy reconnection must keep the same connector type because field IDs differ between connectors. Create a new report with the target connector and bind its fields with component_template_add or chart_add instead.');
        prepared.push({ input: source, original, plan });
      }
    }
    const map = Object.fromEntries(usedIds(doc).map((id) => [id, id]));
    for (const item of prepared) if (item.reusableId) map[item.original.datasourceId] = item.reusableId;
    const projectNumber = await ctx.worker.run(
      () => (window as unknown as { preload?: { myDataStudioConfig?: { projectNumber?: string } } }).preload?.myDataStudioConfig?.projectNumber ?? '', null,
    );
    const copied = await ctx.rap.call<{ url?: string }>('copyReport', { projectNumber, reportId, datasourceMap: JSON.stringify(map), region: 'global' }, undefined, 'form');
    if (!copied.url) throw new LookerError('format_changed', 'copyReport returned no new report URL.');
    const copyId = reportIdOf(copied.url);
    if (copyId === reportId) throw new LookerError('format_changed', 'copyReport returned the original report id; no changes were made to the original.');
    try {
      const saved = await ctx.session.renameReport(copyId, name);
      const notes: string[] = [];
      if (prepared.length) {
        const copy = await ctx.session.load(copyId);
        for (const item of prepared) {
          const target = copy.report.resource?.datasourceAlias?.find((source) => source.alias === item.original.alias)?.datasourceId;
          if (!target) throw new LookerError('format_changed', `The copy has no data source for alias ${item.original.alias}.`);
          if (item.reusableId && target !== item.reusableId)
            throw new LookerError('format_changed', `The copied source ${item.original.alias} does not point to the requested reusable source.`);
          if (item.plan) {
            const note = await reconnect(ctx, copyId, target, item.original.datasourceId, item.plan);
            if (note) notes.push(note);
          }
        }
      }
      return { ...text([`Copied to "${name}" | ${copyId} | ${reportUrl(copyId)}`, ...notes].join('\n')), audit: { reportId: copyId, version: saved.version, ...(saved.snapshot ? { snapshot: saved.snapshot } : {}) } };
    } catch (error) {
      throw new LookerError(error instanceof LookerError ? error.code : 'invalid', `${error instanceof Error ? error.message : 'Copy setup failed.'} The copy exists: ${copyId} (${reportUrl(copyId)}). Inspect it or remove it with report_delete.`);
    }
  },
});
