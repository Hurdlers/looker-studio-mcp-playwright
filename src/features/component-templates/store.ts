import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

import type { ComponentRecipe } from '../../core/component-library.js';
import { assembleComponentDefinition } from '../../core/component-definitions.js';
import { LookerError } from '../../core/errors.js';
import type { ToolContext } from '../../core/tool.js';
import { typeLabel } from '../data-sources/types.js';
import { analysisFor, loadAnalysisContracts } from './analysis.js';

type Json = Record<string, any>;
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const entry = z.object({ id, name: z.string(), purpose: z.string().default(''), keywords: z.array(z.string()).default([]), fingerprint: z.string(), priority: z.number().optional(), theme_hash: z.string(), width: z.number().positive(), height: z.number().positive(), roles: z.array(z.record(z.string(), z.unknown())), text_slots: z.array(z.record(z.string(), z.unknown())).default([]), blockers: z.array(z.string()).default([]), notes: z.array(z.string()).default([]) }).passthrough();
const recipeSchema = entry.extend({ version: z.literal(1), native_components: z.array(z.record(z.string(), z.unknown())).min(1) });
export const invalid = (message: string) => new LookerError('invalid', message);

async function rootOf(ctx: ToolContext): Promise<string> {
  const raw = ctx.config.componentLibrary ?? join(ctx.home, 'components');
  const path = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : isAbsolute(raw) ? raw : resolve(ctx.home, raw);
  try { return await realpath(path); }
  catch { throw new LookerError('not_found', 'The component library is not installed. The server operator must configure component_library; clients do not provide file paths.'); }
}
async function jsonAt(root: string, path: string): Promise<unknown> {
  try {
    const full = await realpath(join(root, path)), rel = relative(root, full);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw invalid('The component file is outside the configured library.');
    const limit = path === 'catalog.json' ? 64 * 1024 * 1024 : 8 * 1024 * 1024;
    if ((await stat(full)).size > limit) throw invalid('The component file exceeds the size limit.');
    const content = await readFile(full, 'utf8');
    if (Buffer.byteLength(content) > limit) throw invalid('The component file exceeds the size limit.');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof LookerError) throw error;
    throw new LookerError('not_found', 'The component library file is missing or invalid. Ask the server operator to validate the installed library.');
  }
}
export async function catalog(ctx: ToolContext): Promise<{ entries: Json[]; validation: Json; root: string }> {
  const root = await rootOf(ctx);
  const parsed = z.object({ version: z.literal(1), components: z.array(entry) }).safeParse(await jsonAt(root, 'catalog.json'));
  if (!parsed.success) throw invalid('The installed component catalog has an invalid structure.');
  const validation = z.record(z.string(), z.unknown()).parse(await jsonAt(root, 'validation.json')) as Json;
  const contracts = await loadAnalysisContracts(root);
  const entries = parsed.data.components.filter(e => e.priority !== undefined).map(e => ({ ...e, analysis: analysisFor(contracts, e.id, e.fingerprint) }));
  return { entries, validation, root };
}
function usesSharedDefinition(item: Json, validation: Json): boolean {
  return item.storage_version === 2 || validation[item.id]?.storage_version === 2
    || item.materialized_sha256 !== undefined || validation[item.id]?.materialized_sha256 !== undefined;
}
export const verified = (item: Json, validation: Json): boolean => validation[item.id]?.status === 'pass'
  && validation[item.id]?.fingerprint === item.fingerprint && !item.blockers?.length
  && (!usesSharedDefinition(item, validation) || (typeof item.materialized_sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(item.materialized_sha256) && validation[item.id]?.materialized_sha256 === item.materialized_sha256));
