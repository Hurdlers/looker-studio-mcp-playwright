import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { fromMapValue, toMapValue } from '../../../src/core/mapvalue.js';
import type { ReportDoc } from '../../../src/core/session.js';
import { resultText, runTool } from '../../../src/core/tool.js';
import { tools } from '../../../src/features/theme/index.js';
import { readTheme, applyTheme, planTheme } from '../../../src/features/theme/theme.js';
import type { Rap } from '../../../src/looker/rap.js';

const R1 = '0b5c4b8e-1111-4222-8333-944455556666';
const THEME_ID = 'themeabc123def4';

function report(): ReportDoc {
  return {
    shareable: { id: R1, name: 'Lab' },
    version: '7',
    report: {
      propertyConfig: { reportProperty: { themeConfig: THEME_ID } },
      attributeConfig: {
        reportAttribute: { width: 1200, height: 900, viewModeNav: 1, viewModeHeader: 0, viewModeScale: 0, viewModeMargin: true, gridSize: 10, datasourceConfigVersion: 2 },
      },
      resource: {
        datasourceAlias: [],
        theme: {
          value: [
            toMapValue({
              id: THEME_ID,
              content: { version: 1, themeFillColor: { color: '#F3F3F3', opacity: 1, themeRef: { index: 0 } }, themeFontFamily: 'Roboto', themeOpacity: 1 },
            }),
          ],
        },
      } as any,
    },
    navigationInfo: { style: 1, navItems: [{ page: { pageId: 'p1', displayName: 'Page 1' } }] },
    page: [{ pageId: 'p1', page: {} }],
  };
}

function fakeRap(doc: ReportDoc = report()) {
  const calls: Array<{ endpoint: string; body: any }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => {
      calls.push({ endpoint, body: structuredClone(body) });
      if (endpoint === 'getReport') return { reportConfig: structuredClone(doc) } as T;
      if (endpoint === 'updateReport' || endpoint === 'updateReportNavigationInfo') return { version: '8' } as T;
      throw new Error(`unexpected ${endpoint}`);
    },
    callMany: async () => {
      throw new Error('callMany not expected');
    },
  };
  return { rap, calls };
}

const ctxFor = (rap: Rap) => createContext({ rap, tools, config: parseConfig({ writes_enabled: true }, tmpdir()) });

async function run(args: Record<string, unknown>, doc?: ReportDoc) {
  const { rap, calls } = fakeRap(doc);
  const out = resultText(await runTool(ctxFor(rap), 'theme_update', { report_id: R1, ...args }));
  return { out, calls, sent: calls.find((c) => c.endpoint === 'updateReport')?.body };
}

// The theme content the save sends for the theme themeConfig points at.
function sentTheme(req: any): { id: string; raw: any; plain: any } {
  const id = req.propertyConfig.reportProperty.themeConfig;
  for (const v of req.resource.theme.value) {
    const e = Object.fromEntries(v.mapValue.entry.map((x: any) => [x.key, x.value]));
    if (e.id.strValue === id) return { id, raw: e.content, plain: fromMapValue(e.content) };
  }
  throw new Error('theme in use not sent');
}

function entryOf(raw: any, key: string): any {
  return raw.mapValue.entry.find((e: any) => e.key === key)?.value;
}

async function failure(args: Record<string, unknown>) {
  const { rap, calls } = fakeRap();
  const err = await runTool(ctxFor(rap), 'theme_update', { report_id: R1, ...args }).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { err: err as { code?: string; message: string } | undefined, calls };
}

const constellation = JSON.parse(readFileSync(new URL('../../../fixtures/theme/presets/Constellation.json', import.meta.url), 'utf8'));

