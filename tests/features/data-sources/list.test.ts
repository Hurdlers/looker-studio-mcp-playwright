import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { A, B, context, DATASET, looker, PROJECT, SQL_B, TABLE } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

const list = async (args: Record<string, unknown>, setup = looker()) => resultText(await runTool(context(setup.rap), 'datasource_list', { report_id: setup.report.shareable.id, ...args }));

describe('datasource_list', () => {
  it('datasource.list: shows each source with its uses, connection, credentials and freshness, and the custom query with its SQL', async () => {
    const f = looker();
    const out = await list({}, f);
    const [ds1, ds2] = [out.split('\n').find((l) => l.startsWith('ds1'))!, out.slice(out.indexOf('ds2'))];
    expect(ds1).toMatch(new RegExp(`ds1 "${TABLE}".*3 charts.*table ${PROJECT}\\.${DATASET}\\.${TABLE}.*embedded.*owner.*12 hours`));
    expect(ds2).toMatch(new RegExp(`ds2 "Custom query".*0 charts.*custom query, billing project ${PROJECT}`));
    expect(ds2).toContain(`SQL: ${SQL_B}`);
    // One round trip for every source after the report.
    expect(f.calls.map((c) => c.endpoint)).toEqual(['getReport', 'getBlockDatasource', 'getBlockDatasource', 'getSchema', 'getSchema', 'getDatasourceList']);
    expect(f.calls.at(-1)!.body).toEqual({ type: [1], trashed: false, shareableIds: [A, B] });
  });

  it('datasource.list: picks one source by alias or name, refuses ambiguous and unknown names, and says when there are none', async () => {
    for (const ref of ['ds2', 'custom QUERY']) {
      const out = await list({ data_source: ref });
      expect(out).toContain('ds2 "Custom query"');
      expect(out).not.toContain('ds1');
    }
    const twins = looker();
    twins.sources[B]!.name = TABLE;
    await expect(list({ data_source: TABLE }, twins)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('ds1, ds2') });
    await expect(list({ data_source: 'Nope' })).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining(`ds1 "${TABLE}", ds2 "Custom query"`),
    });
    const empty = looker();
    empty.report.report.resource!.datasourceAlias = [];
    expect(await list({}, empty)).toBe(`Report ${empty.report.shareable.id} has no data sources.`);
  });

  it('datasource.list.fields: fields: true lists type, dimension or metric and aggregation; otherwise no field lines', async () => {
    const out = await list({ fields: true });
    const ds1 = out.slice(out.indexOf('ds1'), out.indexOf('ds2'));
    expect(ds1).toMatch(/- device_category \(_device_category_\): Text, dimension/);
    expect(ds1).toMatch(/- sessions \(_sessions_\): Number, dimension, aggregation sum/);
    expect(ds1).toMatch(/- Record Count .*: Number, metric, aggregation auto/);
    expect(ds1).toContain('Fields (4):');
    for (const args of [{}, { fields: false }]) {
      const plain = await list(args);
      expect(plain).not.toMatch(/Fields|aggregation/);
    }
  });

  it('describes Sheets by spreadsheet, worksheet and range without exposing native auth settings', async () => {
    const f = looker();
    f.sources[A]!.published.blocks[0].connectorBlockConfig.connectorConfig = {
      datasourceType: 8,
      sheetsConfig: { key: 'example_spreadsheet', sheetId: '0', range: 'A1:C20', meta: { worksheetName: 'Sales' }, context: { accessToken: 'fake-test-token' } },
    };
    const out = await list({ data_source: 'ds1', fields: true }, f);
    expect(out).toContain('Google Sheets example_spreadsheet, worksheet Sales, range A1:C20');
    expect(out).toContain('Fields (4):');
    expect(out).not.toMatch(/fake-test-token|sheetsConfig|BigQuery/);
    delete f.sources[A]!.published.blocks[0].connectorBlockConfig.connectorConfig.sheetsConfig.meta;
    expect(await list({ data_source: 'ds1' }, f)).toContain('worksheet gid 0');
  });
});
