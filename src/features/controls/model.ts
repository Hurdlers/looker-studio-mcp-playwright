import { z } from 'zod';

import { fieldConcept, RECORD_COUNT, resolveField, setSlot, template, type Position } from '../../core/components.js';
import { resolveSource, type ResolvedSource, type SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import { toMapValue } from '../../core/mapvalue.js';
import { boxOf, pageComponents, pageSize } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import type { ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';

export type Json = Record<string, any>;
interface ControlField extends SourceField { parameterKey?: string }
export const KINDS = ['drop_down', 'fixed_size_list', 'input_box', 'advanced_filter', 'slider', 'checkbox', 'preset_filter', 'date_range', 'data_control', 'dimension_control', 'button'] as const;
export type ControlKind = typeof KINDS[number];
export const invalid = (message: string) => new LookerError('invalid', message);
export const prop = (c: Json): Json => ((c.propertyConfig ??= {}).componentProperty ??= {});

export const positionInput = z.object({
  left: z.number().int().min(0).max(20000).optional().describe('페이지 왼쪽에서 떨어진 거리(px, 0~20000).'),
  top: z.number().int().min(0).max(20000).optional().describe('페이지 위쪽에서 떨어진 거리(px, 0~20000).'),
  width: z.number().int().min(10).max(20000).optional().describe('너비(px, 10~20000).'),
  height: z.number().int().min(10).max(20000).optional().describe('높이(px, 10~20000).'),
}).describe('위치와 크기. 위치가 빠지면 왼쪽 40px, 맨 아래 컴포넌트의 20px 아래에 둡니다.');

export function reportIdOf(input: string): string {
  try { return parseReportId(input); }
  catch { throw invalid('Give report_id as a Looker Studio report id or report URL.'); }
}

const PRESETS: Partial<Record<ControlKind, [string, number, boolean, number?, boolean?]>> = {
  drop_down: ['default', 0, true], fixed_size_list: ['control-open-list', 0, false],
  input_box: ['control-textbox', 1, false, 2, false], advanced_filter: ['control-search-all', 1, false, 2, true],
  slider: ['control-slider', 2, false, 2], checkbox: ['control-checkbox', 3, false, 4],
};

export function makeControl(kind: ControlKind): Json {
  if (kind === 'data_control') throw new LookerError('refused', 'BigQuery does not support data controls. No control was created.');
  const preset = PRESETS[kind];
  if (preset) {
    const c = template('dimension-filter', preset[0]);
    Object.assign(prop(c).dimensionFilterProperty, { controlMode: preset[1], expandable: preset[2] });
    if (preset[3] !== undefined) prop(c).dimensionFilterProperty.labelPosition = preset[3];
    if (preset[4] !== undefined) prop(c).dimensionFilterProperty.showFilterCondition = preset[4];
    c.behavior = toMapValue({});
    prop(c).sort = [];
    setSlot(c, 'metrics', 'primary', []);
    return c;
  }
  const type = kind === 'date_range' ? 'simple-daterangepicker' : kind === 'dimension_control' ? 'dimension-control' : 'button';
  const c = template(type, kind === 'preset_filter' ? 'button-filter' : 'default');
  if (kind === 'button') Object.assign(prop(c).buttonProperty, { text: 'New Button', actionType: 1, internalActionType: 1, linkType: 1, linkUrl: '', internalLink: '', linkNewTab: true, fontSize: 14 });
  return c;
}

export function metricAllowed(kind: ControlKind): boolean { return kind === 'drop_down' || kind === 'fixed_size_list'; }
export function fieldRequired(kind: ControlKind): boolean { return !['date_range', 'data_control', 'button'].includes(kind); }
export function checkField(kind: ControlKind, field: ControlField): void {
  if (field.parameterKey) {
    if (kind !== 'drop_down') throw invalid('Parameters are currently supported by drop_down controls.');
    return;
  }
  if (kind === 'slider' && field.dataType !== 3 && field.semanticType !== 33 && ![12, 13, 14, 15, 28].includes(field.semanticType ?? -1))
    throw invalid(`A slider needs a numeric field; "${field.name}" is not numeric.`);
  if ((kind === 'checkbox' || kind === 'preset_filter') && field.dataType !== 1 && field.semanticType !== 34)
    throw invalid(`${kind} needs a Boolean field; "${field.name}" is not Boolean.`);
}

export function putField(c: Json, kind: ControlKind, field: ControlField): void {
  checkField(kind, field);
  if (field.parameterKey) {
    Object.assign(prop(c).dimensionFilterProperty, { controlParameter: { parameterKey: field.parameterKey }, singleSelect: true });
    setSlot(c, 'dimensions', 'primary', []);
    return;
  }
  if (prop(c).dimensionFilterProperty) delete prop(c).dimensionFilterProperty.controlParameter;
  setSlot(c, 'dimensions', 'primary', [fieldConcept(field)]);
}

export function putMetric(c: Json, f: SourceField): void {
  if ((f as ControlField).parameterKey) throw invalid('A parameter cannot be used as a control metric.');
  const concept = fieldConcept(f, f.aggregation === 7 ? {} : { aggregation: f.aggregation });
  if (f.id === RECORD_COUNT) delete concept.queryTimeTransformation.displayTransformation;
  prop(c).sort = [];
  setSlot(c, 'metrics', 'primary', [concept]);
  prop(c).sort = [{ sortDir: 1, sortColumn: concept.name }];
}

export function putFields(c: Json, kind: ControlKind, input: Record<string, string[]>, fields: SourceField[]): void {
  const titles = kind === 'dimension_control' ? ['Dimension', 'Control field'] : ['date_range', 'data_control'].includes(kind) ? [] : ['Control field', ...(metricAllowed(kind) ? ['Metric'] : [])];
  for (const [title, refs] of Object.entries(input)) {
    const match = titles.find((t) => t.toLowerCase() === title.trim().toLowerCase());
    if (!match) throw invalid(`No Setup slot "${title}" for ${kind}. Slots: ${titles.join(', ') || '(none)'}.`);
    const max = kind === 'dimension_control' ? 20 : 1;
    if (refs.length > max) throw invalid(`"${title}" accepts at most ${max} field(s).`);
    const resolved = refs.map((ref) => resolveField(fields, ref));
    if (match === 'Metric') {
      if (resolved[0]) putMetric(c, resolved[0]);
      else { prop(c).sort = []; setSlot(c, 'metrics', 'primary', []); }
    } else {
      resolved.forEach((field) => checkField(kind, field));
      if (resolved.length === 1 && (resolved[0] as ControlField).parameterKey) {
        putField(c, kind, resolved[0]!);
        continue;
      }
      if (prop(c).dimensionFilterProperty) delete prop(c).dimensionFilterProperty.controlParameter;
      setSlot(c, 'dimensions', 'primary', resolved.map((field) => fieldConcept(field)));
    }
  }
}

export async function controlSource(ctx: ToolContext, doc: ReportDoc, pageId: string, name?: string): Promise<ResolvedSource> {
  const aliases = doc.report.resource?.datasourceAlias ?? [];
  let chosen = name;
  if (name === undefined && aliases.length > 1) {
    const counts = new Map<string, number>();
    for (const c of pageComponents(doc, pageId)) {
      const id = String(c.datasourceId ?? c.propertyConfig?.componentProperty?.dataset?.datasetId ?? '');
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    chosen = [...aliases].sort((a, b) => (counts.get(b.datasourceId) ?? 0) - (counts.get(a.datasourceId) ?? 0))[0]!.alias;
  }
  try {
    const source = await resolveSource(ctx.rap, doc, chosen);
    const block = await ctx.rap.call<Json>('getBlockDatasource', { datasourceId: source.datasourceId });
    const entries: Json[] = (block.draft ?? block.published)?.resource?.parameterConfiguration?.parameters ?? [];
    for (const entry of entries) {
      const value = entry.value;
      const role = value?.parametersModifiedByRoles?.find((r: Json) => r.key === 2)?.value;
      if (!role || typeof entry.key !== 'string') continue;
      const parameter: ControlField = { id: entry.key, name: value.parameterDisplayConfiguration?.displayName ?? entry.key,
        parameterKey: entry.key, aggregation: 0, dataType: role.dataType === 1 ? 2 : role.dataType === 2 ? 1 : 3 };
      source.fields.push(parameter);
    }
    return source;
  }
  catch (err) {
    if (err instanceof LookerError && err.code === 'not_found') throw new LookerError(err.code, `${err.message} Use datasource_add to add a missing source first.`);
    throw err;
  }
}

export function controlBox(doc: ReportDoc, pageId: string, kind: ControlKind, given: Partial<Position> = {}): Position {
  const height = kind === 'fixed_size_list' ? 300 : ['input_box', 'advanced_filter'].includes(kind) ? 70 : kind === 'slider' ? 80 : 40;
  const bottoms = pageComponents(doc, pageId).map(boxOf).map((b) => b.top + b.height);
  const top = Math.max(0, Math.min(bottoms.length ? Math.max(...bottoms) + 20 : 20, pageSize(doc, pageId).height - 120));
  return { left: given.left ?? 40, top: given.top ?? top, width: given.width ?? (['button', 'preset_filter'].includes(kind) ? 200 : 300), height: given.height ?? height };
}
