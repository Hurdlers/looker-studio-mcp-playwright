import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';

import { LookerError } from '../../core/errors.js';

const text = z.string().max(3000);
const strings = z.array(text).max(100);
const role = z.object({
  role: text, kind: z.enum(['dimension', 'metric', 'date']), meaning: text, data_type: text,
  unit: text.optional(), source_default_aggregation: text.optional(), chart_aggregations: strings,
  usages: z.array(z.object({ component_index: z.number().int().min(0), chart_type: text, slots: z.array(z.object({ kind: text, slot: text })).max(100), date_range_role: z.boolean(), chart_aggregation: text, result_calculation: text, date_transformation: z.object({ transformationType: z.number().int() }).nullable(), display_format: text.nullable() })).max(100).optional(),
  calculation_kind: text.optional(), expression_shape: text.optional(), expression_is_executable: z.literal(false).optional(), observed_operators: strings, requires_filtered_input: z.boolean(),
});
const contract = z.object({
  version: z.literal(1), template_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), recipe_fingerprint: z.string().min(1).max(128),
  objective: text, intent_tags: strings, roles: z.array(role).max(100),
  date_rules: z.object({ requires_explicit_date_range: z.boolean(), comparison: text, timezone: text }),
  chart_rules: z.array(z.object({ chart_type: text, description: text })).max(100),
  binding_relations: z.array(z.object({ roles: strings, original_source_field_shared: z.boolean(), distinct_filter_scopes: z.boolean(), instruction: text })).max(100).optional(),
  filter_requirements: strings, grain_checks: strings, uncertainties: strings,
  validation_scope: z.object({ analysis: text, new_source_business_semantics: text }),
});
export type AnalysisContract = z.infer<typeof contract>;

// This is operator-authored guidance, not proof of business equivalence.
// The whitelist also keeps private provenance and source formulas out of MCP.
export function parseAnalysisContracts(raw: unknown): Map<string, AnalysisContract> {
  const parsed = z.object({ version: z.literal(1), contracts: z.array(contract).max(1000) }).safeParse(raw);
  if (!parsed.success) throw new LookerError('invalid', 'The component analysis contracts have an invalid structure.');
  const result = new Map<string, AnalysisContract>();
  for (const value of parsed.data.contracts) {
    if (result.has(value.template_id)) throw new LookerError('invalid', 'Duplicate component analysis contract.');
    result.set(value.template_id, value);
  }
  return result;
}

export async function loadAnalysisContracts(root: string): Promise<Map<string, AnalysisContract>> {
  root = await realpath(root);
  let file: string;
  try { file = await realpath(join(root, 'analysis-contracts.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; }
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new LookerError('invalid', 'Analysis contracts must stay inside the component library.');
  const data = await readFile(file, 'utf8');
  if (Buffer.byteLength(data) > 2_000_000) throw new LookerError('invalid', 'The component analysis contracts are too large.');
  let raw: unknown;
  try { raw = JSON.parse(data); } catch { throw new LookerError('invalid', 'The component analysis contracts are not valid JSON.'); }
  return parseAnalysisContracts(raw);
}

export function analysisFor(contracts: ReadonlyMap<string, AnalysisContract>, id: string, fingerprint: string): AnalysisContract | undefined {
  const value = contracts.get(id);
  if (value && value.recipe_fingerprint !== fingerprint) throw new LookerError('invalid', 'The component analysis contract is stale. Rebuild it for the current recipe.');
  return value;
}
