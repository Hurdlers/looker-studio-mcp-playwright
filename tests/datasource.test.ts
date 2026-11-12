import { describe, expect, it } from 'vitest';

import { createReport, BLANK_TEMPLATE, DRY_RUN_REPORT } from '../src/core/create.js';
import { DryRap } from '../src/core/dryrun.js';
import {
  addBigQuerySource,
  connectorConfig,
  editDatasource,
  grantViewerEmailConsent,
  hasViewerEmailConsent,
  makeReusable,
  removeDatasource,
  renameDatasource,
  resolveSource,
  restoreDatasource,
  setCredentials,
  sourceFields,
  sourceUses,
} from '../src/core/datasource.js';
import { ReportSession, type ReportDoc } from '../src/core/session.js';
import { RapError, type Rap, type RapOutcome, type RapRequest } from '../src/looker/rap.js';

type Json = Record<string, any>;

const column = (name: string, outputName: string, semanticType: number): Json => ({
  columnType: 1,
  outputName,
  dataType: semanticType === 33 ? 5 : 0,
  defaultAggregationType: semanticType === 33 ? 6 : 0,
  outputSemanticInfo: { semanticConfig: [{ semanticType }] },
  field: { ns: 't0', name },
});

// A Looker Studio with one report r1 (two data sources, dsA used by a chart)
// and the data source endpoints, answering like the real one.
function looker() {
  const report: ReportDoc = {
    shareable: { id: 'r1', name: 'R' },
    version: '5',
    chartCondition: [],
    page: [{ pageId: 'p1', version: '9', page: { componentConfig: [{ componentId: 'cd-kpi', type: 'kpi-metric', datasourceId: 'dsA' }] } }],
    report: { componentConfig: [], resource: { datasourceAlias: [{ datasourceId: 'dsA', alias: 'ds1' }, { datasourceId: 'dsB', alias: 'ds2' }] } },
    navigationInfo: { navItems: [{ page: { pageId: 'p1', displayName: 'Overview' } }] },
  };
  const sources: Record<string, { name: string; embedded: boolean; delegated: boolean; draft?: Json; published: Json }> = {
    dsA: { name: '4 Demo', embedded: true, delegated: true, published: { datasourceId: 'dsA', datasourceBlock: { name: '4 Demo', fields: [column('_sessions_', 'sessions', 33)] } } },
    dsB: {
      name: 'Orders',
      embedded: true,
      delegated: true,
      published: { datasourceId: 'dsB', datasourceBlock: { name: 'Orders', fields: [column('_old_', 'old', 32)] } },
      draft: { datasourceId: 'dsB', datasourceBlock: { name: 'Orders', fields: [column('_amount_', 'amount', 33), column('_country_', 'country', 32)] } },
    },
  };
  const consent: Array<{ consentType: number; approval?: number }> = [{ consentType: 1 }];
  const calls: Array<{ endpoint: string; body: Json; mode?: string }> = [];
  const answer = (endpoint: string, b: Json): unknown => {
    switch (endpoint) {
      case 'getReport':
        return { reportConfig: structuredClone(report) };
      case 'updateReport':
        if (b.version !== report.version) return { version: '-1' };
        report.report.resource = b.reportRequest.resource;
        report.version = String(Number(report.version) + 1);
        return { version: report.version };
      case 'getBlockDatasource': {
        const s = sources[b.datasourceId];
        if (!s) throw new RapError(endpoint, 404, 'getBlockDatasource returned HTTP 404: ENTITY_NOT_FOUND');
        return structuredClone({ published: s.published, ...(s.draft ? { draft: s.draft } : {}), embeddedInReportId: s.embedded ? 'r1' : '' });
      }
      case 'getDatasourceList':
        return {
          datasourceInfo: (b.shareableIds as string[]).flatMap((id) =>
            sources[id] ? [{ shareableConfig: { id, name: sources[id].name }, isEmbedded: sources[id].embedded }] : [],
          ),
        };
      case 'getSchema':
        return {
          schema: {
            isDelegatedAccessEnabled: sources[b.datasourceId]!.delegated,
            dimensions: [{ name: '_country_', semanticInfo: { semanticConfig: [{ semanticType: 32 }] } }],
            metrics: [{ name: '_amount_', semanticInfo: { semanticConfig: [{ semanticType: 12 }] } }],
          },
        };
      case 'getFirstPartyAccessToken':
        return { accessToken: 'ya29.secret' };
      case 'publishDatasource':
        sources[b.draft.datasourceId]!.published = b.draft;
        delete sources[b.draft.datasourceId]!.draft;
        return {};
      case 'renameDatasource':
        sources[b.datasourceId]!.name = b.title;
        return null;
      case 'deleteClaim':
        return {};
      case 'updateDataAccessControl':
        sources[b.datasourceId]!.delegated = b.delegatedAccessEnabled;
        return { version: '77' };
      case 'convertEmbeddedDatasource':
        // Looker Studio converts, then answers 403.
        sources[b.datasourceId]!.embedded = false;
        throw new RapError(endpoint, 403, 'convertEmbeddedDatasource returned HTTP 403: PERMISSION_DENIED');
      case 'checkConsent':
        return { parameter: { consent: structuredClone(consent) } };
      case 'grantConsent':
        consent[0]!.approval = 1;
        return {};
      case 'createNamedRevision':
        return { revisionNumber: 3 };
      default:
        throw new Error(`unexpected ${endpoint}`);
    }
  };
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown, _t?: number, mode?: string): Promise<T> => {
      calls.push({ endpoint, body: body as Json, ...(mode ? { mode } : {}) });
      return answer(endpoint, body as Json) as T;
    },
    callMany: async <T>(requests: RapRequest[]): Promise<RapOutcome<T>[]> =>
      requests.map((r) => {
        calls.push({ endpoint: r.endpoint, body: r.body as Json });
        try {
          return { ok: true, value: answer(r.endpoint, r.body as Json) as T };
        } catch (e) {
          return { ok: false, status: (e as RapError).status ?? 0, error: (e as Error).message };
        }
      }),
  };
  const session = new ReportSession(rap, { snapshots: false });
  return { rap, session, report, sources, calls, consent };
}