describe('theme_update', () => {
  it('theme.preset: Constellation replaces the content of the theme in use with the preset as mapValue; name ignores case', async () => {
    const { sent, out } = await run({ preset: 'Constellation' });
    const t = sentTheme(sent.reportRequest);
    expect(t.id).toBe(THEME_ID);
    expect(t.raw).toEqual(toMapValue(constellation, undefined));
    expect(entryOf(entryOf(t.raw, 'themeFillColor'), 'color')).toEqual({ strValue: '#202124' });
    expect(t.plain.themeFontFamily).toBe('Droid Sans');
    expect(out).toContain('theme Constellation');

    const lower = await run({ preset: 'constellation' });
    expect(sentTheme(lower.sent.reportRequest).raw).toEqual(t.raw);
  });

  it('theme.preset: an unknown preset is invalid, names all 19 presets and calls nothing', async () => {
    const { err, calls } = await failure({ preset: 'Nope' });
    expect(err?.code).toBe('invalid');
    for (const name of ['Default', 'Edge', 'Constellation', 'Groovy', 'Insight', 'Ocean', 'Harvest', 'Eucalyptus', 'Pop!', 'Fog', 'Lagoon', 'Executive', 'Woodsy', 'Royalty', 'Sienna', 'Material', 'Muted', 'Simple', 'Simple Dark'])
      expect(err?.message).toContain(name);
    expect(calls).toHaveLength(0);
  });

  it('theme.preset: with none of preset, settings, canvas or layout it is invalid', async () => {
    const { err, calls } = await failure({});
    expect(err?.code).toBe('invalid');
    expect(err?.message).toMatch(/preset, settings, layout or canvas/);
    const empty = await failure({ settings: {}, layout: {} });
    expect(empty.err?.code).toBe('invalid');
    expect(calls).toHaveLength(0);
  });

  it('theme.settings: labels set theme keys, and settings win over a preset given with them', async () => {
    const settings = { 'Report background color': '#0B1020', 'Primary font family': 'Roboto', 'Chart title color': '#FFFFFF' };
    const { sent } = await run({ settings });
    const t = sentTheme(sent.reportRequest);
    expect(entryOf(t.raw, 'themeFillColor').mapValue.entry).toEqual(
      expect.arrayContaining([
        { key: 'color', value: { strValue: '#0B1020' } },
        { key: 'opacity', value: { int64Value: '1' } },
      ]),
    );
    expect(entryOf(t.raw, 'themeFontFamily')).toEqual({ strValue: 'Roboto' });
    expect(t.plain.themeTitleFontColor).toMatchObject({ color: '#FFFFFF', opacity: 1 });
    // Keys the call does not name stay.
    expect(t.plain.version).toBe(1);

    const both = await run({ preset: 'Constellation', settings });
    const tb = sentTheme(both.sent.reportRequest);
    expect(tb.plain.themeFillColor.color).toBe('#0B1020');
    expect(tb.plain.themeFontFamily).toBe('Roboto');
    expect(tb.plain.themeAccentFontFamily).toBe('Droid Sans');
  });

  it('theme.settings: unknown labels fail together by name and nothing is saved', async () => {
    const { err, calls } = await failure({ settings: { 'Report background color': '#0B1020', Nope: 1, Nada: 'x' } });
    expect(err?.code).toBe('invalid');
    expect(err?.message).toContain('"Nope"');
    expect(err?.message).toContain('"Nada"');
    expect(calls.filter((c) => c.endpoint === 'updateReport')).toHaveLength(0);
  });

  it('theme.canvas: sets reportAttribute width and height and keeps the other keys; bad sizes are invalid', async () => {
    const { sent } = await run({ canvas: { width: 1600, height: 2000 } });
    const attr = sent.reportRequest.attributeConfig.reportAttribute;
    expect(attr).toEqual({ ...(report().report.attributeConfig!.reportAttribute as object), width: 1600, height: 2000 });
    // The theme is not touched by a canvas-only call.
    expect(sent.reportRequest.resource).toEqual(report().report.resource);

    for (const canvas of [{ width: 100, height: 900 }, { height: 2000 }]) {
      const { err, calls } = await failure({ canvas });
      expect(err?.code).toBe('invalid');
      expect(calls).toHaveLength(0);
    }
  });

  it('theme.layout: labels set reportAttribute keys; Navigation type Tab sets viewModeNav 2 (and the navigation style)', async () => {
    const { sent } = await run({ layout: { 'Header visibility': 'Auto hide', 'Display mode': 'Fit to width', 'Has margin': false, 'Size (px)': 20 } });
    expect(sent.reportRequest.attributeConfig.reportAttribute).toMatchObject({ viewModeHeader: 1, viewModeScale: 1, viewModeMargin: false, gridSize: 20, width: 1200, height: 900 });

    const tab = await run({ layout: { 'Navigation type': 'Tab' } });
    expect(tab.sent.reportRequest.attributeConfig.reportAttribute.viewModeNav).toBe(2);
    const nav = tab.calls.find((c) => c.endpoint === 'updateReportNavigationInfo');
    expect(nav?.body.navigationInfo.style).toBe(2);
    expect(nav?.body.navigationInfo.navItems).toEqual(report().navigationInfo!.navItems);
  });

  it('theme.layout: a wrong option lists the options, an unknown label is named; neither saves', async () => {
    const bad = await failure({ layout: { 'Header visibility': 'Sometimes' } });
    expect(bad.err?.code).toBe('invalid');
    expect(bad.err?.message).toContain('Always show, Auto hide, Initially hidden');
    expect(bad.calls.filter((c) => c.endpoint === 'updateReport')).toHaveLength(0);

    const unknown = await failure({ layout: { Nope: 1 } });
    expect(unknown.err?.code).toBe('invalid');
    expect(unknown.err?.message).toContain('"Nope"');
    expect(unknown.calls.filter((c) => c.endpoint === 'updateReport')).toHaveLength(0);
  });

  it('theme.preset: a report on a built-in theme gets a new custom theme that themeConfig points at', async () => {
    const doc = report();
    (doc.report.propertyConfig as any).reportProperty.themeConfig = 't-default';
    (doc.report.resource as any).theme = { value: [] };
    const { sent } = await run({ settings: { 'Report background color': '#123456' } }, doc);
    const t = sentTheme(sent.reportRequest);
    expect(t.id).toMatch(/^theme[a-z0-9]{10}$/);
    expect(t.plain.themeFillColor.color).toBe('#123456');
    // The rest comes from the built-in theme it was on.
    expect(t.plain.sourceTheme).toBe('t-default');
  });
});

