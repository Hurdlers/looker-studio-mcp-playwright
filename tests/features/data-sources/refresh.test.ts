import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { A, B, column, context, looker, R1, sent, TABLE, type Json } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

const calc = { columnType: 1, outputName: 'calc_x', dataType: 5, textFormula: 'sessions * 2', field: { ns: 't0', name: 'calc_x' } };

// ds1's columns as the connection gives them, plus `extra`.
function withColumns(extra: Json[] = []) {
  const f = looker({ columns: () => [column('_device_category_', 'device_category', 32), column('_sessions_', 'sessions', 33), column('_session_medium_', 'session_medium', 32), ...extra] });
  f.sources[A]!.published.datasourceBlock.fields.push(structuredClone(calc));
  return f;
}

describe('datasource_refresh', () => {
  it('datasource.refresh: adds a new column to both blocks, keeps calculated fields, names it whole; no change publishes nothing', async () => {
    const f = withColumns([column('_new_col_', 'new col', 32)]);
    const out = resultText(await runTool(context(f.rap), 'datasource_refresh', { report_id: R1, name: TABLE }));
    const publish = f.calls.find((c) => c.endpoint === 'publishDatasource')!.body;
    expect(publish.draft.datasourceId).toBe(A);
    expect(publish.draft.blocks[0].fields.map((c: Json) => c.outputName)).toContain('new col');
    const fields = publish.draft.datasourceBlock.fields as Json[];
    expect(fields.map((c) => c.outputName)).toEqual(['device_category', 'sessions', 'session_medium', 'calc_x', 'new col']);
    expect(fields.find((c) => c.field.name === 'calc_x')).toEqual(calc);
    expect(out).toContain('new fields: new col');
    // The getColumns request carries the source's own connection.
    expect(f.calls.find((c) => c.endpoint === 'getColumns')!.body).toMatchObject({
      connectorBlockConfig: f.sources[A]!.published.blocks[0].connectorBlockConfig,
      isBigQueryConnection: true,
      projectNumber: '123456',
    });

    const same = withColumns();
    const quiet = resultText(await runTool(context(same.rap), 'datasource_refresh', { report_id: R1, name: 'ds1' }));
    expect(sent(same.calls)).not.toContain('publishDatasource');
    expect(quiet).toContain('no new fields');
  });

  it('datasource.refresh: takes the alias, and asks for it when two sources share a name', async () => {
    const f = withColumns();
    const out = resultText(await runTool(context(f.rap), 'datasource_refresh', { report_id: R1, name: 'ds2' }));
    expect(out).toMatch(/^ds2 "Custom query"/);
    expect(new Set(f.calls.filter((c) => c.endpoint === 'getBlockDatasource').map((c) => c.body.datasourceId))).toEqual(new Set([B]));
    const twins = withColumns();
    twins.sources[B]!.name = TABLE;
    await expect(runTool(context(twins.rap), 'datasource_refresh', { report_id: R1, name: TABLE })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('ds1, ds2'),
    });
  });
});
