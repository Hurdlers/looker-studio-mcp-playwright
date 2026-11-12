import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Extensions, type ChartKind, type ComponentUpdater } from '../src/core/extensions.js';

const kind = (key: string, type: string, preset?: string, extra: Partial<ChartKind> = {}): ChartKind => ({
  key,
  type,
  ...(preset ? { preset } : {}),
  build: () => ({ type, ...(preset ? { preset } : {}) }),
  ...extra,
});
const updater = (key: string): ComponentUpdater => ({ key, input: z.string(), apply: () => undefined });

describe('Extensions', () => {
  it('keeps dedicated visualization metadata without advertising it through chart_add', () => {
    const special = kind('community_demo', 'gs://demo', undefined, { creationTool: 'community_viz_add' });
    const ext = new Extensions([{ group: 'demo', extensions: { chartKinds: [kind('table', 'simple-table'), special] } }]);
    expect(ext.kindOf({ type: 'gs://demo' })?.creationTool).toBe('community_viz_add');
    expect(ext.chartKindInput('kind').safeParse('community_demo').success).toBe(false);
    expect(ext.chartKindInput('kind').parse('table')).toBe('table');
    const only = new Extensions([{ group: 'demo', extensions: { chartKinds: [special] } }]);
    expect(only.chartKindInput('kind').safeParse('community_demo').success).toBe(false);
  });
  const ext = new Extensions([
    { group: 'chart-types-a', extensions: { chartKinds: [kind('bar', 'simple-barchart', 'horizontal'), kind('column', 'simple-barchart')] } },
    {
      group: 'community',
      extensions: { chartKinds: [kind('funnel', 'gs://viz/funnel', undefined, { matches: (c) => c.type === 'gs://viz/funnel' })] },
    },
    { group: 'chart-options', extensions: { updaters: [updater('filters'), updater('date_range')] } },
    { group: 'static', extensions: { styles: [{ type: 'shape', labels: [{ label: 'Fill', kind: 'color', path: 'shapeProperty.fill' }] }] } },
  ]);

  it('finds chart kinds by key, ignoring case, spaces and dashes', () => {
    expect(ext.chartKind('bar')?.preset).toBe('horizontal');
    expect(ext.chartKind('Col-umn')?.type).toBe('simple-barchart');
    expect(ext.chartKind('pie')).toBeUndefined();
    expect(ext.chartKinds().map((k) => k.key)).toEqual(['bar', 'column', 'funnel']);
  });

  it('tells which kind a component was made as', () => {
    expect(ext.kindOf({ type: 'simple-barchart', preset: 'horizontal' })?.key).toBe('bar');
    expect(ext.kindOf({ type: 'simple-barchart', preset: 'default' })?.key).toBe('column');
    expect(ext.kindOf({ type: 'simple-barchart', preset: 'other' })?.key).toBe('column');
    expect(ext.kindOf({ type: 'gs://viz/funnel' })?.key).toBe('funnel');
  });

  it('gives updaters by input key and style labels by type', () => {
    expect(ext.updater('filters')?.key).toBe('filters');
    expect(ext.updaters().map((u) => u.key)).toEqual(['filters', 'date_range']);
    expect(ext.styleLabels('shape').map((l) => l.label)).toEqual(['Fill']);
  });

  it('refuses two owners for one key', () => {
    expect(
      () =>
        new Extensions([
          { group: 'chart-options', extensions: { updaters: [updater('filters')] } },
          { group: 'controls', extensions: { updaters: [updater('filters')] } },
        ]),
    ).toThrow('updater "filters" is given by both chart-options and controls');
  });

  it('counts chart kind keys that differ only in case, spaces, _ or - as one', () => {
    expect(
      () =>
        new Extensions([
          { group: 'chart-types-a', extensions: { chartKinds: [kind('stacked_column', 'simple-barchart')] } },
          { group: 'chart-types-b', extensions: { chartKinds: [kind('Stacked-Column', 'simple-barchart')] } },
        ]),
    ).toThrow('chart kind "Stacked-Column" (same as "stacked_column") is given by both chart-types-a and chart-types-b');
  });

  it('lets several groups give common style labels, one owner per label', () => {
    const common = (label: string) => ({ type: '*', labels: [{ label, kind: 'color' as const, path: `x.${label}` }] });
    const ok = new Extensions([
      { group: 'static', extensions: { styles: [common('Background')] } },
      { group: 'layout', extensions: { styles: [common('Border color')] } },
    ]);
    expect(ok.styleLabels('any').map((l) => l.label)).toEqual(['Background', 'Border color']);
    expect(
      () =>
        new Extensions([
          { group: 'static', extensions: { styles: [common('Background')] } },
          { group: 'layout', extensions: { styles: [common('background')] } },
        ]),
    ).toThrow(/common style label "background" is given by both static and layout/);
  });

  it("puts the updaters' and chart kinds' inputs into the owning tool's input", () => {
    const shape = ext.updaterInput();
    expect(Object.keys(shape)).toEqual(['filters', 'date_range']);
    expect(z.object(shape).parse({ filters: 'f1' })).toEqual({ filters: 'f1' });
    expect(Object.keys(ext.updaterInput(['date_range']))).toEqual(['date_range']);
    const type = ext.chartKindInput('Chart type');
    expect(type.parse('funnel')).toBe('funnel');
    expect(() => type.parse('pie')).toThrow();
    expect(type.description).toBe('Chart type');
    expect(new Extensions().chartKindInput('Chart type').parse('anything')).toBe('anything');
  });
});

