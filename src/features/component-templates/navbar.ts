import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { listPages, pageArg, resolvePage } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';

const label = z.string().trim().min(1).max(40).refine(value => !/[\r\n]/.test(value), 'Navigation labels must fit on one line.');
export const navigationInput = z.object({
  layout: z.enum(['horizontal', 'vertical']).optional().describe('horizontal은 상단 메뉴, vertical은 왼쪽 사이드바입니다. 생략하면 기존 상단 메뉴.'),
  align: z.enum(['start', 'end']).optional().describe('상단 메뉴의 버튼 정렬. start는 왼쪽(제목이 있으면 제목 다음), end는 오른쪽. 생략하면 end.'),
  items: z.array(z.object({
    label: label.describe('메뉴에 표시할 짧은 이름.'),
    page: pageArg.describe('같은 보고서 안의 이동할 페이지 ID·이름·번호.'),
  }).strict()).min(1).max(8).describe('같은 보고서 안의 페이지 메뉴. 외부 URL·공유 동작은 지원하지 않습니다.'),
}).strict();

export interface NavbarThemeTokens {
  background: string;
  text: string;
  muted: string;
  accent: string;
  font: string;
  activeText?: string | undefined;
}
export interface NavbarInput {
  report_id: string;
  page?: string | number | undefined;
  position?: { left: number; top: number } | undefined;
  size?: { width: number; height: number } | undefined;
  texts?: Record<string, string> | undefined;
  navigation: z.infer<typeof navigationInput>;
  themeTokens: NavbarThemeTokens;
}
export interface NavbarPlan {
  layout: 'horizontal' | 'vertical';
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
  width: number;
  height: number;
  notes: string[];
  current_page_id: string;
  navigation_items: Array<{ label: string; page_id: string; active: boolean }>;
}

export function navbarEntry() {
  return {
    template_id: 'common-navbar', name: '공통 페이지 내비게이션',
    purpose: '현재 페이지를 강조하고 같은 보고서의 다른 페이지로 이동하는 메뉴입니다.',
    implementation: 'built_in_composition', validation: 'supported_pending_review', addable: true,
    design_family: 'project_theme', sizing: 'explicit_container_size', roles: [],
    navigation_required: true, layouts: ['horizontal', 'vertical'], default_layout: 'horizontal', text_inputs: [{ key: 'title', required: false }],
    notes: ['페이지별로 추가합니다. 현재 페이지의 메뉴를 자동 강조합니다.', '같은 메뉴 정의를 상단 가로 배치나 왼쪽 세로 배치로 사용할 수 있습니다.', '메뉴 변경의 전체 페이지 자동 동기화와 작은 화면의 접기 메뉴는 지원하지 않습니다.'],
  };
}

function exactPage(doc: ReportDoc, value: string | number | undefined): string {
  if (typeof value === 'string') {
    const wanted = value.trim();
    const pages = listPages(doc);
    if (!pages.some(p => p.pageId === wanted)) {
      const matches = pages.filter(p => p.name.trim().toLowerCase() === wanted.toLowerCase());
      if (matches.length > 1) throw new LookerError('invalid', `Several pages are named "${wanted}". Use their page IDs.`);
    }
  }
  return resolvePage(doc, value);
}

