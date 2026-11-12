import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURES } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { fromMapValue, toMapValue } from '../../core/mapvalue.js';
import type { ReportDoc } from '../../core/session.js';
import { getPath, planStyle, readStyle, setPath, type StyleLabel } from '../../core/style.js';

// A report's look lives in three places of the report document:
//   theme   report.resource.theme.value[] = {id, content} (protobuf mapValue),
//           report.propertyConfig.reportProperty.themeConfig = the id in use
//   layout  report.attributeConfig.reportAttribute (view mode, grid, canvas)
//   nav     navigationInfo.style (what the viewer's page navigation looks like)
// Everything here works on a copy of the document and checks every input
// before anything changes, so a bad label fails the whole call.

type Json = Record<string, any>;

// The editor's built-in themes, in its menu order. Their content (the
// editor's defaults with each theme's own values on top) is in
// fixtures/theme/presets/<name>.json.
export const PRESETS = [
  'Default',
  'Edge',
  'Constellation',
  'Groovy',
  'Insight',
  'Ocean',
  'Harvest',
  'Eucalyptus',
  'Pop!',
  'Fog',
  'Lagoon',
  'Executive',
  'Woodsy',
  'Royalty',
  'Sienna',
  'Material',
  'Muted',
  'Simple',
  'Simple Dark',
] as const;

const PRESET_DIR = join(FIXTURES, 'theme', 'presets');
const presetCache = new Map<string, Json>();

// The preset's name as the editor spells it, matching case-insensitively.
export function presetName(input: string): string {
  const want = input.trim().toLowerCase();
  const hit = PRESETS.find((p) => p.toLowerCase() === want);
  if (!hit)
    throw new LookerError('invalid', `No built-in theme "${input}". Pick one of: ${PRESETS.join(', ')}.`);
  return hit;
}

// The full theme content of a preset, as plain JSON (a fresh copy).
export function presetContent(name: string): Json {
  let content = presetCache.get(name);
  if (!content) {
    content = JSON.parse(readFileSync(join(PRESET_DIR, `${name}.json`), 'utf8')) as Json;
    presetCache.set(name, content);
  }
  return structuredClone(content);
}

// A built-in theme by the id the editor gives it in themeConfig ("t-constellation").
function presetById(id: string): Json | undefined {
  for (const name of PRESETS) {
    const c = presetContent(name);
    if (c.sourceTheme === id) return c;
  }
  return undefined;
}