describe('gen-registry', () => {
  it('imports extensions only from groups that export them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kl-features-'));
    for (const [g, body] of [
      ['chart-core', 'export const tools = [];\n'],
      ['chart-types-a', 'export const tools = [];\nexport const extensions = { chartKinds: [] };\n'],
      ['empty', ''],
    ] as const) {
      mkdirSync(join(dir, g));
      if (body) writeFileSync(join(dir, g, 'index.ts'), body);
    }
    execFileSync(process.execPath, ['scripts/gen-registry.mjs'], { env: { ...process.env, LOOKER_STUDIO_MCP_FEATURES: dir } });
    const out = readFileSync(join(dir, 'registry.generated.ts'), 'utf8');
    expect(out).toContain("import { tools as chartCoreGroup } from './chart-core/index.js';");
    expect(out).toContain("import { tools as chartTypesAGroup, extensions as chartTypesAGroupExt } from './chart-types-a/index.js';");
    expect(out).toContain('export const FEATURE_TOOLS: Tool[] = [...chartCoreGroup, ...chartTypesAGroup];');
    expect(out).toContain("[{ group: 'chart-types-a', extensions: chartTypesAGroupExt }]");
  });
});

it('uses group-owned readers and rejects ambiguous report or component readers', async () => {
  const theme = () => ({ canvas: { width: 1200, height: 900 } });
  const reader = async (_ctx: any, _doc: any, c: any) => c.type === 'custom' ? { name: 'Custom', creationTool: 'custom_add' } : undefined;
  const ext = new Extensions([{ group: 'custom', extensions: { reportTheme: theme, componentMetadata: reader } }]);
  expect(ext.reportTheme({} as any)).toEqual(theme());
  expect(await ext.componentMetadata({} as any, {} as any, { type: 'other' })).toBeUndefined();
  expect(await ext.componentMetadata({} as any, {} as any, { type: 'custom' })).toEqual({ name: 'Custom', creationTool: 'custom_add' });
  expect(() => new Extensions([
    { group: 'one', extensions: { reportTheme: theme } },
    { group: 'two', extensions: { reportTheme: theme } },
  ])).toThrow('one group must own it');
  const ambiguous = new Extensions([
    { group: 'one', extensions: { componentMetadata: reader } },
    { group: 'two', extensions: { componentMetadata: reader } },
  ]);
  await expect(ambiguous.componentMetadata({} as any, {} as any, { type: 'custom' })).rejects.toThrow('Multiple readers');
});
