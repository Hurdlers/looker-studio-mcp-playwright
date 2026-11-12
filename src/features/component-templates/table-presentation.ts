import { z } from 'zod';
import type { compositionTheme } from './theme-tokens.js';
import { invalid } from './store.js';

export const tablePresentationInput = z.object({
  table_header: z.enum(['surface', 'inverse']).optional().describe('표 머리글의 배경/글자 역할. surface는 테마 표면/본문, inverse는 본문/표면 색을 사용합니다.'),
  share_display: z.enum(['number', 'heatmap']).optional().describe('이미 선택한 비중 열의 표시 방식. percent_of_total:true가 필요하며 비중 계산을 새로 만들지 않습니다.'),
}).strict();
export type TablePresentation = z.infer<typeof tablePresentationInput>;
interface Options { presentation?: TablePresentation | undefined; percent_of_total?: boolean | undefined }

/** Validate display choices independently from the family/data planner. */
export function validateTablePresentation(templateId: string, options: Options): void {
  if (options.presentation === undefined) return;
  if (templateId !== 'common-detail-table') throw invalid('presentation currently supports common-detail-table only.');
  const presentation = tablePresentationInput.parse(options.presentation);
  if (presentation.share_display !== undefined && options.percent_of_total !== true)
    throw invalid('share_display needs an existing share column selected with percent_of_total:true. Presentation does not add that calculation.');
}

/** Only appearance keys are returned: no fields, calculations or native types. */
export function planTablePresentation(templateId: string, theme: ReturnType<typeof compositionTheme>, options: Options = {}): Record<string, unknown> {
  validateTablePresentation(templateId, options);
  const p = options.presentation;
  if (!p) return {};
  return {
    ...(p.table_header ? {
      'Header background color': p.table_header === 'surface' ? theme.background : theme.text,
      'Header font color': p.table_header === 'surface' ? theme.text : theme.background,
    } : {}),
    ...(p.share_display ? {
      'Metric column type#2': p.share_display === 'heatmap' ? 'Heatmap' : 'Number',
      'Show metric value#2': true,
      ...(p.share_display === 'heatmap' ? { 'Metric column color#2': theme.series } : {}),
    } : {}),
  };
}
