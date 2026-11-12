import { describe, expect, it, vi } from 'vitest';

import { ga4Config, ga4Connector } from '../src/connectors/ga4.js';
import type { ConnectorDeps, Ga4Source, Json } from '../src/connectors/types.js';
import { RapError, type Rap } from '../src/looker/rap.js';

const source: Ga4Source = { accountId: '123450', propertyId: '678900' };
const token = 'fake-test-token';
function connection(answer: (endpoint: string, body: Json) => unknown) {
  const calls: Array<{ endpoint: string; body: Json }> = [];
  const rap: Rap = {
    call: async <T>(endpoint: string, body: unknown): Promise<T> => {
      calls.push({ endpoint, body: body as Json });
      if (endpoint === 'getFirstPartyAccessToken') return { accessToken: token } as T;
      return answer(endpoint, body as Json) as T;
    },
    callMany: async () => { throw new Error('No unscoped account or property enumeration expected'); },
  };
  const run = vi.fn(async () => 'synthetic-project-number');
  return { calls, deps: { rap, worker: { run } } as unknown as ConnectorDeps, run };
}

describe('GA4 property connector', () => {
  it('uses the GA4 native property configuration without UA view IDs or credentials', () => {
    const config = ga4Connector.buildConfig(source);
    expect(config).toEqual({ datasourceType: 1, useDatetimeType: true, googleAnalyticsConnectorConfig: { ...source, isEnhanced: true } });
    expect(ga4Config(config)).toEqual(source);
    expect(JSON.stringify(config)).not.toMatch(/accessToken|viewId|googleAuthOAuthToken/);
    expect(ga4Connector.oauthType).toBe(1);
  });

  it.each(['', '0', 'G-ABC123', 'UA-12345-1', '123.5', ' 123', '1e3'])('rejects invalid property ID %j', propertyId => {
    expect(() => ga4Connector.buildConfig({ ...source, propertyId })).toThrow(/numeric account_id and property_id/);
  });

  it('requires a numeric account ID and rejects query parameters', () => {
    expect(() => ga4Connector.buildConfig({ ...source, accountId: '' })).toThrow();
    expect(() => ga4Connector.buildConfig(source, { dateRange: true })).toThrow(/parameters/);
    expect(() => ga4Connector.buildConfig(source, { viewerEmail: true })).toThrow(/parameters/);
  });

  it('does not classify Universal Analytics as GA4', () => {
    const config = ga4Connector.buildConfig(source);
    expect(ga4Connector.matches(config)).toBe(true);
    expect(ga4Connector.matches({ ...config, googleAnalyticsConnectorConfig: { ...source, viewId: '111', isEnhanced: false } })).toBe(false);
    expect(ga4Connector.matches({ ...config, googleAnalyticsConnectorConfig: { ...source, viewId: '111', isEnhanced: true } })).toBe(false);
    expect(ga4Connector.matches({ datasourceType: 8 })).toBe(false);
  });

  it('refuses to flatten unsupported native segments or connection settings during export', () => {
    const config = ga4Connector.buildConfig(source);
    expect(ga4Config({ ...config, googleAnalyticsConnectorConfig: { ...config.googleAnalyticsConnectorConfig, meta: { propertyName: 'Synthetic property' }, analyticsSegment: [] } })).toEqual(source);
    for (const extra of [{ analyticsSegment: [{}] }, { analyticsSegment: ['segment'] }, { comparison: { filter: 'nonempty' } }, { viewId: '111' }])
      expect(ga4Config({ ...config, googleAnalyticsConnectorConfig: { ...config.googleAnalyticsConnectorConfig, ...extra } })).toBeUndefined();
    expect(ga4Config({ ...config, useDatetimeType: false })).toBeUndefined();
    expect(ga4Config({ ...config, parameterConfiguration: { parameters: ['not-supported'] } })).toBeUndefined();
  });

  it('loads property fields through the signed-in connector without enumerating accounts or publishing', async () => {
    const columns = [
      { columnType: 1, mutableVersion: '1', field: { name: 'date' }, outputName: 'Date', dataType: 5 },
      { columnType: 1, mutableVersion: '1', field: { name: 'activeUsers' }, outputName: 'Active users', defaultAggregationType: 7 },
    ];
    const c = connection(() => ({ columns }));
    const config = { connectorConfig: ga4Connector.buildConfig(source) };
    const loaded = await ga4Connector.loadColumns(c.deps, config);
    expect(loaded.columns).toEqual(columns);
    expect(loaded.columns[1]?.defaultAggregationType).toBe(7);
    expect(c.calls.map(call => call.endpoint)).toEqual(['getFirstPartyAccessToken', 'getColumns']);
    expect(c.calls[1]?.body).toEqual({ connectorBlockConfig: config, isBigQueryConnection: false, useThirdpartyAuth: false,
      projectNumber: 'synthetic-project-number', googleAuthOAuthToken: token });
    expect(loaded.accessToken).toBe(token);
  });

  it.each([{}, { columns: [] }, { columns: [{ columnType: 2, field: { name: 'privateOnly' } }] }])('does not accept missing usable fields: %j', async response => {
    const c = connection(() => response);
    await expect(ga4Connector.loadColumns(c.deps, { connectorConfig: ga4Connector.buildConfig(source) })).rejects.toThrow(/no usable fields/);
  });

  it('refuses unsupported native settings before requesting an access token', async () => {
    const c = connection(() => ({}));
    await expect(ga4Connector.loadColumns(c.deps, { connectorConfig: { datasourceType: 1, googleAnalyticsConnectorConfig: { ...source, isEnhanced: false } } })).rejects.toThrow(/unsupported property settings/);
    expect(c.calls).toEqual([]);
  });

  it('gives an actionable access refusal without returning server credentials', async () => {
    const c = connection(() => { throw new RapError('getColumns', 403, 'secret response omitted'); });
    await expect(ga4Connector.loadColumns(c.deps, { connectorConfig: ga4Connector.buildConfig(source) })).rejects.toThrow(/GA4 access was refused/);
  });

  it('keeps the documented linking identity distinct from a UA view', () => {
    expect(ga4Connector.linkParams(source)).toEqual({ connector: 'googleAnalytics', ...source, refreshFields: 'true' });
  });
});
