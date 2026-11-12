import { LookerError } from '../core/errors.js';
import type { BigQuerySource, Column, ConnectorAdapter, Json, SourceParams } from './types.js';

function buildConfig(source: BigQuerySource, params: SourceParams = {}): Json {
  if ((params.dateRange || params.viewerEmail) && !('sql' in source))
    throw new LookerError('invalid', 'Date range and viewer email parameters need a custom query (sql): a table cannot use them.');
  if ('sql' in source)
    // The query sits beside the BigQuery settings, not inside them.
    return {
      datasourceType: 2,
      useDatetimeType: true,
      bigQueryConnectorConfig: {
        projectId: source.billingProject,
        billingProjectId: source.billingProject,
        sqlType: 2,
        meta: { projectName: source.billingProject, isSharedProject: false },
      },
      sql: source.sql,
      ...(params.dateRange || params.viewerEmail
        ? {
            parameterConfiguration: {
              parameters: [
                ...(params.dateRange ? [connectorParam('DS_START_DATE', 5, 6), connectorParam('DS_END_DATE', 5, 6)] : []),
                ...(params.viewerEmail ? [connectorParam('DS_USER_EMAIL', 1, 1)] : []),
              ],
            },
          }
        : {}),
    };
  return {
    datasourceType: 2,
    useDatetimeType: true,
    bigQueryConnectorConfig: {
      meta: {
        projectName: source.projectId,
        isSharedProject: false,
        datasetName: source.datasetId,
        tableName: source.tableId,
      },
      sqlType: 2,
      projectId: source.projectId,
      datasetId: source.datasetId,
      tableId: source.tableId,
      isPartitioned: false,
      isSemanticGraph: false,
      tableLabels: [],
    },
  };
}

// A connector parameter as the editor's checkboxes add it, the same for
// editors (role 1) and viewers (role 2).
function connectorParam(name: string, dataType: number, displayType: number): Json {
  const value = { name, dataType, options: [], defaultValue: [{ label: name, stringValue: '' }], lock: 2 };
  return {
    key: name,
    value: {
      parametersModifiedByRoles: [
        { key: 1, value },
        { key: 2, value: structuredClone(value) },
      ],
      parameterDisplayConfiguration: { name, displayName: name, displayType },
    },
  };
}

export const bigQueryConnector = {
  id: 'bigquery',
  label: 'BigQuery',
  oauthType: 1,
  listing: {
    id: 'bigquery', supported: true, modes: ['table', 'view', 'custom_sql'],
    create_tool: 'report_create', add_tool: 'datasource_add', fields_tool: 'datasource_list',
    note: 'A billing project and access to the selected data are required.',
  },
  matches: (config) => config?.datasourceType === 2,
  defaultName: (source) => 'sql' in source ? 'Custom query' : source.tableId,
  buildConfig,
  async loadColumns(deps, connectorBlockConfig) {
    const projectNumber = await deps.worker.run(
      () => (window as unknown as { preload?: { myDataStudioConfig?: { projectNumber?: string } } }).preload?.myDataStudioConfig?.projectNumber ?? '',
      null,
    );
    const { accessToken } = await deps.rap.call<{ accessToken: string }>('getFirstPartyAccessToken', {});
    const { columns = [] } = await deps.rap.call<{ columns?: Column[] }>('getColumns', {
      connectorBlockConfig,
      isBigQueryConnection: true,
      useThirdpartyAuth: false,
      projectNumber,
      googleAuthOAuthToken: accessToken,
    });
    return { columns, projectNumber, accessToken };
  },
  linkParams(source) {
    return 'sql' in source
      ? { connector: 'bigQuery', type: 'CUSTOM_QUERY', projectId: source.billingProject, sql: source.sql }
      : { connector: 'bigQuery', type: 'TABLE', projectId: source.projectId, datasetId: source.datasetId, tableId: source.tableId };
  },
  query: {
    settings(config) {
      const keys = new Set((config.parameterConfiguration?.parameters ?? []).map((p: Json) => String(p.key)));
      const bq = config.bigQueryConnectorConfig ?? {};
      const project = bq.billingProjectId || bq.projectId;
      return {
        params: { dateRange: keys.has('DS_START_DATE') || keys.has('DS_END_DATE'), viewerEmail: keys.has('DS_USER_EMAIL') },
        ...(project ? { project } : {}),
      };
    },
    replaceSql(config, sql, project) {
      config.sql = sql;
      if (project) {
        const bq = (config.bigQueryConnectorConfig ??= {});
        bq.projectId = project;
        bq.billingProjectId = project;
        bq.meta = { ...(bq.meta ?? {}), projectName: project };
      }
    },
  },
} satisfies ConnectorAdapter<BigQuerySource, 'bigquery'>;