const sent = (calls: Array<{ endpoint: string }>) => calls.map((c) => c.endpoint);

describe('editDatasource', () => {
  it('changes a copy of the draft and publishes it with the report and a fresh token', async () => {
    const { rap, sources, calls } = looker();
    const res = await editDatasource(rap, 'r1', 'dsB', (ds) => {
      ds.queryCachePolicy = { shelfLife: { amount: 15, chronoUnit: 1 }, isCustomPolicy: true };
    });

    expect(sent(calls)).toEqual(['getBlockDatasource', 'getFirstPartyAccessToken', 'publishDatasource']);
    const publish = calls[2]!.body;
    expect(publish).toMatchObject({ clearThumbnails: false, reportId: 'r1', accessToken: 'ya29.secret' });
    // The draft's fields, not the published ones.
    expect(publish.draft.datasourceBlock.fields.map((f: Json) => f.field.name)).toEqual(['_amount_', '_country_']);
    expect(sources.dsB!.published.queryCachePolicy).toEqual({ shelfLife: { amount: 15, chronoUnit: 1 }, isCustomPolicy: true });
    expect(res.previous.queryCachePolicy).toBeUndefined();
    expect(res.fields.map((f) => f.id)).toEqual(['_amount_', '_country_']);
    expect(JSON.stringify(res)).not.toContain('ya29');
  });

  it('publishes a reusable source without a report, and names a missing one', async () => {
    const { rap, calls } = looker();
    await editDatasource(rap, null, 'dsA', () => {});
    expect(calls.at(-1)!.body).not.toHaveProperty('reportId');
    await expect(editDatasource(rap, 'r1', 'nope', () => {})).rejects.toThrow(/HTTP 404/);
  });

  it('puts a data source back whole with restoreDatasource, dropping keys the edit added', async () => {
    const { rap, sources } = looker();
    const res = await editDatasource(rap, 'r1', 'dsA', (ds) => {
      ds.parameterConfiguration = { parameters: [{ key: 'DS_USER_EMAIL' }] };
      (ds.datasourceBlock as Json).fields = [];
    });
    expect(sources.dsA!.published.parameterConfiguration).toBeDefined();
    await restoreDatasource(rap, 'r1', 'dsA', res.previous);
    expect(sources.dsA!.published).toEqual(res.previous);
    expect(sources.dsA!.published).not.toHaveProperty('parameterConfiguration');
  });
});

