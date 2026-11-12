import { z } from 'zod';

import { dryRunContext } from '../../core/dryrun.js';
import { LookerError } from '../../core/errors.js';
import { listPages } from '../../core/page.js';
import { errorMessage, inputOf, resultText, runTool, type ToolContext } from '../../core/tool.js';
import { restoreGroups, validateRestoreAction } from './restore-groups.js';
import { checkDeferred, invalid, reportIdOf, type Action, type Json } from './model.js';

export const BATCH_TOOLS = [
  'chart_add', 'text_add', 'shape_add', 'control_add', 'image_add', 'line_add', 'embed_add', 'community_viz_add',
  'component_update', 'component_duplicate', 'component_arrange', 'component_delete', 'theme_update',
  'calculated_field_add', 'parameter_add', 'group_field_add', 'bin_field_add', 'blend_create', 'report_filter_edit',
  'datasource_add', 'datasource_refresh', 'datasource_update', 'datasource_remove', 'field_update',
  'page_add', 'page_rename', 'page_edit', 'page_settings_update', 'report_rename',
  'component_list', 'component_inspect', 'page_list', 'datasource_list',
] as const;
export const actionInput = z.object({ tool: z.string().min(1).describe('실행할 도구 이름.'), args: z.record(z.string(), z.unknown()).default({}).describe('그 도구의 인자. report_id는 묶음의 리포트로 자동 채웁니다.') });
export interface ActionResult { tool: string; status: 'ok' | 'error' | 'skipped'; ms: number; text: string }
class Boundary extends Error {}
const quiet = (ctx: ToolContext): ToolContext => ({ ...ctx, audit: { write: async () => undefined } });

function argumentsFor(action: Action, reportId: string): Json {
  const args = { ...(action.args ?? {}) };
  checkDeferred(args, action.path ?? action.tool);
  if (args.report_id !== undefined && (typeof args.report_id !== 'string' || reportIdOf(args.report_id) !== reportId))
    throw invalid('This batch changes only its own report; remove report_id from the action.');
  return { ...args, report_id: reportId };
}

function staticContext(ctx: ToolContext): { ctx: ToolContext; reached: () => boolean } {
  let reached = false;
  const stop = async (): Promise<never> => { reached = true; throw new Boundary(); };
  return { reached: () => reached, ctx: { ...quiet(ctx), dryRun: true,
    rap: { call: stop, callMany: stop },
    session: new Proxy(ctx.session, { get: () => stop }),
    worker: new Proxy(ctx.worker, { get: () => stop }),
  } };
}

