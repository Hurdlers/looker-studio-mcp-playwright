import type { CommonInput } from './common.js';
import type { compositionTheme } from './theme-tokens.js';
import { invalid } from './store.js';
import { planTablePresentation } from './table-presentation.js';

/** A manually authored presentation profile. It contains no reference-report
 * assets or coordinates, and never chooses fields, periods or calculations. */
export function planReportAppearance(templateId: string, theme: ReturnType<typeof compositionTheme>,
  options: NonNullable<CommonInput['common_options']> = {}, size?: { width: number; height: number }): Record<string, unknown> {
  const explicit = planTablePresentation(templateId, theme, options);
  const shared = { 'Title font size': 18, 'Title alignment': 'Left' };
  const legend = { 'Legend font size': 14, 'Legend font family': theme.font, 'Legend font color': theme.text };
  // Give axis charts a shared reading start without changing whether a legend
  // is shown or removing unnamed categories. Circular charts keep their layout.
  const axisLegend = { ...legend, 'Legend position': 'Top', 'Legend alignment': 'Start' };
  const axes = {
    'Axis font size': 14, 'Axis label font family': theme.font, 'Axis label font family#2': theme.font, 'Axis label font family#3': theme.font,
    'Data label font size': 14, 'Axis color': theme.text, 'Axis line color': theme.text,
  };
  if (templateId === 'common-kpi') return { ...shared, 'Title alignment': 'Center', 'Title font size': 14,
    // A conservative small-cell reading size; not a copied reference font size.
    ...(options.emphasis === undefined ? { 'Font size': size && size.width < 220 ? 20 : 26 } : {}),
    'Font family': theme.font, 'Font color': theme.text,
    'Value alignment': 'Center', 'Metric label alignment': 'Center', 'Comparison alignment': 'Center',
    'Line height': 40, 'Left padding': 8, 'Right padding': 8, 'Top padding': 12,
  };
  if (templateId === 'common-time-trend' || templateId === 'common-category-line') return { ...shared,
    ...(templateId === 'common-time-trend' ? { 'Data label background color': theme.background, 'Data label background opacity': 1 } : {}),
    // The comparison period is drawn in a lighter shade of the line color. A
    // text-colored line has no lighter shade on a dark theme, so use the series color.
    'Line color': options.comparison ? theme.series : theme.text, 'Line gradient': false,
    // Point markers are presentation only; an explicit show_values choice still decides them.
    ...(options.show_values === undefined ? { 'Show points': true } : {}),
    ...axisLegend, ...axes, 'Data label font family': theme.font,
  };
  if (templateId === 'common-detail-table') return { ...shared,
    // Table font families remain inherited from project_theme; the public table
    // style adapter exposes sizes/colors, not a font-family override.
    'Header background color': theme.text, 'Header font color': theme.background,
    'Body font size': 16, 'Header font size': 16, 'Header row height': 32, 'Data row height': 32,
    'Automatic row height': false, 'Row heights': 'Auto',
    'Metric column color': theme.series, 'Metric column color#2': theme.series,
    'Show metric value': true, 'Row numbers': false,
    ...explicit,
  };
  // Keep the native palette, series roles, stack/axis choices and value-label
  // visibility selected by the analytical plan. Only text roles are unified.
  if (['common-category-bars', 'common-area-trend', 'common-mixed-series', 'common-xy-scatter'].includes(templateId))
    return { ...shared, ...axisLegend, ...axes };
  if (templateId === 'common-radial-share') return { ...shared, ...legend };
  if (templateId === 'common-pivot-table') return { ...shared, 'Body font size': 16, 'Header font size': 16,
    'Header background color': theme.text, 'Header font color': theme.background,
  };
  throw invalid(`outlined-report appearance does not support ${templateId}. Use a built-in common chart structure.`);
}

/** Readability floor for annotated lines in this explicit profile only. */
export function reportAppearanceMinimumWidth(templateId: string, options: NonNullable<CommonInput['common_options']> = {}): number | undefined {
  const line = templateId === 'common-time-trend' || templateId === 'common-category-line';
  const labels = options.show_values ?? (templateId === 'common-time-trend' && options.design_rules === 'team-v1');
  return line && labels ? 720 : undefined;
}