it('exports public theme inputs that preserve custom colors and report layout on replay', () => {
  const original = report();
  const exported = readTheme(original);
  expect(exported.settings?.['Report background color']).toBe('#F3F3F3');
  expect(exported.canvas).toEqual({ width: 1200, height: 900 });
  const next = report();
  applyTheme(next, planTheme(exported));
  expect(readTheme(next)).toEqual(exported);
});

describe('series colors and brand color', () => {
  it('writes the chart series palette in order', () => {
    const plan = planTheme({ settings: { 'Series colors': ['#1f3a5f', '#F28C28'] } });
    expect(plan.theme).toEqual([{ label: 'Series colors', key: 'themeSeriesColor', value: ['#1F3A5F', '#F28C28'] }]);
    expect(() => planTheme({ settings: { 'Series colors': ['blue'] } })).toThrow(/#RRGGBB/);
  });
  it('expands one brand color into the accent pair and a palette, and lets explicit entries win', () => {
    const plan = planTheme({ settings: { 'Brand color': '#7a1f3d' } });
    const byLabel = Object.fromEntries(plan.theme.map(w => [w.label, w.value]));
    expect(byLabel['Accent background color']).toMatchObject({ color: '#7A1F3D' });
    expect(byLabel['Accent font color']).toMatchObject({ color: '#FFFFFF' });
    const series = byLabel['Series colors'] as string[];
    expect(series).toHaveLength(5); expect(series[0]).toBe('#7A1F3D'); expect(series[2]).toBe('#7A8794');
    expect(new Set(series).size).toBe(5);
    const explicit = planTheme({ settings: { 'Brand color': '#FFD54F', 'Series colors': ['#111111'] } });
    const explicitByLabel = Object.fromEntries(explicit.theme.map(w => [w.label, w.value]));
    expect(explicitByLabel['Series colors']).toEqual(['#111111']);
    expect(explicitByLabel['Accent font color']).toMatchObject({ color: '#000000' });
    expect(() => planTheme({ settings: { 'Brand color': 'red' } })).toThrow(/#RRGGBB/);
  });
});
