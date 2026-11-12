import { describe, expect, it } from 'vitest';
import { assembleComponentDefinition, definitionDigest } from '../src/core/component-definitions.js';

type Json = Record<string, any>;
function fixture() {
  const component = { type: 'kpi-metric', componentId: 'card', values: [0, false, null], style: { color: '#123456' }, empty: {} };
  const definitions: Record<string, Json> = {};
  const make = (kind: string, values: Json, containers?: Json[]) => {
    const value = { version: 1, kind, values, ...(containers ? { containers } : {}) };
    const sha256 = definitionDigest(value), path = `definitions/${kind}-${sha256}.json`;
    definitions[path] = value; return { path, sha256 };
  };
  const structure = make('structure', { '/type': 'kpi-metric' }, [
    { path: '', type: 'object' }, { path: '/values', type: 'array' }, { path: '/style', type: 'object' }, { path: '/empty', type: 'object' },
  ]);
  const behavior = make('behavior', { '/values/0': 0, '/values/1': false, '/values/2': null });
  const design = make('design', { '/style/color': '#123456' });
  const recipe = { version: 1, id: 'sample', fingerprint: 'fp', roles: [], native_components: [component] };
  const { native_components: _, ...metadata } = recipe;
  const document: Json = { version: 2, id: 'sample', fingerprint: 'fp', materialized_sha256: definitionDigest(recipe), recipe: metadata,
    components: [{ structure, behavior, design, bindings: { '/componentId': '$component' }, overrides: { '/componentId': 'card' } }] };
  return { document, recipe, definitions, load: async (path: string) => structuredClone(definitions[path]) };
}

describe('shared component definitions', () => {
  it('reconstructs the exact V1 including empty objects, arrays, zero, false and null', async () => {
    const f = fixture(); const before = structuredClone(f.document);
    expect(await assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).toEqual(f.recipe);
    expect(f.document).toEqual(before);
  });
  it('pins the assembled content to the operator catalog, not merely the manifest', async () => {
    const f = fixture(); f.document.recipe.roles = [{ kind: 'metric' }];
    f.document.materialized_sha256 = definitionDigest({ ...f.recipe, roles: f.document.recipe.roles });
    await expect(assembleComponentDefinition(f.document, f.load, definitionDigest(f.recipe))).rejects.toThrow(/digest/);
  });
  it('rejects mutated shared content even when the recipe metadata is unchanged', async () => {
    const f = fixture(); f.definitions[f.document.components[0].design.path]!.values['/style/color'] = '#ffffff';
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow(/digest/);
  });
  it.each(['../outside.json', '/tmp/outside.json', 'definitions/../outside.json'])('rejects reference path %s before loading', async path => {
    const f = fixture(); f.document.components[0].structure.path = path; let reads = 0;
    await expect(assembleComponentDefinition(f.document, async () => { reads++; return {}; }, f.document.materialized_sha256)).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it.each(['/__proto__/polluted', '/constructor/prototype/polluted', '/values/999999999', '/values/-1', '/bad~2escape'])('rejects invalid pointer %s', async pointer => {
    const f = fixture(); f.document.components[0].bindings[pointer] = true;
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow();
    expect(({} as Json).polluted).toBeUndefined();
  });
  it('rejects overlapping layers and unused overrides', async () => {
    const f = fixture(); f.document.components[0].bindings['/type'] = 'other';
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow(/overlap/);
    const g = fixture(); g.document.components[0].overrides['/missing'] = 'x';
    await expect(assembleComponentDefinition(g.document, g.load, g.document.materialized_sha256)).rejects.toThrow(/override/);
  });
  it('rejects omitted native properties through the assembled digest', async () => {
    const f = fixture(); delete f.document.components[0].bindings['/componentId']; delete f.document.components[0].overrides['/componentId'];
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow(/digest/);
  });
  it('rejects missing profiles, duplicate containers and sparse arrays', async () => {
    const f = fixture(); delete f.definitions[f.document.components[0].design.path];
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow();
    for (const mutate of [(p: Json) => p.containers.push({ path: '/values', type: 'array' }), (p: Json) => p.values['/values/3'] = 'gap']) {
      const g = fixture(), old = g.document.components[0].structure, profile = structuredClone(g.definitions[old.path]!);
      mutate(profile); const sha256 = definitionDigest(profile), path = `definitions/structure-${sha256}.json`;
      g.definitions[path] = profile; g.document.components[0].structure = { path, sha256 };
      await expect(assembleComponentDefinition(g.document, g.load, g.document.materialized_sha256)).rejects.toThrow();
    }
  });
  it('rejects unsupported versions, non-JSON input and overlarge documents', async () => {
    const f = fixture(); f.document.version = 3;
    await expect(assembleComponentDefinition(f.document, f.load, f.document.materialized_sha256)).rejects.toThrow();
    expect(() => definitionDigest({ bad: Number.NaN })).toThrow();
    expect(() => definitionDigest({ text: 'x'.repeat(9 * 1024 * 1024) })).toThrow(/size/);
  });
});
