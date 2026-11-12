import { z } from 'zod';

import { errorMessage, defineTool, text } from '../../core/tool.js';
import { explain, LookerError } from '../../core/errors.js';
import { parseReportId } from '../../looker/view.js';
import { applyTheme, CANVAS, LAYOUT_LABELS, labelList, planTheme, readTheme, PRESETS, THEME_LABELS, type Applied } from './theme.js';

function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}

const VALUE_RULES =
  'Values: colors as "#RRGGBB" (or "#RGB", "transparent", or {color: "#RRGGBB", opacity: 0–1}); drop-downs by the option text shown in the panel (case ignored); switches as true/false; ' +
  'percentages as "80%" (a bare number above 1 is also a percentage, one from 0 to 1 is already divided; text without "%" is refused); sizes as whole pixels. ';

export const tools = [
  defineTool({
    name: 'theme_update',
    title: 'Change the report theme and layout',
    description:
      'Changes the look of a whole report the way the editor\'s Theme and layout panel does: picks a built-in theme (`preset`), changes individual theme settings by their Edit Theme label (`settings`), ' +
      'changes Layout tab settings such as navigation type, header visibility, display mode and grid (`layout`), and sets the default page size (`canvas`). ' +
      'Use it to restyle a report in one call; give any combination, at least one. They apply in that order in a single save, so `settings` override the preset and `canvas` overrides the layout\'s "Width (px)"/"Height (px)". ' +
      'Every label and value is checked first: an unknown label or a wrong option fails the whole call with the names and options, and nothing is saved. ' +
      'Colors set directly on a component stay as they are (as in the editor); pages that have their own size keep it. ' +
      VALUE_RULES +
      'A label that appears twice in a panel is "Label#2" for the second one ("Primary font color#2" is the chart header font color; "Background color#2", "Font color#2", "Font family#2" are the page navigation\'s).',
    input: {
      report_id: z.string().describe('Report id or its Looker Studio URL.'),
      preset: z
        .string()
        .optional()
        .describe(`Built-in theme to apply, by name (case ignored): ${PRESETS.join(', ')}. It replaces the whole current theme.`),
      settings: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(`Theme settings by their Edit Theme label, for instance {"Chart title color": "#FAFAFA", "Report background color": "#101820"}. Labels: ${labelList(THEME_LABELS)}. Also "Series colors": the chart series palette in order, as a list such as ["#1F3A5F", "#F28C28"]; and "Brand color": one "#RRGGBB" that sets the accent color, a readable accent font color and a matching series palette (the color, lighter tints and a neutral gray) unless those are given explicitly. It does not color page headers: give the same color as header.band_color in component_page_add, or use brand_color in component_report_add, which does both.`),
      layout: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          `Layout tab settings by label, e.g. {"Navigation type": "Tab", "Header visibility": "Auto hide", "Has margin": false, "Size (px)": 20}. Labels: ${labelList(LAYOUT_LABELS)}. ` +
            'Navigation type: Left, Tab, Top (also "Top left") or Hidden. Header visibility: Always show, Auto hide, Initially hidden. Display mode: Fit to width, Actual size. Max width (px): 1920, 1600, 1280. Snap to: Grid, Smart guides.',
        ),
      canvas: z
        .object({
          width: z.number().int().describe(`Page width in px, ${CANVAS.width.min}–${CANVAS.width.max}.`),
          height: z.number().int().describe(`Page height in px, ${CANVAS.height.min}–${CANVAS.height.max}.`),
        })
        .optional()
        .describe('Default page size in pixels; both are needed (the editor\'s default is 1200 x 900). Use a tall height for a long scrolling page.'),
    },
    write: true,
    run: async (ctx, a) => {
      // Everything is checked before the report is read.
      const plan = planTheme(a);
      const reportId = reportIdOf(a.report_id);
      let applied: Applied | undefined;
      const res = await ctx.session.editReport(
        reportId,
        (doc) => {
          applied = applyTheme(doc, plan);
        },
        'theme and layout',
      );

      const done: string[] = [];
      if (plan.preset) done.push(`theme ${plan.preset}`);
      if (plan.theme.length) done.push(`theme settings ${plan.theme.map((w) => w.label).join(', ')}`);
      const layout = plan.report.filter((w) => !w.label.startsWith('canvas'));
      if (layout.length) done.push(`layout ${layout.map((w) => w.label).join(', ')}`);
      if (a.canvas) done.push(`canvas ${a.canvas.width} x ${a.canvas.height} px`);

      let version = res.version;
      let navNote = '';
      // The viewer's page navigation follows navigationInfo.style, saved
      // separately from the report.
      if (plan.navStyle !== undefined && applied?.navStyleBefore !== plan.navStyle) {
        const style = plan.navStyle;
        try {
          const nav = await ctx.session.editNavigation(
            reportId,
            (_items, doc) => {
              if (doc.navigationInfo) doc.navigationInfo.style = style;
            },
            'navigation type',
          );
          version = nav.version;
        } catch (err) {
          const known = explain(err);
          throw new LookerError(
            known?.code ?? 'busy',
            `Saved ${done.join('; ')} (version ${res.version}), but the page navigation style could not be saved: ${errorMessage(err)} ` +
              'Run theme_update again with only {"Navigation type": …} in layout.',
          );
        }
        navNote = ' Page navigation style updated too.';
      }

      return {
        ...text(`Applied ${done.join('; ')} to report ${reportId} (version ${version}).${navNote}`),
        audit: { reportId, version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: done.join('; ') },
      };
    },
  }),
];

export const extensions: import("../../core/extensions.js").FeatureExtensions = { reportTheme: readTheme };
