import { z } from 'zod';

import { grantViewerEmailConsent, hasViewerEmailConsent, type BigQuerySource, type SourceParams } from '../../core/datasource.js';
import { LookerError } from '../../core/errors.js';
import type { ToolContext } from '../../core/tool.js';
import { buildConnectionConfig, prepareConnection, requireConnector } from '../../connectors/registry.js';
import type { ConnectorSource, Ga4Source, SheetsSource } from '../../connectors/types.js';
import { DATABASE_FIELDS, parseSheetsInput, sheetsInput } from '../../connectors/sheets-input.js';
import { ga4Input, parseGa4Input, rejectGa4Inputs } from '../../connectors/ga4-input.js';
import { checkParams, checkSelect, defaultProject, dryRunQuery, usedParams } from '../../connectors/bigquery-query.js';

const FOREIGN = ['spreadsheet', 'worksheet', 'worksheet_id', 'range', 'use_first_row_as_headers', 'include_hidden_and_filtered_cells', 'host', 'port', 'database', 'user', 'password', 'ssl'] as const;
export const sourceInput = {
  connector: z.string().optional().describe('연결 종류: bigquery(기본값), google_sheets 또는 ga4.'),
  project_id: z.string().optional().describe('테이블의 프로젝트 또는 쿼리를 실행할 청구 프로젝트. 생략하면 설정값을 씁니다.'),
  dataset_id: z.string().optional().describe('테이블이나 뷰의 데이터셋.'),
  table_id: z.string().optional().describe('테이블이나 뷰 이름. sql과 함께 쓸 수 없습니다.'),
  sql: z.string().optional().describe('테이블 대신 연결할 SELECT 또는 WITH 쿼리 한 개.'),
  source_name: z.string().optional().describe('새 데이터 소스의 이름.'),
  date_range_params: z.boolean().optional().describe('쿼리에 날짜 범위 매개변수 두 개를 전달합니다.'),
  viewer_email_param: z.boolean().optional().describe('쿼리에 보는 사람의 이메일을 전달합니다. 각 사용자의 동의가 필요합니다.'),
  ...sheetsInput,
  ...ga4Input,
  ...Object.fromEntries(DATABASE_FIELDS.map((key) => [key, z.unknown().optional().describe('지원하지 않는 연결의 입력입니다. 지정하면 거부합니다.')])) as Record<(typeof DATABASE_FIELDS)[number], z.ZodOptional<z.ZodUnknown>>,
};

export type SourceInput = z.infer<z.ZodObject<typeof sourceInput>>;
export interface SourcePlan {
  source: BigQuerySource | SheetsSource | Ga4Source;
  connection: ConnectorSource;
  params: SourceParams;
  name: string;
  explicitName: boolean;
}

export function nameOf(value: string, what: string): string {
  const name = value.trim();
  if (!name) throw new LookerError('invalid', `${what} cannot be empty: give a name.`);
  return name;
}

export function checkConnector(input: SourceInput, linking = false): void {
  try {
    requireConnector(input.connector);
  } catch (error) {
    if (linking && error instanceof LookerError)
      throw new LookerError('invalid', `${error.message} report_create and datasource_add support BigQuery, Google Sheets and Google Analytics 4.`);
    throw error;
  }
  if (input.connector === 'ga4') { parseGa4Input(input); return; }
  rejectGa4Inputs(input);
  if (input.connector === 'google_sheets') return;
  const foreign = FOREIGN.filter((key) => input[key] !== undefined);
  if (foreign.length) throw new LookerError('invalid', `${foreign.join(', ')} are not BigQuery inputs: remove them.`);
}

