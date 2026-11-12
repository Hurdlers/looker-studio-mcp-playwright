import { LookerError } from '../../core/errors.js';

export type CommonLayoutFamily = 'kpi' | 'time-trend' | 'detail-table' | 'category-bars' | 'radial-share' | 'area-trend' | 'category-line' | 'mixed-series' | 'pivot-table' | 'xy-scatter';
export type DesignDensity = 'comfortable' | 'compact';
export interface CommonPresentation { emphasis?: 'primary' | 'secondary' | undefined; showValues?: boolean | undefined; density?: DesignDensity | undefined; visibleRows?: number | undefined; surface?: 'card' | 'plain' | undefined }
export interface CommonSize { width: number; height: number }
export interface CommonLayoutPlan extends CommonSize {
  style: Record<string, unknown>;
  notes: string[];
}

// Deliberate creation-time policies, not inferred support limits from old
// screenshots. The native renderer still owns text measurement and tick density.
export const COMMON_LAYOUTS = {
  'category-bars': { default: { width: 720, height: 360 }, minimum: { width: 360, height: 260 } },
  'radial-share': { default: { width: 520, height: 360 }, minimum: { width: 320, height: 260 } },
  'area-trend': { default: { width: 720, height: 360 }, minimum: { width: 360, height: 260 } },
  'category-line': { default: { width: 720, height: 360 }, minimum: { width: 360, height: 260 } },
  'mixed-series': { default: { width: 720, height: 360 }, minimum: { width: 440, height: 280 } },
  'pivot-table': { default: { width: 960, height: 360 }, minimum: { width: 480, height: 240 } },
  'xy-scatter': { default: { width: 720, height: 400 }, minimum: { width: 400, height: 280 } },
  kpi: { default: { width: 280, height: 160 }, minimum: { width: 160, height: 96 } },
  'time-trend': { default: { width: 720, height: 360 }, minimum: { width: 320, height: 220 } },
  'detail-table': { default: { width: 720, height: 360 }, minimum: { width: 320, height: 180 } },
} as const;

// Hand-authored size policy. No customer layout or source coordinates are used.
export function commonLayoutHeight(family: CommonLayoutFamily, density: DesignDensity = 'comfortable', visibleRows?: number): number {
  if (visibleRows !== undefined && family !== 'detail-table') throw new LookerError('invalid', 'visible_rows applies only to common-detail-table.');
  if (visibleRows !== undefined && ![1, 5, 10, 20, 25, 50, 100].includes(visibleRows)) throw new LookerError('invalid', 'Choose a supported visible_rows page size.');
  if (family === 'detail-table' && (visibleRows !== undefined || density === 'compact'))
    return Math.max(density === 'compact' ? 96 : 180, (density === 'compact' ? 64 : 72) + (visibleRows ?? 5) * (density === 'compact' ? 28 : 36));
  if (density === 'compact') return family === 'kpi' ? 120 : Math.max(COMMON_LAYOUTS[family].minimum.height, 280);
  return COMMON_LAYOUTS[family].default.height;
}

/** Fits a new common chart into an explicit area. Does not resize existing
 * charts on viewport changes, alter calculations, or assign project colors. */
