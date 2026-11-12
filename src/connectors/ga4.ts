import { LookerError } from '../core/errors.js';
import { RapError } from '../looker/rap.js';
import type { Column, ConnectorAdapter, Ga4Source, Json } from './types.js';

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}
function checked(source: Ga4Source): Ga4Source {
  if (!identifier(source.accountId) || !identifier(source.propertyId))
    throw new LookerError('invalid', 'GA4 requires numeric account_id and property_id strings. Use the property ID, not a G- measurement ID or a UA property/view ID.');
  return { accountId: source.accountId, propertyId: source.propertyId };
}
function meaningful(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === '' || value === 0) return false;
  if (Array.isArray(value)) return value.some(meaningful);
  if (typeof value === 'object') return Object.values(value).some(meaningful);
  return true;
}

/** Read only the property connection this adapter can recreate. UA views,
 * segments and unknown meaningful options must not be silently discarded. */
export function ga4Config(config: Json | undefined): Ga4Source | undefined {
  const ga = config?.googleAnalyticsConnectorConfig;
  if (config?.datasourceType !== 1 || !ga || ga.isEnhanced !== true || meaningful(ga.viewId)
    || !identifier(ga.accountId) || !identifier(ga.propertyId)
    || (ga.analyticsSegment != null && (!Array.isArray(ga.analyticsSegment) || ga.analyticsSegment.length > 0))
    || config.useDatetimeType === false) return undefined;
  const gaKeys = new Set(['accountId', 'propertyId', 'isEnhanced', 'viewId', 'meta', 'analyticsSegment']);
  const configKeys = new Set(['datasourceType', 'googleAnalyticsConnectorConfig', 'useDatetimeType']);
  if (Object.entries(ga).some(([key, value]) => !gaKeys.has(key) && meaningful(value))
    || Object.entries(config).some(([key, value]) => !configKeys.has(key) && meaningful(value))) return undefined;
  return { accountId: ga.accountId, propertyId: ga.propertyId };
}

export const ga4Connector = {
  id: 'ga4', label: 'Google Analytics 4', oauthType: 1,
  listing: {
    id: 'ga4', supported: true, modes: ['property'],
    create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list',
    note: 'Needs explicit account and property IDs, property access and Google Analytics connector authorization in the signed-in Looker Studio account. Fields and available metric combinations depend on the property; Data API quotas apply. UA views and GA4 segments are not supported.',
  },
  matches: (config: Json | undefined) => config?.datasourceType === 1
    && config.googleAnalyticsConnectorConfig?.isEnhanced === true
    && !meaningful(config.googleAnalyticsConnectorConfig?.viewId),
  defaultName: (source: Ga4Source) => `GA4 property ${checked(source).propertyId}`,
  buildConfig(source: Ga4Source, params = {}) {
    if (Object.values(params).some(Boolean)) throw new LookerError('invalid', 'GA4 property connections do not accept BigQuery date-range or viewer-email query parameters.');
    const ids = checked(source);
    return { datasourceType: 1, useDatetimeType: true, googleAnalyticsConnectorConfig: {
      accountId: ids.accountId, propertyId: ids.propertyId, isEnhanced: true,
    } };
  },
  async loadColumns(deps, connectorBlockConfig) {
    if (!ga4Config(connectorBlockConfig?.connectorConfig))
      throw new LookerError('invalid', 'This GA4 connection has unsupported property settings. Use a GA4 property without a UA view or segment configuration.');
    try {
      const projectNumber = await deps.worker.run(
        () => (window as unknown as { preload?: { myDataStudioConfig?: { projectNumber?: string } } }).preload?.myDataStudioConfig?.projectNumber ?? '', null,
      );
      const { accessToken } = await deps.rap.call<{ accessToken: string }>('getFirstPartyAccessToken', {});
      const result = await deps.rap.call<{ columns?: Column[] }>('getColumns', {
        connectorBlockConfig, isBigQueryConnection: false, useThirdpartyAuth: false,
        projectNumber, googleAuthOAuthToken: accessToken,
      });
      const columns = result?.columns;
      if (!Array.isArray(columns) || !columns.some(column => column.columnType === 1 && typeof column.field?.name === 'string'))
        throw new LookerError('invalid', 'GA4 returned no usable fields. Check the selected account/property IDs, property access and Google Analytics connector authorization.');
      return { columns, projectNumber, accessToken };
    } catch (error) {
      if (error instanceof RapError && [401, 403].includes(error.status))
        throw new LookerError('refused', 'GA4 access was refused. The signed-in Looker Studio account must have access to the selected property and authorize the Google Analytics connector. No authorization was granted by this tool.');
      if (error instanceof RapError && error.status === 429)
        throw new LookerError('refused', 'GA4 temporarily refused the request because of a request or quota limit. Wait for the limit to recover before retrying.');
      throw error;
    }
  },
  linkParams(source: Ga4Source): Record<string, string> {
    const ids = checked(source);
    return { connector: 'googleAnalytics', accountId: ids.accountId, propertyId: ids.propertyId, refreshFields: 'true' };
  },
} satisfies ConnectorAdapter<Ga4Source, 'ga4'>;
