import { z, type ZodRawShape } from 'zod';

import type { BrowserHost } from '../browser/host.js';
import type { WorkerTab } from '../browser/worker.js';
import type { Config } from '../config.js';
import type { Rap } from '../looker/rap.js';
import type { Audit, AuditEntry } from './audit.js';
import type { BigQueryClient, GoogleAccount } from './bigquery.js';
import { dryRunContext } from './dryrun.js';
import { explain, LookerError } from './errors.js';
import type { Extensions } from './extensions.js';
import type { ReportSession } from './session.js';

// How a feature adds tools: src/features/<group>/index.ts exports
//   export const tools = [defineTool({ ... }), …];
// (and optionally `extensions`, see extensions.ts), and
// scripts/gen-registry.mjs lists every group in registry.generated.ts.

export type Content =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

// A type, not an interface: the MCP SDK wants an index signature.
export type ToolResult = {
  content: Content[];
  isError?: boolean;
  // For the audit line of a write tool (the server writes it, then drops
  // this before answering): the version saved and the revision to undo to.
  audit?: Pick<AuditEntry, 'reportId' | 'version' | 'snapshot' | 'detail'>;
};

export interface ToolContext {
  rap: Rap;
  worker: WorkerTab;
  session: ReportSession;
  audit: Audit;
  // Folder for files the tools write (renders, exports).
  home: string;
  config: Config;
  // The server's dedicated browser, for connection_check.
  browser: Pick<BrowserHost, 'status'>;
  // The user's Application Default Credentials and BigQuery through them.
  google: GoogleAccount;
  bigquery: BigQueryClient;
  // What other groups add to the tools a group owns.
  ext: Extensions;
  // Every registered tool by name, for tools that run others (batch, spec).
  // Run them with runTool (never tool.run: that skips the audit and dry run).
  tools: ReadonlyMap<string, Tool>;
  // True in a dry-run context (dryrun.ts): writes are recorded, not sent.
  dryRun: boolean;
}

export interface Tool<S extends ZodRawShape = ZodRawShape> {
  // <resource>_<verb>, e.g. chart_add.
  name: string;
  title: string;
  description: string;
  // The input schema. A tool whose input depends on what other groups add
  // (component_update takes every updater's key, chart_add lists the chart
  // kinds) gives a function of the extensions instead; the server calls it
  // once at startup:
  //   input: (ext) => ({ report_id: …, component_id: …, ...ext.updaterInput() })
  input: S | ((ext: Extensions) => S);
  // Write tools are registered only when writes are enabled in the config.
  write: boolean;
  // Report reads may still write files or change browser state. Describe
  // those effects conservatively to MCP clients independently of write access.
  readOnlyHint?: boolean;
  run(ctx: ToolContext, args: z.infer<z.ZodObject<S>>): Promise<ToolResult>;
}

export function defineTool<S extends ZodRawShape>(tool: Tool<S>): Tool<S> {
  return tool;
}

// The tool's input schema with the extensions given.
export function inputOf(tool: Tool, ext: Extensions): ZodRawShape {
  return typeof tool.input === 'function' ? tool.input(ext) : tool.input;
}

export function text(body: string): ToolResult {
  return { content: [{ type: 'text', text: body }] };
}

// Runs another tool by name with its input checked and defaults filled in,
// exactly as the server runs it (invoke: audit line, dry run). Unknown tools
// (or write tools while writes are off) are invalid.
export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = ctx.tools.get(name);
  if (!tool) throw new LookerError('invalid', `No tool "${name}"${ctx.config.writesEnabled ? '' : ' (write tools are off: writes_enabled is false)'}.`);
  const parsed = z.object(inputOf(tool, ctx.ext)).safeParse(args);
  if (!parsed.success)
    throw new LookerError(
      'invalid',
      `${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
    );
  return invoke(tool, ctx, parsed.data);
}

// Runs a tool on parsed input. Every write tool call leaves one audit line,
// whether it worked or not, unless it runs in a dry-run context (nothing is
// saved there). With dry_run on in the config, a write tool runs in a dry-run
// context and its answer ends with what would have been sent.
export async function invoke(tool: Tool, ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!tool.write || ctx.dryRun) {
    const { audit: _audit, ...res } = await tool.run(ctx, args as never);
    return res;
  }
  const base = { tool: tool.name, ...(typeof args.report_id === 'string' ? { reportId: args.report_id } : {}) };
  const dry = ctx.config.dryRun ? dryRunContext(ctx) : undefined;
  try {
    const { audit, ...res } = await tool.run(dry?.ctx ?? ctx, args as never);
    if (dry) {
      const sent = dry.writes.map((w) => w.endpoint);
      await ctx.audit.write({ ...base, result: 'ok', detail: `dry run: ${sent.length ? sent.join(', ') : 'nothing'} not sent` });
      const note = `Dry run (dry_run is on): nothing was saved.${sent.length ? ` Would have sent: ${sent.join(', ')}.` : ''}`;
      return { ...res, content: [...res.content, { type: 'text', text: note }] };
    }
    await ctx.audit.write({ ...base, ...audit, result: res.isError ? 'error' : 'ok' });
    return res;
  } catch (err) {
    await ctx.audit.write({ ...base, result: 'error', detail: `${dry ? 'dry run: ' : ''}${errorMessage(err)}` });
    throw err;
  }
}

// An error as the tool's answer says it: "message [code]" for known ones.
export function errorMessage(err: unknown): string {
  const known = explain(err);
  if (known) return `${known.message} [${known.code}]`;
  return err instanceof Error ? err.message : String(err);
}

// The text of a result, for tools that pass another tool's answer along.
export function resultText(res: ToolResult): string {
  return res.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
}
