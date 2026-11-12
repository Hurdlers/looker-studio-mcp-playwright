import { z } from 'zod';

import { pageArg, resolvePage } from '../../core/page.js';
import { defineTool, text } from '../../core/tool.js';
import { openReport, screenshotReport } from '../../looker/view.js';
import { reportIdOf, reportInput } from './common.js';

export const reportShow = defineTool({
  name: 'report_show',
  title: 'Open a report for viewing',
  description: 'Brings a chosen report page to the front in the worker tab and optionally returns a browser screenshot. Use it when you want to view navigation or other browser-only presentation; opening and capturing the page does not change the report.',
  input: {
    report_id: reportInput,
    page: pageArg.optional().describe('열 페이지의 ID, 이름 또는 1부터 센 번호. 생략하면 첫 페이지입니다.'),
    edit: z.boolean().default(false).describe('true이면 편집 화면을 열고, 기본은 보기 화면입니다.'),
    screenshot: z.boolean().default(false).describe('true이면 차트 로딩을 기다린 후 브라우저 화면 이미지도 반환합니다. 작업 탭을 앞으로 가져옵니다.'),
  },
  write: false, readOnlyHint: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const pageId = resolvePage(await ctx.session.load(reportId), a.page);
    const options = { pageId, edit: a.edit };
    if (!a.screenshot) {
      await openReport(ctx.worker, reportId, options);
      await ctx.worker.cdp('Page.bringToFront', {});
      return text(`Opened page ${pageId} in ${a.edit ? 'edit' : 'view'} mode.`);
    }
    const shot = await screenshotReport(ctx.worker, reportId, options);
    return { content: [{ type: 'image', data: shot.data, mimeType: shot.mimeType }, { type: 'text', text: `Opened page ${pageId} in ${a.edit ? 'edit' : 'view'} mode and captured the browser in ${shot.ms} ms.${shot.settled ? '' : ' Some charts were still loading.'}` }] };
  },
});
