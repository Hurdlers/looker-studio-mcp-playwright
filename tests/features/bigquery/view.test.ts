import { tmpdir } from 'node:os';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import type { WorkerTab } from '../../../src/browser/worker.js';
import { ReportSession } from '../../../src/core/session.js';
import { parseConfig } from '../../../src/config.js';
import { tools } from '../../../src/features/bigquery/index.js';
import type { Rap } from '../../../src/looker/rap.js';
import { buildServer } from '../../../src/mcp/server.js';
import { API, bqContext } from './helpers.js';

const DRY_SELECT: [number, unknown] = [200, { statementType: 'SELECT', totalBytesProcessed: '2048' }];
const DDL_DONE: [number, unknown] = [200, { jobComplete: true, jobReference: { jobId: 'ddl1', location: 'asia-northeast3' } }];
const VIEW = { project_id: 'kds-lab-project', dataset_id: 'kds_lab', view_id: 'v1', sql: 'SELECT 1 AS x;' };
const LABELLED = { type: 'VIEW', labels: { created_by: 'looker-studio-mcp' } };

async function listedTools(writesEnabled: boolean): Promise<string[]> {
  const rap = { call: async () => ({}), callMany: async () => [] } as unknown as Rap;
  const server = buildServer(
    {
      browser: { status: async () => ({ running: true, profile: '' }) },
      worker: {} as WorkerTab,
      rap,
      session: new ReportSession(rap, { snapshots: false }),
      audit: { write: async () => undefined },
      home: tmpdir(),
      config: parseConfig({ writes_enabled: writesEnabled }, tmpdir()),
    },
    'test',
    tools,
    [],
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return (await client.listTools()).tools.map((t) => t.name);
}

describe('bq_view_create', () => {
  it('bq.view.create: validates with a dry run, then runs CREATE OR REPLACE VIEW without the trailing semicolon', async () => {
    const { run, sent } = bqContext([DRY_SELECT, DDL_DONE]);
    const out = await run('bq_view_create', VIEW);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toMatchObject({ query: 'SELECT 1 AS x;', dryRun: true, useLegacySql: false });
    const ddl = String(sent[1]!.body!.query);
    expect(ddl.startsWith('CREATE OR REPLACE VIEW `kds-lab-project.kds_lab.v1`\n')).toBe(true);
    expect(ddl.endsWith('\nAS\nSELECT 1 AS x')).toBe(true);
    expect(sent[1]!.body).not.toHaveProperty('dryRun');
    expect(out).toContain('Created or replaced view `kds-lab-project.kds_lab.v1`');
    expect(out).toContain('2.0 KB');

    const failed = bqContext([[400, { error: { message: 'Unrecognized name: nope' } }]]);
    await expect(failed.run('bq_view_create', { ...VIEW, sql: 'SELECT nope' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('nope') });
    expect(failed.sent).toHaveLength(1);
  });

  it('bq.view.create: with dry_run on only the validating dry run is sent; with writes off the tool is not registered', async () => {
    const { run, sent } = bqContext([DRY_SELECT], { config: { dry_run: true } });
    const out = await run('bq_view_create', VIEW);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ dryRun: true });
    expect(out).toContain('CREATE OR REPLACE VIEW `kds-lab-project.kds_lab.v1`');
    expect(out).toContain('Nothing was saved');

    expect(await listedTools(false)).not.toContain('bq_view_create');
    expect(await listedTools(true)).toContain('bq_view_create');
  });

  it('bq.view.create: the view carries the label created_by: looker-studio-mcp', async () => {
    const { run, sent } = bqContext([DRY_SELECT, DDL_DONE]);
    await run('bq_view_create', VIEW);
    expect(String(sent[1]!.body!.query)).toContain('labels = [("created_by", "looker-studio-mcp")]');
  });

  it('bq.view.create.description: quotes and line breaks escaped into OPTIONS before AS; empty means none', async () => {
    const { run, sent } = bqContext([DRY_SELECT, DDL_DONE]);
    await run('bq_view_create', { ...VIEW, description: "it's\nok" });
    const lines = String(sent[1]!.body!.query).split('\n');
    const at = lines.indexOf('AS');
    expect(lines[at - 1]).toContain("OPTIONS (description = 'it\\'s\\nok'");

    for (const description of ['', undefined]) {
      const plain = bqContext([DRY_SELECT, DDL_DONE]);
      await plain.run('bq_view_create', { ...VIEW, ...(description === undefined ? {} : { description }) });
      expect(String(plain.sent[1]!.body!.query)).not.toContain('description');
    }
  });
});

describe('bq_view_delete', () => {
  const target = { project_id: 'kds-lab-project', dataset_id: 'kds_lab', view_id: 'kds_lab_view' };
  const url = `${API}/projects/kds-lab-project/datasets/kds_lab/tables/kds_lab_view`;

  it('bq.view.delete: a table is left alone with a note, a view is deleted, a missing one is not_found', async () => {
    const table = bqContext([[200, { type: 'TABLE' }]]);
    const note = await table.run('bq_view_delete', target);
    expect(note).toContain('not a view');
    expect(table.sent.filter((s) => s.method === 'DELETE')).toHaveLength(0);

    const view = bqContext([[200, LABELLED], [200, LABELLED], [204, null]]);
    expect(await view.run('bq_view_delete', target)).toContain('Deleted view `kds-lab-project.kds_lab.kds_lab_view`');
    expect(view.sent.filter((s) => s.method === 'DELETE').map((s) => s.url)).toEqual([url]);

    const gone = bqContext([[404, { error: { message: 'Not found: Table kds-lab-project:kds_lab.kds_lab_view' } }]]);
    await expect(gone.run('bq_view_delete', target)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('bq.view.delete: with dry_run on the type is read but nothing is deleted', async () => {
    const { run, sent } = bqContext([[200, LABELLED], [200, LABELLED]], { config: { dry_run: true } });
    const out = await run('bq_view_delete', target);
    expect(sent.filter((s) => s.method === 'GET').length).toBeGreaterThanOrEqual(1);
    expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(0);
    expect(out).toContain('kds-lab-project.kds_lab.kds_lab_view');
  });

  it('bq.view.delete: a view without our label is refused before any delete', async () => {
    const { run, sent } = bqContext([[200, { type: 'VIEW', labels: { created_by: 'someone-else' } }]]);
    await expect(run('bq_view_delete', target)).rejects.toMatchObject({ code: 'refused' });
    expect(sent.filter((s) => s.method === 'DELETE')).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });
});
