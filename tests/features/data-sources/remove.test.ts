import { afterEach, describe, expect, it, vi } from 'vitest';

import { resultText, runTool } from '../../../src/core/tool.js';
import { A, B, context, looker, R1, sent } from './fake.js';

afterEach(() => vi.unstubAllGlobals());

describe('datasource_remove', () => {
  it('datasource.remove: refuses a source in use, naming the component and page; removes an unused one by claim and alias', async () => {
    const f = looker();
    const ctx = context(f.rap);
    await expect(runTool(ctx, 'datasource_remove', { report_id: R1, data_source: 'ds1' })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/cd-a .*page "Overview"/),
    });
    expect(sent(f.calls)).not.toContain('deleteClaim');
    expect(sent(f.calls)).not.toContain('updateReport');

    f.calls.length = 0;
    const out = resultText(await runTool(ctx, 'datasource_remove', { report_id: R1, data_source: 'ds2' }));
    const writes = f.calls.filter((c) => c.endpoint === 'deleteClaim' || c.endpoint === 'updateReport');
    expect(writes.map((c) => c.endpoint)).toEqual(['updateReport', 'deleteClaim']);
    expect(writes[1]!.body).toEqual({ reportId: R1, datasourceId: B });
    expect(writes[0]!.body.reportRequest.resource.datasourceAlias).toEqual([{ datasourceId: A, alias: 'ds1' }]);
    expect(out).toMatch(/Removed ds2 "Custom query"/);
  });

  it('datasource.remove: in a dry run nothing is sent to Looker Studio and the answer names the source', async () => {
    const f = looker();
    const out = resultText(await runTool(context(f.rap, { dryRun: true }), 'datasource_remove', { report_id: R1, data_source: 'ds2' }));
    expect(sent(f.calls)).not.toContain('deleteClaim');
    expect(sent(f.calls)).not.toContain('updateReport');
    expect(out).toContain('ds2 "Custom query"');
    expect(out).toMatch(/Dry run .*deleteClaim/);
    expect(f.report.report.resource!.datasourceAlias).toHaveLength(2);
  });

  it('datasource.remove.force: removes a source in use and lists the components to fix', async () => {
    const f = looker();
    const out = resultText(await runTool(context(f.rap), 'datasource_remove', { report_id: R1, data_source: 'ds1', force: true }));
    expect(sent(f.calls).filter((e) => e === 'deleteClaim' || e === 'updateReport')).toEqual(['updateReport', 'deleteClaim']);
    expect(f.calls.find((c) => c.endpoint === 'deleteClaim')!.body).toEqual({ reportId: R1, datasourceId: A });
    expect(f.report.report.resource!.datasourceAlias).toEqual([{ datasourceId: B, alias: 'ds2' }]);
    expect(out).toContain('cd-a');
    expect(out).toMatch(/Delete them or point them at another data source/);
  });
});
