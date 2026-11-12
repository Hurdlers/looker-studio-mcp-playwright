import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Audit } from '../core/audit.js';
import type { BigQueryClient, GoogleAccount } from '../core/bigquery.js';
import { createContext } from '../core/context.js';
import { Extensions, type FeatureExtensions } from '../core/extensions.js';
import type { ReportSession } from '../core/session.js';
import { errorMessage, inputOf, invoke, text, type Tool, type ToolContext, type ToolResult } from '../core/tool.js';
import type { Config } from '../config.js';
import { FEATURE_EXTENSIONS, FEATURE_TOOLS } from '../features/registry.generated.js';
import type { BrowserHost } from '../browser/host.js';
import type { WorkerTab } from '../browser/worker.js';
import type { Rap } from '../looker/rap.js';

export interface ServerDeps {
  browser: Pick<BrowserHost, 'status'>;
  worker: WorkerTab;
  rap: Rap;
  // For the feature tools (src/features).
  session: ReportSession;
  audit: Audit;
  home: string;
  // writes_enabled, dry_run, BigQuery settings: one source for all of them.
  config: Config;
  // The rest of the feature tools' context; stand-ins when left out (tests).
  google?: GoogleAccount;
  bigquery?: BigQueryClient;
}

export function buildServer(
  deps: ServerDeps,
  version: string,
  tools: Tool[] = FEATURE_TOOLS,
  extensions: Array<{ group: string; extensions: FeatureExtensions }> = FEATURE_EXTENSIONS,
): McpServer {
  const server = new McpServer({ name: 'looker-studio-mcp-playwright', version });
  // One worker tab: calls run one at a time, or a navigation could cut an API call.
  const serial = createSerial();
  const handle =
    <A>(fn: (args: A) => Promise<ToolResult>) =>
    (args: A): Promise<ToolResult> =>
      serial(() => fn(args).catch((err: unknown) => ({ ...text(`Error: ${errorMessage(err)}`), isError: true })));

  const registered = tools.filter((t) => !t.write || deps.config.writesEnabled);
  // Fails at startup when two groups claim the same chart kind or updater.
  const ext = new Extensions(extensions);
  const ctx: ToolContext = createContext({
    rap: deps.rap,
    worker: deps.worker,
    session: deps.session,
    audit: deps.audit,
    home: deps.home,
    config: deps.config,
    browser: deps.browser,
    ...(deps.google ? { google: deps.google } : {}),
    ...(deps.bigquery ? { bigquery: deps.bigquery } : {}),
    ext,
    tools: registered,
  });
  for (const tool of registered) {
    server.registerTool(
      tool.name,
      // Inputs that depend on the extensions are worked out once, here.
      { title: tool.title, description: tool.description, inputSchema: inputOf(tool, ext), annotations: { readOnlyHint: tool.write ? false : tool.readOnlyHint ?? true } },
      // Audit line and dry run for write tools (invoke).
      handle((args: Record<string, unknown>) => invoke(tool, ctx, args)),
    );
  }

  return server;
}

function createSerial(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
