import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { BrowserHost } from '../../src/browser/host.js';
import { loadConfig } from '../../src/config.js';
import { WorkerTab } from '../../src/browser/worker.js';
import { BLANK_TEMPLATE, createReport } from '../../src/core/create.js';
import { GuardedRap } from '../../src/core/guard.js';
import { ReportSession } from '../../src/core/session.js';
import { RapClient, type Rap } from '../../src/looker/rap.js';
import { getReportBody } from '../../src/looker/reports.js';

// Lab lanes for live tests. A lane has its own worker tab in the dedicated
// browser and can write only to what it created:
// any call but a listed read may name only ids the lane made (GuardPolicy
// owned), so even an endpoint whose body we do not know yet cannot touch
// anyone else's report or data source. Lab reports and reusable data sources are named
// "[looker-studio-mcp-lab-N] …", logged to ~/.looker-studio-mcp/lab/created.ndjson,
// and deleted by sweep().

const HOME_URL = 'https://lookerstudio.google.com/navigation/reporting?hl=en';

const allowed = JSON.parse(readFileSync(new URL('./endpoints.json', import.meta.url), 'utf8')) as {
  reads: string[];
  writes: string[];
};
export const LAB_ENDPOINTS: ReadonlySet<string> = new Set([...allowed.reads, ...allowed.writes]);

export const labDir = (): string => join(process.env.LOOKER_STUDIO_MCP_HOME ?? join(homedir(), '.looker-studio-mcp'), 'lab');
export const labPrefix = (n: number): string => `[looker-studio-mcp-lab-${n}]`;

export interface Lane {
  n: number;
  worker: WorkerTab;
  rap: Rap;
  session: ReportSession;
  // Reports this lane may write to and must delete.
  created: Set<string>;
  // Where the lane's renders go.
  dir: string;
}

// Experiments may allow more endpoints for their lane; sharing and mail stay
// refused whatever is listed.
export interface LaneOptions {
  reads?: string[];
  writes?: string[];
}

export async function openLane(n: number, opts: LaneOptions = {}): Promise<Lane> {
  // Every lane works in a tab of its own in the server's dedicated browser.
  const config = loadConfig();
  const browser = new BrowserHost({ home: config.home, headless: config.browser.headless, ...(config.browser.chromePath ? { chromePath: config.browser.chromePath } : {}) });
  const worker = new WorkerTab(browser, { homeUrl: HOME_URL });
  await worker.ensure();
  const created = new Set<string>();
  const reads = new Set([...allowed.reads, ...(opts.reads ?? [])]);
  const rap = new GuardedRap(new RapClient(worker), {
    endpoints: new Set([...LAB_ENDPOINTS, ...reads, ...(opts.writes ?? [])]),
    canWrite: (id) => created.has(id),
    canWriteSource: (id) => created.has(id),
    owned: { reads, owns: (id) => created.has(id) || id === BLANK_TEMPLATE, learn: (ids) => ids.forEach((id) => created.add(id)) },
  });
  const dir = join(labDir(), `lane-${n}`);
  await mkdir(dir, { recursive: true });
  return { n, worker, rap, session: new ReportSession(rap), created, dir };
}

// A blank report owned by the account, made the way the editor makes one.
export async function createLabReport(lane: Lane, title: string): Promise<{ reportId: string; pageId: string }> {
  const { reportId, pageId, name } = await createReport(lane.rap, `${labPrefix(lane.n)} ${title}`);
  lane.created.add(reportId);
  await log({ event: 'created', lane: lane.n, id: reportId, name });
  return { reportId, pageId };
}

// Records something an experiment made outside createLabReport (a copied
// report, a reusable data source) so sweep() deletes it, also after a crash.
export async function track(lane: Lane, id: string, name: string, kind: 'report' | 'datasource' = 'report'): Promise<void> {
  if (!name.startsWith(labPrefix(lane.n))) throw new Error(`lab objects are named "${labPrefix(lane.n)} …", not "${name}"`);
  lane.created.add(id);
  await log({ event: 'created', lane: lane.n, id, name, kind });
}

