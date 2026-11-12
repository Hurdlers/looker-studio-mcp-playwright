import { describe, expect, it, vi } from 'vitest';

import { findConnector, listConnectors, readConnectorColumns, requireConnector } from '../src/connectors/registry.js';
import type { ConnectorAdapter, ConnectorDeps, ConnectorSource, Json } from '../src/connectors/types.js';
import { addDataSource, addSourceWithConnector } from '../src/core/datasource.js';
import { ReportSession } from '../src/core/session.js';
import { RapError, type Rap } from '../src/looker/rap.js';

function connection(answer: (endpoint: string, body: Json) => unknown) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: body as Json });
      return answer(endpoint, body as Json) as T;
    },
    callMany: async () => [],
  };
  const run = vi.fn(async () => 'project-number');
  const deps: ConnectorDeps = { rap, worker: { run } as ConnectorDeps['worker'] };
  return { calls, deps, run };
}

describe('connector registry', () => {
  it('advertises installed adapters and keeps unavailable connectors separate', () => {
    const expected = [
      { id: 'bigquery', supported: true, modes: ['table', 'view', 'custom_sql'], create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list', note: 'A billing project and access to the selected data are required.' },
      { id: 'google_sheets', supported: true, modes: ['worksheet', 'range'], create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list', note: 'The signed-in Looker Studio account needs spreadsheet access and Google Sheets connector authorization.' },
      { id: 'ga4', supported: true, modes: ['property'], create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list', note: 'Needs explicit account and property IDs, property access and Google Analytics connector authorization in the signed-in Looker Studio account. Fields and available metric combinations depend on the property; Data API quotas apply. UA views and GA4 segments are not supported.' },
      { id: 'google_ads', supported: false },
    ];
    expect(listConnectors()).toEqual(expected);
    for (const entry of listConnectors()) {
      if (entry.supported) expect(requireConnector(entry.id).id).toBe(entry.id);
      else expect(() => requireConnector(entry.id)).toThrow(`Connector "${entry.id}" is not supported`);
    }
    const changed = listConnectors();
    changed[0]!.modes!.push('unimplemented');
    expect(listConnectors()).toEqual(expected);
  });

  it('keeps the default and explains available connectors on errors', () => {
    expect(requireConnector()).toBe(requireConnector('bigquery'));
    expect(() => requireConnector('postgresql')).toThrow('Connector "postgresql" is not supported. Available connectors: BigQuery, Google Sheets and GA4.');
    expect(findConnector({ datasourceType: 2 })).toBe(requireConnector());
    expect(findConnector({ datasourceType: '2' })).toBeUndefined();
    expect(findConnector({ bigQueryConnectorConfig: {} })).toBeUndefined();
    expect(findConnector(undefined)).toBeUndefined();
    expect(findConnector({ datasourceType: 1, googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: '789012', isEnhanced: true } })).toBe(requireConnector('ga4'));
    expect(findConnector({ datasourceType: 1, googleAnalyticsConnectorConfig: { accountId: '123456', propertyId: 'UA-123456-1', viewId: '789012' } })).toBeUndefined();
  });

  it('refuses an unsupported native connection before browser access or authentication', async () => {
    const c = connection(() => { throw new Error('must not call'); });
    await expect(readConnectorColumns(c.deps, { connectorConfig: { datasourceType: 3 } }))
      .rejects.toThrow('Only BigQuery, Google Sheets and GA4 data sources can be read again from their connection.');
    expect(c.calls).toEqual([]);
    expect(c.run).not.toHaveBeenCalled();
  });

  it('retains the column request flags, order and metadata without returning authentication', async () => {
    const columns = [{ columnType: 1, mutableVersion: 1, field: { name: '_amount_' }, dataType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 12 }] } }];
    const c = connection((endpoint) => endpoint === 'getFirstPartyAccessToken' ? { accessToken: 'fake-test-token' } : { columns });
    const block = { alias: 't0', connectorConfig: { datasourceType: 2, sql: 'SELECT 1' }, useDatetimeType: true };
    const result = await readConnectorColumns(c.deps, block);
    expect(c.calls).toEqual([
      { endpoint: 'getFirstPartyAccessToken', body: {} },
      { endpoint: 'getColumns', body: { connectorBlockConfig: block, isBigQueryConnection: true, useThirdpartyAuth: false, projectNumber: 'project-number', googleAuthOAuthToken: 'fake-test-token' } },
    ]);
    expect(result).toEqual(columns);
    expect(JSON.stringify(result)).not.toContain('fake-test-token');
  });

  it('keeps empty column responses and propagates connection errors without writes', async () => {
    const c = connection((endpoint) => endpoint === 'getFirstPartyAccessToken' ? { accessToken: 'fake-test-token' } : {});
    expect(await readConnectorColumns(c.deps, { connectorConfig: { datasourceType: 2 } })).toEqual([]);
    const failure = new RapError('getColumns', 403, 'access denied');
    const failing = connection((endpoint) => {
      if (endpoint === 'getFirstPartyAccessToken') return { accessToken: 'fake-test-token' };
      throw failure;
    });
    await expect(addDataSource({ ...failing.deps, session: new ReportSession(failing.deps.rap) }, null, { connector: 'bigquery', source: { sql: 'SELECT 1', billingProject: 'example' } })).rejects.toBe(failure);
    expect(failing.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns']);
  });

  it('generic creation preserves reusable-source fields and omits report binding and token from its result', async () => {
    const c = connection((endpoint, body) => {
      if (endpoint === 'getFirstPartyAccessToken') return { accessToken: 'fake-test-token' };
      if (endpoint === 'getColumns') return { columns: [{ columnType: 1, mutableVersion: 1, outputName: 'amount', field: { name: '_amount_' }, dataType: 1, defaultAggregationType: 1, outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] } }] };
      if (endpoint === 'createBlockDatasource') return { datasource: { ...body.datasource, datasourceId: 'created-source' } };
      return {};
    });
    const result = await addDataSource({ ...c.deps, session: new ReportSession(c.deps.rap) }, null, { connector: 'bigquery', source: { projectId: 'example', datasetId: 'data', tableId: 'orders' } });
    expect(c.calls.map((call) => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns', 'createBlockDatasource', 'publishDatasource']);
    expect(c.calls[2]!.body).toMatchObject({ name: 'orders', oauthType: 1, datasource: { blocks: [{ name: 'BigQuery' }], datasourceBlock: { fields: [{ field: { name: '_amount_', simpleName: '_amount_' } }] } } });
    expect(c.calls[2]!.body).not.toHaveProperty('reportId');
    expect(c.calls[3]!.body).not.toHaveProperty('reportId');
    expect(result).toMatchObject({ datasourceId: 'created-source', alias: '', fields: [{ id: '_amount_', name: 'amount', dataType: 1, aggregation: 1, semanticType: 33 }] });
    expect(JSON.stringify(result)).not.toContain('fake-test-token');
  });

  it('generic creation refuses an unavailable connector before any effect', async () => {
    const c = connection(() => { throw new Error('must not call'); });
    const unavailable = { connector: 'mysql', source: {} } as unknown as ConnectorSource;
    await expect(addDataSource({ ...c.deps, session: new ReportSession(c.deps.rap) }, 'report', unavailable)).rejects.toThrow('not supported');
    expect(c.calls).toEqual([]);
    expect(c.run).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: 'example', datasetId: 'data', tableId: 'events' },
    { sql: 'SELECT CURRENT_DATE() AS day', billingProject: 'example' },
  ])('requests native dates at the connector level and preserves their metadata for %j', async (source) => {
    const semantic = { semanticConfig: [{ semanticType: 2, dateTimeOptions: { useNativeDateTime: true } }] };
    const c = connection((endpoint, body) => {
      if (endpoint === 'getFirstPartyAccessToken') return { accessToken: 'fake-test-token' };
      if (endpoint === 'getColumns') {
        expect(body.connectorBlockConfig.connectorConfig.useDatetimeType).toBe(true);
        return { columns: [{ columnType: 1, field: { name: '_day_' }, outputName: 'day', outputSemanticInfo: semantic }] };
      }
      if (endpoint === 'createBlockDatasource') {
        expect(body.datasource.blocks[0].connectorBlockConfig.connectorConfig.useDatetimeType).toBe(true);
        expect(body.datasource.datasourceBlock.fields[0].outputSemanticInfo).toEqual(semantic);
        return { datasource: { ...body.datasource, datasourceId: 'native-date-source' } };
      }
      return {};
    });
    const result = await addDataSource({ ...c.deps, session: new ReportSession(c.deps.rap) }, null, { connector: 'bigquery', source });
    expect(result.fields[0]!.outputSemanticInfo).toEqual(semantic);
  });

  it('runs the same creation lifecycle for a non-SQL adapter without BigQuery authentication or settings', async () => {
    const c = connection((endpoint, body) => {
      if (endpoint === 'createBlockDatasource') return { datasource: { ...body.datasource, datasourceId: 'alternate-source' } };
      if (endpoint === 'publishDatasource') return {};
      throw new Error(`Unexpected built-in connector call: ${endpoint}`);
    });
    const alternate: ConnectorAdapter<{ collection: string }, 'test-collection'> = {
      id: 'test-collection', label: 'Test collection', oauthType: 7,
      listing: { id: 'test-collection', supported: true, modes: ['collection'] },
      matches: (config) => config?.datasourceType === 999,
      defaultName: (source) => source.collection,
      buildConfig: (source) => ({ datasourceType: 999, collection: source.collection }),
      loadColumns: async (_deps, block) => {
        expect(block.connectorConfig).toEqual({ datasourceType: 999, collection: 'Events' });
        return {
          columns: [{ columnType: 1, field: { name: 'event_name' }, outputName: 'Event', dataType: 2 }],
          projectNumber: 'alternate-project', accessToken: 'alternate-test-token',
        };
      },
    };
    const result = await addSourceWithConnector({ ...c.deps, session: new ReportSession(c.deps.rap) }, null, alternate, { collection: 'Events' });
    expect(alternate.query).toBeUndefined();
    expect(alternate.linkParams).toBeUndefined();
    expect(c.run).not.toHaveBeenCalled();
    expect(c.calls.map((call) => call.endpoint)).toEqual(['createBlockDatasource', 'publishDatasource']);
    expect(c.calls[0]!.body).toMatchObject({ name: 'Events', oauthType: 7, uiCreateOptions: { projectNumber: 'alternate-project' }, datasource: { blocks: [{ name: 'Test collection', connectorBlockConfig: { connectorConfig: { datasourceType: 999, collection: 'Events' } } }] } });
    expect(JSON.stringify(c.calls)).not.toContain('bigQuery');
    expect(result).toMatchObject({ datasourceId: 'alternate-source', alias: '', fields: [{ id: 'event_name', name: 'Event' }] });
    expect(JSON.stringify(result)).not.toContain('alternate-test-token');
  });

});
