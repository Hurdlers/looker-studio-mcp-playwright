import { z } from 'zod';

import { checkPage } from '../../core/check.js';
import { listPages, pageArg, resolvePage } from '../../core/page.js';
import { defineTool, text } from '../../core/tool.js';
import { components, reportIdOf, reportInput, safeText, type Json } from './common.js';
import { problemFor } from './errors.js';
import { observeRap } from './observed.js';

export const CONSENT_NOTE = 'Consent: this tool does not approve access for you. Open the report and choose Allow yourself. For viewer credentials, you can instead use datasource_update to select owner credentials; an email parameter such as @DS_USER_EMAIL may also require your approval.';

export function setupFields(component: Json): string {
  const p = component.propertyConfig?.componentProperty ?? {};
  const labels: string[] = [];
  for (const kind of ['dimensions', 'metrics'])
    for (const slot of (p[kind]?.labeledConcepts ?? []) as Json[]) {
      const label = slot.key === 'primary' ? kind === 'dimensions' ? 'Dimension' : 'Metric' : slot.key === 'breakdown' ? 'Breakdown dimension' : String(slot.key).replaceAll('_', ' ');
      const fields = ((slot.value?.conceptNames ?? []) as string[]).map((name) => {
        const concept = ((component.conceptDefs ?? []) as Json[]).find((c) => c.name === name);
        return concept?.queryTimeTransformation?.displayTransformation?.displayName ?? concept?.queryTimeTransformation?.dataTransformation?.sourceFieldName ?? name;
      });
      if (fields.length) labels.push(`${label}: ${fields.join(', ')}`);
    }
  return labels.join('; ');
}

export const reportCheck = defineTool({
  name: 'report_check',
  title: 'Check charts for data and configuration problems',
  description: 'Checks data-backed components on every page or one selected page and reports empty results, invalid fields, source errors, consent requirements and requests still loading. Use it after making changes or when a report looks wrong; checks read the current draft, include hidden pages, and never grant consent.',
  input: {
    report_id: reportInput,
    page: pageArg.optional().describe('확인할 페이지 ID, 이름 또는 1부터 센 번호. 생략하면 숨긴 페이지까지 모두 확인합니다.'),
    timeout_seconds: z.number().int().min(5).max(300).default(30).describe('차트 요청 하나를 기다리는 최대 초. 5–300의 정수이며 기본은 30초입니다.'),
  },
  write: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pages = a.page !== undefined ? listPages(doc).filter((p) => p.pageId === resolvePage(doc, a.page)) : listPages(doc);
    const observed = observeRap(ctx.rap);
    const problems: string[] = [];
    let total = 0;
    let normal = 0;
    let consent = false;
    for (const page of pages) {
      const checks = await checkPage(observed.rap, doc, page.pageId, { timeoutMs: a.timeout_seconds * 1000 });
      for (const check of checks) {
        total++;
        const component = components(doc, page.pageId).find((c) => c.componentId === check.componentId) ?? { type: check.type };
        const problem = problemFor(check, component, observed.replies.get(check.componentId), a.timeout_seconds, observed.timedOut.has(check.componentId));
        if (!problem) { normal++; continue; }
        if (problem.kind === 'consent') consent = true;
        const source = observed.sources.get(String(component.datasourceId));
        const name = (source?.published ?? source?.draft)?.datasourceBlock?.name ?? component.datasourceId ?? '(unknown source)';
        const p = component.propertyConfig?.componentProperty ?? {};
        const title = p.chartTitle ?? (Object.values(p).find((v) => v && typeof v === 'object' && 'title' in v) as Json | undefined)?.title;
        problems.push(`Page ${page.number}. ${page.name} | ${check.componentId}${check.reportLevel ? ' (report level)' : ''} | ${check.type}${title ? ` "${safeText(title)}"` : ''} | Source: ${safeText(name)} | ${safeText(setupFields(component))} | ${problem.kind}: ${problem.message}${problem.details ? `\n  Details: ${problem.details}` : ''}`);
      }
    }
    return text([`Checked ${pages.length} page${pages.length === 1 ? '' : 's'}: ${normal} normal / ${total} total.`, ...problems, ...(consent ? [CONSENT_NOTE] : [])].join('\n'));
  },
});