describe('dry run', () => {
  it('records the writes and skips reading them back', async () => {
    const { rap, calls } = looker();
    const dry = new DryRap(rap, []);
    expect(await renameDatasource(dry, 'dsA', 'New name')).toEqual({ name: 'New name' });
    expect(await setCredentials(dry, 'r1', 'dsA', 'viewer')).toEqual({ credentials: 'viewer' });
    expect(await makeReusable(dry, 'r1', 'dsA')).toEqual({ converted: true });
    expect(dry.writes.map((w) => w.endpoint)).toEqual(['renameDatasource', 'updateDataAccessControl', 'convertEmbeddedDatasource']);
    // Rename reads the original once and later reads use the simulated state.
    expect(sent(calls)).toEqual(['getBlockDatasource']);
    expect(await resolveSource(dry, (await dry.call<any>('getReport', { reportId: 'r1' })).reportConfig, 'New name')).toMatchObject({ name: 'New name' });
  });

  it('keeps a reusable source reusable while previewing edits and a rename', async () => {
    const { rap, sources } = looker();
    sources.dsA!.embedded = false;
    const dry = new DryRap(rap, []);
    await editDatasource(dry, 'r1', 'dsA', (ds) => { ds.queryCachePolicy = { shelfLife: { amount: 1, chronoUnit: 2 } }; });
    await renameDatasource(dry, 'dsA', 'Preview name');
    const info = await dry.call<any>('getDatasourceList', { shareableIds: ['dsA'] });
    expect(info.datasourceInfo[0]).toMatchObject({ shareableConfig: { name: 'Preview name' }, isEmbedded: false });
    expect(sources.dsA!.name).toBe('4 Demo');
    expect(sources.dsA!.published).not.toHaveProperty('queryCachePolicy');
  });

  it('answers createReport with placeholder ids', async () => {
    const dry = new DryRap({ call: async () => { throw new Error('nothing is sent'); }, callMany: async () => [] }, []);
    expect(await createReport(dry, 'Sales')).toMatchObject({ reportId: DRY_RUN_REPORT, name: 'Sales' });
    expect(dry.writes.map((w) => w.endpoint)).toEqual(['createTempReport', 'persistTempReport']);
  });
});

