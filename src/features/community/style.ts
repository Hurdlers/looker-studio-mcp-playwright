import { LookerError } from '../../core/errors.js';
import { fromMapValue, toMapValue } from '../../core/mapvalue.js';
import { planStyle, type StyleLabel } from '../../core/style.js';
import type { Element, Json, VisualizationConfig } from './registration.js';

export const styleElements = (config: VisualizationConfig): Element[] => (config.style ?? []).flatMap((section) => section.elements ?? []);
const fieldKey = (element: Element) => element.id.startsWith('tp_') ? element.id : `tp_${element.id}`;

function label(element: Element): StyleLabel | undefined {
  const basic = { label: element.label, path: 'value' };
  const range = !Array.isArray(element.options) ? element.options : undefined;
  switch (element.type) {
    case 'CHECKBOX': return { ...basic, kind: 'toggle' };
    case 'FILL_COLOR': case 'FONT_COLOR': case 'BORDER_COLOR': case 'COLOR': return { ...basic, kind: 'color' };
    case 'SELECT_SINGLE': case 'SELECT_RADIO': return { ...basic, kind: 'select', options: Object.fromEntries((Array.isArray(element.options) ? element.options : []).map((option) => [option.label, option.value])) };
    case 'INTERVAL': case 'NUMBER': case 'FONT_SIZE': case 'BORDER_WEIGHT': return { ...basic, kind: 'number', ...(range?.min !== undefined ? { min: range.min } : {}), ...(range?.max !== undefined ? { max: range.max } : {}) };
    case 'OPACITY': return { ...basic, kind: 'percent', min: 0, max: 1 };
    case 'TEXTINPUT': case 'TEXTAREA': case 'FONT_FAMILY': return { ...basic, kind: 'text' };
    default: return undefined;
  }
}

export function writeSetting(component: Json, element: Element, input: unknown): void {
  const metadata = label(element);
  if (!metadata) throw new LookerError('invalid', `The style input "${element.label}" uses unsupported control type ${element.type}. Leave this setting out.`);
  if (metadata.kind === 'color') {
    const color = typeof input === 'object' && input !== null ? (input as Json).color : input;
    if (typeof color === 'string' && color.trim().startsWith('#') && !/^#[0-9a-f]{6}$/i.test(color.trim()))
      throw new LookerError('invalid', `Style "${element.label}" needs six hex digits, for example #1A73E8.`);
  }
  const plain = planStyle([metadata], { [element.label]: input }).writes[0]!.value;
  const property = ((component.propertyConfig ??= {}).componentProperty ??= {});
  const thirdParty = (property.thirdPartyVizProperty ??= { keyConfig: [], isMigrated: true });
  const key = fieldKey(element);
  const entries: Json[] = (thirdParty.keyConfig ??= []);
  const previous = entries.find((entry) => entry.key === key);
  const value = toMapValue(plain, previous?.value);
  if (previous) previous.value = value; else entries.push({ key, value });
  thirdParty.isMigrated = true;
  const display: Json[] = (((component.keyConfig ??= {}).display ??= {}).keyConfig ??= []);
  const existing = display.find((entry) => entry.key === key);
  const mirrored = { key, stateKey: key, dominant: 2, value: structuredClone(value) };
  if (existing) Object.assign(existing, mirrored); else display.push(mirrored);
}

export function applyCommunityStyle(component: Json, config: VisualizationConfig, style: Record<string, unknown> = {}): string[] {
  const elements = styleElements(config);
  const missing: string[] = [];
  for (const [key, input] of Object.entries(style)) {
    const numbered = /^(.*?)(?:#(\d+))?$/.exec(key.trim())!;
    const name = numbered[1]!.trim().toLowerCase();
    const number = Number(numbered[2] ?? 1);
    const element = elements.filter((candidate) => candidate.label.trim().toLowerCase() === name)[number - 1];
    if (!element) missing.push(key); else writeSetting(component, element, input);
  }
  return missing;
}

export function applyCommunityTitle(component: Json, config: VisualizationConfig, title?: string): string[] {
  if (!title?.trim()) return [];
  const elements = styleElements(config);
  const show = elements.find((element) => element.type === 'CHECKBOX' && element.label.toLowerCase() === 'show title');
  const text = elements.find((element) => ['TEXTINPUT', 'TEXTAREA'].includes(element.type) &&
    (['title', 'chart title', 'title text'].includes(element.label.toLowerCase()) || /title/i.test(element.placeholder ?? (!Array.isArray(element.options) ? element.options?.placeholder ?? '' : ''))));
  if (show) writeSetting(component, show, true);
  if (text) writeSetting(component, text, title);
  return [...(!show ? ['Show title'] : []), ...(!text ? ['title'] : [])];
}

export function readCommunityStyle(component: Json, config: VisualizationConfig): Record<string, unknown> {
  const stored = component.propertyConfig?.componentProperty?.thirdPartyVizProperty?.keyConfig ?? [];
  const counts = new Map<string, number>();
  return Object.fromEntries(styleElements(config).flatMap((element) => {
    const normalized = element.label.trim().toLowerCase();
    const number = (counts.get(normalized) ?? 0) + 1;
    counts.set(normalized, number);
    const entry = stored.find((candidate: Json) => candidate.key === fieldKey(element));
    const value = entry ? fromMapValue(entry.value) : element.defaultValue;
    return value === undefined ? [] : [[number === 1 ? element.label : `${element.label}#${number}`, value]];
  }));
}
