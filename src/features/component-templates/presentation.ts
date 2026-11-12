import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';

import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater } from '../../core/extensions.js';

type Json = Record<string, any>;

const PROPERTY: Record<string, string> = {
  'kpi-metric': 'kpiMetricProperty',
  'simple-linechart': 'lineChartProperty',
  'simple-table': 'tableProperty',
  'simple-barchart': 'barChartProperty', 'simple-piechart': 'pieChartProperty',
  'simple-areachart': 'areaChartProperty', 'simple-combochart': 'comboChartProperty',
  'pivot-table': 'pivotTableProperty', 'simple-scatterchart': 'scatterChartProperty',
};

function omit(object: Json | undefined, keys: readonly string[]): void {
  if (object) for (const key of keys) delete object[key];
}

/** Prepare the supported common structures for native report-theme inheritance.
 * This is opt-in: saved designs and ordinary chart_add keep their styling.
 * Only known presentation paths are removed. Calculations, formats, conditional
 * colors, value mappings, reference lines and all layout sizes remain intact.
 */
export function prepareProjectPresentation(component: Json): Json {
  const key = PROPERTY[component.type];
  if (!key) throw new LookerError('invalid', 'Project theme inheritance is supported only for supported common chart components.');
  const copy = structuredClone(component);
  const p = copy.propertyConfig?.componentProperty?.[key] as Json | undefined;
  if (!p) return copy;

  omit(p, ['fontColor', 'fontFamily', 'backgroundAndBorderProperty']);
  omit(p.chartTitleProperty, ['chartTitleColor', 'chartTitleFontFamily']);
  omit(p.componentHeaderProperty, ['componentHeaderColor', 'componentHeaderFontFamily']);

  if (['simple-linechart', 'simple-barchart', 'simple-combochart', 'simple-areachart', 'simple-scatterchart'].includes(component.type)) {
    omit(p.chartDisplayProperty, ['chartBackground', 'chartBorder']);
    omit(p.legendProperty, ['legendColor', 'legendFontFamily']);
    omit(p.axisAndGridProperty, ['axisColor', 'axisLineColor']);
    // Explicit transparency means no grid, not a project palette override.
    if (p.axisAndGridProperty?.gridColor?.color !== 'transparent') omit(p.axisAndGridProperty, ['gridColor']);
    for (const axis of ['hAxisProperty', 'leftVAxisProperty', 'rightVAxisProperty']) {
      omit(p.axisAndGridProperty?.[axis], ['axisLabelsColor', 'axisLabelsFont', 'axisTitleColor', 'axisTitleFont']);
    }
    // Positional color arrays use the project palette; value-to-color mappings remain intact.
    delete p.seriesColor;
    omit(p.labelStyleProperty, ['labelsFontColor', 'labelsFontFamily', 'labelsBackgroundColor', 'labelsOpacity']);
    // A report's explicit dimension-value color mappings are left untouched.
    for (const series of p.seriesProperty ?? []) {
      omit(series, ['seriesColor']);
      omit(series.labelStyleProperty, ['labelsFontColor', 'labelsFontFamily', 'labelsBackgroundColor', 'labelsOpacity']);
    }
  }

  if (component.type === 'simple-piechart') {
    omit(p.legendProperty, ['legendColor', 'legendFontFamily']);
    delete p.sliceColor;
  }

  if (component.type === 'kpi-metric') {
    omit(p.subvizSparklineProperty, ['sparklineColor']);
    // positiveDeltaColor / negativeDeltaColor retain their semantic overrides.
  }

  if (['simple-table', 'pivot-table'].includes(component.type)) {
    omit(p, ['headerColor', 'headerFontColor', 'headerFont', 'oddRowColor', 'evenRowColor', 'rowBorderColor', 'footerBorderColor']);
    for (const column of p.tableMetricProperty ?? []) {
      // Numeric columns inherit the theme; bar/heatmap encodings retain color.
      if (column.colType === 2) omit(column, ['colColor']);
    }
  }
  return copy;
}

// Native reads can add empty containers. They do not create a presentation
// override; only infer inheritance when removing known overrides changes no
// effective values. Explicit colors/fonts are never inferred as inherited.
function withoutEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? value.map(withoutEmpty) : undefined;
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, withoutEmpty(item)] as const).filter(([, item]) => item !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export const projectThemeUpdater: ComponentUpdater = {
  key: 'project_theme',
  input: z.literal(true).describe('공통 차트의 일반 색·글꼴·배경을 보고서 테마에서 상속합니다. 크기·계산·단위·조건부 색은 유지합니다.'),
  types: Object.keys(PROPERTY),
  read: component => PROPERTY[component.type] && isDeepStrictEqual(withoutEmpty(component), withoutEmpty(prepareProjectPresentation(component))) ? true : undefined,
  apply: ({ component }) => {
    // Keep the same component reference held by chart_add's pending save.
    Object.assign(component, prepareProjectPresentation(component));
  },
};
