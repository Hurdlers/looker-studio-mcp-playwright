import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Rap } from '../looker/rap.js';
import { externalPageId } from '../looker/page-id.js';
import { checkPage, type ChartCheck, type CheckOptions } from './check.js';
import { pageSize } from './page.js';
import type { ReportDoc } from './session.js';

// Looker Studio renders the page on its servers (getPdf, the editor's "Download
// as PDF"), so it works with the tab in the background. With publishing on it
// renders the published version, not the draft.

export interface RenderResult {
  pdf: string;
  // PNG of the first page, when a converter is installed.
  png?: string;
  converter?: string;
  ms: number;
}

export type Run = (cmd: string, args: string[]) => Promise<void>;

const execFileP = promisify(execFile);
const runCmd: Run = async (cmd, args) => {
  await execFileP(cmd, args, { timeout: 60_000 });
};

export async function renderPage(
  rap: Rap,
  doc: ReportDoc,
  pageId: string,
  out: { dir: string; name: string },
  run: Run = runCmd,
): Promise<RenderResult> {
  const started = Date.now();
  const { width, height } = pageSize(doc, pageId);
  const name = pageName(doc, pageId);
  const selector = externalPageId(pageId);
  // Every page setting needs its pageId and size: without them the server
  // renders the first page whatever pageIds says.
  const b64 = await rap.call<string>(
    'getPdf',
    {
      reportId: doc.shareable.id,
      pageIds: [selector],
      pageNames: [name],
      reportName: 'report',
      printBackground: true,
      addReportLink: false,
      width,
      height,
      pageSettings: [{ pageId: selector, name, width, height }],
      timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/GMT',
      pdfSettings: { expandTables: false, addPageNumbers: false, includeFilterBar: false },
      layoutType: 1,
    },
    180_000,
    'text',
  );
  await mkdir(out.dir, { recursive: true });
  const pdf = join(out.dir, `${out.name}.pdf`);
  await writeFile(pdf, Buffer.from(b64.trim().replace(/^"|"$/g, ''), 'base64'));
  const png = join(out.dir, `${out.name}.png`);
  const converter = await toPng(pdf, png, run);
  return { pdf, ...(converter ? { png, converter } : {}), ms: Date.now() - started };
}

export interface CheckedRender {
  render: RenderResult;
  checks: ChartCheck[];
}

export interface RenderCheckedOptions extends CheckOptions {
  // Pause between asking for the data and rendering (default 15 s).
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  run?: Run;
}

// Renders a page that was just saved. Rendering right after a save draws its
// charts blank: the page's data is asked for first (checkPage, whose answers
// also go back to the caller), then the server is given time before getPdf.
export async function renderChecked(
  rap: Rap,
  doc: ReportDoc,
  pageId: string,
  out: { dir: string; name: string },
  opts: RenderCheckedOptions = {},
): Promise<CheckedRender> {
  const { waitMs = 15_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), run = runCmd, ...check } = opts;
  const checks = await checkPage(rap, doc, pageId, check);
  if (checks.length && waitMs > 0) await sleep(waitMs);
  return { render: await renderPage(rap, doc, pageId, out, run), checks };
}

// First converter that works: poppler (macOS, Linux, Windows), macOS sips, ImageMagick.
async function toPng(pdf: string, png: string, run: Run): Promise<string | undefined> {
  const tries: Array<[string, string[]]> = [
    ['pdftoppm', ['-png', '-r', '96', '-singlefile', pdf, png.replace(/\.png$/, '')]],
    ['sips', ['-s', 'format', 'png', pdf, '--out', png]],
    ['magick', ['-density', '96', `${pdf}[0]`, png]],
  ];
  for (const [cmd, args] of tries) {
    try {
      await run(cmd, args);
      return cmd;
    } catch {
      // Not installed or failed: try the next one.
    }
  }
  return undefined;
}

export function pageName(doc: ReportDoc, pageId: string): string {
  const walk = (items: NonNullable<ReportDoc['navigationInfo']>['navItems'] = []): string | undefined => {
    for (const item of items) {
      if (item.page?.pageId === pageId) return item.page.displayName;
      const inner = walk(item.section?.navItems);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(doc.navigationInfo?.navItems) ?? pageId;
}
