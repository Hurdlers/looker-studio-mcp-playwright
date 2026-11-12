import type { ResolvedSource } from '../../core/datasource.js';
import type { ToolContext } from '../../core/tool.js';

type Json = Record<string, any>;

// User variable references use a private marker in stored Looker formulas.
// Quoted literals and comments must retain their text.
export async function parameterFormula(ctx: ToolContext, source: ResolvedSource, formula: string): Promise<string> {
  const got = await ctx.rap.call<Json>('getBlockDatasource', { datasourceId: source.datasourceId });
  const entries: Json[] = (got.draft ?? got.published)?.resource?.parameterConfiguration?.parameters ?? [];
  if (!entries.length) return formula;
  const names = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.key !== 'string') continue;
    names.set(entry.key.toLowerCase(), entry.key);
    const label = entry.value?.parameterDisplayConfiguration?.displayName;
    if (typeof label === 'string' && !source.fields.some((field) => field.name.toLowerCase() === label.toLowerCase())) names.set(label.toLowerCase(), entry.key);
  }
  return replaceReferences(formula, new Map([...names].map(([name, key]) => [name, `\uE000${key}`])));
}

// Some source calculations are only recognized by their internal field ID.
export function canonicalFieldFormula(source: ResolvedSource, formula: string): string {
  const names = new Map<string, string>();
  for (const field of source.fields) {
    names.set(field.id.toLowerCase(), `t0.${field.id}`);
    names.set(field.name.toLowerCase(), `t0.${field.id}`);
  }
  return replaceReferences(formula, names);
}

// A preparation plan must not accept the canonicalizer's last matching field
// when several fields have the same display name. Inspect the same reference
// tokens that canonicalization uses, excluding literals, comments and functions.
export function ambiguousFieldReferences(source: ResolvedSource, formula: string): string[] {
  const targets = new Map<string, { label: string; ids: Set<string> }>();
  for (const field of source.fields) {
    for (const label of [field.id, field.name]) {
      const key = label.toLowerCase(), match = targets.get(key) ?? { label, ids: new Set<string>() };
      match.ids.add(field.id); targets.set(key, match);
    }
  }
  // An ID can also collide with another field's display name. Even t0.ID is
  // unsafe then: the existing fallback canonicalizer uses the same name map.
  const ambiguous = new Map([...targets].filter(([, match]) => match.ids.size > 1).map(([name, match]) => [name, match.label]));
  const tokens = new Map(source.fields.flatMap(field => [[field.id.toLowerCase(), field.id], [field.name.toLowerCase(), field.name]] as Array<[string, string]>));
  const found = new Set<string>();
  replaceReferences(formula, tokens, name => {
    const match = ambiguous.get(name.toLowerCase());
    if (match !== undefined) found.add(match);
  });
  return [...found];
}

function replaceReferences(formula: string, names: Map<string, string>, onReference?: (name: string) => void): string {
  const escaped = [...names.keys()].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!escaped.length) return formula;
  const references = new RegExp(`(?<![.\\p{L}\\p{N}_\\uE000])(?:t0\\.)?(${escaped.join('|')})(?![\\p{L}\\p{N}_]|\\s*\\()`, 'giu');
  const parts = formula.split(/('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\/\*[\s\S]*?\*\/|--[^\n]*)/g);
  return parts.map((part, i) => i % 2 ? part : part.replace(references, (_, name: string) => {
    onReference?.(name);
    return names.get(name.toLowerCase())!;
  })).join('');
}
