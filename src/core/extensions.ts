import { z, type ZodRawShape } from 'zod';

import type { BuildContext } from './components.js';
import type { PageDoc, ReportDoc } from './session.js';
import { labelsFor, type StyleLabel, type StyleTable } from './style.js';
import type { ToolContext } from './tool.js';

// How groups share a tool that one group owns. Besides `tools`, a group's
// src/features/<group>/index.ts may export
//   export const extensions: FeatureExtensions = { chartKinds: [...], updaters: [...], styles: [...] };
// scripts/gen-registry.mjs collects them, and the owning tool reaches them
// through ctx.ext (never by importing another group):
//   chart_add (chart-core)         ctx.ext.chartKind(key)      kinds from chart-types-a/b, community
//   component_update (layout)      ctx.ext.updater(key)        updaters from chart-options, static, controls, layout
//   control_add (controls)         ctx.ext.updater('filters'), ctx.ext.updater('date_range')   from chart-options
//   component_inspect, spec export ctx.ext.kindOf(c), updater.read, ctx.ext.styleLabels(type, preset)
// A key has one owner: two groups giving the same chart kind (case, spaces,
// _ and - ignored), updater key or style table fail at startup, naming both.
// Common labels (style table type "*") may come from several groups, each
// label from one.
// The owning tool's MCP input shows what was added: its input is a function
// of the extensions (tool.ts), e.g.
//   input: (ext) => ({ type: ext.chartKindInput('Chart type'), … })
//   input: (ext) => ({ report_id: …, component_id: …, ...ext.updaterInput() })

type Json = Record<string, any>;

// One choice of chart_add's `type` input ("bar", "stacked_column", "funnel").
export interface ChartKind {
  key: string;
  // The component it makes, e.g. type "simple-barchart" with preset "horizontal".
  type: string;
  preset?: string;
  // Name in the editor's chart menu, for lists and errors.
  title?: string;
  // Some kinds require registration or consent handled by a dedicated tool.
  creationTool?: string;
  validate?(spec: Json): void;
  slots?: Array<{
    title: string;
    aliases?: string[];
    kind: 'dimensions' | 'metrics';
    key: string;
    max?: number;
    aggregation?: number;
    pivotColumns?: true;
    breakdown?: true;
  }>;
  // Makes the component from chart_add's parsed input (chart-core documents
  // its fields): template, fields in their slots, kind-specific settings.
  // Position, filters, date range and style are applied by chart_add after.
  build(spec: Json, ctx: BuildContext): Json;
  // Whether a component is of this kind, when type and preset alone cannot
  // tell (several kinds share a preset). Defaults to comparing both.
  matches?(component: Json): boolean;
}

// Where an updater works: a copy of the report being edited. Changing
// target.doc.report (filters live in report.resource.filter) needs the report
// saved too: an updater that does so sets `touchesReport`, and the owner
// saves the report before the page.
export interface UpdateTarget {
  component: Json;
  page: PageDoc;
  doc: ReportDoc;
}

// One input key of component_update (and of add tools that take the same
// option): "filters", "date_range", "style", "url", "position"…
export interface ComponentUpdater {
  key: string;
  // Schema of the input value, merged into the owning tool's input (as an
  // optional key; see updaterInput). Describe it: the description is what the
  // MCP client reads.
  input: z.ZodType;
  // Component types it applies to; all when omitted. Another type is invalid.
  types?: string[];
  touchesReport?: boolean;
  // Changes target.component (and target.doc when touchesReport). Throws
  // LookerError('invalid') before changing anything when the value cannot apply.
  // May return a note for the tool's answer ("Not applied: …").
  apply(target: UpdateTarget, value: unknown, ctx: ToolContext): void | string | Promise<void | string>;
  // The reverse, for inspect and spec export: the input value that would make
  // the component as it is, or undefined when it has none.
  read?(component: Json, doc: ReportDoc): unknown;
}

export interface ReportTheme {
  preset?: string;
  settings?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  canvas?: { width: number; height: number };
}

export interface ComponentMetadata {
  name: string;
  creationTool: string;
  slots?: ChartKind['slots'];
  controls?: Array<{ label: string }>;
  style?: Record<string, unknown>;
}

type ComponentReader = (ctx: ToolContext, doc: ReportDoc, component: Json) => Promise<ComponentMetadata | undefined>;

export interface FeatureExtensions {
  reportTheme?: (doc: ReportDoc) => ReportTheme | undefined;
  componentMetadata?: ComponentReader;
  chartKinds?: ChartKind[];
  updaters?: ComponentUpdater[];
  styles?: StyleTable[];
}

export class Extensions {
  private readonly kinds = new Map<string, ChartKind>();
  private readonly updaterMap = new Map<string, ComponentUpdater>();
  private themeReader: FeatureExtensions['reportTheme'];
  private readonly componentReaders: ComponentReader[] = [];
  private readonly tables: StyleTable[] = [];

