import { LookerError } from '../../core/errors.js';
import type { ComponentUpdater } from '../../core/extensions.js';
import { readStyle } from '../../core/style.js';
import { STYLE_RULES, styleRecord } from './common.js';
import { applyStaticStyle, staticLabels, type StaticLabel } from './styles.js';
import { applyTextStyle } from './text.js';

type Json = Record<string, any>;

// component_update's style input: panel settings by label, for any component
// whose type has a label table (ctx.ext.styleLabels: this group's static
// tables, and the chart tables other groups add). Text boxes also take
// "Font color", "Font size" and "Font", which rewrite the box's HTML.
export const styleUpdater: ComponentUpdater = {
  key: 'style',
  input: styleRecord.describe(
    'Style and Setup panel settings to change, by label, for any component type (text box, shape, line, image, URL embed, and charts whose tables are registered). ' +
      'Text boxes also take "Font color", "Font size" (pixels) and "Font", applied to the whole text. ' +
      `${STYLE_RULES} Labels not given keep their values.`,
  ),
  apply: (target, value, ctx) => {
    const c = target.component;
    const style = value as Record<string, unknown>;
    if (!Object.keys(style).length) throw new LookerError('invalid', 'style is empty: give at least one label and value, or leave style out.');
    const type = String(c.type ?? '');
    const labels = ctx.ext.styleLabels(type, c.preset) as StaticLabel[];
    const out = type === 'simple-description' ? applyTextStyle(c, style, labels) : applyStaticStyle(c, labels, style);
    if (!out.notApplied.length) return undefined;
    const none = out.notApplied.length === Object.keys(style).length;
    return `Not applied: ${out.notApplied.join(', ')}${none ? ` (the ${type} panel has no such label${out.notApplied.length > 1 ? 's' : ''})` : ''}`;
  },
  // For inspect and spec export: the static types' settings by label.
  read: (c: Json) => {
    const labels = staticLabels(String(c.type ?? ''), c.preset);
    if (!labels.length) return undefined;
    const style = readStyle(c, labels);
    return Object.keys(style).length ? style : undefined;
  },
};