export const roleLabel = (role: Json): string => typeof role.public_label === 'string' ? role.public_label : `${role.kind === 'date' ? '날짜' : role.kind === 'dimension' ? '분류' : '측정값'} ${String(role.key).split('_').at(-1)}${role.format_type === 14 ? ' (비율)' : role.currency ? ` (${role.currency})` : ''}`;
function visibleTextKeys(components: Json[]): Set<string> {
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { for (const match of value.matchAll(/\$text:([a-z_0-9]+)/g)) keys.add(match[1]!); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'chartTitleProperty' && (item as Json | undefined)?.chartTitleShowTitle === false) continue;
      visit(item);
    }
  };
  components.forEach(visit);return keys;
}
export function publicEntry(item: Json, validation: Json, details = false): Json {
  const ready = verified(item, validation);
  return {
    template_id: item.id, name: item.name, purpose: item.purpose,
    status: ready ? 'verified' : item.blockers?.length ? 'needs_support' : 'not_verified', addable: ready,
    design_family: item.theme_hash, size: { width: item.width, height: item.height },
    roles: item.roles.map((role: Json) => ({ key: role.key, name: roleLabel(role), kind: role.kind,
      ...(typeof role.public_description === 'string' ? { description: role.public_description } : {}),
      ...(role.format_type !== undefined ? { semantic_type: role.format_type, data_type: typeLabel(role.format_type, role.currency) } : role.kind === 'date' ? { data_type: 'Date' } : role.numeric_required ? { data_type: 'Number' } : {}),
      ...(role.currency ? { currency: role.currency } : {}),
      ...(role.numeric_required ? { numeric_required: true } : {}),
      ...(role.requires_filtered_input ? { requires_filtered_input: true } : {}),
    })),
    ...(details ? {
      ...(item.analysis ? { analysis: item.analysis } : {}),
      text_inputs: (item.text_slots ?? []).filter((slot: Json) => visibleTextKeys(item.native_components ?? []).has(slot.key)).map((slot: Json) => ({ key: slot.key, default: slot.default, ...(slot.max_units ? { max_length_units: slot.max_units } : {}) })),
      date_range_required: (item.native_components ?? []).some((c: Json) => c.propertyConfig?.componentProperty?.compareDateDuration),
      conditions: ['Bind existing fields from the target data source. Calculated metrics must be created first.', 'Original customer filters are not copied. Roles marked requires_filtered_input need a field with the intended condition already applied.', 'Only the saved design size is supported. Use the same design_family when composing multiple templates.'],
      limitations: item.blockers ?? [],
    } : {}),
  };
}
export async function loadRecipe(ctx: ToolContext, templateId: string): Promise<{ recipe: ComponentRecipe; item: Json; validation: Json }> {
  if (!id.safeParse(templateId).success) throw invalid('Invalid template_id. Use component_template_list.');
  const { entries, validation, root } = await catalog(ctx);
  const listed = entries.find(e => e.id === templateId);
  if (!listed) throw new LookerError('not_found', `Unknown component template "${templateId}". Use component_template_list.`);
  let raw = await jsonAt(root, `recipes/${templateId}.json`);
  if (usesSharedDefinition(listed, validation) && (raw as Json | null)?.version !== 2) throw invalid('The component storage version does not match its validated shared definition.');
  if ((raw as Json | null)?.version === 2) {
    const pinned = listed.materialized_sha256;
    if (typeof pinned !== 'string' || validation[templateId]?.materialized_sha256 !== pinned) throw invalid('The shared component validation digest is missing or stale.');
    raw = await assembleComponentDefinition(raw, path => jsonAt(root, path), pinned);
  }
  const parsed = recipeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== templateId || parsed.data.fingerprint !== listed.fingerprint) throw invalid('The template definition and catalog versions do not match.');
  const item = parsed.data as Json;
  delete item.analysis;
  if (listed.analysis) item.analysis = listed.analysis;
  // Keep private provenance and original source names inside operator-owned files.
  const recipe = structuredClone(item) as unknown as ComponentRecipe;
  if (usesSharedDefinition(listed, validation)) { item.storage_version = 2; item.materialized_sha256 = listed.materialized_sha256; }
  for (const role of recipe.roles) role.label = roleLabel(role);
  return { recipe, item, validation };
}
