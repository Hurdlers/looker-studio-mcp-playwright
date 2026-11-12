import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { pageArg, resolvePage } from '../../core/page.js';
import { renderChecked } from '../../core/render.js';
import { defineTool, resultText, runTool, text, type Content } from '../../core/tool.js';
import { CONSENT_NOTE } from './check.js';
import { components, reportIdOf, reportInput, safeText, type Json } from './common.js';
import { problemFor } from './errors.js';
import { observeRap } from './observed.js';

export const reportRender = defineTool({
  name: 'report_render',
  title: 'Render a report page',
  description: 'Returns a server-rendered page as a PNG with saved file paths, or a PDF path when no image converter is installed. Use it to inspect a finished page while the worker remains in the background; chart data is requested first, and manual publishing makes the server render the published version. Set refresh_data:true to request the editor data refresh once before rendering when source changes leave stale cached values. Refreshing requires writes_enabled; dry-run skips both the refresh and rendering. Service freshness limits still apply.',
  input: {
    report_id: reportInput,
    page: pageArg.optional().describe('페이지 ID, 이름 또는 1부터 센 번호. 생략하면 내비게이션의 첫 페이지를 그립니다.'),
    refresh_data: z.boolean().default(false).describe('렌더 전에 보고서 데이터 새로고침을 한 번 요청합니다. 기본false이며 true에는 쓰기 허용이 필요합니다. 열 구조 변경이나 게시 작업은 하지 않습니다.'),
  },
  write: false, readOnlyHint: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const pageId = resolvePage(doc, a.page);
    if (a.refresh_data) {
      const refreshed = await runTool(ctx, 'report_data_refresh', { report_id: reportId });
      if (refreshed.isError) return refreshed;
      if (ctx.dryRun || ctx.config.dryRun) return text(`${resultText(refreshed)}\nRendering skipped: the requested data refresh was not applied in dry-run.`);
    }
    const observed = observeRap(ctx.rap);
    const out = await renderChecked(observed.rap, doc, pageId, { dir: join(ctx.home, 'renders'), name: `${reportId}-${pageId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}-${randomBytes(3).toString('hex')}` });
    const pageComponents = components(doc, pageId);
    const warnings = out.checks.flatMap((check) => {
      const component = pageComponents.find((entry) => entry.componentId === check.componentId) ?? { type: check.type };
      const problem = problemFor(check, component, observed.replies.get(check.componentId), 60, observed.timedOut.has(check.componentId));
      return problem ? [`${safeText(check.componentId)}: ${problem.kind}: ${problem.message}`] : [];
    });
    const affected: string[] = [];
    for (const component of pageComponents) {
      const raw = observed.sources.get(String(component.datasourceId));
      const source = raw?.published ?? raw?.draft;
      if (!source) continue;
      const emailParam = ((source.blocks ?? []) as Json[]).some((block) => /@DS_USER_EMAIL\b/i.test(String(block.connectorBlockConfig?.connectorConfig?.sql ?? '')));
      if (source.delegatedAccessEnabled === false || emailParam) affected.push(String(component.componentId));
    }
    const lines = [`Rendered page ${pageId} in ${out.render.ms} ms.`, `PDF: ${out.render.pdf}`, ...(out.render.png ? [`PNG: ${out.render.png}`] : ['No PNG converter succeeded; open the PDF.']), 'When manual publishing is enabled, this render shows the published version.', ...(warnings.length ? ['Data check warnings (current draft):', ...warnings] : []), ...(affected.length ? [`Consent may be required for components: ${[...new Set(affected)].join(', ')}. ${CONSENT_NOTE}`] : [])];
    const content: Content[] = [{ type: 'text', text: lines.join('\n') }];
    if (out.render.png) content.unshift({ type: 'image', data: (await readFile(out.render.png)).toString('base64'), mimeType: 'image/png' });
    return { content };
  },
});