export async function validateActions(ctx: ToolContext, reportId: string, actions: Action[], existing = true): Promise<void> {
  const problems: string[] = [];
  const valid: Array<{ action: Action; args: Json; index: number }> = [];
  for (const [index, action] of actions.entries()) {
    const at = `${index + 1}. ${action.tool}${action.path ? ` (${action.path})` : ''}`;
    try {
      if (action.groupsRestore) {
        validateRestoreAction(action);
        valid.push({ action, args: argumentsFor(action, reportId), index });
        continue;
      }
      if (!(BATCH_TOOLS as readonly string[]).includes(action.tool)) throw invalid(`Allowed tools: ${BATCH_TOOLS.join(', ')}.`);
      const tool = ctx.tools.get(action.tool);
      if (!tool) throw invalid(`The tool ${action.tool} is not installed or enabled.`);
      const args = argumentsFor(action, reportId);
      const parsed = z.strictObject(inputOf(tool, ctx.ext)).safeParse(args);
      if (!parsed.success) throw invalid(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '));
      const first = staticContext(ctx);
      try {
        const result = await runTool(first.ctx, action.tool, args);
        if (result.isError) throw invalid(resultText(result));
      } catch (error) { if (!(error instanceof Boundary) && !first.reached()) throw error; }
      valid.push({ action, args, index });
    } catch (error) { problems.push(`${at}: ${errorMessage(error)}`); }
  }
  if (existing) {
    const preview = dryRunContext(quiet(ctx));
    // One preview context caches reads and carries earlier simulated writes.
    const bindings = new Map<number, string>();
    const components = new Map<number, string>();
    for (const { action, args, index } of valid) {
      try { await executeOne(preview.ctx, reportId, { ...action, args }, bindings, components); }
      catch (error) {
        // An absent component may be a deliberate runtime failure (or a
        // concurrent edit). Keep continuation semantics for id-based edits.
        if (error instanceof LookerError && error.code === 'not_found' && action.tool.startsWith('component_')) continue;
        problems.push(`${index + 1}. ${action.tool}${action.path ? ` (${action.path})` : ''}: ${errorMessage(error)}`);
      }
    }
  }
  if (problems.length) throw invalid(`The actions were not started:\n${problems.join('\n')}`);
}

async function executeOne(ctx: ToolContext, reportId: string, action: Action, pages: Map<number, string>, components: Map<number, string>) {
  const args = argumentsFor(action, reportId);
  if (action.pageRef !== undefined) {
    const pageId = pages.get(action.pageRef);
    if (!pageId) throw invalid(`The page for this action was not created (page ${action.pageRef + 1}).`);
    args.page = pageId;
  }
  if (action.groupsRestore) {
    validateRestoreAction(action);
    return restoreGroups(ctx, reportId, args.page, action.groupsRestore, components);
  }
  if (action.componentRef !== undefined) {
    const component = components.get(action.componentRef);
    if (!component) throw invalid('The component to move to report level was not created.');
    args.component_id = component;
  }
  const capture = action.producesPage !== undefined || action.producesComponent !== undefined;
  const before = capture ? await ctx.session.load(reportId) : undefined;
  const result = await runTool(quiet(ctx), action.tool, args);
  if (result.isError) throw invalid(resultText(result));
  if (capture) {
    const after = await ctx.session.load(reportId);
    if (action.producesPage !== undefined) {
      const old = new Set(listPages(before!).map((page) => page.pageId));
      const added = listPages(after).find((page) => !old.has(page.pageId));
      if (!added) throw invalid('page_add returned without a new page. Read page_list before retrying.');
      pages.set(action.producesPage, added.pageId);
    }
    if (action.producesComponent !== undefined) {
      const old = new Set(before!.page.flatMap((page) => page.page.componentConfig ?? []).map((component) => component.componentId));
      const added = after.page.flatMap((page) => page.page.componentConfig ?? []).find((component) => !old.has(component.componentId));
      if (!added) throw invalid('The add tool did not leave a new component on its page. Inspect the report before retrying.');
      components.set(action.producesComponent, String(added.componentId));
    }
  }
  return resultText(result);
}

export async function runActions(ctx: ToolContext, reportId: string, actions: Action[], continueOnError: boolean): Promise<{ results: ActionResult[]; isError: boolean; text: string }> {
  const started = Date.now();
  const results: ActionResult[] = [];
  const pages = new Map<number, string>();
  const components = new Map<number, string>();
  for (const action of actions) {
    if (results.some((result) => result.status === 'error') && !continueOnError) { results.push({ tool: action.tool, status: 'skipped', ms: 0, text: 'after an error' }); continue; }
    const start = Date.now();
    try { results.push({ tool: action.tool, status: 'ok', ms: Date.now() - start, text: await executeOne(ctx, reportId, action, pages, components) }); results.at(-1)!.ms = Date.now() - start; }
    catch (error) { results.push({ tool: action.tool, status: 'error', ms: Date.now() - start, text: errorMessage(error) }); }
  }
  const ok = results.filter((result) => result.status === 'ok').length;
  return { results, isError: results.some((result) => result.status === 'error'), text: [
    `${ok} of ${results.length} actions done (${((Date.now() - started) / 1000).toFixed(2)} s total)`,
    ...results.map((result, index) => result.status === 'skipped' ? `${index + 1}. ${result.tool}: skipped (after an error)` : `${index + 1}. ${result.tool}: ${result.status} (${(result.ms / 1000).toFixed(2)} s)\n${result.text}`),
  ].join('\n') };
}
