import { LookerError } from '../../core/errors.js';
import type { PageItem } from './page-add.js';
import type { PositionedPageItem } from './page-layout.js';
import { COMMON_LAYOUTS, commonLayoutHeight, planCommonLayout, type CommonLayoutFamily } from './layout.js';

export type AnalysisRegionKind = 'kpi-group' | 'kpi-trend' | 'table-trend' | 'table-share' | 'block';
export interface AnalysisRegion { key: string; kind: AnalysisRegionKind; title: string; items: PageItem[]; kpi_columns?: 1 | 2 | undefined;
  /** Width in twelfths of the page. Consecutive regions with a share sit side by side. */
  share?: number | undefined }
export interface AnalysisRegionPlanInput {
  regions: AnalysisRegion[];
  width: number;
  left: number;
  top: number;
  gap: number;
  padding?: number | undefined;
  minimumWidths?: ReadonlyMap<string, number> | undefined;
  /** Regions whose title sits in a colored band: the band hugs the title instead of using the box padding. */
  bandKeys?: ReadonlySet<string> | undefined;
}
interface Box { left: number; top: number; width: number; height: number }
export interface PositionedAnalysisRegion {
  key: string;
  kind: AnalysisRegionKind;
  title: string;
  box: Box;
  titleBox: Box;
  items: PositionedPageItem[];
}
export interface AnalysisRegionsPlan { regions: PositionedAnalysisRegion[]; height: number; notes: string[] }
const LIMIT = 20_000;
const families: Record<string, CommonLayoutFamily> = {
  'common-kpi': 'kpi', 'common-time-trend': 'time-trend', 'common-category-line': 'category-line',
  'common-detail-table': 'detail-table', 'common-radial-share': 'radial-share',
  'common-category-bars': 'category-bars', 'common-area-trend': 'area-trend', 'common-mixed-series': 'mixed-series',
  'common-pivot-table': 'pivot-table', 'common-xy-scatter': 'xy-scatter',
};
const BLOCK_ONLY = new Set(['common-category-bars', 'common-area-trend', 'common-mixed-series', 'common-pivot-table', 'common-xy-scatter']);
// Reading room each structure asks for inside one row. A share ring reads
// at a small size; a cross table needs the most. Layout choice only.
const BLOCK_WEIGHTS: Partial<Record<CommonLayoutFamily, number>> = { 'radial-share': 1, 'pivot-table': 3 };
function invalid(message: string): never { throw new LookerError('invalid', message); }
function integer(value: number, name: string, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum || value > LIMIT) invalid(`${name} must be an integer from ${minimum} to ${LIMIT}.`);
}

/** Creation-time geometry only. No source fields, report theme or native groups
 * are read or changed. Ratios are explicit layout choices, not source coordinates. */
