import { LookerError } from '../../core/errors.js';
import { applyPlan, getPath, labelsFor, planStyle, setPath, type StyleLabel, type StyleTable } from '../../core/style.js';

// Style and Setup panel labels of the static components (text box, shapes,
// line, image, URL embed), as tables per component type. They go to
// component_update's style input through extensions.styles and are used
// directly by this group's add tools.

type Json = Record<string, any>;

// "Border color" is a plain "#RRGGBB" string beside border.opacity in the
// saved JSON, not a {color, opacity} object, so the table gives it as text
// and this group checks the color itself (`hex`).
export type StaticLabel = StyleLabel & { hex?: true };

const BORDER_WEIGHT = { None: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };
const BORDER_STYLES = { Solid: 0, Dashed: 1, Dotted: 2, Double: 3 };

// Background, border and shadow of a card-like box (backgroundAndBorderProperty).
function card(base: string, opts: { radius: boolean; double: boolean }): StaticLabel[] {
  const styles = opts.double ? BORDER_STYLES : { Solid: 0, Dashed: 1, Dotted: 2 };
  return [
    { label: 'Background', kind: 'color', path: `${base}.background` },
    { label: 'Background color', kind: 'color', path: `${base}.background` },
    { label: 'Opacity', kind: 'percent', path: `${base}.opacity`, min: 0, max: 1 },
    { label: 'Border color', kind: 'text', path: `${base}.border.color`, hex: true },
    { label: 'Border weight', kind: 'select', path: `${base}.border.size`, options: BORDER_WEIGHT },
    { label: 'Border style', kind: 'select', path: `${base}.border.style`, options: styles },
    ...(opts.radius ? [{ label: 'Border radius', kind: 'number', path: `${base}.border.radius`, min: 0, max: 100 } as StaticLabel] : []),
    { label: 'Border shadow', kind: 'toggle', path: `${base}.boxShadow` },
    { label: 'Add border shadow', kind: 'toggle', path: `${base}.boxShadow` },
  ];
}

export const BORDER_STYLE_OPTIONS = BORDER_STYLES;

export const LINE_LABELS: StaticLabel[] = [
  { label: 'Border weight', kind: 'number', path: 'arrowProperty.strokeWidth', min: 0, max: 20 },
  { label: 'Line weight', kind: 'number', path: 'arrowProperty.strokeWidth', min: 0, max: 20 },
  { label: 'Stroke color', kind: 'color', path: 'arrowProperty.strokeColor' },
  { label: 'Border style', kind: 'select', path: 'arrowProperty.strokeStyle', options: BORDER_STYLES },
  { label: 'Line type', kind: 'select', path: 'arrowProperty.pathStyle', options: { Linear: 1, Elbow: 2, 'Curved elbow': 3 } },
];

const TEXT_BOX = 'descriptionProperty.backgroundAndBorderProperty';

export const STYLE_TABLES: StyleTable[] = [
  {
    type: 'simple-description',
    labels: [...card(TEXT_BOX, { radius: true, double: true }), { label: 'Line height', kind: 'number', path: 'descriptionProperty.lineHeight' }],
  },
  // Only rectangles take a corner radius (the editor disables it for the
  // other 14 shapes): the rectangle's own table adds it.
  { type: 'generic-shape', labels: card('genericShapeProperty.backgroundAndBorderProperty', { radius: false, double: false }) },
  { type: 'generic-shape', preset: 'shape-rectangle', labels: card('genericShapeProperty.backgroundAndBorderProperty', { radius: true, double: false }) },
  // Older shapes still in many reports: rectangles ("shape") and ellipses.
  { type: 'shape', labels: card('shapeProperty.backgroundAndBorderProperty', { radius: true, double: false }) },
  { type: 'ellipse', labels: card('ellipseProperty.backgroundAndBorderProperty', { radius: false, double: false }) },
  { type: 'arrow', labels: LINE_LABELS },
  { type: 'image-component', labels: card('imageProperty.backgroundAndBorderProperty', { radius: true, double: true }) },
  { type: 'framed-external-content', labels: card('framedExternalContentProperty.backgroundAndBorderProperty', { radius: true, double: true }) },
];

