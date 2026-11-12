import type { ReportDoc } from '../../core/session.js';
import { themeContent } from '../theme/theme.js';

function color(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value : (value as { color?: unknown } | undefined)?.color;
  if (typeof raw !== 'string') return fallback;
  if (/^#[\da-f]{6}$/i.test(raw)) return raw;
  if (/^#[\da-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map(c => c + c).join('');
  return fallback;
}

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** Secondary text must stay readable on the destination surface. A theme's
 * header color is kept when it is; otherwise the theme text is softened. */
function readableMuted(candidate: string, text: string, background: string): string {
  if (contrastRatio(candidate, background) >= 4.5) return candidate;
  const [t, b] = [channels(text), channels(background)];
  for (const share of [0.35, 0.2, 0.1]) {
    const mixed = '#' + t.map((v, i) => Math.round(v * (1 - share) + b[i]! * share).toString(16).padStart(2, '0')).join('').toUpperCase();
    if (contrastRatio(mixed, background) >= 4.5) return mixed;
  }
  return text;
}

/** Resolve semantic colors from the destination, never a reference report. */
export function compositionTheme(doc: ReportDoc) {
  const theme = themeContent(doc) ?? {};
  // Content sits on the component surface. A theme without one (transparent)
  // gets white cards on a light canvas and the canvas color on a dark one.
  const canvas = color(theme.themeFillColor, '#FFFFFF');
  const background = color(theme.themeBackground, luminance(canvas) > 0.6 ? '#FFFFFF' : canvas);
  const text = color(theme.themeFontColor, '#202C36');
  const firstSeries = Array.isArray(theme.themeSeriesColor) ? (theme.themeSeriesColor as unknown[])[0] : undefined;
  return {
    background, text,
    // First chart series color: bars and shading inside tables follow the charts.
    // A report without a stored theme draws its charts in the default first series color.
    series: color(firstSeries, '#0072F0'),
    muted: readableMuted(color(theme.themeComponentHeaderColor, '#64748B'), text, background),
    accent: color(theme.themeAccentFillColor, '#E2E8F0'),
    activeText: color(theme.themeAccentFontColor, '#202C36'),
    font: typeof theme.themeFontFamily === 'string' ? theme.themeFontFamily : 'Roboto',
  };
}
