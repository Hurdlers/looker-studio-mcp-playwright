import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { definitionDigest } from '../../../src/core/component-definitions.js';
import { resultText } from '../../../src/core/tool.js';
import { loadRecipe } from '../../../src/features/component-templates/store.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function recipe(): Json { return {
  version: 1, id: 'shared-card', name: '합계 카드', purpose: '합계 확인', priority: 1, fingerprint: 'tested-fingerprint', theme_hash: 'family', width: 200, height: 100,
  blockers: [], notes: [], text_slots: [], provenance: { private: 'private-original' },
  roles: [{ key: 'metric_1', kind: 'metric', numeric_required: true, label: 'private-label', concepts: [{ component: 0, name: 'metric', aggregation: 6 }] }],
  native_components: [{ componentId: 'old-id', type: 'kpi-metric', datasourceId: '$data_source', attributeConfig: { componentAttribute: { left: 0, top: 0, width: 200, height: 100 } },
    propertyConfig: { componentProperty: { dataset: { datasetType: 1, datasetId: '$data_source' }, metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['metric'] } }] }, kpiMetricProperty: { primaryDecimalPrecision: 0 } } },
    conceptDefs: [{ name: 'metric', id: 't0.metric', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '$role:metric_1', aggregation: 6 } } }],
  }],
}; }
async function setup(shared: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'common-library-')); dirs.push(dir);
  await mkdir(join(dir, 'recipes')); await mkdir(join(dir, 'definitions'));
  const original = recipe(), containers: Json[] = [], groups: Record<string, Json> = { structure: {}, behavior: {}, design: {}, bindings: {} };
  const flatten = (value: any, path: string) => {
    if (value && typeof value === 'object') { containers.push({ path, type: Array.isArray(value) ? 'array' : 'object' }); for (const [k, v] of Object.entries(value)) flatten(v, `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`); }
    else groups[path === '/type' ? 'structure' : path === '/componentId' ? 'bindings' : 'behavior']![path] = value;
  };
  flatten(original.native_components[0], '');
  const part: Json = { bindings: groups.bindings, overrides: {} }, profiles: Record<string, Json> = {};
  for (const kind of ['structure', 'behavior', 'design']) {
    const profile = { version: 1, kind, values: groups[kind], ...(kind === 'structure' ? { containers } : {}) };
    const sha256 = definitionDigest(profile), path = `definitions/${kind}-${sha256}.json`;
    profiles[path] = profile; part[kind] = { path, sha256 }; await writeFile(join(dir, path), JSON.stringify(profile));
  }
  const materialized_sha256 = definitionDigest(original), { native_components: _, ...metadata } = original;
  const manifest: Json = { version: 2, id: original.id, fingerprint: original.fingerprint, materialized_sha256, recipe: metadata, components: [part] };
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({ version: 1, components: [{ ...metadata, ...(shared ? { storage_version: 2, materialized_sha256 } : {}) }] }));
  await writeFile(join(dir, 'validation.json'), JSON.stringify({ [original.id]: { status: 'pass', fingerprint: original.fingerprint, ...(shared ? { storage_version: 2, materialized_sha256 } : {}) } }));
  await writeFile(join(dir, 'recipes/shared-card.json'), JSON.stringify(shared ? manifest : original));
  const f = fake(); f.ctx.config.componentLibrary = dir; f.original.shareable.name = '[looker-studio-mcp-lab-1] common definition';
  return { ...f, dir, originalRecipe: original, manifest, profiles };
}