export function staticLabels(type: string, preset?: string): StaticLabel[] {
  return labelsFor(STYLE_TABLES, type, preset) as StaticLabel[];
}

const HEX6 = /^#[0-9a-f]{6}$/i;

export function checkHex(value: unknown, what: string): string {
  if (typeof value !== 'string' || !HEX6.test(value.trim()))
    throw new LookerError('invalid', `${what} takes a color like "#1A73E8" (# and six hex digits), not ${JSON.stringify(value)}.`);
  return value.trim().toUpperCase();
}

export function findLabel<L extends StyleLabel>(labels: L[], key: string): L | undefined {
  const m = /^(.*?)#(\d+)$/.exec(key.trim());
  const [text, n] = m ? [m[1]!, Number(m[2])] : [key.trim(), 1];
  return labels.filter((l) => l.label.trim().toLowerCase() === text.trim().toLowerCase())[n - 1];
}

export interface StyleOutcome {
  notApplied: string[];
  // Full paths written.
  written: string[];
}

// Checks every value first (a bad one fails the whole style before anything
// changes), then writes. A border color brings border opacity 1 with it and,
// like the editor, raises a border weight of 0 to 1 unless the weight is set
// too.
export function applyStaticStyle(component: Json, labels: StaticLabel[], style: Record<string, unknown>): StyleOutcome {
  const checked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    const label = findLabel(labels, key);
    if (label?.hex) checked[key] = value === 'transparent' && label.path.endsWith('.border.color') ? value : checkHex(value, `Style "${key}"`);
    else if (label?.kind === 'color' && typeof value === 'string' && value.trim().startsWith('#')) checked[key] = checkHex(value, `Style "${key}"`);
    else checked[key] = value;
  }
  const plan = planStyle(labels, checked);
  applyPlan(component, plan);
  const written = plan.writes.map((w) => w.path);
  for (const path of written.filter((p) => p.endsWith('.legendProperty.showLegend'))) {
    if (getPath(component, path) === false) {
      const legend = getPath(component, path.slice(0, -'.showLegend'.length));
      if (legend && typeof legend === 'object') delete (legend as Json).legendPosition;
    }
  }
  for (const path of written.filter((p) => p.endsWith('.border.color'))) {
    if (getPath(component, path) !== 'transparent') borderShown(component, path.slice(0, -'.color'.length), written);
  }
  for (const border of new Set(written.flatMap((p) => /^(.*\.border)\.[^.]+$/.exec(p)?.[1] ?? []))) borderComplete(component, border);
  return { notApplied: plan.notApplied, written };
}

// The editor always saves a whole border (color, opacity, size, style,
// radius; team reports have no partial ones), and a shape saved that way
// draws its rounded corners. An image saved with only {radius} kept square
// corners, so a border that gets any key is filled out with the editor's
// "no border" values for the keys it lacks.
export const BORDER_DEFAULTS = { color: 'transparent', opacity: 1, size: 0, style: 0, radius: 0 };

export function borderComplete(component: Json, borderPath: string): void {
  for (const [k, v] of Object.entries(BORDER_DEFAULTS))
    if (getPath(component, `${borderPath}.${k}`) === undefined) setPath(component, `${borderPath}.${k}`, v);
}

// After a border color is set: opacity 1 when none, and a visible weight.
export function borderShown(component: Json, borderPath: string, written: string[] = []): void {
  if (getPath(component, `${borderPath}.opacity`) === undefined) setPath(component, `${borderPath}.opacity`, 1);
  const size = getPath(component, `${borderPath}.size`);
  if (!written.includes(`${borderPath}.size`) && (size === undefined || size === 0)) setPath(component, `${borderPath}.size`, 1);
}
