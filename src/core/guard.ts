import type { Rap, RapOutcome, RapRequest } from '../looker/rap.js';
import { LookerError } from './errors.js';

// Safety rules checked before a request leaves the process, so no prompt or
// bug can get around them:
//   - nothing that shares a report or sends mail is ever called;
//   - only listed endpoints are called at all;
//   - a write names its target (report, data source) and the policy must allow it.

// Sharing, invitations, scheduled delivery, embedding, ownership transfer.
// "Shareable" (Looker Studio's word for a report or data source) is fine.
export const SHARING = /schedul|deliver|shar(?:e|ing)(?!able)|\bacl|invite|email|embed|transfer|owner/i;

// Endpoints whose name looks like sharing but that share nothing, allowed only
// with a body that keeps sharing untouched. convertEmbeddedDatasource turns a
// report's own data source into a reusable one; checkEmbed asks whether a web
// page may be framed in a report (URL embed component), sending only the URL.
const NOT_SHARING: Record<string, (body: Record<string, unknown>) => boolean> = {
  convertEmbeddedDatasource: (b) => b.updateSharing === false,
  checkEmbed: (b) => Object.keys(b).length === 1 && typeof b.url === 'string',
};

// Where a write points: a report, or a data source.
export type Target = { report: string } | { source: string };

// Endpoints that change something, with every target they name, all of which
// the policy must allow. undefined (the body names no target where one is
// expected) is refused: a write never goes out unchecked. Creating
// (createTempReport, persistTempReport) has no target yet ([]); copyReport
// only reads its source (see READS) and makes a new report.
export const WRITES: Record<string, (body: Record<string, unknown>) => Target[] | undefined> = {
  updatePrefetch: (b) => b.fieldMask === 'TIMESTAMP'
    ? all(report((b.prefetchConfig as Record<string, unknown> | undefined)?.reportId)) : undefined,
  updatePage: (b) => all(report(b.reportId)),
  updateReport: (b) => all(report(b.reportId)),
  createPages: (b) => all(report(b.reportId)),
  deletePages: (b) => all(report(b.reportId)),
  updateReportNavigationInfo: (b) => all(report(b.reportId)),
  publishReport: (b) => all(report(b.reportId)),
  createNamedRevision: (b) => all(report(b.reportId)),
  restoreRevision: (b) => all(report(b.entityId)),
  deleteRevision: (b) => all(report(b.entityId)),
  // Shareable type 1 is a data source, anything else a report.
  deleteShareable: (b) => all(shareable(b.id, b.type)),
  updateRemovedState: (b) => all(shareable(b.id, b.type)),
  uploadImage: (b) => all(report(b.reportId)),
  createBlockDatasource: (b) => (b.reportId === undefined ? [] : all(report(b.reportId))),
  // The data source itself, never on the strength of a report: a draft of
  // someone else's source must not ride on a report we may change.
  publishDatasource: (b) => all(source((b.draft as Record<string, unknown> | undefined)?.datasourceId)),
  claimDatasourceForReport: (b) => all(report(b.reportId)),
  // Takes the source out of the report; the source itself is left as it is.
  deleteClaim: (b) => all(report(b.reportId), str(b.datasourceId) ? [] : undefined),
  // These change the data source itself: both it and the report it is in.
  updateDataAccessControl: (b) => all(report(b.reportId), source(b.datasourceId)),
  convertEmbeddedDatasource: (b) => all(report(b.reportId), source(b.datasourceId)),
  renameDatasource: (b) => all(source(b.datasourceId)),
  grantConsent: consentTarget,
  copyReport: () => [],
  createTempReport: () => [],
  persistTempReport: () => [],
};

// Requests that read a report through a door other than getReport: the
// report must be one the policy may read (canRead, else canWrite). Also
// checked: the reportId of any GET request.
export const READS: Record<string, (body: Record<string, unknown>) => string | undefined> = {
  copyReport: (b) => str(b.reportId),
  getImageV2: (b) => str(b.reportId),
};