const color = (label: string, key: string): StyleLabel => ({ label, kind: 'color', path: key, root: true });
const font = (label: string, key: string): StyleLabel => ({ label, kind: 'text', path: key, root: true });
const WEIGHTS = { None: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

// Edit Theme panel labels → keys of the theme content, in panel order (a
// repeated label is "Label#2").
export const THEME_LABELS: StyleLabel[] = [
  color('Report background color', 'themeFillColor'),
  color('Primary font color', 'themeFontColor'),
  font('Primary font family', 'themeFontFamily'),
  color('Chart title color', 'themeTitleFontColor'),
  { label: 'Text contrast', kind: 'select', path: 'themeContrastCorrection', root: true, options: { None: 0, Low: 1, Medium: 2, High: 3 } },
  color('Background', 'themeBackground'),
  { label: 'Opacity', kind: 'percent', path: 'themeOpacity', root: true, min: 0, max: 1 },
  color('Border color', 'themeBorderColor'),
  { label: 'Border radius', kind: 'number', path: 'themeBorderRadius', root: true, min: 0, max: 100 },
  { label: 'Border weight', kind: 'select', path: 'themeBorderWeight', root: true, options: WEIGHTS },
  {
    label: 'Border style',
    kind: 'select',
    path: 'themeBorderStyle',
    root: true,
    options: { Solid: 'solid', Dashed: 'dashed', Dotted: 'dotted', Double: 'double' },
  },
  {
    label: 'Border shadow',
    kind: 'select',
    path: 'themeBoxShadow',
    root: true,
    options: { 'Show for controls': 'default', 'Always show': true, 'Never show': false },
  },
  { label: 'Chart animations', kind: 'toggle', path: 'themeAnimationEnabled', root: true },
  { label: 'Show titles inside chart border', kind: 'toggle', path: 'themeChartTitleInsideBorder', root: true },
  color('Accent background color', 'themeAccentFillColor'),
  color('Accent font color', 'themeAccentFontColor'),
  font('Accent font family', 'themeAccentFontFamily'),
  color('Shape fill color', 'themeShapeFillColor'),
  color('Shape border color', 'themeShapeBorderColor'),
  { label: 'Shape border weight', kind: 'select', path: 'themeShapeBorderWeight', root: true, options: WEIGHTS },
  {
    label: 'Shape border style',
    kind: 'select',
    path: 'themeShapeBorderStyle',
    root: true,
    options: { Solid: 'solid', Dashed: 'dashed', Dotted: 'dotted' },
  },
  color('"Others" color', 'themeOthersColor'),
  color('Positive change color', 'themeIncreaseColor'),
  color('Negative change color', 'themeDecreaseColor'),
  color('Grid color', 'themeGridColor'),
  { label: 'Line weight', kind: 'select', path: 'themeLineWeight', root: true, options: { Auto: 'auto', ...WEIGHTS } },
  color('Axis line color', 'themeAxisLineColor'),
  { label: 'Show X-axis gridlines', kind: 'toggle', path: 'themeShowHGridLine', root: true },
  { label: 'Modern chart styling', kind: 'toggle', path: 'isModernTheme', root: true },
  {
    label: 'Chart header',
    kind: 'select',
    path: 'themeComponentHeaderPosition',
    root: true,
    options: { 'Do not show': 4, 'Always show': 1, 'Show on hover': 2 },
  },
  // The chart header's font color: the second "Primary font color" in the panel.
  color('Primary font color', 'themeComponentHeaderColor'),
  color('Bar border color', 'themeBarBorderColor'),
  { label: 'Bar width', kind: 'number', path: 'themeBarWidth', root: true, min: 0, max: 100 },
  { label: 'Group bar width', kind: 'number', path: 'themeGroupBarWidth', root: true, min: 0, max: 100 },
  // "Auto" removes the setting.
  { label: 'Smooth styling', kind: 'select', path: 'themeSmoothStyling', root: true, options: { Auto: undefined, On: 'on', Off: 'off' } },
  // Text box defaults.
  color('Background color', 'themeTextboxFillColor'),
  color('Font color', 'themeTextboxFontColor'),
  font('Font family', 'themeTextboxFontFamily'),
  color('Link text color', 'themeTextboxHyperLinkFillColor'),
  color('Visited link text color', 'themeTextboxVisitedHyperLinkFillColor'),
  { label: 'Hide textbox borders', kind: 'toggle', path: 'themeTextboxHideBorder', root: true },
  // Page navigation: the second set of the same labels.
  color('Background color', 'themeNavigationBackground'),
  color('Active font color', 'themeNavigationSelectionFontColor'),
  color('Font color', 'themeNavigationFontColor'),
  font('Font family', 'themeNavigationFontFamily'),
];

// The canvas size limits (the editor's, also the reference's).
export const CANVAS = { width: { min: 200, max: 4000 }, height: { min: 200, max: 10000 } };

const ATTR = 'attributeConfig.reportAttribute';

// viewModeNav (reportAttribute) → navigationInfo.style for the same choice.
const NAV_STYLE: Record<number, number> = { 0: 3, 1: 1, 2: 2, 3: 4 };

// Theme and layout › Layout tab labels → report keys (from the report
// document, not a component).
export const LAYOUT_LABELS: StyleLabel[] = [
  {
    label: 'Navigation type',
    kind: 'select',
    path: `${ATTR}.viewModeNav`,
    root: true,
    options: { Left: 1, Tab: 2, Tabs: 2, Top: 0, 'Top left': 0, Hidden: 3 },
  },
  {
    label: 'Header visibility',
    kind: 'select',
    path: `${ATTR}.viewModeHeader`,
    root: true,
    options: { 'Always show': 0, 'Auto hide': 1, 'Initially hidden': 2 },
  },
  { label: 'Display mode', kind: 'select', path: `${ATTR}.viewModeScale`, root: true, options: { 'Fit to width': 1, 'Actual size': 0 } },
  { label: 'Has margin', kind: 'toggle', path: `${ATTR}.viewModeMargin`, root: true },
  { label: 'Max width (px)', kind: 'select', path: `${ATTR}.viewModeMaxWidth`, root: true, options: { '1920': 0, '1600': 2, '1280': 1 } },
  { label: 'Width (px)', kind: 'number', path: `${ATTR}.width`, root: true, ...CANVAS.width },
  { label: 'Height (px)', kind: 'number', path: `${ATTR}.height`, root: true, ...CANVAS.height },
  { label: 'Snap to', kind: 'select', path: `${ATTR}.snapMode`, root: true, options: { Grid: 0, 'Smart guides': 1 } },
  { label: 'Size (px)', kind: 'number', path: `${ATTR}.gridSize`, root: true, min: 1, max: 400 },
  { label: 'Padding (px)', kind: 'number', path: `${ATTR}.gridPadding`, root: true, min: 0, max: 20 },
  { label: 'Horizontal offset (px)', kind: 'number', path: `${ATTR}.gridXOffset`, root: true, min: 0, max: 400 },
  { label: 'Vertical offset (px)', kind: 'number', path: `${ATTR}.gridYOffset`, root: true, min: 0, max: 400 },
  {
    label: 'Report-level component position',
    kind: 'select',
    path: 'propertyConfig.reportProperty.globalObjectPosition',
    root: true,
    options: { Top: 1, Bottom: 2 },
  },
];

const INTEGER_PATHS = new Set(LAYOUT_LABELS.filter((l) => l.kind === 'number').map((l) => l.path));

/** One brand color for the accent and a matching chart palette. */
export const BRAND_COLOR = 'Brand color';
function mix(hex: string, target: string, share: number): string {
  const channel = (value: string, i: number) => parseInt(value.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map(i => Math.round(channel(hex, i) * (1 - share) + channel(target, i) * share).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** Expands "Brand color" into the accent pair and a series palette: the brand
 * color, lighter tints of it and one neutral gray. Explicit entries win. */
function expandBrand(settings: Record<string, unknown>): Record<string, unknown> {
  const { [BRAND_COLOR]: brand, ...rest } = settings;
  if (brand === undefined) return settings;
  if (typeof brand !== 'string' || !/^#[\da-f]{6}$/i.test(brand.trim()))
    throw new LookerError('invalid', `Theme setting "${BRAND_COLOR}" takes one color as "#RRGGBB". Nothing was saved.`);
  const base = brand.trim().toUpperCase();
  const [r, g, b] = [0, 1, 2].map(i => parseInt(base.slice(1 + i * 2, 3 + i * 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4;
  return { 'Accent background color': base, 'Accent font color': light ? '#000000' : '#FFFFFF',
    [SERIES_COLORS]: [base, mix(base, '#FFFFFF', 0.45), '#7A8794', mix(base, '#FFFFFF', 0.7), mix(base, '#000000', 0.35)], ...rest };
}

/** Chart series colors in order (series 1, 2, …), as a list of "#RRGGBB". */
export const SERIES_COLORS = 'Series colors';
export interface ThemeInput {
  preset?: string | undefined;
  settings?: Record<string, unknown> | undefined;
  layout?: Record<string, unknown> | undefined;
  canvas?: { width: number; height: number } | undefined;
}

// Everything to write, worked out (and checked) before the report is read.
export interface ThemePlan {
  preset?: string;
  // Theme content key → value (undefined removes it).
  theme: Array<{ label: string; key: string; value: unknown }>;
  // Report document path → value.
  report: Array<{ label: string; path: string; value: unknown }>;
  // navigationInfo.style, when the navigation type changes.
  navStyle?: number;
  // Id for a new custom theme, used when the report has none yet (fixed
  // here so a repeated edit uses the same id).
  newThemeId: string;
}

export function planTheme(input: ThemeInput): ThemePlan {
  const settings = input.settings && Object.keys(input.settings).length ? input.settings : undefined;
  const layout = input.layout && Object.keys(input.layout).length ? input.layout : undefined;
  if (!input.preset && !settings && !layout && !input.canvas)
    throw new LookerError('invalid', 'Nothing to change: give at least one of preset, settings, layout or canvas.');

  const plan: ThemePlan = { theme: [], report: [], newThemeId: newThemeId() };
  if (input.preset !== undefined) plan.preset = presetName(input.preset);

  if (settings) {
    // The chart series palette is a list, not a single panel field.
    const { [SERIES_COLORS]: series, ...panel } = expandBrand(settings);
    if (Object.keys(panel).length) {
      const p = plan_(THEME_LABELS, panel, 'Theme setting', 'settings');
      plan.theme = p.map((w) => ({ label: w.label, key: w.path, value: w.value }));
    }
    if (series !== undefined) {
      if (!Array.isArray(series) || series.length < 1 || series.length > 20 || !series.every((c) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c)))
        throw new LookerError('invalid', `Theme setting "${SERIES_COLORS}" takes 1 to 20 colors as "#RRGGBB". Nothing was saved.`);
      plan.theme.push({ label: SERIES_COLORS, key: 'themeSeriesColor', value: (series as string[]).map((c) => c.toUpperCase()) });
    }
  }
  if (layout) {
    plan.report = plan_(LAYOUT_LABELS, layout, 'Layout setting', 'layout').map((w) => ({ label: w.label, path: w.path, value: w.value }));
    for (const w of plan.report)
      if (INTEGER_PATHS.has(w.path) && !Number.isInteger(w.value))
        throw new LookerError('invalid', `Layout setting "${w.label}" takes a whole number of pixels, not ${JSON.stringify(w.value)}.`);
    const nav = plan.report.find((w) => w.path === `${ATTR}.viewModeNav`);
    const style = nav ? NAV_STYLE[nav.value as number] : undefined;
    if (style !== undefined) plan.navStyle = style;
  }
  if (input.canvas) {
    const { width, height } = input.canvas;
    const bad = (what: 'width' | 'height', v: number): string | undefined =>
      Number.isInteger(v) && v >= CANVAS[what].min && v <= CANVAS[what].max
        ? undefined
        : `${what} ${v} (${CANVAS[what].min}–${CANVAS[what].max})`;
    const wrong = [bad('width', width), bad('height', height)].filter(Boolean);
    if (wrong.length)
      throw new LookerError('invalid', `Canvas size out of range: ${wrong.join(', ')}. Give whole pixels: width 200–4000, height 200–10000.`);
    // The canvas wins over the layout's Width/Height labels.
    plan.report = plan.report.filter((w) => w.path !== `${ATTR}.width` && w.path !== `${ATTR}.height`);
    plan.report.push({ label: 'canvas width', path: `${ATTR}.width`, value: width }, { label: 'canvas height', path: `${ATTR}.height`, value: height });
  }
  return plan;
}

// Checks one panel's labels and values. Unknown labels fail together, by
// name; a bad drop-down value lists its options.
function plan_(labels: StyleLabel[], values: Record<string, unknown>, what: string, input: string) {
  const given: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    // Drop-downs take their option text; a number is read as that text (2 → "2").
    const value = typeof raw === 'string' ? raw.trim() : raw;
    given[key] = value;
    const m = /^(.*?)(?:#(\d+))?$/.exec(key.trim())!;
    const label = labels.filter((l) => l.label.toLowerCase() === m[1]!.toLowerCase())[Number(m[2] ?? 1) - 1];
    if (label?.kind !== 'select') continue;
    const options = Object.keys(label.options ?? {});
    const text = typeof value === 'number' ? String(value) : value;
    const hit = options.find((o) => typeof text === 'string' && o.toLowerCase() === text.toLowerCase());
    if (hit === undefined)
      throw new LookerError('invalid', `${what} "${key}" takes one of: ${options.join(', ')} (not ${JSON.stringify(raw)}). Nothing was saved.`);
    given[key] = hit;
  }
  const p = planStyle(labels, given);
  if (p.notApplied.length)
    throw new LookerError(
      'invalid',
      `Unknown ${input} label${p.notApplied.length > 1 ? 's' : ''}: ${p.notApplied.map((l) => `"${l}"`).join(', ')}. Nothing was saved. ` +
        `Known labels: ${labelList(labels)}.`,
    );
  return p.writes.map((w) => ({ label: w.label, path: w.path, value: w.value }));
}

// "A, B, C#2" as a client would type them.
export function labelList(labels: StyleLabel[]): string {
  const seen = new Map<string, number>();
  return labels
    .map((l) => {
      const k = l.label.toLowerCase();
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      return n === 1 ? l.label : `${l.label}#${n}`;
    })
    .join(', ');
}

function newThemeId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `theme${[...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

interface ThemeEntry {
  id?: string;
  content?: unknown;
}

function entryOf(value: Json): ThemeEntry {
  const out: ThemeEntry = {};
  for (const e of (value?.mapValue?.entry ?? []) as Array<{ key: string; value: Json }>) {
    if (e.key === 'id') out.id = fromMapValue(e.value) as string;
    if (e.key === 'content') out.content = e.value;
  }
  return out;
}

export interface Applied {
  themeId: string;
  // The navigation style before this edit (to skip an unneeded save).
  navStyleBefore?: number;
}

// Applies the plan to a copy of the report document: preset, then settings
// (they win over the preset), then layout and canvas (canvas wins).
// Repeatable: the session may run it again on a fresher document.
export function applyTheme(doc: ReportDoc, plan: ThemePlan): Applied {
  const report = doc.report as Json;
  report.propertyConfig ??= {};
  report.propertyConfig.reportProperty ??= {};
  const reportProperty = report.propertyConfig.reportProperty as Json;
  let themeId = String(reportProperty.themeConfig ?? '');

  if (plan.preset || plan.theme.length) {
    report.resource ??= { datasourceAlias: [] };
    report.resource.theme ??= {};
    const list: Json[] = (report.resource.theme.value ??= []);
    // The theme in use when it is a custom one; else the report's custom
    // theme slot (the editor keeps one, the first); else a new one.
    let index = list.findIndex((v) => entryOf(v).id === themeId);
    const builtIn = index < 0 && themeId ? presetById(themeId) : undefined;
    if (index < 0 && list.length) index = 0;
    if (index < 0) {
      list.push({ mapValue: { entry: [{ key: 'id', value: { strValue: plan.newThemeId } }] } });
      index = list.length - 1;
    }
    const slot = list[index]!;
    const stored = entryOf(slot);
    const usedStored = stored.id === themeId && stored.content !== undefined;
    themeId = stored.id ?? plan.newThemeId;

    let content: Json = plan.preset
      ? presetContent(plan.preset)
      : usedStored
        ? ((fromMapValue(stored.content) as Json | undefined) ?? {})
        : (builtIn ?? presetContent('Default'));
    for (const w of plan.theme) {
      const old = content[w.key];
      if (w.key === 'themeSeriesColor' && Array.isArray(w.value)) {
        // Replace the leading series colors in order; later series keep theirs.
        const current = Array.isArray(old) ? structuredClone(old as Json[]) : [];
        (w.value as string[]).forEach((color, index) => { current[index] = { color, seriesRef: { index } }; });
        content[w.key] = current;
      } else if (w.value === undefined) delete content[w.key];
      // A color keeps what else it carries (its palette slot).
      else if (isColor(w.value) && old && typeof old === 'object' && !Array.isArray(old)) content[w.key] = { ...old, ...(w.value as Json) };
      else content[w.key] = w.value;
    }
    content = Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined));

    const entries = ((slot.mapValue ??= {}).entry ??= []) as Array<{ key: string; value: unknown }>;
    const at = entries.findIndex((e) => e.key === 'content');
    const value = toMapValue(content, at >= 0 ? entries[at]!.value : undefined);
    if (at >= 0) entries[at]!.value = value;
    else entries.push({ key: 'content', value });
    reportProperty.themeConfig = themeId;
  }

  for (const w of plan.report) {
    if (w.value === undefined) continue;
    setPath(report, w.path, w.value);
  }
  const navStyleBefore = (doc.navigationInfo as Json | undefined)?.style as number | undefined;
  return { themeId, ...(navStyleBefore !== undefined ? { navStyleBefore } : {}) };
}

function isColor(v: unknown): boolean {
  return !!v && typeof v === 'object' && typeof (v as Json).color === 'string';
}

// The theme content a report uses, as plain JSON (for messages and tests).
export function themeContent(doc: ReportDoc): Json | undefined {
  const id = getPath(doc.report, 'propertyConfig.reportProperty.themeConfig');
  const list = (getPath(doc.report, 'resource.theme.value') ?? []) as Json[];
  const hit = list.map(entryOf).find((e) => e.id === id);
  return hit?.content ? (fromMapValue(hit.content) as Json) : typeof id === 'string' ? presetById(id) : undefined;
}

// Export inputs accepted by theme_update, without internal theme identifiers.
export function readTheme(doc: ReportDoc): import('../../core/extensions.js').ReportTheme {
  const content = themeContent(doc);
  const preset = content && PRESETS.find((name) => presetContent(name).sourceTheme === content.sourceTheme);
  const settings = content ? readStyle(content, THEME_LABELS) : {};
  const layout = readStyle(doc.report, LAYOUT_LABELS);
  const width = getPath(doc.report, `${ATTR}.width`);
  const height = getPath(doc.report, `${ATTR}.height`);
  const canvas = typeof width === 'number' && typeof height === 'number' ? { width, height } : undefined;
  delete layout['Width (px)'];
  delete layout['Height (px)'];
  return { ...(preset ? { preset } : {}), settings, layout, ...(canvas ? { canvas } : {}) };
}
