import { z } from 'zod';

import type { Position } from '../../core/components.js';
import { LookerError } from '../../core/errors.js';
import { pageArg, pageComponents, pageSize, boxOf, listPages, resolvePage } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import type { ToolContext, ToolResult } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';

type Json = Record<string, any>;

export const reportIdInput = z.string().describe('Report id or its Looker Studio URL.');

export const pageInput = pageArg.optional().describe('Page id, the name shown in the page list, or its number counted from 1. The first page when omitted.');

export function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}

const coord = (what: string) => z.number().int().min(0).max(20000).optional().describe(what);
const extent = (what: string) => z.number().int().min(10).max(20000).optional().describe(what);

export function positionInput(defaults: string) {
  return z
    .object({
      left: coord('Distance from the left edge of the canvas, in report pixels (0–20000).'),
      top: coord('Distance from the top edge of the canvas, in report pixels (0–20000).'),
      width: extent('Width in report pixels (10–20000).'),
      height: extent('Height in report pixels (10–20000).'),
    })
    .optional()
    .describe(`Where the component goes and how big it is, in report pixels. Missing values get defaults: ${defaults}`);
}

export type PositionInput = { [K in keyof Position]?: number | undefined } | undefined;

const styleValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.number().positive()).min(1),
  z.object({ color: z.string(), opacity: z.number().min(0).max(1).optional() }),
]);

export const STYLE_RULES =
  'Keys are the labels shown in the editor\'s panel ("Border color", "Opacity"); "Label#2" picks the second field of that label. ' +
  'Values: true/false for switches; "#RRGGBB" for colors (or {color, opacity}); the option text for drop-downs (case ignored); numbers for number fields; positive number arrays for column widths; ' +
  'percentages as "80%" (a bare number above 1 is a percentage too, 0–1 is already divided, and text without % is refused). ' +
  'A label the panel does not have is skipped and listed under "Not applied"; a bad value fails the call before anything is saved.';

// Label → value, without optional(): component_update's updater input.
export const styleRecord = z.record(z.string(), styleValue);

export function styleInput(what: string) {
  return styleRecord.optional().describe(`${what} ${STYLE_RULES}`);
}

export const hexInput = (what: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'a color like "#1A73E8" (# and six hex digits)')
    .optional()
    .describe(`${what} as "#RRGGBB".`);

// Where a new component goes when no place is given: 40 px from the left,
// 20 px below the lowest component on the page (20 on an empty page), and no
// lower than 120 px above the canvas bottom.
export function nextSpot(doc: ReportDoc, pageId: string): { left: number; top: number } {
  const bottoms = pageComponents(doc, pageId)
    .map(boxOf)
    .map((b) => b.top + b.height);
  const top = bottoms.length ? Math.max(...bottoms) + 20 : 20;
  const { height } = pageSize(doc, pageId);
  return { left: 40, top: Math.max(0, Math.min(top, height - 120)) };
}

// The box: what was given, the default size, and the free spot (or `place`
// when the tool has its own default spot) for what is missing.
export function boxFor(given: PositionInput, size: { width: number; height: number }, spot: () => { left: number; top: number }): Position {
  const g = given ?? {};
  const needSpot = g.left === undefined || g.top === undefined;
  const s = needSpot ? spot() : { left: 0, top: 0 };
  return { left: g.left ?? s.left, top: g.top ?? s.top, width: g.width ?? size.width, height: g.height ?? size.height };
}

export function pageNameOf(doc: ReportDoc, pageId: string): string {
  return listPages(doc).find((p) => p.pageId === pageId)?.name ?? pageId;
}

// What an add tool made, before saving.
export interface Made {
  component: Json;
  // Kind for the answer: "text", "shape (star)", "line"…
  kind: string;
  notApplied: string[];
  warnings: string[];
}

export interface AddArgs {
  report_id: string;
  page?: string | number | undefined;
}

// Adds one component to a page in one save: reads the report, finds the page,
// lets `make` build the component (and do any upload), then appends it to the
// page's components (on top of the others). Nothing is saved when `make`
// fails. A save that is applied again (someone saved meanwhile) adds the
// same component once.
export async function addComponent(
  ctx: ToolContext,
  a: AddArgs,
  make: (doc: ReportDoc, pageId: string, reportId: string) => Made | Promise<Made>,
  label: string,
): Promise<ToolResult> {
  const reportId = reportIdOf(a.report_id);
  const doc = await ctx.session.load(reportId);
  const pageId = resolvePage(doc, a.page ?? undefined);
  const made = await make(doc, pageId, reportId);
  const component = made.component;
  const box = boxOf(component);
  const { width: pw, height: ph } = pageSize(doc, pageId);
  const warnings = [...made.warnings];
  if (box.left + box.width > pw || box.top + box.height > ph)
    warnings.push(`It reaches beyond the ${pw}×${ph} page (right edge ${box.left + box.width}, bottom ${box.top + box.height}): it may be cut off.`);
  const res = await ctx.session.editPage(
    reportId,
    pageId,
    (page) => {
      const list = (page.page.componentConfig ?? []).filter((c) => c.componentId !== component.componentId);
      page.page.componentConfig = [...list, structuredClone(component)];
    },
    label,
  );
  const where = `page "${pageNameOf(doc, pageId)}" (${pageId})`;
  const lines = [
    `${ctx.dryRun ? 'Would add' : 'Added'} ${made.kind} ${component.componentId} to ${where} at left ${box.left}, top ${box.top}, ${box.width}×${box.height}${
      ctx.dryRun ? '' : ` (report version ${res.version})`
    }.`,
    `component_id: ${component.componentId}`,
    `position: ${JSON.stringify(box)}`,
    ...(made.notApplied.length ? [`Not applied: ${made.notApplied.join(', ')}`] : []),
    ...warnings.map((w) => `Warning: ${w}`),
  ];
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `${label} ${component.componentId}` },
  };
}