describe('data source wrappers', () => {
  it('renames and reads the name back, treating the empty answer as success', async () => {
    const { rap, calls } = looker();
    expect(await renameDatasource(rap, 'dsA', ' TA main ')).toEqual({ name: 'TA main' });
    expect(calls[0]).toEqual({ endpoint: 'renameDatasource', body: { datasourceId: 'dsA', title: 'TA main' } });
    expect(calls[1]).toEqual({ endpoint: 'getDatasourceList', body: { type: [1], trashed: false, shareableIds: ['dsA'] } });
    await expect(renameDatasource(rap, 'dsA', '  ')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('removes an unused data source: its alias (after a snapshot), then deleteClaim', async () => {
    const { rap, report, calls } = looker();
    const res = await removeDatasource({ rap, session: new ReportSession(rap) }, 'r1', 'dsB');

    expect(sent(calls)).toEqual(['getReport', 'createNamedRevision', 'getReport', 'updateReport', 'deleteClaim']);
    expect(calls[4]!.body).toEqual({ reportId: 'r1', datasourceId: 'dsB' });
    expect(report.report.resource?.datasourceAlias).toEqual([{ datasourceId: 'dsA', alias: 'ds1' }]);
    expect(res).toMatchObject({ alias: 'ds2', version: '6', snapshot: '3' });
  });

  it('sends no deleteClaim when the alias cannot be saved, and puts the alias back when deleteClaim fails', async () => {
    const { rap, session, report, calls } = looker();
    const failing = (endpoint: string): Rap => ({
      ...rap,
      call: async <T>(e: string, body: unknown): Promise<T> => {
        if (e === endpoint) {
          calls.push({ endpoint: e, body: body as Json });
          throw new RapError(e, 500, `${e} returned HTTP 500`);
        }
        return rap.call<T>(e, body);
      },
    });
    const aliases = structuredClone(report.report.resource?.datasourceAlias);
    await expect(removeDatasource({ rap, session: new ReportSession(failing('updateReport'), { snapshots: false }) }, 'r1', 'dsB')).rejects.toThrow(/HTTP 500/);
    expect(sent(calls)).not.toContain('deleteClaim');
    expect(report.report.resource?.datasourceAlias).toEqual(aliases);

    calls.length = 0;
    await expect(removeDatasource({ rap: failing('deleteClaim'), session }, 'r1', 'dsB')).rejects.toThrow(/deleteClaim returned HTTP 500/);
    expect(sent(calls)).toEqual(['getReport', 'getReport', 'updateReport', 'deleteClaim', 'getReport', 'updateReport']);
    expect(report.report.resource?.datasourceAlias).toEqual(aliases);
  });

  it('refuses to remove a data source in use, naming the components, and sends nothing', async () => {
    const { rap, session, calls } = looker();
    await expect(removeDatasource({ rap, session }, 'r1', 'dsA')).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('cd-kpi (kpi-metric) on page "Overview"'),
    });
    expect(sent(calls)).toEqual(['getReport']);
    await expect(removeDatasource({ rap, session }, 'r1', 'dsZ')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('counts report-level components and report filters as uses', () => {
    const { report } = looker();
    report.report.componentConfig = [{ componentId: 'cd-top', type: 'dimension-filter', datasourceId: 'dsB' }];
    (report.report.resource as Json).filter = [{ id: 'f1', datasourceId: 'dsB' }];
    expect(sourceUses(report, 'dsB')).toEqual([
      { componentId: 'cd-top', type: 'dimension-filter', page: 'report level' },
      { componentId: '(report filters or parameters)', type: 'resource', page: 'report level' },
    ]);
  });

  it('counts conditional formatting that names the data source as a use', () => {
    const { report } = looker();
    report.page[0]!.chartCondition = [{ chartId: 'cd-x', conditionalFormat: { field: { datasourceId: 'dsB' } } }];
    report.chartCondition = [{ chartId: 'cd-y', datasourceId: 'dsB' }];
    expect(sourceUses(report, 'dsB')).toEqual([
      { componentId: '(conditional formatting)', type: 'chartCondition', page: 'Overview' },
      { componentId: '(conditional formatting)', type: 'chartCondition', page: 'report level' },
    ]);
  });

  it('switches credentials and confirms them from getSchema', async () => {
    const { rap, calls } = looker();
    expect(await setCredentials(rap, 'r1', 'dsA', 'viewer')).toEqual({ version: '77', credentials: 'viewer' });
    expect(calls[0]!.body).toEqual({ datasourceId: 'dsA', reportId: 'r1', delegatedAccessEnabled: false, oauthType: 1 });
    expect(calls[1]!.body).toMatchObject({ datasourceId: 'dsA', requestContext: { reportContext: { reportId: 'r1', mode: 2 } } });
  });

  it('makes a source reusable although Looker Studio answers 403, judging by isEmbedded', async () => {
    const { rap, calls } = looker();
    expect(await makeReusable(rap, 'r1', 'dsA')).toEqual({ converted: true });
    expect(calls.find((c) => c.endpoint === 'convertEmbeddedDatasource')!.body).toEqual({ datasourceId: 'dsA', reportId: 'r1', updateSharing: false });
    // Already reusable: nothing sent.
    const before = calls.length;
    expect(await makeReusable(rap, 'r1', 'dsA')).toEqual({ converted: false });
    expect(sent(calls.slice(before))).toEqual(['getDatasourceList']);
  });

  it('passes the 403 on as refused when the source stays embedded', async () => {
    const { rap } = looker();
    const stubborn: Rap = {
      ...rap,
      call: async <T>(endpoint: string, body: unknown): Promise<T> => {
        if (endpoint === 'convertEmbeddedDatasource') throw new RapError(endpoint, 403, 'HTTP 403 PERMISSION_DENIED');
        return rap.call<T>(endpoint, body);
      },
    };
    await expect(makeReusable(stubborn, 'r1', 'dsA')).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('PERMISSION_DENIED') });
  });

  it('checks and grants the viewer email consent', async () => {
    const { rap, calls } = looker();
    expect(await hasViewerEmailConsent(rap, 'dsA')).toBe(false);
    await grantViewerEmailConsent(rap, 'dsA');
    expect(await hasViewerEmailConsent(rap, 'dsA')).toBe(true);
    expect(calls.map((c) => c.body)).toEqual([
      { parameter: { datasourceId: 'dsA', consentTypes: [1] } },
      { parameter: { consent: [{ consentType: 1, approval: 1 }], datasourceId: 'dsA' } },
      { parameter: { datasourceId: 'dsA', consentTypes: [1] } },
    ]);
  });
});

describe('sourceFields', () => {
  it('reads semantic types from the block, and dimension or metric from getSchema in the same round trip', async () => {
    const { rap, calls } = looker();
    expect(await sourceFields(rap, 'dsB', { reportId: 'r1' })).toEqual([
      { id: '_old_', name: 'old', dataType: 0, aggregation: 0, semanticType: 32, outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] } },
    ]);
    expect(sent(calls)).toEqual(['getBlockDatasource', 'getSchema']);

    const fresh = looker();
    fresh.sources.dsB!.published = fresh.sources.dsB!.draft!;
    expect(await sourceFields(fresh.rap, 'dsB', { reportId: 'r1' })).toEqual([
      { id: '_amount_', name: 'amount', dataType: 5, aggregation: 6, kind: 'metric', semanticType: 12, outputSemanticInfo: { semanticConfig: [{ semanticType: 12 }] } },
      { id: '_country_', name: 'country', dataType: 0, aggregation: 0, kind: 'dimension', semanticType: 32, outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] } },
    ]);
    expect(await sourceFields(fresh.rap, 'dsA')).toEqual([{ id: '_sessions_', name: 'sessions', dataType: 5, aggregation: 6, semanticType: 33, outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] } }]);
  });
});

