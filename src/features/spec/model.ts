import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import { blockFields, type SourceField } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import type { ToolContext } from '../../core/tool.js';
import { groupSchema, validatePageGroups, type PortableGroup } from './group-schema.js';
import { parseReportId } from '../../looker/view.js';

export type Json = Record<string, any>;
export interface Source { id: string; alias: string; name: string; block: Json; fields: SourceField[] }
export interface State { doc: ReportDoc; sources: Source[]; notes: string[] }
export type SpecGroup = PortableGroup;
export interface Spec extends Json { version: 1; name?: string; pages: Array<{ name: string; components: Json[]; settings?: Json; hidden?: boolean; groups?: SpecGroup[] }>; data_sources: Json[]; report_components: Json[] }
export interface Action { tool: string; args?: Json; path?: string; pageRef?: number; producesPage?: number; componentRef?: number; producesComponent?: number; groupsRestore?: { groups: SpecGroup[]; members: Array<{ index: number; componentId?: string; ref?: number }> } }
export interface Plan { actions: Action[]; notes: string[] }

export const COMPONENT_TOOLS: Record<string, string> = {
  chart: 'chart_add', text: 'text_add', shape: 'shape_add', control: 'control_add', image: 'image_add',
  line: 'line_add', embed: 'embed_add', community: 'community_viz_add',
};
export const invalid = (message: string) => new LookerError('invalid', message);
export const diagnostic = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replace(/ya29\.[A-Za-z0-9._~-]+/g, '[redacted]')
  .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
  .replace(/((?:access_token|refresh_token|id_token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]');
export const reportInput = z.string().min(1).describe('리포트 ID 또는 Looker Studio 리포트 주소.');
export const reportIdOf = (value: string): string => {
  try { return parseReportId(value); } catch { throw invalid('Give a report id or a Looker Studio report URL.'); }
};
export const expandPath = (value: string): string => resolve(value === '~' ? homedir() : value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : value);
const record = z.record(z.string(), z.unknown());
const records = z.array(record).default([]);
const settings = z.strictObject({ data_source: z.string().optional(), date_range_dimension: z.string().optional(), date_range: z.string().optional(), filters: z.array(record).optional() });
const specSchema = z.strictObject({
  version: z.literal(1).default(1), name: z.string().trim().min(1).optional(), theme: record.optional(),
  data_sources: records, parameters: records, calculated_fields: records, group_fields: records, bin_fields: records, blends: records,
  report_settings: settings.optional(), report_components: records,
  pages: z.array(z.strictObject({ name: z.string().trim().min(1), components: records, groups: z.array(groupSchema).optional(), settings: settings.extend({ style: record.optional() }).optional(), hidden: z.boolean().optional() })).min(1),
});

// Deferred consent cannot be enabled through a nested action or spec file.
export function checkDeferred(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (/^(viewer_?email_?param|viewerEmail|viewer_email)$/i.test(key) ||
      ((key === 'sql' || key === 'formula' || key === 'id') && typeof item === 'string' && /DS_USER_EMAIL/i.test(item)))
      throw new LookerError('refused', `${at}: viewer email parameters are deferred and cannot be enabled through this tool.`);
    checkDeferred(item, at);
  }
}

export async function loadSpec(input: { spec?: unknown; spec_path?: string | undefined }): Promise<Spec> {
  if ((input.spec === undefined) === (input.spec_path === undefined)) throw invalid('Supply exactly one of spec or spec_path.');
  let value = input.spec;
  const file = input.spec_path === undefined ? undefined : expandPath(input.spec_path);
  if (file) {
    try { value = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { throw invalid(`Cannot read spec_path ${file}: ${error instanceof Error ? error.message : String(error)}.`); }
  }
  checkDeferred(value, 'spec');
  const parsed = specSchema.safeParse(value);
  if (!parsed.success) throw invalid(parsed.error.issues.map((issue) => `spec.${issue.path.join('.')}: ${issue.message}`).join('\n'));
  const spec = parsed.data as Spec;
  spec.pages.forEach((page, index) => validatePageGroups(page, `spec.pages[${index}]`));
  const override = z.strictObject({ field: z.string().trim().min(1), name: z.string().trim().min(1).optional(), type: z.string().trim().min(1).optional(), aggregation: z.string().trim().min(1).optional() }).refine((value) => value.name !== undefined || value.type !== undefined || value.aggregation !== undefined, 'Give name, type or aggregation.');
  for (const [index, source] of spec.data_sources.entries()) if (source.field_overrides !== undefined) {
    const fields = z.array(override).safeParse(source.field_overrides);
    if (!fields.success) throw invalid(`spec.data_sources[${index}].field_overrides: ${fields.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    source.field_overrides = fields.data;
  }
  for (const parameter of spec.parameters ?? []) {
    if (!/^number \((?:whole|decimal)\)$/i.test(parameter.data_type ?? '')) continue;
    const numeric = (value: unknown): unknown => typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : value;
    if (parameter.default_value !== undefined) parameter.default_value = numeric(parameter.default_value);
    if (Array.isArray(parameter.values)) parameter.values = parameter.values.map(numeric);
  }
  for (const component of [...spec.pages.flatMap((page) => page.components), ...spec.report_components]) {
    if (component.component === 'image' && typeof component.image === 'string' && !/^(?:https?:|data:)/i.test(component.image) && !isAbsolute(component.image))
      component.image = resolve(file ? dirname(file) : process.cwd(), component.image);
  }
  return spec;
}

export async function readState(ctx: ToolContext, reportId: string): Promise<State> {
  const doc = await ctx.session.load(reportId);
  const aliases = [...(doc.report.resource?.datasourceAlias ?? [])].sort((a, b) => Number(a.alias.match(/\d+$/)?.[0] ?? 0) - Number(b.alias.match(/\d+$/)?.[0] ?? 0));
  const answers = await ctx.rap.callMany<Json>(aliases.map((entry) => ({ endpoint: 'getBlockDatasource', body: { datasourceId: entry.datasourceId } })));
  const notes: string[] = [];
  const sources = aliases.flatMap((entry, i): Source[] => {
    const answer = answers[i];
    if (!answer?.ok || !(answer.value.published ?? answer.value.draft)?.datasourceBlock) {
      notes.push(`${entry.datasourceId}: 읽지 못함; its source and fields were omitted.`); return [];
    }
    const block = answer.value.published ?? answer.value.draft;
    return [{ id: entry.datasourceId, alias: entry.alias, name: block.datasourceBlock.name || entry.alias, block, fields: blockFields(answer.value) }];
  });
  return { doc, sources, notes };
}

export function sourceName(entry: Json): string { return entry.name ?? entry.source_name ?? (entry.connector === 'ga4' ? 'Google Analytics 4' : entry.table_id ?? 'Custom query'); }
export function sourceArgs(entry: Json): Json { const { name, field_overrides: _fields, ...args } = entry; return { ...args, ...(name ? { source_name: name } : {}) }; }