// Deletes this lane's reports and reusable data sources: the ones it made
// now, and any an earlier run left behind. Only objects owned by the account,
// named with the lane's prefix and logged or made by this lane are touched.
// Embedded data sources go with their report. (Shareable type 0 = report,
// 1 = data source.)
export async function sweep(lane: Lane): Promise<string[]> {
  const prefix = labPrefix(lane.n);
  const logged = await loggedIds(lane.n);
  const ours = (id: string) => lane.created.has(id) || logged.has(id);
  const doomed = new Map<string, { name: string; type: number }>();
  // By name, live and in the trash (a lab report_delete only trashes).
  const lists = await lane.rap.callMany<{ shareableConfig?: Array<{ id: string; name: string }> }>(
    [0, 1].flatMap((type) => [false, true].map((trashed) => ({ endpoint: 'getShareableList', body: listBody(type, trashed, prefix, []) }))),
  );
  lists.forEach((l, i) => {
    if (!l.ok) throw new Error(`sweep: getShareableList failed (HTTP ${l.status})`);
    for (const r of l.value.shareableConfig ?? [])
      if (r.name.startsWith(prefix) && ours(r.id)) doomed.set(r.id, { name: r.name, type: i < 2 ? 0 : 1 });
  });
  // The name search lags minutes behind creation: look up every id this
  // lane made by id, as a report, else as a data source, and check its name.
  const rest = [...new Set([...lane.created, ...logged.keys()])].filter((id) => UUID.test(id) && !doomed.has(id));
  const asReport = await lane.rap.callMany<{ reportConfig?: { shareable?: { name?: string } } }>(
    rest.map((reportId) => ({ endpoint: 'getReport', body: getReportBody(reportId, false) })),
  );
  // A report has a name. getReport may answer a data source id with 200 and
  // no reportConfig, so anything without a name is looked up as a source.
  const notReports = rest.filter((id, i) => {
    const r = asReport[i]!;
    const name = r.ok ? r.value.reportConfig?.shareable?.name : undefined;
    if (name?.startsWith(prefix)) doomed.set(id, { name, type: 0 });
    return !name;
  });
  const asSource = await lane.rap.callMany<{ published?: Json; draft?: Json; embeddedInReportId?: string }>(
    notReports.map((datasourceId) => ({ endpoint: 'getBlockDatasource', body: { datasourceId } })),
  );
  const gone: string[] = [];
  notReports.forEach((id, i) => {
    const r = asSource[i]!;
    if (!r.ok) {
      if (r.status === 403 || r.status === 404) gone.push(id);
      return;
    }
    const block = (r.value.published ?? r.value.draft) as { datasourceBlock?: { name?: string } } | undefined;
    const name = block?.datasourceBlock?.name;
    // Embedded sources go with their report.
    if (name?.startsWith(prefix) && !r.value.embeddedInReportId) doomed.set(id, { name, type: 1 });
  });
  // Reports first: a reusable source may still be in one.
  const order = [...doomed].sort((a, b) => a[1].type - b[1].type);
  for (const [id, r] of order) {
    lane.created.add(id);
    await lane.rap.call('deleteShareable', { id, type: r.type });
    await log({ event: 'deleted', lane: lane.n, id, name: r.name });
  }
  for (const id of gone) if (logged.has(id)) await log({ event: 'deleted', lane: lane.n, id, name: logged.get(id), note: 'already gone' });
  return order.map(([id]) => id);
}

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function listBody(type: number, trashed: boolean, titleContains: string, shareableIds: string[]): Json {
  return { type: [type], trashed, titleContains, shareableIds, sharedWithMe: false, ownedByMe: true, fromHomePage: false, aclModes: [] };
}

async function log(entry: Record<string, unknown>): Promise<void> {
  await mkdir(labDir(), { recursive: true });
  await appendFile(join(labDir(), 'created.ndjson'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// Ids this lane logged as created and not yet deleted, with their names.
async function loggedIds(n: number): Promise<Map<string, string>> {
  const text = await readFile(join(labDir(), 'created.ndjson'), 'utf8').catch(() => '');
  const live = new Map<string, string>();
  for (const line of text.split('\n').filter(Boolean)) {
    const e = JSON.parse(line) as { event: string; lane: number; id: string; name?: string };
    if (e.lane !== n) continue;
    if (e.event === 'created') live.set(e.id, e.name ?? '');
    else live.delete(e.id);
  }
  return live;
}
