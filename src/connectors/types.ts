import type { WorkerTab } from '../browser/worker.js';
import type { Rap } from '../looker/rap.js';

export type Json = Record<string, any>;

export type BigQuerySource =
  | { projectId: string; datasetId: string; tableId: string }
  | { sql: string; billingProject: string };

export interface SheetsSource {
  spreadsheetId: string;
  worksheetId?: string;
  worksheet?: string;
  hasHeader: boolean;
  includeHiddenAndFiltered: boolean;
  range?: string;
}

export interface Ga4Source { accountId: string; propertyId: string; }

export type ConnectorSource = { connector: 'bigquery'; source: BigQuerySource }
  | { connector: 'google_sheets'; source: SheetsSource }
  | { connector: 'ga4'; source: Ga4Source };

// Custom-query inputs supplied by Looker Studio: YYYYMMDD date bounds and
// the signed-in viewer email. Email access still needs its separate consent.
export interface SourceParams {
  dateRange?: boolean;
  viewerEmail?: boolean;
}

export interface Column extends Json {
  columnType?: number;
  mutableVersion?: unknown;
  outputName?: string;
  dataType?: number;
  defaultAggregationType?: number;
  textFormula?: string;
  field: { ns?: string; name: string; simpleName?: string };
}

export interface ConnectorDeps {
  rap: Rap;
  worker: Pick<WorkerTab, 'run'>;
}

// The token is an internal, short-lived value. Never put this object in a
// tool result, an audit entry, or a stored connection definition.
export interface LoadedColumns {
  columns: Column[];
  projectNumber: string;
  accessToken: string;
}

export interface ConnectorListing {
  id: string;
  supported: boolean;
  modes?: string[];
  create_tool?: string;
  add_tool?: string;
  fields_tool?: string;
  note?: string;
}

// Connector-specific native settings and authentication stay here; the
// report lifecycle and field reconciliation do not depend on their shape.
export interface ConnectorAdapter<TSource, TId extends string = string> {
  readonly id: TId;
  readonly label: string;
  readonly oauthType: number;
  readonly listing: ConnectorListing;
  matches(config: Json | undefined): boolean;
  defaultName(source: TSource): string;
  buildConfig(source: TSource, params?: SourceParams): Json;
  loadColumns(deps: ConnectorDeps, connectorBlockConfig: Json): Promise<LoadedColumns>;
  linkParams?(source: TSource): Record<string, string>;
  query?: {
    settings(config: Json): { params: SourceParams; project?: string };
    replaceSql(config: Json, sql: string, project?: string): void;
  };
}
