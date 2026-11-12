import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileAudit } from '../src/core/audit.js';
import { checkPage, dataRequests } from '../src/core/check.js';
import { addBigQuerySource, connectorConfig, nextAlias } from '../src/core/datasource.js';
import { explain } from '../src/core/errors.js';
import { pageName, renderPage } from '../src/core/render.js';
import { ReportSession, type ReportDoc } from '../src/core/session.js';
import { RapError, type Rap, type RapOutcome, type RapRequest } from '../src/looker/rap.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'kl-'));

function doc(): ReportDoc {
  return {
    shareable: { id: 'r1', name: 'R' },
    version: '5',
    report: { attributeConfig: { reportAttribute: { width: 1200, height: 1100 } }, resource: { datasourceAlias: [{ datasourceId: 'dsA', alias: 'ds1' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }, { section: { displayName: 'S', navItems: [{ page: { pageId: 'p2', displayName: 'Inner' } }] } }] },
    page: [
      {
        pageId: 'p1',
        version: '9',
        page: {
          componentConfig: [
            {
              componentId: 'cd-kpi',
              type: 'kpi-metric',
              datasourceId: 'dsA',
              conceptDefs: [
                { name: 'qt_m', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_sessions_', aggregation: 6 } } },
                { name: 'qt_unused', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_x_' } } },
              ],
              propertyConfig: { componentProperty: { metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_m'] } }] } } },
            },
            { componentId: 'cd-text', type: 'simple-description' },
            {
              componentId: 'cd-bad',
              type: 'simple-table',
              datasourceId: 'dsA',
              conceptDefs: [{ name: 'qt_d', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_gone_' } } }],
              propertyConfig: { componentProperty: { dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_d'] } }] } } },
            },
          ],
        },
      },
    ],
  };
}

describe('renderPage', () => {
  it('asks for the page by id with the canvas size and converts the PDF with the first tool that works', async () => {
    const asked: unknown[] = [];
    const rap: Rap = {
      call: async <T>(endpoint: string, body: unknown, _t?: number, mode?: string) => {
        asked.push({ endpoint, body, mode });
        return `"${Buffer.from('%PDF-1.4\n').toString('base64')}"` as T;
      },
      callMany: async () => [],
    };
    const tried: string[] = [];
    const dir = tmp();

    const res = await renderPage(rap, doc(), 'p1', { dir, name: 'shot' }, async (cmd) => {
      tried.push(cmd);
      if (cmd === 'pdftoppm') throw new Error('not installed');
    });

    expect(asked[0]).toMatchObject({
      endpoint: 'getPdf',
      mode: 'text',
      body: { reportId: 'r1', pageIds: ['p1'], width: 1200, height: 1100, pageSettings: [{ pageId: 'p1', name: 'Overview', width: 1200, height: 1100 }] },
    });
    expect(readFileSync(res.pdf, 'utf8')).toBe('%PDF-1.4\n');
    expect(tried).toEqual(['pdftoppm', 'sips']);
    expect(res).toMatchObject({ converter: 'sips', png: join(dir, 'shot.png') });
  });

  it('returns the PDF alone when no converter is installed', async () => {
    const rap: Rap = { call: async <T>() => 'JVBERg==' as T, callMany: async () => [] };
    const res = await renderPage(rap, doc(), 'p1', { dir: tmp(), name: 'x' }, async () => {
      throw new Error('missing');
    });
    expect(res.png).toBeUndefined();
  });

  it('finds page names inside sections', () => {
    expect(pageName(doc(), 'p2')).toBe('Inner');
    expect(pageName(doc(), 'nope')).toBe('nope');
  });
});

describe('checkPage', () => {
  it('asks for the fields each data chart shows, and skips components without data', () => {
    const asks = dataRequests('r1', doc().page[0]!, 'Asia/Seoul');
    expect(asks.map((a) => a.component.componentId)).toEqual(['cd-kpi', 'cd-bad']);
    expect(asks[0]!.request).toMatchObject({
      requestContext: { reportContext: { reportId: 'r1', pageId: 'p1', componentId: 'cd-kpi', displayType: 'kpi-metric' } },
      datasetSpec: {
        dataset: [{ datasourceId: 'dsA' }],
        queryFields: [{ name: 'qt_m', dataTransformation: { sourceFieldName: '_sessions_', aggregation: 6 } }],
        timezone: 'Asia/Seoul',
      },
    });
  });

  // Fake answers: cd-kpi has data; cd-bad gets `bad`; the data source has `fields`.
  function fakeRap(bad: RapOutcome<unknown>, fields: string[] | 'unreadable'): { rap: Rap; asked: string[] } {
    const asked: string[] = [];
    const rap: Rap = {
      call: async () => {
        throw new Error('unused');
      },
      callMany: async <T>(requests: RapRequest[]) =>
        requests.map((r): RapOutcome<T> => {
          asked.push(r.endpoint);
          if (r.endpoint === 'getBlockDatasource')
            return fields === 'unreadable'
              ? { ok: false, status: 403, error: 'denied' }
              : ({ ok: true, value: { published: { datasourceBlock: { fields: fields.map((name) => ({ field: { name } })) } } } } as RapOutcome<T>);
          const id = (r.body as { dataRequest: Array<{ requestContext: { reportContext: { componentId: string } } }> }).dataRequest[0]!
            .requestContext.reportContext.componentId;
          return (id === 'cd-kpi' ? { ok: true, value: { dataResponse: [{ dataSubset: [{ dataset: { tableDataset: { totalCount: 1 } } }] }] } } : bad) as RapOutcome<T>;
        }),
    };
    return { rap, asked };
  }

  it('names missing fields using source metadata read before chart queries', async () => {
    const { rap, asked } = fakeRap({ ok: true, value: { dataResponse: [{ dataSubset: [{ requestId: '' }], errorStatus: { code: 13 } }] } }, ['_sessions_']);
    expect(await checkPage(rap, doc(), 'p1')).toEqual([
      { componentId: 'cd-kpi', type: 'kpi-metric', ok: true, rows: 1 },
      { componentId: 'cd-bad', type: 'simple-table', ok: false, error: 'fields not in the data source: _gone_' },
    ]);
    expect(asked).toEqual(['getBlockDatasource', 'batchedDataV2', 'batchedDataV2']);
  });

  it('reports the error code when the fields are there but no data comes back', async () => {
    const { rap } = fakeRap({ ok: true, value: { dataResponse: [{ dataSubset: [{ requestId: '' }], errorStatus: { code: 13 } }] } }, ['_sessions_', '_gone_']);
    expect((await checkPage(rap, doc(), 'p1'))[1]).toMatchObject({ ok: false, error: 'Looker Studio returned no data (error code 13)' });
  });

  it('falls back to the error message when the data source cannot be read', async () => {
    const { rap } = fakeRap(
      { ok: false, status: 400, error: '{"errorStatus":{"reasonStr":"INVALID_FIELD","endUserMessage":"Field _gone_ was not found"}}' },
      'unreadable',
    );
    expect((await checkPage(rap, doc(), 'p1'))[1]).toMatchObject({ ok: false, error: 'INVALID_FIELD: Field _gone_ was not found' });
  });
});

describe('BigQuery data sources', () => {
  it('puts custom SQL beside the BigQuery settings', () => {
    expect(connectorConfig({ sql: 'SELECT 1', billingProject: 'bill' })).toEqual({
      datasourceType: 2,
      useDatetimeType: true,
      bigQueryConnectorConfig: { projectId: 'bill', billingProjectId: 'bill', sqlType: 2, meta: { projectName: 'bill', isSharedProject: false } },
      sql: 'SELECT 1',
    });
  });

  it('numbers aliases after the highest one', () => {
    expect(nextAlias([])).toBe('ds1');
    expect(nextAlias(['ds1', 'ds4', 'other'])).toBe('ds5');
  });

  it('makes the six calls in order and adds the alias, without returning the token', async () => {
    const report = doc();
    const order: string[] = [];
    const rap: Rap = {
      call: async <T>(endpoint: string, body: unknown): Promise<T> => {
        order.push(endpoint);
        const b = body as Record<string, unknown>;
        switch (endpoint) {
          case 'getFirstPartyAccessToken':
            return { accessToken: 'ya29.secret' } as T;
          case 'getColumns':
            expect(b.googleAuthOAuthToken).toBe('ya29.secret');
            return {
              columns: [
                { columnType: 1, mutableVersion: 1, outputName: 'sessions', dataType: 3, defaultAggregationType: 6, field: { ns: 't0', name: '_sessions_' } },
                { columnType: 1, outputName: 'Record Count', dataType: 3, defaultAggregationType: 7, textFormula: 'COUNT(1)', field: { name: 'datastudio_record_count' } },
              ],
            } as T;
          case 'createBlockDatasource':
            return { datasource: { datasourceId: 'dsNew' } } as T;
          case 'getReport':
            return { reportConfig: structuredClone(report) } as T;
          case 'updateReport':
            report.report.resource = (b.reportRequest as ReportDoc['report']).resource!;
            return { version: '6' } as T;
          default:
            return {} as T;
        }
      },
      callMany: async () => [],
    };
    const worker = { run: async <A, R>() => '123' as R };

    const res = await addBigQuerySource({ rap, worker, session: new ReportSession(rap, { snapshots: false }) }, 'r1', {
      projectId: 'p',
      datasetId: 'd',
      tableId: 't',
    });

    expect(order).toEqual(['getFirstPartyAccessToken', 'getColumns', 'createBlockDatasource', 'publishDatasource', 'claimDatasourceForReport', 'getReport', 'updateReport']);
    expect(res).toEqual({
      datasourceId: 'dsNew',
      alias: 'ds2',
      fields: [
        { id: '_sessions_', name: 'sessions', dataType: 3, aggregation: 6 },
        { id: 'datastudio_record_count', name: 'Record Count', dataType: 3, aggregation: 7 },
      ],
    });
    expect(JSON.stringify(res)).not.toContain('ya29');
    expect(report.report.resource?.datasourceAlias).toContainEqual({ datasourceId: 'dsNew', alias: 'ds2' });
  });
});

describe('explain', () => {
  it('turns internal API failures into codes with a next step', () => {
    expect(explain(new RapError('updatePage', 429, 'rate'))?.code).toBe('busy');
    expect(explain(new RapError('getReport', 404, 'x'))?.code).toBe('not_found');
    expect(explain(new RapError('getColumns', 400, '{"errorStatus":{"code":3,"reasonStr":"BACKEND_ADAPTER_ERROR"}}'))?.message).toMatch(
      /BACKEND_ADAPTER_ERROR/,
    );
    expect(explain(new Error('other'))).toBeUndefined();
  });
});

describe('FileAudit', () => {
  it('appends one line per write and never writes secrets', async () => {
    const path = join(tmp(), 'audit.ndjson');
    const audit = new FileAudit(path, () => new Date('2026-10-30T00:00:00Z'));
    await audit.write({ tool: 'chart_add', reportId: 'r1', result: 'ok', version: '7', detail: 'x' });
    await audit.write({ tool: 'x', result: 'error', ...({ accessToken: 'ya29.secret' } as object) });

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ at: '2026-10-30T00:00:00.000Z', tool: 'chart_add', reportId: 'r1', result: 'ok', version: '7', detail: 'x' });
    expect(lines[1]).not.toContain('ya29');
  });
});