// Validate the complete connection before making a report or a copy.
export async function planSource(ctx: ToolContext, input: SourceInput, linking = false): Promise<SourcePlan> {
  checkConnector(input, linking);
  if (input.connector === 'ga4') {
    const source = parseGa4Input(input), name = input.source_name === undefined ? 'Google Analytics 4' : nameOf(input.source_name, 'source_name');
    const connection = { connector: 'ga4' as const, source };
    if (!linking) await requireConnector('ga4').loadColumns(ctx, { alias: 't0', connectorConfig: buildConnectionConfig(connection), useDatetimeType: true });
    return { source, connection, params: {}, name, explicitName: input.source_name !== undefined };
  }
  if (input.connector === 'google_sheets') {
    const parsed = parseSheetsInput(input, linking);
    const requestedName = input.source_name === undefined ? undefined : nameOf(input.source_name, 'source_name');
    const connection = linking ? { connector: 'google_sheets' as const, source: parsed } : await prepareConnection(ctx, { connector: 'google_sheets', source: parsed });
    if (connection.connector !== 'google_sheets') throw new LookerError('invalid', 'Google Sheets preparation returned another connector.');
    const source = connection.source;
    // Check range/header usability before creating a report. Creation reads
    // again with fresh authentication; no token or column cache is retained.
    if (!linking) await requireConnector('google_sheets').loadColumns(ctx, { alias: 't0', connectorConfig: buildConnectionConfig(connection), useDatetimeType: true });
    const name = requestedName ?? (source.worksheet || 'Spreadsheet');
    return { source, connection, params: {}, name, explicitName: input.source_name !== undefined };
  }
  const sql = input.sql === undefined ? undefined : nameOf(input.sql, 'sql');
  const table = input.dataset_id !== undefined || input.table_id !== undefined;
  if (sql && table) throw new LookerError('invalid', 'Use sql or dataset_id with table_id, never both.');
  if (!sql && !(input.dataset_id?.trim() && input.table_id?.trim()))
    throw new LookerError('invalid', 'Give dataset_id and table_id, or sql for a custom query.');
  if (!sql && ['date_range_params', 'viewer_email_param'].some((key) => input[key as keyof SourceInput] !== undefined))
    throw new LookerError('invalid', 'A table source cannot take query options: leave out date_range_params and viewer_email_param.');
  if (linking && !sql && input.source_name !== undefined) throw new LookerError('invalid', 'For a table link, use name instead of source_name.');
  if (input.source_name !== undefined) nameOf(input.source_name, 'source_name');
  const params: SourceParams = { ...(input.date_range_params ? { dateRange: true } : {}), ...(input.viewer_email_param ? { viewerEmail: true } : {}) };
  if (sql) {
    checkSelect(sql);
    if (linking && (params.dateRange || params.viewerEmail || usedParams(sql).length))
      throw new LookerError('invalid', 'Linking cannot enable query parameters: use report_create or datasource_add to connect this query.');
    checkParams(sql, params, { date: 'date_range_params: true', email: 'viewer_email_param: true' });
  }
  const project = input.project_id?.trim() || await defaultProject(ctx);
  if (!project) throw new LookerError('invalid', 'No project_id or default billing project: give project_id.');
  const source: BigQuerySource = sql
    ? { sql, billingProject: project }
    : { projectId: project, datasetId: input.dataset_id!.trim(), tableId: input.table_id!.trim() };
  // The first FROM target is also a useful default name for a custom query.
  const from = sql ? /\bfrom\s+(?:`([^`]+)`|([\w.-]+))/i.exec(sql) : undefined;
  const guessed = (from?.[1] ?? from?.[2])?.split('.').at(-1);
  const name = input.source_name?.trim() ?? (sql ? guessed || 'Custom query' : input.table_id!.trim());
  return { source, connection: { connector: 'bigquery', source }, params, name, explicitName: input.source_name !== undefined };
}

export async function checkQuery(ctx: ToolContext, plan: SourcePlan): Promise<void> {
  if (plan.connection.connector === 'bigquery' && 'sql' in plan.connection.source)
    await dryRunQuery(ctx, plan.connection.source.billingProject, plan.connection.source.sql, plan.params);
}

export async function consentNote(ctx: ToolContext, datasourceId: string, params: SourceParams): Promise<string | undefined> {
  if (!params.viewerEmail) return;
  if (ctx.dryRun) return 'The signed-in account would consent to the viewer email parameter.';
  try {
    if (!await hasViewerEmailConsent(ctx.rap, datasourceId)) await grantViewerEmailConsent(ctx.rap, datasourceId);
    return 'The signed-in account has consented to the viewer email parameter; other viewers consent for themselves.';
  } catch {
    return 'Viewer email consent was not granted. Open this report and allow the email parameter before its charts can read data.';
  }
}
