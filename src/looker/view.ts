import { WorkerError, type WorkerTab } from '../browser/worker.js';
import { externalPageId } from './page-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reports created before the UUID ids carry a Drive file id.
const DRIVE_ID = /^[A-Za-z0-9_-]{25,}$/;

// Accepts a report id or any Looker Studio / Data Studio URL of the report.
export function parseReportId(input: string): string {
  const raw = /\/reporting\/([^/?#]+)/.exec(input)?.[1] ?? input.trim();
  if (UUID.test(raw)) return raw.toLowerCase();
  if (DRIVE_ID.test(raw)) return raw;
  throw new WorkerError('page_error', `Not a Looker Studio report id or URL: ${input}`);
}

export interface OpenReportOptions {
  pageId?: string;
  edit?: boolean;
}

// Opens a report page in the worker, skipping the load when it is already there.
export async function openReport(worker: WorkerTab, reportId: string, opts: OpenReportOptions = {}): Promise<void> {
  const path = `/reporting/${reportId}${opts.pageId ? `/page/${externalPageId(opts.pageId)}` : ''}${opts.edit ? '/edit' : ''}`;
  const here = await worker.run(() => ({ origin: location.origin, path: location.pathname.replace(/^\/u\/\d+/, '') }), null);
  // Without a page id the report redirects to its first page: always load.
  if (opts.pageId && here.path === path) return;
  await worker.goto(`${here.origin}${path}?hl=en`);
}

// True once the canvas is drawn and no component has shown its loading
// shimmer for 400 ms (the shimmer shows up only after the canvas, so a quiet
// canvas right away proves nothing); false when that did not happen within
// timeoutMs.
export async function waitForCharts(worker: WorkerTab, timeoutMs = 30_000): Promise<boolean> {
  try {
    await worker.waitFor(
      () => {
        const w = window as unknown as { __lookerStudioMcpQuietSince?: number };
        const busy =
          !document.querySelector('.reportArea') ||
          !!document.querySelector('ng2-canvas-component-loading-shimmer');
        if (busy) {
          w.__lookerStudioMcpQuietSince = 0;
          return false;
        }
        w.__lookerStudioMcpQuietSince ||= Date.now();
        return Date.now() - w.__lookerStudioMcpQuietSince >= 400;
      },
      null,
      timeoutMs,
    );
    return true;
  } catch (err) {
    if (err instanceof WorkerError && err.code === 'timeout') return false;
    throw err;
  }
}

export interface ReportScreenshot {
  data: string;
  mimeType: string;
  settled: boolean;
  ms: number;
}

export async function screenshotReport(
  worker: WorkerTab,
  reportId: string,
  opts: OpenReportOptions & { timeoutMs?: number } = {},
): Promise<ReportScreenshot> {
  const started = Date.now();
  await openReport(worker, reportId, opts);
  await worker.cdp('Page.bringToFront', {});
  await worker.run(() => {
    (window as unknown as { __lookerStudioMcpQuietSince?: number }).__lookerStudioMcpQuietSince = 0;
  }, null);
  const settled = await waitForCharts(worker, opts.timeoutMs);
  await worker.run(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, null);
  const shot = await worker.screenshot();
  return { ...shot, settled, ms: Date.now() - started };
}
