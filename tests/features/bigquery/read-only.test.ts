import { describe, expect, it } from 'vitest';

import { readOnlySql } from '../../../src/features/bigquery/sql.js';
import { bqContext } from './helpers.js';

const DRY_SELECT: [number, unknown] = [200, { statementType: 'SELECT', totalBytesProcessed: '0' }];
const DONE: [number, unknown] = [200, { jobComplete: true, schema: { fields: [] }, totalRows: '0', totalBytesProcessed: '0' }];

describe('read-only SQL check', () => {
  it('bq.query.read_only: writes and scripts are refused with no request, pointing to bq_view_create', async () => {
    for (const sql of ['DELETE FROM d.t WHERE TRUE', 'SELECT 1; DROP TABLE d.t', 'CREATE VIEW d.v AS SELECT 1', '/* x */ INSERT INTO d.t VALUES (1)']) {
      const { run, sent } = bqContext([]);
      await expect(run('bq_query_run', { project_id: 'example-project', sql })).rejects.toMatchObject({
        code: 'refused',
        message: expect.stringContaining('bq_view_create'),
      });
      expect(sent).toHaveLength(0);
    }
  });

  it('bq.query.read_only: single SELECT/WITH statements pass, keyword-named columns included', async () => {
    for (const sql of [
      'SELECT 1;',
      'WITH a AS (SELECT 1 AS x) SELECT x FROM a',
      "SELECT 'drop table d.t; delete' AS s",
      'SELECT `update` FROM d.t',
      'SELECT update, load FROM d.t',
    ]) {
      const { run, sent } = bqContext([DRY_SELECT, DONE]);
      await run('bq_query_run', { project_id: 'example-project', sql });
      expect(sent.filter((s) => s.body?.dryRun === false)).toHaveLength(1);
    }
    expect(readOnlySql('SELECT 1 AS x; -- done')).toBe('SELECT 1 AS x -- done');
    expect(readOnlySql("SELECT r'\\' AS a, \"\"\"x;\ny\"\"\" AS b # c;")).toBe("SELECT r'\\' AS a, \"\"\"x;\ny\"\"\" AS b # c;");
    expect(() => readOnlySql('SELECT 1 /* ; */ ; SELECT 2')).toThrow(/more than one statement/);
    expect(() => readOnlySql('MERGE d.t USING s ON TRUE WHEN MATCHED THEN DELETE')).toThrow(/MERGE/);
    expect(() => readOnlySql('-- only a comment')).toThrow(/empty/);
  });

  it('bq.query.read_only: the same check runs first for dry_run and bq_view_create', async () => {
    const dry = bqContext([]);
    await expect(dry.run('bq_query_run', { project_id: 'example-project', sql: 'DELETE FROM d.t WHERE TRUE', dry_run: true })).rejects.toMatchObject({ code: 'refused' });
    expect(dry.sent).toHaveLength(0);

    const view = bqContext([]);
    await expect(
      view.run('bq_view_create', { project_id: 'kds-lab-project', dataset_id: 'kds_lab', view_id: 'v1', sql: 'DROP TABLE kds_lab.t' }),
    ).rejects.toMatchObject({ code: 'refused' });
    expect(view.sent).toHaveLength(0);
  });
});