  constructor(groups: Array<{ group: string; extensions: FeatureExtensions }> = []) {
    const owner = new Map<string, { group: string; key: string }>();
    // `key` as the group wrote it, `same` what counts as the same key.
    const claim = (what: string, key: string, same: string, group: string): void => {
      const had = owner.get(`${what} ${same}`);
      if (had && had.group !== group)
        throw new Error(
          `${what} "${key}"${had.key !== key ? ` (same as "${had.key}")` : ''} is given by both ${had.group} and ${group}: one group must own it.`,
        );
      if (had) throw new Error(`${what} "${key}" is given twice by ${group}.`);
      owner.set(`${what} ${same}`, { group, key });
    };
    for (const { group, extensions: e } of groups) {
      if (e.reportTheme) {
        claim('report reader', 'theme', 'theme', group);
        this.themeReader = e.reportTheme;
      }
      if (e.componentMetadata) this.componentReaders.push(e.componentMetadata);
      for (const k of e.chartKinds ?? []) {
        claim('chart kind', k.key, norm(k.key), group);
        this.kinds.set(k.key, k);
      }
      for (const u of e.updaters ?? []) {
        claim('updater', u.key, u.key, group);
        this.updaterMap.set(u.key, u);
      }
      for (const t of e.styles ?? []) {
        if (t.type === '*') {
          // Repeats of a label within one group's table are "Label#2"; across
          // groups a label has one owner.
          for (const label of new Set(t.labels.map((l) => l.label.trim().toLowerCase())))
            claim('common style label', label, label, group);
        } else {
          const key = `${t.type}${t.preset ? `.${t.preset}` : ''}`;
          claim('style table', key, key, group);
        }
        this.tables.push(t);
      }
    }
  }

  reportTheme(doc: ReportDoc): ReportTheme | undefined {
    return this.themeReader?.(doc);
  }

  async componentMetadata(ctx: ToolContext, doc: ReportDoc, component: Json): Promise<ComponentMetadata | undefined> {
    let found: ComponentMetadata | undefined;
    for (const read of this.componentReaders) {
      const result = await read(ctx, doc, component);
      if (!result) continue;
      if (found) throw new Error(`Multiple readers describe component type ${component.type}.`);
      found = result;
    }
    return found;
  }

  chartKinds(): ChartKind[] {
    return [...this.kinds.values()];
  }

  // Ignores case, spaces, _ and -: "Stacked column" finds stacked_column.
  chartKind(key: string): ChartKind | undefined {
    const want = norm(key);
    return this.kinds.get(key) ?? this.chartKinds().find((k) => norm(k.key) === want);
  }

  // chart_add's `type` input: one of the kinds' keys (any text while none is
  // registered).
  chartKindInput(description: string): z.ZodType<string> {
    const keys = this.chartKinds().filter((k) => !k.creationTool || k.creationTool === 'chart_add').map((k) => k.key);
    return (keys.length ? z.enum(keys as [string, ...string[]]) : this.kinds.size ? z.never() : z.string()).describe(description);
  }

  // The kind a component was made as, for listing and export.
  kindOf(component: Json): ChartKind | undefined {
    const kinds = this.chartKinds();
    return (
      kinds.find((k) => k.matches?.(component)) ??
      kinds.find((k) => !k.matches && k.type === component.type && (k.preset ?? 'default') === (component.preset ?? 'default')) ??
      kinds.find((k) => !k.matches && k.type === component.type && !k.preset)
    );
  }

  updaters(): ComponentUpdater[] {
    return [...this.updaterMap.values()];
  }

  updater(key: string): ComponentUpdater | undefined {
    return this.updaterMap.get(key);
  }

  // Each updater's input as an optional key, for the owning tool's input:
  // every updater, or only `keys`. The owner calls each given key's apply.
  updaterInput(keys?: string[]): Record<string, z.ZodOptional<z.ZodType>> {
    return Object.fromEntries(this.updaters().flatMap((u) => (!keys || keys.includes(u.key) ? [[u.key, u.input.optional()]] : [])));
  }

  // The updaters an owning tool's parsed input asks for, in registration
  // order, with their values (keys left out or undefined are skipped):
  //   for (const [u, value] of ctx.ext.updaterValues(args)) notes.push(await u.apply(target, value, ctx));
  updaterValues(args: object): Array<[ComponentUpdater, unknown]> {
    const a = args as Record<string, unknown>;
    return this.updaters().flatMap((u) => (a[u.key] !== undefined ? [[u, a[u.key]] as [ComponentUpdater, unknown]] : []));
  }

  styleTables(): StyleTable[] {
    return this.tables;
  }

  styleLabels(type: string, preset?: string): StyleLabel[] {
    return labelsFor(this.tables, type, preset);
  }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}
