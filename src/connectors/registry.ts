import { LookerError } from '../core/errors.js';
import { bigQueryConnector } from './bigquery.js';
import { ga4Connector } from './ga4.js';
import { prepareSheetsSource, sheetsConnector } from './sheets.js';
import type { Column, ConnectorDeps, ConnectorListing, ConnectorSource, Json, SourceParams } from './types.js';

const registry = { bigquery: bigQueryConnector, google_sheets: sheetsConnector, ga4: ga4Connector };
type InstalledConnector = (typeof registry)[keyof typeof registry];
const adapters = Object.values(registry);
const unavailable = ['google_ads'] as const;

export function requireConnector(): typeof bigQueryConnector;
export function requireConnector<K extends keyof typeof registry>(id: K): (typeof registry)[K];
export function requireConnector(id: string | undefined): InstalledConnector;
export function requireConnector(id = 'bigquery'): InstalledConnector {
  const adapter = adapters.find((candidate) => candidate.id === id);
  if (adapter) return adapter;
  throw new LookerError(
    'invalid',
    `Connector "${id}" is not supported. Available connectors: BigQuery, Google Sheets and GA4.`,
  );
}

export function findConnector(config: Json | undefined): InstalledConnector | undefined {
  return adapters.find((adapter) => adapter.matches(config));
}

export function listConnectors(): ConnectorListing[] {
  return [
    ...adapters.map((adapter) => structuredClone(adapter.listing)),
    ...unavailable.filter((id) => !adapters.some((adapter) => String(adapter.id) === id)).map((id) => ({ id, supported: false })),
  ];
}

export async function readConnectorColumns(deps: ConnectorDeps, connectorBlockConfig: Json): Promise<Column[]> {
  const adapter = findConnector(connectorBlockConfig?.connectorConfig);
  if (!adapter) throw new LookerError('invalid', 'Only BigQuery, Google Sheets and GA4 data sources can be read again from their connection.');
  return (await adapter.loadColumns(deps, connectorBlockConfig)).columns;
}

export async function prepareConnection(deps: ConnectorDeps, connection: ConnectorSource): Promise<ConnectorSource> {
  return connection.connector === 'google_sheets'
    ? { connector: 'google_sheets', source: await prepareSheetsSource(deps, connection.source) } : connection;
}

export function buildConnectionConfig(connection: ConnectorSource, params?: SourceParams): Json {
  switch (connection.connector) {
    case 'bigquery': return bigQueryConnector.buildConfig(connection.source, params);
    case 'google_sheets': return sheetsConnector.buildConfig(connection.source, params);
    case 'ga4': return ga4Connector.buildConfig(connection.source, params);
  }
}

export function linkConnectionParams(connection: ConnectorSource): Record<string, string> {
  switch (connection.connector) {
    case 'bigquery': return bigQueryConnector.linkParams(connection.source);
    case 'google_sheets': return sheetsConnector.linkParams(connection.source);
    case 'ga4': return ga4Connector.linkParams(connection.source);
  }
}
