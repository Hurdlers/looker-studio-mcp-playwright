import { LookerError } from '../../core/errors.js';

export interface PageLayoutItem {
  key: string;
  span?: number | undefined;
  height: number;
  min_width: number;
}
export interface PageLayoutInput {
  width: number;
  columns: number;
  gap: number;
  padding: number;
  header_height?: number | undefined;
  sidebar_width?: number | undefined;
  sidebar_min_height?: number | undefined;
  items: PageLayoutItem[];
}
export interface PositionedPageItem {
  key: string;
  position: { left: number; top: number };
  size: { width: number; height: number };
}
export interface PageLayoutPlan {
  width: number;
  height: number;
  columns: number;
  items: PositionedPageItem[];
  sidebar?: { position: { left: number; top: number }; size: { width: number; height: number } };
  notes: string[];
}

const LIMIT = 20_000;
function integer(value: number, name: string, min: number, max = LIMIT): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new LookerError('invalid', `${name} must be an integer from ${min} to ${max}.`);
}

/** Lay out complete components in input order. Columns may decrease to keep
 * every component above its minimum width; its supplied height is never scaled.
 * This is creation-time layout, not browser-viewport responsive behavior. */
export function planPageLayout(input: PageLayoutInput): PageLayoutPlan {
  integer(input.width, 'Page width', 1);
  integer(input.columns, 'Column count', 1, 4);
  integer(input.gap, 'Gap', 0);
  integer(input.padding, 'Padding', 0);
  if (input.header_height !== undefined) integer(input.header_height, 'Header height', 0);
  if (input.sidebar_width !== undefined) integer(input.sidebar_width, 'Sidebar width', 160);
  if (input.sidebar_min_height !== undefined) {
    if (input.sidebar_width === undefined) throw new LookerError('invalid', 'sidebar_min_height requires sidebar_width.');
    integer(input.sidebar_min_height, 'Sidebar minimum height', 96);
  }
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100)
    throw new LookerError('invalid', 'A page layout needs from 1 to 100 items.');
  const keys = new Set<string>();
  for (const item of input.items) {
    if (typeof item.key !== 'string' || !item.key.trim() || keys.has(item.key))
      throw new LookerError('invalid', 'Every page layout item needs a unique nonempty key.');
    keys.add(item.key);
    integer(item.height, `${item.key} height`, 1);
    integer(item.min_width, `${item.key} minimum width`, 1);
    integer(item.span ?? 1, `${item.key} column span`, 1, input.columns);
  }
  const contentLeft = input.padding + (input.sidebar_width === undefined ? 0 : input.sidebar_width + input.gap);
  const contentWidth = input.width - contentLeft - input.padding;
  if (contentWidth < 1) throw new LookerError('invalid', 'Page width leaves no room after the sidebar and padding.');

  // Integer rounding can make a cell one pixel narrower than its neighbor.
  // Use the narrowest spanned width, so no row start violates a minimum.
  let columns = input.columns;
  const fits = (count: number) => input.items.every(item => {
    const span = Math.min(item.span ?? 1, count);
    return Math.floor((contentWidth + input.gap) * span / count) - input.gap >= item.min_width;
  });
  while (columns > 1 && !fits(columns)) columns--;
  if (!fits(columns)) throw new LookerError('invalid', 'Page content width is smaller than a component minimum. Widen the page or reduce the sidebar and padding.');

  let column = 0, top = input.padding + (input.header_height ?? 0), rowHeight = 0;
  const items: PositionedPageItem[] = [];
  for (const item of input.items) {
    const span = Math.min(item.span ?? 1, columns);
    if (column + span > columns) {
      top += rowHeight + input.gap;
      column = 0; rowHeight = 0;
    }
    const start = Math.floor((contentWidth + input.gap) * column / columns);
    const end = Math.floor((contentWidth + input.gap) * (column + span) / columns) - input.gap;
    items.push({ key: item.key, position: { left: contentLeft + start, top }, size: { width: end - start, height: item.height } });
    rowHeight = Math.max(rowHeight, item.height);
    column += span;
  }
  const contentHeight = top + rowHeight - input.padding;
  const bodyHeight = Math.max(contentHeight, input.sidebar_width === undefined ? 0 : input.sidebar_min_height ?? 720);
  const height = input.padding * 2 + bodyHeight;
  integer(height, 'Required page height', 1);
  return {
    width: input.width, height, columns, items,
    ...(input.sidebar_width === undefined ? {} : { sidebar: {
      position: { left: input.padding, top: input.padding }, size: { width: input.sidebar_width, height: bodyHeight },
    } }),
    notes: [
      ...(columns === input.columns ? [] : [`차트의 최소 폭을 유지하기 위해 열 수를 ${input.columns}개에서 ${columns}개로 줄였습니다.`]),
      '입력 순서대로 배치하고 필요한 페이지 높이를 계산합니다. 브라우저 폭 변경에 따른 자동 재배치는 아닙니다.',
    ],
  };
}
