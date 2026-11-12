import { createHash } from 'node:crypto';
import { z } from 'zod';

import { LookerError } from './errors.js';

type Json = Record<string, any>;
type Scalar = string | number | boolean | null;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const values = z.record(z.string(), scalar).refine(v => Object.keys(v).length <= MAX_ENTRIES);
const reference = z.strictObject({ path: z.string().regex(/^definitions\/(structure|behavior|design)-[a-f0-9]{64}\.json$/), sha256: digest });
const instance = z.strictObject({ structure: reference, behavior: reference, design: reference, bindings: values, overrides: values });
const documentSchema = z.strictObject({ version: z.literal(2), id: z.string().min(1), fingerprint: z.string().min(1), materialized_sha256: digest,
  recipe: z.record(z.string(), z.unknown()), components: z.array(instance).min(1).max(1000) });
const containers = z.array(z.strictObject({ path: z.string(), type: z.enum(['object', 'array']) })).min(1).max(MAX_ENTRIES);
const profileSchema = z.strictObject({ version: z.literal(1), kind: z.enum(['structure', 'behavior', 'design']), values, containers: containers.optional() });

function invalid(message: string): never { throw new LookerError('invalid', `Component definition ${message}`); }
function canonical(value: unknown, depth = 0, counter = { value: 0 }): string {
  if (++counter.value > 500_000 || depth > 64) invalid('exceeds the JSON complexity limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object') invalid('contains a non-JSON value.');
  if (Array.isArray(value)) {
    if (value.length > MAX_ENTRIES || Object.keys(value).length !== value.length) invalid('contains an invalid array.');
    return `[${value.map(item => canonical(item, depth + 1, counter)).join(',')}]`;
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('contains a non-JSON object.');
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => {
    if (forbidden.has(key)) invalid('contains a forbidden object key.');
    return `${JSON.stringify(key)}:${canonical(object[key], depth + 1, counter)}`;
  }).join(',')}}`;
}
/** Stable content digest used by the installer and reader. Not a signature:
 * the catalog and validation files remain operator-controlled trust roots. */
export function definitionDigest(value: unknown): string {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > MAX_BYTES) invalid('exceeds the size limit.');
  return createHash('sha256').update(encoded).digest('hex');
}
function pointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/') || path.length > 4096 || /~(?![01])/u.test(path)) invalid('has an invalid JSON pointer.');
  const parts = path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.length > 64 || parts.some(part => forbidden.has(part))) invalid('has a forbidden JSON pointer.');
  return parts;
}
function materialize(groups: Array<Record<string, Scalar>>, layout: z.infer<typeof containers>, overrides: Record<string, Scalar>): Json {
  let root: any;
  const seen = new Set<string>(), leafPaths = new Set<string>();
  function put(path: string, value: unknown, leaf = false): void {
    if (seen.has(path)) invalid('has overlapping paths.');
    seen.add(path);
    if (leaf) leafPaths.add(path);
    const parts = pointer(path);
    if (!parts.length) { if (leaf) invalid('root must be a container.'); root = value; return; }
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) invalid('has a missing parent container.');
      parent = parent[part];
    }
    if (!parent || typeof parent !== 'object') invalid('has an invalid parent container.');
    const key = parts.at(-1)!;
    if (Array.isArray(parent) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= MAX_ENTRIES)) invalid('has an invalid array index.');
    Object.defineProperty(parent, key, { value, enumerable: true, writable: true, configurable: true });
  }
  for (const item of [...layout].sort((a, b) => pointer(a.path).length - pointer(b.path).length)) put(item.path, item.type === 'array' ? [] : {});
  for (const group of groups) for (const [path, value] of Object.entries(group)) put(path, Object.hasOwn(overrides, path) ? overrides[path] : value, true);
  for (const path of Object.keys(overrides)) if (!leafPaths.has(path)) invalid('has an override without a leaf.');
  if (!root || Array.isArray(root) || typeof root !== 'object') invalid('must materialize an object.');
  definitionDigest(root); // Reject sparse arrays and enforce depth/size bounds.
  return root as Json;
}

/** Resolve common native profiles into the exact validated V1 recipe. Field
 * rebinding happens later through instantiateComponentRecipe, unchanged. */
export async function assembleComponentDefinition(
  document: unknown,
  load: (path: string) => Promise<unknown>,
  expectedDigest: string,
): Promise<Json> {
  definitionDigest(document);
  const result = documentSchema.safeParse(document);
  if (!result.success || !digest.safeParse(expectedDigest).success) invalid('manifest is missing or invalid.');
  const manifest = result.data;
  if (manifest.materialized_sha256 !== expectedDigest) invalid('assembled digest does not match the catalog.');
  if (manifest.recipe.version !== 1 || manifest.recipe.id !== manifest.id || manifest.recipe.fingerprint !== manifest.fingerprint || Object.hasOwn(manifest.recipe, 'native_components')) invalid('metadata does not match the recipe.');
  const cache = new Map<string, z.infer<typeof profileSchema>>();
  const native: Json[] = [];
  let totalBytes = 0;
  for (const part of manifest.components) {
    const profiles: z.infer<typeof profileSchema>[] = [];
    for (const kind of ['structure', 'behavior', 'design'] as const) {
      const ref = part[kind];
      if (ref.path !== `definitions/${kind}-${ref.sha256}.json`) invalid('reference name does not match its kind and digest.');
      let profile = cache.get(ref.path);
      if (!profile) {
        const raw = await load(ref.path);
        if (definitionDigest(raw) !== ref.sha256) invalid('profile digest mismatch.');
        totalBytes += Buffer.byteLength(JSON.stringify(raw));
        if (totalBytes > 64 * 1024 * 1024) invalid('profiles exceed the total size limit.');
        const parsed = profileSchema.safeParse(raw);
        if (!parsed.success || parsed.data.kind !== kind || (kind === 'structure') !== Boolean(parsed.data.containers)) invalid('profile schema or kind is invalid.');
        profile = parsed.data; cache.set(ref.path, profile);
      }
      profiles.push(profile);
    }
    native.push(materialize([...profiles.map(profile => profile.values), part.bindings], profiles[0]!.containers!, part.overrides));
  }
  const recipe = { ...structuredClone(manifest.recipe), native_components: native };
  if (definitionDigest(recipe) !== expectedDigest) invalid('assembled digest mismatch; restore the validated definition.');
  return recipe;
}
