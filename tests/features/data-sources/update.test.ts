import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { A, B, bigquery, column, context, DATASET, looker, PROJECT, R1, sent, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

const NEW_SQL = `SELECT device_category, session_medium, SUM(sessions) AS sessions FROM \`${PROJECT}.${DATASET}.${TABLE}\` GROUP BY 1, 2`;

function setup(opts: { reply?: Parameters<typeof bigquery>[0]; convert403?: boolean; stayEmbedded?: boolean; dryRun?: boolean } = {}) {
  const f = looker({
    ...opts,
    columns: (b) =>
      typeof b.connectorBlockConfig.connectorConfig.sql === 'string' && b.connectorBlockConfig.connectorConfig.sql.includes('session_medium')
        ? [column('_device_category_', 'device_category', 32), column('_session_medium_', 'session_medium', 32), column('_sessions_', 'sessions', 33)]
        : [],
  });
  const bq = bigquery(opts.reply);
  const ctx = context(f.rap, { fetch: bq.fetch, ...(opts.dryRun ? { dryRun: true } : {}) });
  const update = async (args: Record<string, unknown>) => resultText(await runTool(ctx, 'datasource_update', { report_id: R1, ...args }));
  return { ...f, bq, update };
}

describe('datasource_update', () => {
  it('datasource.update.rename: renames by alias with the name trimmed; nothing to change or a blank name is invalid', async () => {
    const s = setup();
    const out = await s.update({ data_source: 'ds1', name: ' TA main ' });
    expect(s.calls.find((c) => c.endpoint === 'renameDatasource')!.body).toEqual({ datasourceId: A, title: 'TA main' });
    expect(out).toContain('renamed to "TA main"');
    for (const args of [{ data_source: 'ds1' }, { data_source: 'ds1', name: '   ' }]) {
      const t = setup();
      await expect(t.update(args)).rejects.toMatchObject({ code: 'invalid' });
      expect(t.calls).toEqual([]);
    }
  });

  it('datasource.update.sql: dry-runs, reads the new columns and publishes the new SQL on the same source', async () => {
    const s = setup();
    const out = await s.update({ data_source: 'ds2', sql: NEW_SQL });
    expect(s.bq.sent[0]!.body).toMatchObject({ query: NEW_SQL, dryRun: true });
    expect(s.bq.sent[0]!.url).toContain(`/projects/${PROJECT}/queries`);
    const order = sent(s.calls);
    expect(order.indexOf('getColumns')).toBeLessThan(order.indexOf('publishDatasource'));
    expect(s.calls.find((c) => c.endpoint === 'getColumns')!.body.connectorBlockConfig.connectorConfig.sql).toBe(NEW_SQL);
    const draft = s.calls.find((c) => c.endpoint === 'publishDatasource')!.body.draft;
    expect(draft.datasourceId).toBe(B);
    expect(draft.blocks[0].connectorBlockConfig.connectorConfig.sql).toBe(NEW_SQL);
    expect(out).toContain('new fields: session_medium');
    expect(s.report.report.resource!.datasourceAlias).toContainEqual({ datasourceId: B, alias: 'ds2' });

    // A source with the date range parameters on: the dry run gets sample dates.
    const p = setup();
    const params = { parameters: [{ key: 'DS_START_DATE' }, { key: 'DS_END_DATE' }] };
    p.sources[B]!.published.blocks[0].connectorBlockConfig.connectorConfig.parameterConfiguration = params;
    const dated = `SELECT device_category, session_medium FROM \`${PROJECT}.${DATASET}.${TABLE}\` WHERE FORMAT_DATE('%Y%m%d', date) >= @DS_START_DATE`;
    await p.update({ data_source: 'ds2', sql: dated });
    expect(p.bq.sent[0]!.body.queryParameters).toEqual([{ name: 'DS_START_DATE', parameterType: { type: 'STRING' }, parameterValue: { value: '20240101' } }]);
  });

  it('datasource.update.sql: a table source is invalid; a query BigQuery rejects leaves the source alone', async () => {
    const s = setup();
    await expect(s.update({ data_source: 'ds1', sql: NEW_SQL })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('table') });
    expect(s.bq.sent).toEqual([]);
    const bad = setup({ reply: () => [400, { error: { message: 'Unrecognized name: foo at [1:8]' } }] });
    await expect(bad.update({ data_source: 'ds2', sql: 'SELECT foo FROM t' })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('Unrecognized name: foo'),
    });
    expect(sent(bad.calls)).not.toContain('getColumns');
    expect(sent(bad.calls)).not.toContain('publishDatasource');
  });

  it('datasource.update.credentials: owner and viewer switch delegated access, and viewer says everyone must consent', async () => {
    const s = setup();
    const out = await s.update({ data_source: 'ds1', credentials: 'viewer' });
    expect(s.calls.find((c) => c.endpoint === 'updateDataAccessControl')!.body).toEqual({ datasourceId: A, reportId: R1, delegatedAccessEnabled: false, oauthType: 1 });
    expect(out).toMatch(/credentials: viewer.*own Google account/);
    s.calls.length = 0;
    await s.update({ data_source: 'ds1', credentials: 'owner' });
    expect(s.calls.find((c) => c.endpoint === 'updateDataAccessControl')!.body).toMatchObject({ delegatedAccessEnabled: true });
  });

  it('datasource.update.freshness: presets and custom intervals become a shelf life; days and values off the list are invalid', async () => {
    const cases: Array<[string, Json]> = [
      ['1 hour', { amount: 1, chronoUnit: 2 }],
      ['30 minutes', { amount: 30, chronoUnit: 1 }],
      ['30m', { amount: 30, chronoUnit: 1 }],
      ['every 2 h', { amount: 2, chronoUnit: 2 }],
    ];
    for (const [freshness, shelfLife] of cases) {
      const s = setup();
      const out = await s.update({ data_source: 'ds1', freshness });
      expect(s.calls.find((c) => c.endpoint === 'publishDatasource')!.body.draft.queryCachePolicy.shelfLife).toEqual(shelfLife);
      expect(out).toContain('data freshness');
    }
    for (const freshness of ['2 days', '7 minutes', '13 hours']) {
      const s = setup();
      await expect(s.update({ data_source: 'ds1', freshness })).rejects.toMatchObject({ code: 'invalid' });
      expect(s.calls).toEqual([]);
    }
  });

  it('datasource.update.make_reusable: converts without sharing, judges by isEmbedded, and refuses sharing with editors', async () => {
    for (const grant of [undefined, false]) {
      const s = setup();
      const out = await s.update({ data_source: 'ds1', make_reusable: true, ...(grant === undefined ? {} : { grant_editor_access: grant }) });
      expect(s.calls.find((c) => c.endpoint === 'convertEmbeddedDatasource')!.body).toEqual({ datasourceId: A, reportId: R1, updateSharing: false });
      // Looker Studio answered 403, but the source reads reusable: success.
      expect(out).toMatch(/made reusable/);
    }
    const share = setup();
    await expect(share.update({ data_source: 'ds1', make_reusable: true, grant_editor_access: true })).rejects.toMatchObject({ code: 'refused' });
    expect(share.calls).toEqual([]);
    const alone = setup();
    await expect(alone.update({ data_source: 'ds1', grant_editor_access: false })).rejects.toMatchObject({ code: 'invalid' });
    expect(alone.calls).toEqual([]);

    const already = setup();
    already.sources[A]!.embedded = false;
    expect(await already.update({ data_source: 'ds1', make_reusable: true })).toMatch(/already reusable/);
    expect(sent(already.calls)).not.toContain('convertEmbeddedDatasource');

    const stuck = setup({ stayEmbedded: true });
    await expect(stuck.update({ data_source: 'ds1', make_reusable: true })).rejects.toMatchObject({ code: 'refused' });
  });
});
