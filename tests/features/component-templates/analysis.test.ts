import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analysisFor, loadAnalysisContracts, parseAnalysisContracts } from '../../../src/features/component-templates/analysis.js';

const roots: string[] = [];
async function temp() { const root = await mkdtemp(join(tmpdir(), 'chart-analysis-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const sample = () => ({ version: 1, contracts: [{ version: 1, template_id: 'daily-trend', recipe_fingerprint: 'recipe-a', objective: 'Daily metric trend', intent_tags: ['trend'],
  roles: [{ role: 'metric_1', kind: 'metric', meaning: 'Metric', data_type: 'Number', chart_aggregations: ['inherit_source'], source_default_aggregation: 'auto', observed_operators: ['COUNT_DISTINCT'], requires_filtered_input: false }],
  date_rules: { requires_explicit_date_range: false, comparison: 'none', timezone: 'unknown' }, chart_rules: [], filter_requirements: [], grain_checks: ['Confirm one row per order'], uncertainties: ['New metric requires an explicit definition'],
  validation_scope: { analysis: 'offline_review', new_source_business_semantics: 'not_verified' } }] });

describe('operator analysis guidance', () => {
  it('separates original calculation from a new source definition and strips private extra fields', () => {
    const input = sample(); Object.assign(input.contracts[0]!, { private_formula: 'PRIVATE_FORMULA', provenance: { report: 'PRIVATE_REPORT' } });
    Object.assign(input.contracts[0]!.roles[0]!, { source_field: 'PRIVATE_FIELD' });
    const value = analysisFor(parseAnalysisContracts(input), 'daily-trend', 'recipe-a');
    expect(value?.roles[0]?.observed_operators).toEqual(['COUNT_DISTINCT']);
    expect(value?.validation_scope.new_source_business_semantics).toBe('not_verified');
    expect(JSON.stringify(value)).not.toContain('PRIVATE_');
  });
  it('preserves per-chart share calculations, date buckets and display patterns', () => {
    const input = sample();
    Object.assign(input.contracts[0]!.roles[0]!, { usages: [{ component_index: 0, chart_type: 'simple-table', slots: [{ kind: 'metrics', slot: 'primary' }], date_range_role: false, chart_aggregation: 'sum', result_calculation: 'percent_of_total', date_transformation: { transformationType: 3 }, display_format: '0.00%', private_source: 'PRIVATE_FIELD' }] });
    const value = analysisFor(parseAnalysisContracts(input), 'daily-trend', 'recipe-a');
    expect(value?.roles[0]?.usages?.[0]).toMatchObject({ result_calculation: 'percent_of_total', date_transformation: { transformationType: 3 }, display_format: '0.00%' });
    expect(JSON.stringify(value)).not.toContain('PRIVATE_FIELD');
  });
  it('rejects stale guidance instead of attaching it to a changed recipe', () => {
    expect(() => analysisFor(parseAnalysisContracts(sample()), 'daily-trend', 'recipe-b')).toThrow(/stale/);
  });
  it('rejects duplicate IDs and malformed contracts', () => {
    const input = sample(); input.contracts.push(input.contracts[0]!);
    expect(() => parseAnalysisContracts(input)).toThrow(/Duplicate/);
    expect(() => parseAnalysisContracts({ version: 1, contracts: [{ template_id: 'bad' }] })).toThrow(/invalid/);
  });
  it('keeps older libraries without guidance compatible', async () => {
    expect((await loadAnalysisContracts(await temp())).size).toBe(0);
    expect(analysisFor(new Map(), 'daily-trend', 'recipe-a')).toBeUndefined();
  });
  it('rejects malformed files and links outside the library', async () => {
    const root = await temp(), outside = await temp();
    await writeFile(join(root, 'analysis-contracts.json'), '{bad');
    await expect(loadAnalysisContracts(root)).rejects.toThrow(/valid JSON/);
    await rm(join(root, 'analysis-contracts.json'));
    await writeFile(join(outside, 'contracts.json'), JSON.stringify(sample()));
    await symlink(join(outside, 'contracts.json'), join(root, 'analysis-contracts.json'));
    await expect(loadAnalysisContracts(root)).rejects.toThrow(/inside/);
  });
  it('loads a matching public contract from a library', async () => {
    const root = await temp(); await writeFile(join(root, 'analysis-contracts.json'), JSON.stringify(sample()));
    expect(analysisFor(await loadAnalysisContracts(root), 'daily-trend', 'recipe-a')?.objective).toBe('Daily metric trend');
  });
});
