import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Rap, RapOutcome, RapRequest } from '../src/looker/rap.js';
import { labDir, sweep, type Lane } from './live/lab.js';

// sweep() against a fake account: the name search misses what was made a
// moment ago, so ids the lane logged or made are looked up one by one.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = '[looker-studio-mcp-lab-1]';

interface Thing {
  name: string;
  type: 0 | 1;
  trashed?: boolean;
  // Shown by the name search (false: made too recently).
  listed?: boolean;
  embeddedIn?: string;
}

function account(things: Record<string, Thing>, opts: { emptyReportForSources?: boolean } = {}) {
  const deleted: string[] = [];
  const answer = (r: RapRequest): RapOutcome<unknown> => {
    const b = r.body as Record<string, any>;
    switch (r.endpoint) {
      case 'getShareableList':
        return {
          ok: true,
          value: {
            shareableConfig: Object.entries(things)
              .filter(([, t]) => t.listed !== false && t.type === b.type[0] && !!t.trashed === b.trashed && t.name.includes(b.titleContains))
              .map(([k, t]) => ({ id: k, name: t.name })),
          },
        };
      case 'getReport': {
        const t = things[b.reportId];
        // Some ids that are not reports get 200 with no reportConfig.
        if (t?.type === 1 && opts.emptyReportForSources) return { ok: true, value: {} };
        return t?.type === 0 ? { ok: true, value: { reportConfig: { shareable: { id: b.reportId, name: t.name } } } } : { ok: false, status: 400, error: 'not a report' };
      }
      case 'getBlockDatasource': {
        const t = things[b.datasourceId];
        return t?.type === 1
          ? { ok: true, value: { published: { datasourceBlock: { name: t.name } }, embeddedInReportId: t.embeddedIn ?? '' } }
          : { ok: false, status: 404, error: 'ENTITY_NOT_FOUND' };
      }
      case 'deleteShareable':
        deleted.push(b.id);
        delete things[b.id];
        return { ok: true, value: {} };
      default:
        throw new Error(`unexpected ${r.endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      const res = answer({ endpoint, body });
      if (!res.ok) throw new Error(res.error);
      return res.value as T;
    },
    callMany: async <T>(requests: RapRequest[]) => requests.map(answer) as RapOutcome<T>[],
  };
  return { rap, deleted };
}

describe('sweep', () => {
  beforeEach(() => {
    process.env.LOOKER_STUDIO_MCP_HOME = mkdtempSync(join(tmpdir(), 'kds-lab-'));
    mkdirSync(labDir(), { recursive: true });
  });

  const logLines = (entries: object[]) =>
    writeFileSync(join(labDir(), 'created.ndjson'), entries.map((e) => JSON.stringify({ at: 'x', lane: 1, ...e })).join('\n') + '\n');

  it('deletes by id what the name search does not show yet, trashed reports too, reports before data sources', async () => {
    const { rap, deleted } = account({
      [id(1)]: { name: `${P} listed`, type: 0 },
      [id(2)]: { name: `${P} just made`, type: 0, listed: false },
      [id(3)]: { name: `${P} trashed`, type: 0, trashed: true },
      [id(4)]: { name: `${P} reusable`, type: 1, listed: false },
      [id(5)]: { name: `${P} not ours`, type: 0 },
      [id(6)]: { name: 'renamed by hand', type: 0, listed: false },
      [id(7)]: { name: '4 Demo', type: 1, embeddedIn: id(2) },
    });
    logLines([
      { event: 'created', id: id(1), name: `${P} listed` },
      { event: 'created', id: id(3), name: `${P} trashed` },
      { event: 'created', id: id(4), name: `${P} reusable`, kind: 'datasource' },
      { event: 'created', id: id(6), name: `${P} x` },
      { event: 'created', id: id(9), name: `${P} gone already` },
    ]);
    const lane = { n: 1, rap, created: new Set([id(2), id(7), 'img-not-a-uuid']) } as unknown as Lane;

    const done = await sweep(lane);

    expect(new Set(done)).toEqual(new Set([id(1), id(2), id(3), id(4)]));
    expect(deleted.at(-1)).toBe(id(4));
    const log = readFileSync(join(labDir(), 'created.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log.filter((e) => e.event === 'deleted').map((e) => e.id)).toEqual(expect.arrayContaining([id(1), id(2), id(3), id(4), id(9)]));
    expect(log.find((e) => e.id === id(9) && e.event === 'deleted')).toMatchObject({ note: 'already gone' });

    // A second sweep finds nothing left of ours.
    expect(await sweep(lane)).toEqual([]);
  });

  it('looks a nameless getReport answer up as a data source', async () => {
    const { rap, deleted } = account({ [id(4)]: { name: `${P} reusable`, type: 1, listed: false } }, { emptyReportForSources: true });
    const lane = { n: 1, rap, created: new Set([id(4)]) } as unknown as Lane;
    expect(await sweep(lane)).toEqual([id(4)]);
    expect(deleted).toEqual([id(4)]);
  });
});
