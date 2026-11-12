import { LookerError } from './errors.js';

// Turns the labels of the editor's Style and Setup panels ("Show data labels",
// "Bar color") into the JSON the editor saves, and back. Feature groups supply
// one label table per component type (extensions.styles); this file only
// knows how to read a table.
//
// Input values:
//   toggle   true / false (invert: the JSON holds the opposite, e.g. "Hide …")
//   color    "#RRGGBB", "#RGB" or "transparent" → {color, opacity: 1};
//            {color: "#RRGGBB", opacity: 0…1} (nothing else in it)
//   number   a number, or "80%" → 0.8
//   number-array  nonempty positive finite pixel values, preserving fractions
//   percent  "80%" → 0.8 ("1%" → 0.01). A plain number: above 1 it is a
//            percentage (80 → 0.8), from 0 to 1 it is already divided
//            (0.8 → 0.8, 1 → 1 = 100%). Text without "%" is refused: "1"
//            could mean either.
//   select   the option text shown in the drop-down (case ignored) → its value
//   radio    true picks this option (the label is the option's own text)
//   text     a string
// A label used twice in a panel is "Label#2" for the second one. Labels ignore
// case.

type Json = Record<string, any>;

export interface StyleLabel {
  label: string;
  kind: 'toggle' | 'color' | 'number' | 'number-array' | 'percent' | 'select' | 'radio' | 'text';
  // Where the value goes, from propertyConfig.componentProperty
  // ("barChartProperty.seriesProperty[0].seriesColor"), or from the component
  // itself when root is true.
  path: string;
  root?: boolean;
  // Explicit Auto restores the editor's inherited value by removing this property.
  auto?: boolean;
  // select: option text → value saved.
  options?: Record<string, unknown>;
  // radio: the value saved when this option is picked.
  value?: unknown;
  // toggle: the JSON holds the opposite of the switch.
  invert?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
}

// The labels of one component type's panels, in panel order. A table for a
// preset replaces the type's table; type "*" holds labels every component has
// (background, border) and comes after the type's own.
export interface StyleTable {
  type: string;
  preset?: string;
  labels: StyleLabel[];
}

export interface StyleWrite {
  label: string;
  path: string;
  value: unknown;
}

export interface StylePlan {
  writes: StyleWrite[];
  // Labels the table does not have: nothing is written for them.
  notApplied: string[];
}

// The labels for one component, from all tables.
export function labelsFor(tables: StyleTable[], type: string, preset?: string): StyleLabel[] {
  const own = preset ? tables.filter((t) => t.type === type && t.preset === preset) : [];
  const base = own.length ? own : tables.filter((t) => t.type === type && !t.preset);
  return [...base, ...tables.filter((t) => t.type === '*')].flatMap((t) => t.labels);
}

// Checks every value and works out what to write, before anything changes:
// a bad value fails the whole style with the reason.
export function planStyle(labels: StyleLabel[], style: Record<string, unknown>): StylePlan {
  const plan: StylePlan = { writes: [], notApplied: [] };
  for (const [key, input] of Object.entries(style)) {
    const label = findLabel(labels, key);
    if (!label) {
      plan.notApplied.push(key);
      continue;
    }
    plan.writes.push({ label: key, path: fullPath(label), value: toJson(label, key, input) });
  }
  return plan;
}

export function applyPlan(component: Json, plan: StylePlan): Json {
  for (const w of plan.writes) {
    if (w.value === undefined) {
      const keys = steps(w.path);
      let parent: any = component;
      for (const key of keys.slice(0, -1)) parent = parent?.[key];
      if (parent && typeof parent === 'object') delete parent[keys[keys.length - 1]!];
    } else setPath(component, w.path, w.value);
  }
  return component;
}

// planStyle and applyPlan in one go.
export function applyStyle(component: Json, labels: StyleLabel[], style: Record<string, unknown>): StylePlan {
  const plan = planStyle(labels, style);
  applyPlan(component, plan);
  return plan;
}

