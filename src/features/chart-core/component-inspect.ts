import { z } from 'zod';

import { resolveSource, type SourceField } from '../../core/datasource.js';
import { boxOf } from '../../core/page.js';
import { labelKey, readStyle } from '../../core/style.js';
import { defineTool, text } from '../../core/tool.js';
import {
  conceptText,
  kindLabel,
  locate,
  notFound,
  propertyKey,
  reportIdInput,
  reportIdOf,
  slotNames,
  slotsOf,
  type Json,
} from './common.js';
import { groupsOf } from './component-list.js';

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

// Values as the add and update tools take them: colors as #RRGGBB.
function shown(v: unknown): string {
  if (typeof v === 'string') return HEX.test(v) ? v.toUpperCase() : JSON.stringify(v);
  if (v && typeof v === 'object' && typeof (v as Json).color === 'string' && HEX.test((v as Json).color))
    return JSON.stringify({ ...(v as Json), color: ((v as Json).color as string).toUpperCase() });
  return JSON.stringify(v);
}

export const componentInspect = defineTool({
  name: 'component_inspect',
  title: 'Show how a component is set up',
  description:
    'Shows one component in full by its component_id: kind, page, position and size, data source, the fields in each Setup slot (by slot title, with aggregation), sorting, date range and filters, and each Style and Setup setting by its label with its current value. ' +
    'Use it before component_update or to copy a chart: the slot titles are the keys of the `fields` input and the labels are the keys of the `style` input, with the same value forms (colors as #RRGGBB; a label used twice is "Label#2"). ' +
    'Settings left at their default are listed by label without a value. Reads only.',
  input: {
    report_id: reportIdInput,
    component_id: z.string().min(1).describe('Id of the component (cd-…), from component_list; it is looked up on every page.'),
  },
  write: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const id = a.component_id.trim();
    const doc = await ctx.session.load(reportId);
    const hit = locate(doc, id);
    if (!hit) throw notFound(doc, id);
    const c = hit.component;
    const metadata = await ctx.ext.componentMetadata(ctx, doc, c);
    const p = (c.propertyConfig?.componentProperty ?? {}) as Json;
    const b = boxOf(c);
    const lines = [
      `${id}: ${metadata?.name ?? kindLabel(ctx.ext, c)} [type ${c.type}, preset ${c.preset ?? 'default'}]`,
      `Page: ${hit.page ? `"${hit.pageName}" (${hit.page.pageId})` : 'report level (every page)'}${
        hit.page && groupsOf(hit.page, id).length ? `, in group ${groupsOf(hit.page, id).join(', ')}` : ''
      }`,
      `Position: left ${b.left}, top ${b.top}, width ${b.width}, height ${b.height}`,
    ];

    let fields: SourceField[] = [];
    if (c.datasourceId) {
      try {
        const source = await resolveSource(ctx.rap, doc, String(c.datasourceId));
        fields = source.fields;
        lines.push(`Data source: "${source.name}" (${source.alias}, ${source.datasourceId})`);
      } catch {
        lines.push(`Data source: ${c.datasourceId} (not readable from this report)`);
      }
    }

    const defs = (c.conceptDefs ?? []) as Json[];
    const concept = (name: string) => conceptText(defs.find((d) => d.name === name) ?? { name }, fields);
    const slots = metadata?.slots ?? slotsOf(c, ctx.ext);
    if (slots.length) {
      lines.push('Setup slots:');
      for (const s of slots) {
        const names = slotNames(c, s);
        lines.push(`  ${s.title}: ${names.length ? names.map(concept).join(', ') : '(empty)'}`);
      }
    }
    if ((p.sort ?? []).length)
      lines.push(`Sort: ${(p.sort as Json[]).map((s) => `${concept(String(s.sortColumn))} ${s.sortDir === 0 ? 'ascending' : 'descending'}`).join(', ')}`);
    if (p.dateDuration) lines.push(`Date range: ${JSON.stringify(p.dateDuration)}`);
    if ((p.filters ?? []).length) lines.push(`Filters: ${(p.filters as unknown[]).map((f) => (typeof f === 'string' ? f : JSON.stringify(f))).join(', ')}`);

    // What other groups' options read back, keyed as their inputs.
    const options = ctx.ext
      .updaters()
      .filter((u) => u.read && (!u.types || u.types.includes(String(c.type))) && u.key !== 'style')
      .flatMap((u) => {
        const v = u.read!(c, doc);
        return v === undefined ? [] : [`  ${u.key}: ${JSON.stringify(v)}`];
      });
    if (options.length) lines.push('Options:', ...options);

    const labels = ctx.ext.styleLabels(String(c.type), c.preset);
    const values = { ...readStyle(c, labels), ...metadata?.style };
    const keys = labels.map((_, i) => labelKey(labels, i));
    const seen = new Map<string, number>();
    for (const control of metadata?.controls ?? []) {
      const name = control.label.trim().toLowerCase();
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      const key = count === 1 ? control.label : `${control.label}#${count}`;
      if (!keys.includes(key)) keys.push(key);
    }
    for (const key of Object.keys(metadata?.style ?? {})) if (!keys.includes(key)) keys.push(key);
    const set = keys.filter((k) => k in values);
    const titleKey = propertyKey(c);
    const title = titleKey ? p[titleKey]?.chartTitleProperty : undefined;
    lines.push('Style and settings:');
    if (title?.chartTitleText !== undefined && !keys.some((k) => k.toLowerCase() === 'title')) lines.push(`  Title: ${JSON.stringify(title.chartTitleText)}`);
    for (const k of set) lines.push(`  ${k}: ${shown(values[k])}`);
    const unset = keys.filter((k) => !(k in values));
    if (unset.length) lines.push(`  At their default: ${unset.join(', ')}`);
    if (!set.length && !unset.length && title?.chartTitleText === undefined) lines.push('  (no labels known for this component type)');
    return text(lines.join('\n'));
  },
});