describe('common definitions through existing component tools', () => {
  it('preserves V1 discovery and inspection DTOs without exposing the storage representation', async () => {
    const a = await setup(false), b = await setup(true);
    for (const [tool, args] of [['component_template_list', {}], ['component_template_inspect', { template_id: 'shared-card' }]] as const) {
      const old = resultText(await a.run(tool, args)), current = resultText(await b.run(tool, args));
      expect(current).toBe(old); expect(current).not.toMatch(/private-|definitions\/|sha256/);
    }
    expect((await loadRecipe(b.ctx, 'shared-card')).recipe).toEqual((await loadRecipe(a.ctx, 'shared-card')).recipe);
  });
  it('reuses the existing binding engine to add a common definition with fresh data fields', async () => {
    const f = await setup(true);
    const added = await f.run('component_template_add', { report_id: ORIGINAL, template_id: 'shared-card', bindings: { metric_1: { field: 'value', aggregation: 'sum' } } });
    expect(JSON.parse(resultText(added))).toMatchObject({ saved: true, component_count: 1 });
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.componentId).not.toBe('old-id');
    expect(c.conceptDefs[0].queryTimeTransformation.dataTransformation).toMatchObject({ sourceFieldName: '_value_', aggregation: 6 });
    expect(c.propertyConfig.componentProperty.kpiMetricProperty.primaryDecimalPrecision).toBe(0);
  });
  it('requires the validation record to pin shared materialized content', async () => {
    const f = await setup(true); await writeFile(join(f.dir, 'validation.json'), JSON.stringify({ 'shared-card': { status: 'pass', fingerprint: 'tested-fingerprint' } }));
    const listed = JSON.parse(resultText(await f.run('component_template_list', { verified_only: false })));
    expect(listed.templates[0].addable).toBe(false);
    await expect(f.run('component_template_inspect', { template_id: 'shared-card' })).rejects.toThrow(/validation digest/);
    expect(f.writes()).toEqual([]);
  });
  it.each(['catalog-only', 'both'])('does not advertise a shared recipe after %s pins are removed', async (where) => {
    const f = await setup(true);
    const catalog = { version: 1, components: [{ ...f.originalRecipe, storage_version: 2 }] };
    await writeFile(join(f.dir, 'catalog.json'), JSON.stringify(catalog));
    if (where === 'both') await writeFile(join(f.dir, 'validation.json'), JSON.stringify({ 'shared-card': { status: 'pass', fingerprint: 'tested-fingerprint', storage_version: 2 } }));
    const listed = JSON.parse(resultText(await f.run('component_template_list', { verified_only: false })));
    expect(listed.templates[0].addable).toBe(false);
    await expect(f.run('component_template_inspect', { template_id: 'shared-card' })).rejects.toThrow(/validation digest/);
  });
  it('does not bypass the shared digest by replacing its manifest with a V1 recipe', async () => {
    const f = await setup(true);
    await writeFile(join(f.dir, 'recipes/shared-card.json'), JSON.stringify(f.originalRecipe));
    await expect(f.run('component_template_inspect', { template_id: 'shared-card' })).rejects.toThrow(/storage version/);
    expect(f.writes()).toEqual([]);
  });
  it('rejects shared profile symlinks outside the configured root', async () => {
    const f = await setup(true), path = f.manifest.components[0].structure.path;
    const outside = await mkdtemp(join(tmpdir(), 'outside-common-')); dirs.push(outside);
    await writeFile(join(outside, 'profile.json'), JSON.stringify(f.profiles[path]));
    await rm(join(f.dir, path)); await symlink(join(outside, 'profile.json'), join(f.dir, path));
    await expect(f.run('component_template_inspect', { template_id: 'shared-card' })).rejects.toThrow(/outside/);
    expect(f.writes()).toEqual([]);
  });
  it('rejects an altered native chart even if its profile reference hash is updated', async () => {
    const f = await setup(true), old = f.manifest.components[0].behavior;
    const changed = structuredClone(f.profiles[old.path]!); changed.values['/propertyConfig/componentProperty/kpiMetricProperty/primaryDecimalPrecision'] = 3;
    const sha256 = definitionDigest(changed), path = `definitions/behavior-${sha256}.json`;
    await writeFile(join(f.dir, path), JSON.stringify(changed)); f.manifest.components[0].behavior = { path, sha256 };
    await writeFile(join(f.dir, 'recipes/shared-card.json'), JSON.stringify(f.manifest));
    await expect(f.run('component_template_add', { report_id: ORIGINAL, template_id: 'shared-card', bindings: { metric_1: 'value' } })).rejects.toThrow(/assembled digest/);
    expect(f.writes()).toEqual([]);
  });
});
