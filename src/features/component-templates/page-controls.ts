import { z } from 'zod';
import { resolveField } from '../../core/components.js';
import { resolveSource } from '../../core/datasource.js';
import type { ReportDoc } from '../../core/session.js';
import { resultText, runTool, type ToolContext } from '../../core/tool.js';
import { isCommonTemplate } from './common.js';
import type { PageItem } from './page-add.js';
import { invalid } from './store.js';
import { compositionTheme } from './theme-tokens.js';

export const pageControlsInput = z.object({
  data_source: z.string().trim().min(1),
  date_range: z.string().trim().min(1),
  date_range_dimension: z.string().trim().min(1),
  dimensions: z.array(z.object({ field: z.string().trim().min(1), label: z.string().trim().min(1).max(80).optional(),
    display: z.enum(['dropdown', 'list']).optional().describe('list는 펼쳐진 고정 목록입니다. 생략 시 dropdown.'),
    visible_rows: z.number().int().min(3).max(10).optional().describe('list 높이를 정하는 표시 행 힌트. 조회 행 수를 제한하지 않습니다.'),
  }).strict().refine(d => d.visible_rows === undefined || d.display === 'list', 'visible_rows requires display:list')).max(2).optional(),
}).strict().describe('페이지 공통 기간 선택기와 최대 두 분류 필터. 일반 공통 차트만 지원하며 모든 항목의 date 역할은 이 날짜 필드와 같아야 합니다. 항목 소스 생략 시 이 소스를 사용합니다. 항목의 다른 고정 기간·독립 그룹 섹션은 거부합니다. 차트는 선택기 기간을 상속하고 비교 기간은 유지합니다.');
export type PageControls = z.infer<typeof pageControlsInput>;

export async function preparePageControls(ctx: ToolContext, doc: ReportDoc, controls: PageControls, items: PageItem[]) {
  const source = await resolveSource(ctx.rap, doc, controls.data_source);
  const date = resolveField(source.fields, controls.date_range_dimension);
  const prepared: PageItem[] = [];
  for (const item of items) {
    if (!isCommonTemplate(item.template_id)) throw invalid('Page controls support ordinary common charts only, without independently scoped sections.');
    if (item.data_source && (await resolveSource(ctx.rap, doc, item.data_source)).datasourceId !== source.datasourceId)
      throw invalid(`Page item ${item.key} must use the page controls data source.`);
    const binding = item.bindings.date, field = typeof binding === 'string' ? binding : binding?.field;
    if (!field || resolveField(source.fields, field).id !== date.id) throw invalid(`Page item ${item.key} needs the same date role as page controls.`);
    if (item.date_range !== undefined && item.date_range.trim() !== controls.date_range.trim())
      throw invalid(`Page item ${item.key} has a different date_range from page controls.`);
    prepared.push({ ...item, data_source: source.datasourceId, date_range: controls.date_range });
  }
  const dimensions = (controls.dimensions ?? []).map(d => {
    const field = resolveField(source.fields, d.field);
    return { ...d, field: field.id, label: d.label ?? field.name };
  });
  if (new Set(dimensions.map(d => d.field)).size !== dimensions.length) throw invalid('Page control dimensions must be distinct.');
  return { items: prepared, controls: { ...controls, data_source: source.datasourceId, date_range_dimension: date.id, dimensions } };
}

function pageControlSpecs(controls: PageControls) {
  return [...(controls.dimensions ?? []).map(d => {
    const label = d.label ?? d.field;
    // Reserve text plus horizontal padding and the native selection/arrow area.
    // This is a conservative creation-time estimate, not browser text measurement.
    const display = d.display ?? 'dropdown';
    return { label, field: d.field as string | undefined, display, height: display === 'list' ? 80 + (d.visible_rows ?? 3) * 38 : 44,
      preferredWidth: Math.max(display === 'list' ? 260 : 220, Array.from(label).length * 14 + 60) };
  }), { label: '기간', field: undefined as string | undefined, display: 'dropdown' as const, height: 44, preferredWidth: 280 }];
}
export function pageControlsPreferredWidth(controls: PageControls, gap: number): number {
  const specs = pageControlSpecs(controls);
  return specs.reduce((sum, entry) => sum + entry.preferredWidth, 0) + Math.max(0, specs.length - 1) * gap;
}
export function planPageControls(controls: PageControls, left: number, top: number, width: number, gap: number) {
  if (width < 240) throw invalid('Page controls need at least 240 pixels of content width.');
  const entries: Array<{ label: string; field: string | undefined; left: number; top: number; width: number; height: number; display: 'dropdown' | 'list'; captionHeight: number }> = [];
  let rowTop = top, usedWidth = 0, rowHeight = 0;
  for (const spec of pageControlSpecs(controls)) {
    const controlWidth = Math.min(width, spec.preferredWidth);
    if (usedWidth && usedWidth + gap + controlWidth > width) { rowTop += rowHeight + gap; usedWidth = 0; rowHeight = 0; }
    const offset = usedWidth ? usedWidth + gap : 0;
    entries.push({ label: spec.label, field: spec.field, left: left + offset, top: rowTop, width: controlWidth, height: spec.height, display: spec.display, captionHeight: 0 });
    usedWidth = offset + controlWidth;
    rowHeight = Math.max(rowHeight, spec.height);
  }
  return { height: rowTop - top + rowHeight + gap, entries };
}
export async function compilePageControls(ctx: ToolContext, reportId: string, pageId: string, controls: PageControls, plan: ReturnType<typeof planPageControls>) {
  const theme = compositionTheme(await ctx.session.load(reportId));
  const style = { Font: theme.font, 'Font size': 14, 'Font color': theme.text,
    Background: theme.background, 'Border color': theme.muted, 'Border weight': '1', 'Border opacity': 1,
    'Border radius': 6, 'Add border shadow': false,
    'Top padding': 0, 'Left padding': 12, 'Right padding': 12, 'Center vertically': true, 'Line height': 20 };
  for (const entry of plan.entries) {
    const result = await runTool(ctx, 'control_add', { report_id: reportId, page: pageId,
      kind: entry.field ? (entry.display === 'list' ? 'fixed_size_list' : 'drop_down') : 'date_range', ...(entry.field ? {
        data_source: controls.data_source, field: entry.field, date_range_dimension: controls.date_range_dimension,
        labels: { [entry.field]: entry.label },
      } : { date_range: controls.date_range }),
      style: { ...style, ...(entry.field ? { 'Show values': false, 'Enable search box': true,
        'Allow "Select all"': true, 'Single-select': false, 'Label position': 'Left (Legacy)', 'List text size': 14 } : {}) },
      position: { left: entry.left, top: entry.top, width: entry.width, height: entry.height } });
    if (result.isError || /Not applied:/i.test(resultText(result))) throw invalid(`Page controls could not be compiled: ${resultText(result)}`);
  }
}
