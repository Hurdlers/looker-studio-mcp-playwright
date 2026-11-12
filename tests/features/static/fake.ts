import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { Extensions } from '../../../src/core/extensions.js';
import { ReportSession, type ReportDoc } from '../../../src/core/session.js';
import { runTool, type ToolContext, type ToolResult, resultText } from '../../../src/core/tool.js';
import { extensions, tools } from '../../../src/features/static/index.js';
import type { Rap, RapOutcome, RapRequest } from '../../../src/looker/rap.js';

type Json = Record<string, any>;

export const REPORT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// A report with two pages ("Overview" p1 and "Second" p2) on a 1200×900 canvas.
export function report(p1: Json[] = [], p2: Json[] = []): ReportDoc {
  return {
    shareable: { id: REPORT, name: 'Lab' },
    version: '5',
    report: { attributeConfig: { reportAttribute: { width: 1200, height: 900 } } },
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }, { page: { pageId: 'p2', displayName: 'Second' } }] },
    page: [
      { pageId: 'p1', version: '9', page: { componentConfig: structuredClone(p1) } },
      { pageId: 'p2', version: '9', page: { componentConfig: structuredClone(p2) } },
    ],
  };
}

export interface Call {
  endpoint: string;
  body: Json;
}

// A Rap that answers getReport with `doc`, saves with version 11, and other
// endpoints from `answers`.
export function fakeRap(doc: ReportDoc, answers: Record<string, (body: Json) => unknown> = {}): { rap: Rap; calls: Call[] } {
  const calls: Call[] = [];
  const call = async <T>(endpoint: string, body: unknown): Promise<T> => {
    calls.push({ endpoint, body: structuredClone(body) as Json });
    if (answers[endpoint]) return answers[endpoint]!(body as Json) as T;
    switch (endpoint) {
      case 'getReport':
        return { reportConfig: structuredClone(doc) } as T;
      case 'updatePage':
      case 'updateReport':
        return { version: '11' } as T;
      case 'createNamedRevision':
        return { revisionNumber: '7' } as T;
      case 'checkEmbed':
        return { canFrame: true, isWhitelisted: false } as T;
      case 'uploadImage':
        return { id: 'img-1' } as T;
      default:
        throw new Error(`unexpected ${endpoint}`);
    }
  };
  const rap: Rap = {
    call,
    callMany: async <T>(requests: RapRequest[]) =>
      Promise.all(requests.map(async (r): Promise<RapOutcome<T>> => ({ ok: true, value: await call<T>(r.endpoint, r.body) }))),
  };
  return { rap, calls };
}

export function context(rap: Rap, opts: { dryRun?: boolean } = {}): ToolContext {
  const home = mkdtempSync(join(tmpdir(), 'kds-static-'));
  return createContext({
    rap,
    tools,
    home,
    config: parseConfig({ writes_enabled: true, ...(opts.dryRun ? { dry_run: true } : {}) }, home),
    // Snapshots on, as the server runs: a dry run must not take one either.
    session: new ReportSession(rap),
    ext: new Extensions([{ group: 'static', extensions }]),
  });
}

export async function run(rap: Rap, name: string, args: Json, opts: { dryRun?: boolean } = {}): Promise<{ res: ToolResult; text: string }> {
  const res = await runTool(context(rap, opts), name, { report_id: REPORT, ...args });
  return { res, text: resultText(res) };
}

export const endpoints = (calls: Call[]) => calls.map((c) => c.endpoint);

// The components the last updatePage saved.
export function savedComponents(calls: Call[]): Json[] {
  const save = calls.filter((c) => c.endpoint === 'updatePage').at(-1);
  if (!save) throw new Error('no updatePage');
  return save.body.pageRequest.componentConfig as Json[];
}

export function added(calls: Call[]): Json {
  return savedComponents(calls).at(-1)!;
}

export const prop = (c: Json): Json => c.propertyConfig.componentProperty;
export const attr = (c: Json): Json => c.attributeConfig.componentAttribute;
export const box = (c: Json) => {
  const a = attr(c);
  return { left: a.left, top: a.top, width: a.width, height: a.height };
};

export async function rejects(p: Promise<unknown>, code: string): Promise<Error & { code?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code !== code) throw new Error(`expected ${code}, got ${err.code}: ${err.message}`);
    return err;
  }
  throw new Error(`expected ${code}, but it worked`);
}
