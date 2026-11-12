import type { Rap } from '../../looker/rap.js';
import { LookerError } from '../../core/errors.js';

// One saved version of a report as getRevisions returns it, newest first.
export interface Version {
  // 1 = newest saved version (revisionInfo[0]). Edits saved since then are not
  // in the list yet, so every position, 1 included, is a state to go back to.
  index: number;
  revisionNumber: string;
  // The version's name, or the editor's default name (its date and time).
  name: string;
  named: boolean;
  editors: string[];
  restored: boolean;
}

interface RevisionsResponse {
  revisionInfo?: Array<{
    revisionNumber?: string | number;
    createdTimestamp?: string | number;
    editorList?: { editor?: Array<{ userId?: string }> };
    revisionAnnotation?: { name?: string; creationMethod?: number | string };
  }>;
  editorInfo?: Array<{ key?: string; value?: { displayName?: string } }>;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// The editor's default version name, 'MMMM d, y h:mm a' in this machine's
// time zone (e.g. "October 30, 2026 7:07 PM"). createdTimestamp is in
// microseconds.
export function defaultName(createdMicros: string | number | undefined): string {
  if (createdMicros === undefined || createdMicros === '') return 'Unknown date';
  const d = new Date(Math.floor(Number(createdMicros) / 1000));
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const h = d.getHours() % 12 || 12;
  const ampm = d.getHours() < 12 ? 'AM' : 'PM';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

export async function readVersions(rap: Rap, reportId: string): Promise<Version[]> {
  const res = (await rap.call<RevisionsResponse>('getRevisions', { entityId: reportId, entityType: 1 })) ?? {};
  if (res.revisionInfo !== undefined && !Array.isArray(res.revisionInfo))
    throw new LookerError('format_changed', 'getRevisions answered without a revision list: Looker Studio may have changed its internal API.');
  const people = new Map<string, string>();
  for (const e of res.editorInfo ?? []) if (e.key && e.value?.displayName) people.set(e.key, e.value.displayName);
  return (res.revisionInfo ?? []).map((r, i) => {
    if (r.revisionNumber === undefined || r.revisionNumber === '')
      throw new LookerError('format_changed', 'A version from getRevisions has no revisionNumber: Looker Studio may have changed its internal API.');
    const given = r.revisionAnnotation?.name?.trim();
    return {
      index: i + 1,
      revisionNumber: String(r.revisionNumber),
      name: given || defaultName(r.createdTimestamp),
      named: Boolean(given),
      editors: (r.editorList?.editor ?? []).map((e) =>
        e.userId === '0' ? 'Deleted user' : (e.userId && people.get(e.userId)) || 'User name hidden',
      ),
      restored: Number(r.revisionAnnotation?.creationMethod) === 2,
    };
  });
}

export function describeVersion(v: Version): string {
  const marks = [v.index === 1 ? 'latest save' : '', v.restored ? 'restored' : ''].filter(Boolean);
  const by = v.editors.length ? ` — ${v.editors.join(', ')}` : '';
  return `${v.index}. ${v.name}${marks.length ? ` (${marks.join(', ')})` : ''}${by}`;
}

// The version a restore asks for: a number is the list position (1 or more),
// a string a name (exact match ignoring case first, then the newest version
// whose name contains it). Position 1 is the newest saved version, not the
// working draft: live, edits saved after it are not in the list, so it is a
// real earlier state and can be restored.
export function pickVersion(versions: Version[], want: number | string): Version {
  const count = `The report has ${versions.length} version${versions.length === 1 ? '' : 's'}`;
  let hit: Version | undefined;
  if (typeof want === 'number') {
    if (!Number.isInteger(want) || want < 1) throw new LookerError('invalid', `Version ${want} is not a position in the list: give 1 or more (see version_list).`);
    hit = versions[want - 1];
    if (!hit) throw new LookerError('not_found', `No version ${want}. ${count}: run version_list and pick one of them.`);
  } else {
    const q = want.trim().toLowerCase();
    if (!q) throw new LookerError('invalid', 'Give a version name or part of one, or its position from version_list.');
    hit = versions.find((v) => v.name.toLowerCase() === q) ?? versions.find((v) => v.name.toLowerCase().includes(q));
    if (!hit) throw new LookerError('not_found', `No version named or containing "${want}". ${count}: run version_list to see their names.`);
  }
  return hit;
}