export function planAnalysisRegions(input: AnalysisRegionPlanInput): AnalysisRegionsPlan {
  const padding = input.padding ?? 24;
  integer(input.width, 'Region width', 1); integer(input.left, 'Left'); integer(input.top, 'Top');
  integer(input.gap, 'Gap'); integer(padding, 'Padding');
  if (input.left + input.width > LIMIT) invalid('The regions exceed the horizontal coordinate limit.');
  if (!Array.isArray(input.regions) || input.regions.length < 1 || input.regions.length > 100) invalid('Use from 1 to 100 analysis regions.');
  const regionKeys = new Set<string>(), itemKeys = new Set<string>();
  const notes = ['영역 표면과 제목은 호출자가 만들고 자식 차트는 기본 plain 표면으로 배치합니다. 네이티브 그룹은 만들지 않습니다.',
    '생성 시 가용 폭에 맞춰 배치합니다. 브라우저 크기 변경에 따른 재배치는 아닙니다.'];
  const regions: PositionedAnalysisRegion[] = [];
  const layoutRegion = (region: AnalysisRegion, regionLeft: number, regionWidth: number, top: number): PositionedAnalysisRegion => {
    const innerWidth = regionWidth - padding * 2;
    if (innerWidth < 1) invalid(`Region ${region.key} is too narrow for its padding.`);
    if (!region.key?.trim() || regionKeys.has(region.key.trim())) invalid('Region keys must be nonempty and unique.');
    regionKeys.add(region.key.trim());
    if (!region.title?.trim()) invalid('Every analysis region needs a title.');
    if (!Array.isArray(region.items)) invalid('Every region needs items.');
    const types = region.items.map(item => item.template_id);
    const kpi = (type: string) => type === 'common-kpi';
    const trend = (type: string | undefined) => type === 'common-time-trend' || type === 'common-category-line';
    const valid = region.kind === 'kpi-group' ? types.length >= 2 && types.length <= 6 && types.every(kpi)
      : region.kind === 'kpi-trend' ? types.length >= 2 && types.length <= 5 && types.slice(0, -1).every(kpi) && trend(types.at(-1))
      : region.kind === 'table-trend' ? types.length === 2 && types[0] === 'common-detail-table' && trend(types[1])
      : region.kind === 'table-share' ? types.length === 2 && types[0] === 'common-detail-table' && types[1] === 'common-radial-share'
      : region.kind === 'block' ? types.length >= 1 && types.length <= 8 && types.every(type => families[type] !== undefined) : false;
    if (region.kind !== 'block' && types.some(type => BLOCK_ONLY.has(type))) invalid(`Region ${region.key} accepts this chart kind in a block region only.`);
    if (!valid) invalid(`The child chart kinds or count do not match region ${region.key}.`);
    if (region.kpi_columns !== undefined && (region.kind !== 'kpi-trend' || ![1, 2].includes(region.kpi_columns))) invalid('kpi_columns accepts 1 or 2 on kpi-trend only.');
    if (region.kpi_columns === 2 && types.length < 3) invalid('Two KPI columns need at least two KPI charts.');
    const measured = region.items.map(item => {
      if (!item.key?.trim() || itemKeys.has(item.key.trim())) invalid('Item keys must be nonempty and unique across all regions.');
      itemKeys.add(item.key.trim());
      if (item.span !== undefined) invalid('Region items do not accept span; the region kind owns placement.');
      const family = families[item.template_id]!;
      const options = item.common_options ?? {};
      // A progress bar under a KPI needs its own line below the comparison text.
      const height = item.height ?? commonLayoutHeight(family, options.density, options.visible_rows) + (family === 'kpi' && options.progress ? 16 : 0);
      // Reuse existing size validation, including compact table exceptions.
      planCommonLayout(family, { width: COMMON_LAYOUTS[family].minimum.width, height }, {}, { density: options.density, visibleRows: options.visible_rows });
      const override = input.minimumWidths?.get(item.key);
      if (override !== undefined) integer(override, `${item.key} minimum width`, 1);
      return { item, family, height, minWidth: Math.max(COMMON_LAYOUTS[family].minimum.width, override ?? 0) };
    });
    if (measured.some(item => innerWidth < item.minWidth)) invalid(`Region ${region.key} is narrower than a child chart minimum after padding.`);
    const titleLines = region.title.trim().split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length * 20 / innerWidth)), 0);
    const band = input.bandKeys?.has(region.key) === true;
    const titleBox = { left: regionLeft + padding, top: top + (band ? 8 : padding), width: innerWidth, height: titleLines * 32 };
    const bodyTop = titleBox.top + titleBox.height + (band ? 24 : 16);
    const placed: PositionedPageItem[] = [];
    const place = (index: number, left: number, y: number, width: number) => {
      const m = measured[index]!;
      planCommonLayout(m.family, { width, height: m.height }, {}, { density: m.item.common_options?.density, visibleRows: m.item.common_options?.visible_rows });
      placed.push({ key: m.item.key, position: { left, top: y }, size: { width, height: m.height } });
    };
    if (region.kind === 'block') {
      // One question, any charts. KPI charts form a narrow cluster beside the
      // first row of the other charts; the rest fill rows by reading weight.
      const kpis = measured.flatMap((m, index) => m.family === 'kpi' ? [index] : []);
      const bodies = measured.flatMap((m, index) => m.family === 'kpi' ? [] : [index]);
      const rowOf = (queue: number[], width: number) => {
        const row: number[] = [];
        // Spread charts evenly over the rows they need (four become two and two), not three and one.
        const target = Math.ceil(queue.length / Math.ceil(queue.length / 3));
        while (queue.length && row.length < target) {
          const next = queue[0]!;
          const needed = [...row, next].reduce((sum, i) => sum + measured[i]!.minWidth, 0) + input.gap * row.length;
          if (row.length && needed > width) break;
          row.push(queue.shift()!);
        }
        return row;
      };
      const placeRow = (row: number[], left: number, y: number, width: number) => {
        const available = width - input.gap * (row.length - 1);
        const weight = (i: number) => BLOCK_WEIGHTS[measured[i]!.family] ?? 2;
        const widths = new Map<number, number>();
        let open = [...row], remaining = available;
        // Give each chart its weighted share; a chart below its minimum keeps the minimum.
        for (;;) {
          const total = open.reduce((sum, i) => sum + weight(i), 0);
          const short = open.filter(i => Math.floor(remaining * weight(i) / total) < measured[i]!.minWidth);
          if (!short.length) { for (const i of open) widths.set(i, Math.floor(remaining * weight(i) / total)); break; }
          for (const i of short) { widths.set(i, measured[i]!.minWidth); remaining -= measured[i]!.minWidth; }
          open = open.filter(i => !short.includes(i));
          if (!open.length) break;
        }
        const last = row.at(-1)!;
        widths.set(last, widths.get(last)! + available - row.reduce((sum, i) => sum + widths.get(i)!, 0));
        let x = left;
        for (const i of row) { place(i, x, y, widths.get(i)!); x += widths.get(i)! + input.gap; }
        return y + Math.max(...row.map(i => measured[i]!.height)) + input.gap;
      };
      const placeKpis = (left: number, y: number, width: number, columns: number) => {
        let rowTop = y;
        for (let start = 0; start < kpis.length; start += columns) {
          const row = kpis.slice(start, start + columns);
          for (let col = 0; col < row.length; col++) {
            const a = Math.floor((width + input.gap) * col / columns), b = Math.floor((width + input.gap) * (col + 1) / columns) - input.gap;
            place(row[col]!, left + a, rowTop, b - a);
          }
          rowTop += Math.max(...row.map(i => measured[i]!.height)) + input.gap;
        }
        return rowTop;
      };
      const queue = [...bodies];
      let y = bodyTop;
      if (kpis.length) {
        const kpiMinimum = COMMON_LAYOUTS.kpi.minimum.width;
        const sideColumns = kpis.length >= 3 ? 2 : 1, sideMinimum = sideColumns * kpiMinimum + input.gap * (sideColumns - 1);
        const firstMinimum = queue.length ? measured[queue[0]!]!.minWidth : 0;
        if (queue.length && innerWidth >= sideMinimum + input.gap + firstMinimum) {
          const available = innerWidth - input.gap;
          const clusterWidth = Math.max(sideMinimum, Math.min(available - firstMinimum, Math.floor(available * (sideColumns === 2 ? 0.34 : 0.22))));
          const kpiBottom = placeKpis(titleBox.left, y, clusterWidth, sideColumns);
          const rowBottom = placeRow(rowOf(queue, available - clusterWidth), titleBox.left + clusterWidth + input.gap, y, available - clusterWidth);
          y = Math.max(kpiBottom, rowBottom);
        } else {
          const columns = Math.min(kpis.length, Math.max(1, Math.floor((innerWidth + input.gap) / (kpiMinimum + input.gap))));
          y = placeKpis(titleBox.left, y, innerWidth, columns);
          if (queue.length) notes.push(`${region.key}: 최소 차트 폭을 유지하려고 KPI 아래에 차트를 배치했습니다.`);
        }
      }
      while (queue.length) y = placeRow(rowOf(queue, innerWidth), titleBox.left, y, innerWidth);
    } else if (region.kind === 'kpi-group') {
      const columns = Math.min(measured.length, Math.max(1, Math.floor((innerWidth + input.gap) / (COMMON_LAYOUTS.kpi.minimum.width + input.gap))));
      let rowTop = bodyTop;
      for (let start = 0; start < measured.length; start += columns) {
        const count = Math.min(columns, measured.length - start);
        for (let col = 0; col < count; col++) {
          const a = Math.floor((innerWidth + input.gap) * col / count), b = Math.floor((innerWidth + input.gap) * (col + 1) / count) - input.gap;
          place(start + col, titleBox.left + a, rowTop, b - a);
        }
        rowTop += Math.max(...measured.slice(start, start + count).map(m => m.height)) + input.gap;
      }
      if (columns < measured.length) notes.push(`${region.key}: KPI를 여러 행으로 배치했습니다.`);
    } else if (region.kind === 'kpi-trend' && region.kpi_columns === 2) {
      const count = measured.length - 1, gridMinimum = 2 * COMMON_LAYOUTS.kpi.minimum.width + input.gap;
      const trendMinimum = measured[count]!.minWidth;
      const sideBySide = innerWidth >= gridMinimum + input.gap + trendMinimum;
      const available = innerWidth - input.gap;
      const gridWidth = sideBySide ? Math.max(gridMinimum, Math.min(available - trendMinimum, Math.floor(available * 0.4))) : innerWidth;
      const columns = gridWidth >= gridMinimum ? 2 : 1;
      let rowTop = bodyTop;
      for (let start = 0; start < count; start += columns) {
        const rowCount = Math.min(columns, count - start);
        for (let col = 0; col < rowCount; col++) {
          const a = Math.floor((gridWidth + input.gap) * col / columns);
          const b = Math.floor((gridWidth + input.gap) * (col + 1) / columns) - input.gap;
          place(start + col, titleBox.left + a, rowTop, b - a);
        }
        rowTop += Math.max(...measured.slice(start, start + rowCount).map(m => m.height)) + input.gap;
      }
      place(count, sideBySide ? titleBox.left + gridWidth + input.gap : titleBox.left, sideBySide ? bodyTop : rowTop, sideBySide ? available - gridWidth : innerWidth);
      if (!sideBySide) notes.push(`${region.key}: KPI 격자 아래에 추이를 배치했습니다.`);
      if (columns === 1) notes.push(`${region.key}: 최소 KPI 폭을 유지하려고 한 열로 배치했습니다.`);
    } else {
      const split = region.kind === 'kpi-trend' ? measured.length - 1 : 1;
      const leftMinimum = Math.max(...measured.slice(0, split).map(m => m.minWidth));
      const rightMinimum = measured[split]!.minWidth;
      const sideBySide = innerWidth >= leftMinimum + input.gap + rightMinimum;
      if (sideBySide) {
        const available = innerWidth - input.gap;
        const leftWidth = Math.max(leftMinimum, Math.min(available - rightMinimum, Math.floor(available * (region.kind === 'kpi-trend' ? 0.3 : 0.45))));
        let y = bodyTop;
        for (let index = 0; index < split; index++) { place(index, titleBox.left, y, leftWidth); y += measured[index]!.height + input.gap; }
        place(split, titleBox.left + leftWidth + input.gap, bodyTop, available - leftWidth);
      } else {
        let y = bodyTop;
        for (let index = 0; index < measured.length; index++) { place(index, titleBox.left, y, innerWidth); y += measured[index]!.height + input.gap; }
        notes.push(`${region.key}: 최소 차트 폭을 유지하려고 세로로 배치했습니다.`);
      }
    }
    const bottom = Math.max(...placed.map(item => item.position.top + item.size.height)) + padding;
    if (bottom > LIMIT) invalid('The analysis regions exceed the 20000 pixel page height limit.');
    return { key: region.key, kind: region.kind, title: region.title.trim(), box: { left: regionLeft, top, width: regionWidth, height: bottom - top }, titleBox, items: placed };
  };
  // Regions that give a share sit side by side until a row's twelve parts are
  // used; a region without one takes a full row. Rows share one height.
  const rows: AnalysisRegion[][] = [];
  let used = 0;
  for (const region of input.regions) {
    const share = region.share;
    if (share !== undefined && (!Number.isInteger(share) || share < 2 || share > 10)) invalid('A region share is a whole number of twelfths from 2 to 10.');
    if (share === undefined) { rows.push([region]); used = 0; continue; }
    if (used === 0 || used + share > 12) { rows.push([region]); used = share; } else { rows.at(-1)!.push(region); used += share; }
  }
  let top = input.top;
  for (const row of rows) {
    const total = row.reduce((sum, region) => sum + (region.share ?? 12), 0), available = input.width - input.gap * (row.length - 1);
    let left = input.left;
    const placedRow = row.map((region, index) => {
      const width = index === row.length - 1 ? input.left + input.width - left : Math.floor(available * (region.share ?? 12) / total);
      const positioned = layoutRegion(region, left, width, top);
      left += width + input.gap;
      return positioned;
    });
    const height = Math.max(...placedRow.map(region => region.box.height));
    for (const region of placedRow) { region.box.height = height; regions.push(region); }
    top += height + input.gap;
  }
  return { regions, height: top - input.gap - input.top, notes };
}