describe('resolveSource', () => {
  it('finds a data source by alias or id without reading names, and by name case-insensitively', async () => {
    const { rap, report, calls } = looker();
    expect(await resolveSource(rap, report, 'DS2')).toMatchObject({ datasourceId: 'dsB', alias: 'ds2', name: 'Orders' });
    expect(calls[0]).toEqual({ endpoint: 'getBlockDatasource', body: { datasourceId: 'dsB' } });
    expect(sent(calls)).toEqual(['getBlockDatasource', 'getSchema', 'getDatasourceList']);
    expect(await resolveSource(rap, report, 'dsA')).toMatchObject({ alias: 'ds1' });
    expect(await resolveSource(rap, report, ' 4 demo ')).toMatchObject({ datasourceId: 'dsA', fields: [{ id: '_sessions_' }] });
  });

  it('gives each field its kind from getSchema in the same round trip', async () => {
    const { rap, report, sources } = looker();
    sources.dsB!.published = sources.dsB!.draft!;
    delete sources.dsB!.draft;
    expect((await resolveSource(rap, report, 'Orders')).fields).toEqual([
      { id: '_amount_', name: 'amount', dataType: 5, aggregation: 6, kind: 'metric', semanticType: 12, outputSemanticInfo: { semanticConfig: [{ semanticType: 12 }] } },
      { id: '_country_', name: 'country', dataType: 0, aggregation: 0, kind: 'dimension', semanticType: 32, outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] } },
    ]);
  });

  it('takes the only data source when none is named, and lists them otherwise', async () => {
    const { rap, report } = looker();
    await expect(resolveSource(rap, report)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('ds1 "4 Demo", ds2 "Orders"') });
    await expect(resolveSource(rap, report, 'Nothing')).rejects.toMatchObject({ code: 'not_found' });
    report.report.resource!.datasourceAlias = [{ datasourceId: 'dsB', alias: 'ds2' }];
    expect(await resolveSource(rap, report)).toMatchObject({ datasourceId: 'dsB', name: 'Orders' });
    report.report.resource!.datasourceAlias = [];
    await expect(resolveSource(rap, report)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('addBigQuerySource options', () => {
  it('adds date range and viewer email parameters to a custom query only', () => {
    const cfg: Json = connectorConfig({ sql: 'SELECT @DS_START_DATE', billingProject: 'bill' }, { dateRange: true, viewerEmail: true });
    const params = cfg.parameterConfiguration.parameters as Json[];
    expect(params.map((p) => p.key)).toEqual(['DS_START_DATE', 'DS_END_DATE', 'DS_USER_EMAIL']);
    expect(params[0]).toEqual({
      key: 'DS_START_DATE',
      value: {
        parametersModifiedByRoles: [
          { key: 1, value: { name: 'DS_START_DATE', dataType: 5, options: [], defaultValue: [{ label: 'DS_START_DATE', stringValue: '' }], lock: 2 } },
          { key: 2, value: { name: 'DS_START_DATE', dataType: 5, options: [], defaultValue: [{ label: 'DS_START_DATE', stringValue: '' }], lock: 2 } },
        ],
        parameterDisplayConfiguration: { name: 'DS_START_DATE', displayName: 'DS_START_DATE', displayType: 6 },
      },
    });
    expect(params[2]!.value.parametersModifiedByRoles[0].value.dataType).toBe(1);
    expect(params[2]!.value.parameterDisplayConfiguration.displayType).toBe(1);
    expect(() => connectorConfig({ projectId: 'p', datasetId: 'd', tableId: 't' }, { dateRange: true })).toThrow(/custom query/);
    expect(connectorConfig({ sql: 'SELECT 1', billingProject: 'b' }, {})).not.toHaveProperty('parameterConfiguration');
  });

  it('makes a reusable source with its name: no report, no claim, no alias', async () => {
    const calls: Array<{ endpoint: string; body: Json }> = [];
    const rap: Rap = {
      call: async <T>(endpoint: string, body: unknown): Promise<T> => {
        calls.push({ endpoint, body: body as Json });
        if (endpoint === 'getFirstPartyAccessToken') return { accessToken: 'tok' } as T;
        if (endpoint === 'getColumns') return { columns: [{ columnType: 1, mutableVersion: 1, outputName: 'n', field: { name: '_n_' } }] } as T;
        if (endpoint === 'createBlockDatasource') return { datasource: { datasourceId: 'dsR' } } as T;
        return {} as T;
      },
      callMany: async () => [],
    };
    const res = await addBigQuerySource(
      { rap, worker: { run: async <A, R>() => '123' as R }, session: new ReportSession(rap, { snapshots: false }) },
      null,
      { sql: 'SELECT @DS_USER_EMAIL AS v', billingProject: 'bill' },
      { name: '[lab] reusable', params: { viewerEmail: true } },
    );

    expect(sent(calls)).toEqual(['getFirstPartyAccessToken', 'getColumns', 'createBlockDatasource', 'publishDatasource']);
    expect(calls[1]!.body.connectorBlockConfig.connectorConfig.parameterConfiguration.parameters[0].key).toBe('DS_USER_EMAIL');
    expect(calls[2]!.body).not.toHaveProperty('reportId');
    expect(calls[2]!.body).toMatchObject({ name: '[lab] reusable', datasource: { datasourceBlock: { name: '[lab] reusable' } } });
    expect(calls[3]!.body).not.toHaveProperty('reportId');
    expect(res).toEqual({ datasourceId: 'dsR', alias: '', fields: [{ id: '_n_', name: 'n', dataType: 0, aggregation: 0 }] });
  });
});

describe('createReport', () => {
  it('makes a temporary report from the blank template, then keeps it', async () => {
    const calls: Array<{ endpoint: string; body: Json }> = [];
    const temp = {
      shareable: { id: 'tmp1', name: 'x' },
      page: [{ pageId: 'p0', page: { componentConfig: [] } }],
      report: { componentConfig: [], resource: { datasourceAlias: [] } },
    };
    const rap: Rap = {
      call: async <T>(endpoint: string, body: unknown): Promise<T> => {
        calls.push({ endpoint, body: body as Json });
        if (endpoint === 'createTempReport') return { reportConfig: temp } as T;
        if (endpoint === 'persistTempReport') return { reportConfig: { shareable: { id: 'new1', name: 'Sales' }, page: [] } } as T;
        return { reportConfig: { page: [{ pageId: 'p9' }] } } as T;
      },
      callMany: async () => [],
    };

    expect(await createReport(rap, '  Sales ')).toEqual({ reportId: 'new1', pageId: 'p9', name: 'Sales' });
    expect(sent(calls)).toEqual(['createTempReport', 'persistTempReport', 'getReport']);
    expect(calls[0]!.body).toMatchObject({ templateId: BLANK_TEMPLATE, reportTitle: 'Sales', creationType: 4, datasourceTemplateConfig: [], pluginParameters: [] });
    expect(calls[1]!.body).toMatchObject({ dyads: [], reportName: 'Sales', templateId: BLANK_TEMPLATE, reportRequest: { sourceReportId: 'tmp1' } });
    expect(calls[1]!.body.pageRequest).toEqual([expect.objectContaining({ pageId: 'p0', fieldMask: [4, 3, 5] })]);
    await expect(createReport(rap, ' ')).rejects.toMatchObject({ code: 'invalid' });
  });
});