// The reverse: the style a component has, keyed by label ("Label#2" for
// repeats), for what the table covers and the component sets. A radio group
// shows the option that is picked.
export function readStyle(component: Json, labels: StyleLabel[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  labels.forEach((label, i) => {
    const raw = getPath(component, fullPath(label));
    if (raw === undefined) return;
    const value = fromJson(label, raw);
    if (value !== undefined) out[labelKey(labels, i)] = value;
  });
  return out;
}

// "Label" for the first label of that text, "Label#2" for the second, …
export function labelKey(labels: StyleLabel[], index: number): string {
  const text = labels[index]!.label;
  const n = labels.slice(0, index + 1).filter((l) => same(l.label, text)).length;
  return n === 1 ? text : `${text}#${n}`;
}

function findLabel(labels: StyleLabel[], key: string): StyleLabel | undefined {
  const m = /^(.*?)#(\d+)$/.exec(key.trim());
  const [text, n] = m ? [m[1]!, Number(m[2])] : [key.trim(), 1];
  return labels.filter((l) => same(l.label, text))[n - 1];
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function fullPath(label: StyleLabel): string {
  return label.root ? label.path : `propertyConfig.componentProperty.${label.path}`;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function sixDigits(hex: string): string {
  const h = hex.trim();
  return (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h).toUpperCase();
}

function toJson(label: StyleLabel, key: string, input: unknown): unknown {
  if (label.auto && typeof input === 'string' && same(input, 'Auto')) return undefined;
  const bad = (want: string): never => {
    throw new LookerError('invalid', `Style "${key}" takes ${want}, not ${JSON.stringify(input)}.`);
  };
  switch (label.kind) {
    case 'toggle':
      if (typeof input !== 'boolean') bad('true or false');
      return label.invert ? !input : input;
    case 'radio':
      if (input !== true) bad(`true (it picks this option; to change it, pick another option by its label)`);
      return label.value;
    case 'color': {
      const want = 'a color like "#1A73E8", "transparent", or {color: "#1A73E8", opacity: 0.5}';
      if (input === 'transparent') return { color: 'transparent' };
      if (input && typeof input === 'object' && !Array.isArray(input)) {
        const { color, opacity, ...rest } = input as Json;
        if (Object.keys(rest).length || typeof color !== 'string' || !HEX.test(color.trim())) bad(want);
        if (opacity !== undefined && (typeof opacity !== 'number' || !(opacity >= 0 && opacity <= 1))) bad(`${want} (opacity from 0 to 1)`);
        return { color: sixDigits(color), opacity: opacity ?? 1 };
      }
      if (typeof input !== 'string' || !HEX.test(input.trim())) bad(want);
      return { color: sixDigits(input as string), opacity: 1 };
    }
    case 'number-array': {
      if (!Array.isArray(input) || !input.length || input.some(n =>
        typeof n !== 'number' || !Number.isFinite(n) || n <= 0 ||
        (label.min !== undefined && n < label.min) || (label.max !== undefined && n > label.max)))
        bad('a nonempty array of positive finite numbers within the allowed bounds');
      return [...input as number[]];
    }
    case 'number':
    case 'percent': {
      const n = toNumber(input, label.kind === 'percent');
      if (n === undefined) bad(label.kind === 'percent' ? 'a percentage like "80%" (with the %), or a number' : 'a number');
      if ((label.min !== undefined && n! < label.min) || (label.max !== undefined && n! > label.max))
        bad(`a number from ${label.min ?? '…'} to ${label.max ?? '…'}`);
      if (label.integer && !Number.isInteger(n)) bad('a whole number');
      return n;
    }
    case 'select': {
      const options = label.options ?? {};
      const text = Object.keys(options).find((o) => typeof input === 'string' && same(o, input));
      if (text !== undefined) return options[text];
      const raw = Object.values(options).find((v) => v === input);
      if (raw !== undefined) return raw;
      return bad(`one of ${Object.keys(options).map((o) => `"${o}"`).join(', ')}`);
    }
    case 'text':
      if (typeof input !== 'string') bad('text');
      return input;
  }
}

// "80%" is 0.8 for any number; for a percent, 80 is 0.8 as well, while numbers
// from 0 to 1 are taken as already divided. A percent given as text needs
// its %.
function toNumber(input: unknown, percent: boolean): number | undefined {
  if (typeof input === 'string') {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(%?)\s*$/.exec(input);
    if (!m || (percent && !m[2])) return undefined;
    const n = Number(m[1]);
    return m[2] ? n / 100 : n;
  }
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined;
  return percent && Math.abs(input) > 1 ? input / 100 : input;
}

function fromJson(label: StyleLabel, raw: unknown): unknown {
  switch (label.kind) {
    case 'toggle':
      return typeof raw === 'boolean' ? (label.invert ? !raw : raw) : undefined;
    case 'radio':
      return JSON.stringify(raw) === JSON.stringify(label.value) ? true : undefined;
    case 'color': {
      const c = raw as Json;
      if (!c || typeof c.color !== 'string') return undefined;
      return c.opacity === undefined || c.opacity === 1 ? c.color : { color: c.color, opacity: c.opacity };
    }
    case 'number-array':
      return Array.isArray(raw) ? structuredClone(raw) : undefined;
    case 'percent':
      return typeof raw === 'number' ? `${Math.round(raw * 10_000) / 100}%` : undefined;
    case 'select': {
      const hit = Object.entries(label.options ?? {}).find(([, v]) => JSON.stringify(v) === JSON.stringify(raw));
      return hit ? hit[0] : raw;
    }
    default:
      return raw;
  }
}

// Paths are dotted keys with [n] for array items: "a.b[0].c".
function steps(path: string): Array<string | number> {
  return path.split('.').flatMap((part) => {
    const [, key, rest] = /^([^[]*)((?:\[\d+\])*)$/.exec(part) ?? [, part, ''];
    return [...(key ? [key] : []), ...[...(rest ?? '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))];
  });
}

export function getPath(obj: unknown, path: string): unknown {
  let at: any = obj;
  for (const s of steps(path)) {
    if (at == null || typeof at !== 'object') return undefined;
    at = at[s];
  }
  return at;
}

// Creates the objects and arrays on the way; array gaps are filled with {}.
export function setPath(obj: Json, path: string, value: unknown): void {
  const s = steps(path);
  let at: any = obj;
  s.forEach((key, i) => {
    if (i === s.length - 1) {
      at[key] = value;
      return;
    }
    const next = s[i + 1];
    if (at[key] == null || typeof at[key] !== 'object') at[key] = typeof next === 'number' ? [] : {};
    if (Array.isArray(at[key]) && typeof next === 'number') while (at[key].length < next) at[key].push({});
    at = at[key];
  });
}