// grantConsent takes several kinds of consent. Only one is sent: letting a
// community visualization read a report's data (vizPermitted). Anything else
// (the viewer's email for a data source parameter, audit logging, external
// images, viewer credentials) is refused.
function consentTarget(b: Record<string, unknown>): Target[] {
  const viz = b.vizPermitted as Record<string, unknown> | undefined;
  const target = Object.keys(b).length === 1 && viz ? report(viz.reportId) : undefined;
  if (target) return [target];
  throw new LookerError('refused', 'grantConsent: only a community visualization consent (vizPermitted) for a report is sent.');
}

export interface GuardPolicy {
  // Endpoints that may be called (reads and writes).
  endpoints: ReadonlySet<string>;
  // Whether a write may touch this report.
  canWrite(reportId: string): boolean;
  // Whether a write may touch this data source. Without it, only a data
  // source embedded in a report canWrite allows (as getBlockDatasource or
  // createBlockDatasource showed this guard) may be written.
  canWriteSource?(datasourceId: string): boolean;
  // Whether a report may be read where READS lists it (copyReport's source,
  // an image). Without it, only reports canWrite allows.
  canRead?(reportId: string): boolean;
  // Stricter rule for experiments with endpoints whose body we do not know
  // yet: a call to anything but these reads may name only ids we own, and the
  // ids a successful create answers with (what it just made) become ours.
  // Other writes teach nothing: their answers may mention ids we do not own.
  owned?: {
    reads: ReadonlySet<string>;
    owns(id: string): boolean;
    learn(ids: string[]): void;
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Endpoints that make something new.
const CREATES = /^(create|copy|persist|duplicate|convert|clone|upload)/i;

// What a known create made, read from its answer: only that id becomes
// writable. An answer can mention other ids (a template's data sources)
// that are not ours. [] = made nothing to write to.
const MADE: Record<string, (value: Record<string, any>) => unknown[]> = {
  createTempReport: (v) => [v.reportConfig?.shareable?.id],
  persistTempReport: (v) => [v.reportConfig?.shareable?.id],
  copyReport: (v) => [typeof v.url === 'string' ? /\/reporting\/([0-9a-f-]{36})/i.exec(v.url)?.[1] : undefined],
  createBlockDatasource: (v) => [v.datasource?.datasourceId],
  convertEmbeddedDatasource: () => [],
  createPages: () => [],
  createNamedRevision: () => [],
  uploadImage: () => [],
};

// Report, data source and template ids anywhere in a request or answer.
export function idsIn(value: unknown): string[] {
  return [...new Set((JSON.stringify(value ?? null).match(UUID) ?? []).map((id) => id.toLowerCase()))];
}

export class GuardedRap implements Rap {
  // Data source → the report it is embedded in, as answers showed it.
  private readonly embedded = new Map<string, string>();
  // Reports and data sources made through this guard (a copy, a reusable
  // source): writable whatever the policy says about other ids.
  private readonly made = new Set<string>();

  constructor(
    private readonly inner: Rap,
    private readonly policy: GuardPolicy,
  ) {}

  async call<T = unknown>(endpoint: string, body: unknown, timeoutMs?: number, mode?: RapRequest['mode']): Promise<T> {
    this.check({ endpoint, body, ...(mode ? { mode } : {}) });
    const value = await this.inner.call<T>(endpoint, body, timeoutMs, mode);
    this.learn(endpoint, body, value);
    return value;
  }

  async callMany<T = unknown>(
    requests: RapRequest[],
    opts?: { concurrency?: number; timeoutMs?: number },
  ): Promise<RapOutcome<T>[]> {
    requests.forEach((r) => this.check(r));
    const out = await this.inner.callMany<T>(requests, opts);
    out.forEach((o, i) => o.ok && this.learn(requests[i]!.endpoint, requests[i]!.body, o.value));
    return out;
  }

  private learn(endpoint: string, body: unknown, value: unknown): void {
    const owned = this.policy.owned;
    const b = (body ?? {}) as Record<string, unknown>;
    const v = (value ?? {}) as Record<string, any>;
    // Ids the request named existed before it (a template, a copied report).
    const named = new Set(idsIn(body));
    const known = MADE[endpoint];
    const fresh = known
      ? known(v).flatMap((id) => (typeof id === 'string' && id && !named.has(id.toLowerCase()) ? [id.toLowerCase()] : []))
      : [];
    fresh.forEach((id) => this.made.add(id));
    // An experiment with a create whose answer we do not know yet: every new
    // id in it is the lane's (its policy names only ids the lane made).
    const guessed = !known && CREATES.test(endpoint) && !owned?.reads.has(endpoint) ? idsIn(value).filter((id) => !named.has(id)) : [];
    if (owned && fresh.length + guessed.length) owned.learn([...fresh, ...guessed]);
    // A data source lives in the report it is embedded in: who may write the
    // report may write the source.
    const pairs: Array<[unknown, unknown]> = [];
    if (endpoint === 'getBlockDatasource') pairs.push([b.datasourceId, v.embeddedInReportId]);
    if (endpoint === 'createBlockDatasource') pairs.push([v.datasource?.datasourceId, b.reportId]);
    for (const [ds, reportId] of pairs) {
      if (typeof ds !== 'string' || !ds || typeof reportId !== 'string' || !reportId) continue;
      this.embedded.set(ds.toLowerCase(), reportId.toLowerCase());
      if (owned?.owns(reportId.toLowerCase())) owned.learn([ds.toLowerCase()]);
    }
  }

  private writable(target: Target): boolean {
    if ('report' in target) return this.made.has(target.report.toLowerCase()) || this.policy.canWrite(target.report);
    const id = target.source.toLowerCase();
    if (this.made.has(id) || this.policy.canWriteSource?.(target.source)) return true;
    const host = this.embedded.get(id);
    return host !== undefined && (this.made.has(host) || this.policy.canWrite(host));
  }

  private readable(reportId: string): boolean {
    if (this.made.has(reportId.toLowerCase())) return true;
    return this.policy.canRead ? this.policy.canRead(reportId) : this.policy.canWrite(reportId);
  }

  private check(r: Pick<RapRequest, 'endpoint' | 'body' | 'mode'>): void {
    const body = (r.body ?? {}) as Record<string, unknown>;
    if (SHARING.test(r.endpoint) && !NOT_SHARING[r.endpoint]?.(body))
      throw new LookerError('refused', `${r.endpoint}: sharing and email are never called.`);
    if (!this.policy.endpoints.has(r.endpoint))
      throw new LookerError('refused', `${r.endpoint} is not an allowed endpoint (add it to the allowlist once it is understood).`);
    const write = WRITES[r.endpoint];
    if (write) {
      const targets = write(body);
      if (!targets) throw new LookerError('refused', `${r.endpoint} names no report or data source to check: not sent.`);
      for (const target of targets)
        if (!this.writable(target))
          throw new LookerError(
            'refused',
            'report' in target
              ? `${r.endpoint} on report ${target.report} is not allowed by this policy.`
              : `${r.endpoint} on data source ${target.source} is not allowed by this policy (it is not in a report this policy may change).`,
          );
    }
    const reads = READS[r.endpoint];
    const read = reads ? reads(body) : r.mode === 'get' ? str(body.reportId) : undefined;
    if (reads && !read) throw new LookerError('refused', `${r.endpoint} names no report to check: not sent.`);
    if (read && !this.readable(read))
      throw new LookerError('refused', `${r.endpoint} reads report ${read}, which is outside the reports this policy may read.`);
    const owned = this.policy.owned;
    if (!owned || owned.reads.has(r.endpoint)) return;
    const foreign = idsIn(r.body).filter((x) => !owned.owns(x));
    if (foreign.length)
      throw new LookerError('refused', `${r.endpoint} names ${foreign.length} id(s) this lane did not create (${foreign.slice(0, 3).join(', ')}).`);
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

// Every target, or undefined when one is missing.
function all(...targets: Array<Target | Target[] | undefined>): Target[] | undefined {
  if (targets.some((t) => t === undefined)) return undefined;
  return (targets as Array<Target | Target[]>).flat();
}

function report(v: unknown): Target | undefined {
  const id = str(v);
  return id ? { report: id } : undefined;
}

function source(v: unknown): Target | undefined {
  const id = str(v);
  return id ? { source: id } : undefined;
}

function shareable(id: unknown, type: unknown): Target | undefined {
  return Number(type) === 1 ? source(id) : report(id);
}