// Approximate space reservation, not a browser font measurement. Generous
// padding and an explicit overflow error avoid silently truncating menus.
function labelWidth(value: string, fontSize: number): number {
  return Math.ceil([...value].reduce((sum, char) => sum + (/[^\x00-\x7f]/.test(char) ? fontSize : fontSize * 0.62), 0));
}
function contrastText(color: string): string {
  const rgb = /^#([a-f\d]{6})$/i.exec(color)?.[1];
  if (!rgb) throw new LookerError('invalid', 'Navigation accent must be a six-digit hex color.');
  const linear = [0, 2, 4].map(index => {
    const channel = parseInt(rgb.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

/** Plans internal page links only. The composition runner owns preflight,
 * saving and grouping; this function does not mutate the report. */
export function planNavbar(input: NavbarInput, doc: ReportDoc): NavbarPlan {
  const parsed = navigationInput.safeParse(input.navigation);
  if (!parsed.success) throw new LookerError('invalid', parsed.error.issues.map(issue => issue.message).join('; '));
  const layout = parsed.data.layout ?? 'horizontal';
  const vertical = layout === 'vertical';
  const { width, height } = input.size ?? (vertical ? { width: 240, height: 720 } : { width: 960, height: 72 });
  const minWidth = vertical ? 160 : 320, minHeight = vertical ? 96 : 56, maxHeight = vertical ? 20000 : 160;
  if (!Number.isInteger(width) || width < minWidth || width > 20000 || !Number.isInteger(height) || height < minHeight || height > maxHeight)
    throw new LookerError('invalid', `Navigation ${layout} needs width ${minWidth}–20000px and height ${minHeight}–${maxHeight}px.`);
  const { left, top } = input.position ?? { left: 0, top: 0 };
  if (![left, top].every(value => Number.isInteger(value) && value >= 0 && value <= 20000))
    throw new LookerError('invalid', 'Navigation position must use nonnegative whole pixels up to 20000.');
  if (left + width > 20000 || top + height > 20000) throw new LookerError('invalid', 'Navigation extends beyond the 20000px page coordinate limit.');
  for (const key of Object.keys(input.texts ?? {})) if (key !== 'title') throw new LookerError('invalid', `Unknown navigation text "${key}". Use title.`);
  const brand = input.texts?.title?.trim() ?? '';
  if (brand.length > 40 || /[\r\n]/.test(brand)) throw new LookerError('invalid', 'Navigation title must be a short single line (up to 40 characters).');
  const page = exactPage(doc, input.page);
  const pages = listPages(doc);
  const items = parsed.data.items.map(item => {
    const id = exactPage(doc, item.page);
    if (pages.find(p => p.pageId === id)?.hidden) throw new LookerError('invalid', `Navigation target "${item.label}" is hidden from viewers.`);
    return { label: item.label, page: id };
  });
  if (new Set(items.map(item => item.page)).size !== items.length) throw new LookerError('invalid', 'Navigation items must target different pages.');
  if (new Set(items.map(item => item.label.toLowerCase())).size !== items.length) throw new LookerError('invalid', 'Navigation labels must be distinct.');
  const theme = input.themeTokens;
  for (const [name, value] of Object.entries(theme)) if (name !== 'font' && value !== undefined && !/^#[a-f\d]{6}$/i.test(value))
    throw new LookerError('invalid', `Navigation theme ${name} must be a six-digit hex color.`);
  if (!theme.font.trim()) throw new LookerError('invalid', 'Navigation theme needs a font family.');
  const activeText = theme.activeText ?? contrastText(theme.accent);
  const inset = 16, gap = 8, buttonHeight = vertical ? 44 : 40;
  const brandWidth = brand ? labelWidth(brand, 18) + 24 : 0;
  const widths = items.map(item => Math.max(96, labelWidth(item.label, 14) + 32));
  const menuWidth = widths.reduce((sum, value) => sum + value, 0) + gap * (items.length - 1);
  const menuTop = brand ? 80 : inset;
  if (vertical) {
    const requiredWidth = 2 * inset + Math.max(brandWidth, ...widths);
    if (requiredWidth > width) throw new LookerError('invalid', `Sidebar needs at least ${requiredWidth}px width for these labels. Widen it or shorten the labels.`);
    const requiredHeight = menuTop + items.length * buttonHeight + (items.length - 1) * gap + inset;
    if (requiredHeight > height) throw new LookerError('invalid', `Sidebar needs at least ${requiredHeight}px height for its brand and menu items.`);
  } else if (2 * inset + brandWidth + (brand ? 16 : 0) + menuWidth > width) {
    throw new LookerError('invalid', `Navigation needs at least ${2 * inset + brandWidth + (brand ? 16 : 0) + menuWidth}px for these labels. Widen it or shorten the labels.`);
  }
  const shared = { report_id: input.report_id, page };
  const steps: NavbarPlan['steps'] = [{ tool: 'shape_add', args: {
    ...shared, shape: 'rectangle', position: { left, top, width, height }, background: theme.background,
    border_radius: 12, style: { 'Border weight': 'None', 'Border shadow': false },
  } }];
  if (brand) steps.push({ tool: 'text_add', args: {
    ...shared, text: brand, font_size: 18, bold: true, color: theme.text,
    position: { left: left + inset, top: top + (vertical ? 24 : Math.round((height - 32) / 2)), width: vertical ? width - 2 * inset : brandWidth, height: 32 },
    style: { Font: theme.font },
  } });
  let x = parsed.data.align === 'start' ? left + inset + (brand ? brandWidth + 16 : 0) : left + width - inset - menuWidth;
  for (const [index, item] of items.entries()) {
    const active = item.page === page;
    steps.push({ tool: 'control_add', args: {
      ...shared, kind: 'button', button: { action: 'link', page: item.page, new_tab: false },
      position: { left: vertical ? left + inset : x, top: vertical ? top + menuTop + index * (buttonHeight + gap) : top + Math.round((height - buttonHeight) / 2), width: vertical ? width - 2 * inset : widths[index], height: buttonHeight },
      style: { Text: item.label, Font: theme.font, 'Font size': 14, 'Font color': active ? activeText : theme.text,
        Background: active ? theme.accent : theme.background, 'Border weight': 'None', 'Border radius': 8, 'Add border shadow': false },
    } });
    x += widths[index]! + gap;
  }
  return { steps, width, height, layout, current_page_id: page, navigation_items: items.map(item => ({ label: item.label, page_id: item.page, active: item.page === page })), notes: [
    '메뉴는 같은 보고서 안의 페이지로 이동하며 새 탭을 열지 않습니다.',
    ...(vertical ? ['사이드바는 보고서 캔버스에 배치됩니다. 스크롤 고정이나 접기·펼치기 동작은 포함하지 않습니다.'] : []),
    '현재 페이지 강조는 생성 시 결정됩니다. 메뉴 변경의 전체 페이지 자동 동기화·작은 화면 접기 메뉴는 아직 지원하지 않습니다.',
    '글꼴과 색상은 생성 시 프로젝트 테마에서 읽습니다. 기존 메뉴를 테마 변경에 맞춰 바꾸려면 다시 적용해야 합니다.',
  ] };
}
