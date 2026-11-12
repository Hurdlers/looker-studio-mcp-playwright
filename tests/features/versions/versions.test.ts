process.env.TZ = 'Asia/Seoul';

import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../../src/config.js';
import { createContext } from '../../../src/core/context.js';
import { runTool, resultText } from '../../../src/core/tool.js';
import { tools } from '../../../src/features/versions/index.js';
import { pickVersion, type Version } from '../../../src/features/versions/revisions.js';
import type { Rap } from '../../../src/looker/rap.js';

const R1 = '0b5c4b8e-1111-4222-8333-944455556666';

function fakeRap(revisions: unknown) {
  const calls: Array<{ endpoint: string; body: any }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown) => {
      calls.push({ endpoint, body });
      if (endpoint === 'getRevisions') return structuredClone(revisions) as T;
      if (endpoint === 'getReport') return { reportConfig: { shareable: { id: R1 }, version: '42' } } as T;
      if (endpoint === 'restoreRevision') return {} as T;
      throw new Error(`unexpected ${endpoint}`);
    },
    callMany: async () => {
      throw new Error('callMany not expected');
    },
  };
  return { rap, calls };
}

function ctxFor(rap: Rap, dryRun = false) {
  return createContext({ rap, tools, config: parseConfig({ writes_enabled: true, dry_run: dryRun }, tmpdir()) });
}

const four = {
  revisionInfo: [
    { revisionNumber: '40', createdTimestamp: '1793354900000000', editorList: { editor: [{ userId: 'u1' }] } },
    { revisionNumber: '31', revisionAnnotation: { name: 'kds-lab-B' }, editorList: { editor: [{ userId: 'u1' }] } },
    { revisionNumber: '22', createdTimestamp: '1793354820000000', editorList: { editor: [{ userId: 'u1' }] } },
    { revisionNumber: '13', revisionAnnotation: { name: 'kds-lab-A' }, editorList: { editor: [{ userId: 'u1' }] } },
  ],
  editorInfo: [{ key: 'u1', value: { displayName: 'Lab User' } }],
};

describe('version_list', () => {
  it('version.list: numbers versions newest first with default date names, latest-save mark and editor names', async () => {
    const { rap, calls } = fakeRap({
      revisionInfo: [
        { revisionNumber: '12', createdTimestamp: '1793354820000000', editorList: { editor: [{ userId: 'u1' }] } },
        { revisionNumber: '9', revisionAnnotation: { name: 'kds-lab-A' }, editorList: { editor: [{ userId: '0' }] } },
      ],
      editorInfo: [{ key: 'u1', value: { displayName: 'Lab User' } }],
    });
    const out = resultText(await runTool(ctxFor(rap), 'version_list', { report_id: R1 }));
    const lines = out.split('\n');
    expect(lines[1]).toBe('1. October 30, 2026 7:07 PM (latest save) — Lab User');
    expect(lines[2]).toBe('2. kds-lab-A — Deleted user');
    expect(out.match(/latest save/g)).toHaveLength(1);
    expect(out).not.toMatch(/current version/);
    expect(calls).toEqual([{ endpoint: 'getRevisions', body: { entityId: R1, entityType: 1 } }]);
  });

  it('version.list: says the report has no saved versions when revisionInfo is empty', async () => {
    const { rap } = fakeRap({ revisionInfo: [] });
    const out = resultText(await runTool(ctxFor(rap), 'version_list', { report_id: R1 }));
    expect(out).toMatch(/no saved versions/);
  });

  it('version.list: shows User name hidden for an editor without a name', async () => {
    const { rap } = fakeRap({ revisionInfo: [{ revisionNumber: '1', revisionAnnotation: { name: 'x' }, editorList: { editor: [{ userId: 'u9' }] } }] });
    const out = resultText(await runTool(ctxFor(rap), 'version_list', { report_id: R1 }));
    expect(out).toMatch(/1\. x \(latest save\) — User name hidden/);
  });
});

describe('version_restore', () => {
  it('version.restore.by_index: version 2 sends one restoreRevision with the 2nd revisionNumber; 1 restores the newest saved version; 0 is invalid; 9 is not_found naming 4', async () => {
    const { rap, calls } = fakeRap(four);
    const res = await runTool(ctxFor(rap), 'version_restore', { report_id: R1, version: 2 });
    expect(resultText(res)).toMatch(/kds-lab-B/);
    const restores = calls.filter((c) => c.endpoint === 'restoreRevision');
    expect(restores).toEqual([{ endpoint: 'restoreRevision', body: { entityId: R1, entityType: 1, revisionNumber: '31' } }]);

    // Live, the version named right before the last save is revisionInfo[0]
    // (the later save is not listed yet), so position 1 must be restorable.
    const one = fakeRap(four);
    await runTool(ctxFor(one.rap), 'version_restore', { report_id: R1, version: 1 });
    expect(one.calls.filter((c) => c.endpoint === 'restoreRevision')).toEqual([
      { endpoint: 'restoreRevision', body: { entityId: R1, entityType: 1, revisionNumber: '40' } },
    ]);

    const zero = fakeRap(four);
    await expect(runTool(ctxFor(zero.rap), 'version_restore', { report_id: R1, version: 0 })).rejects.toMatchObject({ code: 'invalid' });
    expect(zero.calls.filter((c) => c.endpoint === 'restoreRevision')).toHaveLength(0);

    const nine = fakeRap(four);
    const err = await runTool(ctxFor(nine.rap), 'version_restore', { report_id: R1, version: 9 }).catch((e) => e);
    expect(err).toMatchObject({ code: 'not_found', message: expect.stringMatching(/\b4 versions\b/) });
    expect(nine.calls.filter((c) => c.endpoint === 'restoreRevision')).toHaveLength(0);
  });

  it('version.restore.by_index: with dry_run on only getRevisions is sent and the answer names the version', async () => {
    const { rap, calls } = fakeRap(four);
    const out = resultText(await runTool(ctxFor(rap, true), 'version_restore', { report_id: R1, version: 4 }));
    expect(calls.map((c) => c.endpoint)).toEqual(['getRevisions']);
    expect(out).toMatch(/kds-lab-A/);
    expect(out).toMatch(/Dry run/);
  });

  it('version.restore.by_label: exact name ignoring case, then newest containing; empty refused; the newest version name restores it', () => {
    const names = ['(현재)', 'kds-lab-B', 'October 30, 2026 7:07 PM', 'kds-lab-A'];
    const versions: Version[] = names.map((name, i) => ({ index: i + 1, revisionNumber: String(10 - i), name, named: true, editors: [], restored: false }));
    expect(pickVersion(versions, 'KDS-LAB-a').index).toBe(4);
    expect(pickVersion(versions, '7:07 pm').index).toBe(3);
    expect(pickVersion(versions, 'kds-lab').index).toBe(2);
    expect(() => pickVersion(versions, '')).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(pickVersion(versions, '(현재)').index).toBe(1);
  });

  it('version.restore.by_label: a default date name from getRevisions is found by part of its time', async () => {
    const { rap, calls } = fakeRap(four);
    await runTool(ctxFor(rap), 'version_restore', { report_id: R1, version: '7:07 PM' });
    expect(calls.find((c) => c.endpoint === 'restoreRevision')!.body).toEqual({ entityId: R1, entityType: 1, revisionNumber: '22' });
  });
});