export function planCommonLayout(
  family: CommonLayoutFamily,
  size?: CommonSize,
  slots: { dimensionCount?: number; metricCount?: number; hasBreakdown?: boolean; percentMetricIndexes?: number[] } = {},
  presentation: CommonPresentation = {},
): CommonLayoutPlan {
  const policy = COMMON_LAYOUTS[family];
  if (!policy) throw new LookerError('invalid', `Unknown common layout family: ${family}.`);
  const compact = presentation.density === 'compact';
  const plannedHeight = commonLayoutHeight(family, presentation.density, presentation.visibleRows);
  const { width, height } = size ?? { width: policy.default.width, height: plannedHeight };
  for (const [axis, value] of [['width', width], ['height', height]] as const) {
    const minimum = axis === 'height' && compact && family === 'detail-table' ? 96 : policy.minimum[axis];
    if (!Number.isInteger(value) || value < minimum || value > 20_000) {
      throw new LookerError('invalid', `${family} ${axis} must be an integer from ${minimum} to 20000 pixels.`);
    }
  }
  const surface = presentation.surface === 'plain' ? { Background: 'transparent', 'Border weight': 'None', 'Border radius': 0, 'Add border shadow': false } : compact ? { 'Border weight': 'None', 'Border radius': 8, 'Add border shadow': false } : {};
  const notes = ['크기는 생성 시 지정한 영역에 맞춥니다. 브라우저 폭 변경에 따른 자동 재배치는 아닙니다.'];
  if (family === 'radial-share') return { width, height, notes, style: { ...surface,
    'Title font size': compact ? 14 : 18, 'Title alignment': 'Left',
    'Display legend': true, 'Legend position': 'Bottom', 'Legend alignment': 'Center',
    'Legend font size': 12, 'Max lines': 2,
  } };
  if (family === 'pivot-table') return { width, height, notes, style: { ...surface,
    'Title font size': compact ? 14 : 18, 'Title alignment': 'Left', 'Body font size': 14, 'Header font size': 14,
    'Pivot row label widths': [Math.min(200, Math.floor(width * 0.22))],
    'Pivot total widths': [Math.min(180, Math.floor(width * 0.2))],
  } };
  if (['category-bars', 'area-trend', 'category-line', 'mixed-series', 'xy-scatter'].includes(family)) {
    const base = planCommonLayout('time-trend', { width, height }, slots, presentation);
    const style = { ...base.style };
    if (['area-trend', 'xy-scatter'].includes(family)) {
      for (const key of ['Chart area top', 'Chart area left', 'Chart area width', 'Chart area height', 'Align legend with grid', 'Show points', 'Line style']) delete style[key];
    }
    if (family === 'category-bars') {
      for (const key of ['Show points', 'Line style']) delete style[key];
      style['Group bar width'] = 65;
    }
    if (family === 'mixed-series') {
      style['Chart area width'] = width - 144;
      style['Show axis title#2'] = true;
      style['Show axis title#3'] = true;
    }
    if (family === 'xy-scatter') {
      style['Show axis title'] = true; style['Show axis title#2'] = true;
      style['Maximum bubble size'] = 0.18;
    }
    return { width, height, notes, style };
  }
  if (family === 'kpi') {
    return { width, height, notes, style: { ...surface,
      // A fixed typography hierarchy makes compact cards legible.
      'Font size': presentation.emphasis === 'primary' ? (width < 220 ? 28 : 32) : presentation.emphasis === 'secondary' ? 24 : compact ? 28 : width < 220 ? 26 : 30,
      'Title font size': compact ? 14 : 18, 'Title alignment': 'Left',
      'Top padding': compact ? 12 : height < 150 ? 20 : 28, 'Left padding': 16, 'Right padding': 16,
      'Line height': compact ? 40 : 48,
      'Metric label alignment': compact ? 'Left' : 'Center', 'Value alignment': compact ? 'Left' : 'Center', 'Comparison alignment': compact ? 'Left' : 'Center',
    } };
  }
  if (family === 'time-trend') {
    const narrow = width < 480;
    return { width, height, notes, style: { ...surface,
      // Recompute plot from the requested box rather than copying a source's fixed plot.
      'Title font size': compact ? 14 : 18, 'Title alignment': 'Left',
      'Chart area top': compact ? 36 : 48, 'Chart area left': compact ? 56 : narrow ? 64 : 72,
      'Chart area width': width - (presentation.showValues ? (compact ? 56 : narrow ? 64 : 72) + 84 : compact ? 104 : narrow ? 84 : 96), 'Chart area height': height - (compact ? 88 : 124),
      'Display legend': !compact || (slots.metricCount ?? 1) > 1 || slots.hasBreakdown === true, 'Legend position': 'Top',
      'Legend alignment': 'End', 'Align legend with grid': true, 'Max lines': 1,
      'Legend font size': 12, 'Axis font size': 12, 'Data label font size': 12,
      'Show data labels': false, 'Show points': !compact, 'Line style': 'Solid',
      'Show axes': true, 'Show axis labels': true, 'Show axis labels#2': true,
      'Show axis title': false, 'Show axis title#2': false,
      'Show axis line': true, 'Show axis line#2': false, 'Show axis line#3': false,
      'Grid color': 'transparent',
      'Show X-axis gridlines': false, 'Show left Y-axis gridlines': false, 'Show right Y-axis gridlines': false,
    } };
  }
  const dimensionCount = slots.dimensionCount ?? 1, metricCount = slots.metricCount ?? 1;
  for (const [name, count] of [['dimensionCount', dimensionCount], ['metricCount', metricCount]] as const) {
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new LookerError('invalid', `${name} must be an integer from 1 to 100.`);
  }
  const count = dimensionCount + metricCount, available = width - 2;
  // A narrow many-column table should fail clearly, rather than silently
  // reduce columns, change the query, or produce unreadable column widths.
  if (available < count * 80) throw new LookerError('invalid', `This table needs at least ${count * 80 + 2}px width for ${count} columns.`);
  // Give the primary value more reading room than a short share column.
  // This only changes geometry: the percent calculation and all columns remain.
  const weights = Array.from({ length: count }, (_, i) => compact && slots.percentMetricIndexes?.length
    // The first metric carries the bar; a share column still needs room for its header; further value columns are plain numbers.
    ? i < dimensionCount ? 1 : slots.percentMetricIndexes.includes(i - dimensionCount) ? (metricCount > 2 ? 0.7 : 0.35) : i === dimensionCount ? 1.6 : 0.8
    : i < dimensionCount ? 1.4 : 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const remainder = available - count * 80;
  const widths = weights.map(weight => 80 + Math.floor(remainder * weight / totalWeight));
  widths[widths.length - 1]! += available - widths.reduce((sum, value) => sum + value, 0);
  const capacity = Math.max(1, Math.floor((height - (compact ? 64 : 72)) / (compact ? 28 : 36)));
  if (presentation.visibleRows !== undefined && presentation.visibleRows > capacity) throw new LookerError('invalid', 'The table height is too small for visible_rows. Increase the height or request fewer displayed rows.');
  const rows = presentation.visibleRows ?? [1, 5, 10, 20, 25, 50, 100].filter(n => n <= capacity).at(-1)!;
  return { width, height, notes, style: { ...surface,
    'Title font size': compact ? 14 : 18, 'Title alignment': 'Left',
    'Body font size': 14, 'Header font size': 14,
    'Data row height': compact ? 28 : 36, 'Header row height': compact ? 32 : 40, 'Row heights': 'Auto',
    'Automatic row height': false,
    'Dimension column alignment': 'Left', 'Metric column alignment': 'Right',
    ...Object.fromEntries(Array.from({ length: Math.min(metricCount, 5) - 1 }, (_, i) => [`Metric column alignment#${i + 2}`, 'Right'])),
    'Row numbers': false,
    'Column widths': widths,
    'Rows per page': String(rows),
    'Show pagination': true,
    'Compact pagination': width < 480,
  } };
}
