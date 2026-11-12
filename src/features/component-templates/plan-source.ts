import { z } from 'zod';

import type { Field } from '../../core/bigquery.js';
import { errorMessage, type ToolContext } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { checkDataset, checkTable, resolveProject } from '../bigquery/names.js';
import { blankNoise, readOnlySql } from '../bigquery/sql.js';
import type { BindingIssue } from './plan-bindings.js';

export const connectionInput = z.object({
  project_id: z.string().optional().describe('BigQuery 프로젝트. 생략하면 설정된 기본 프로젝트를 사용합니다.'),
  dataset_id: z.string().optional().describe('선택한 테이블 또는 뷰의 데이터셋. table_id와 함께 지정합니다.'),
  table_id: z.string().optional().describe('연결할 테이블 또는 뷰 이름. sql과 동시에 지정할 수 없습니다.'),
  sql: z.string().optional().describe('연결할 단일 SELECT 또는 WITH 쿼리. 매개변수 없이 작성하며 실행하지 않고 검사합니다.'),
  source_name: z.string().optional().describe('연결 후 사용할 데이터 소스 이름. 생략하면 테이블 이름 또는 Custom query입니다.'),
}).strict();
export type ConnectionInput = z.infer<typeof connectionInput>;

export interface PlannedSourceField {
  name: string;
  type: string;
  mode: string;
  description?: string;
  fields?: PlannedSourceField[];
  requires_projection?: boolean;
}
export interface SourcePlan {
  fields: PlannedSourceField[];
  issues: BindingIssue[];
  validation: 'bigquery_table_metadata' | 'bigquery_query_dry_run' | 'not_validated';
  preparation?: { tool: 'datasource_add'; arguments: Record<string, unknown> };
  source_name?: string;
  estimated_bytes?: number;
  notes: string[];
}

function schema(fields: Field[]): PlannedSourceField[] {
  return fields.map(field => ({
    name: field.name, type: field.type, mode: field.mode ?? 'NULLABLE',
    ...(field.description ? { description: field.description } : {}),
    ...(field.fields?.length ? { fields: schema(field.fields) } : {}),
    ...(field.mode === 'REPEATED' || ['RECORD', 'STRUCT'].includes(field.type) ? { requires_projection: true } : {}),
  }));
}

/** Inspect one explicitly selected source. Never create a Looker source or
 * simulate datasource_add: connection preparation can involve credentials.
 * The caller must connect, read the real Looker fields and plan again. */
export async function planSource(ctx: ToolContext, reportId: string, connection: ConnectionInput): Promise<SourcePlan> {
  const empty: SourcePlan = { fields: [], issues: [], validation: 'not_validated', notes: [] };
  try {
    const parsed = connectionInput.parse(connection);
    const report_id = parseReportId(reportId);
    const hasTable = parsed.dataset_id !== undefined || parsed.table_id !== undefined;
    const hasSql = parsed.sql !== undefined;
    if (hasSql === hasTable) return { ...empty, issues: [{ code: 'invalid_connection', message: 'dataset_id와 table_id, 또는 sql 중 한 가지 연결 방식을 지정하세요.' }] };
    if (parsed.source_name !== undefined && !parsed.source_name.trim())
      return { ...empty, issues: [{ code: 'invalid_connection', message: 'source_name은 비어 있을 수 없습니다.' }] };
    const project_id = await resolveProject(ctx, parsed.project_id?.trim());
    if (hasSql) {
      const sql = readOnlySql(parsed.sql!);
      if (/[@?]/.test(blankNoise(sql))) return { ...empty, issues: [{ code: 'unsupported_query_parameters', message: '연결 계획에서는 날짜·이메일 등 쿼리 매개변수를 지원하지 않습니다. 매개변수 없는 SELECT를 지정하세요.' }] };
      const dry = await ctx.bigquery.dryRun(project_id, sql);
      if (dry.statementType && dry.statementType !== 'SELECT')
        return { ...empty, issues: [{ code: 'invalid_query', message: `SELECT 쿼리만 연결할 수 있습니다. BigQuery가 ${dry.statementType}로 판정했습니다.` }] };
      if (!Number.isFinite(dry.bytesProcessed) || dry.bytesProcessed < 0 || dry.bytesProcessed > ctx.config.bigquery.maxBytesBilled)
        return { ...empty, issues: [{ code: 'query_budget_exceeded', message: '예상 읽기 크기를 확인할 수 없거나 설정된 쿼리 한도를 넘습니다. 쿼리 범위를 줄여 다시 계획하세요.' }] };
      const source_name = parsed.source_name?.trim() ?? 'Custom query';
      return { fields: [], issues: [], validation: 'bigquery_query_dry_run', source_name, estimated_bytes: dry.bytesProcessed,
        preparation: { tool: 'datasource_add', arguments: { report_id, connector: 'bigquery', project_id, sql, source_name } },
        notes: ['쿼리 문법과 예상 읽기 크기만 검사했으며 쿼리를 실행하지 않았습니다.', '연결 후 실제 Looker Studio 필드와 집계 규칙을 읽고 차트 계획을 다시 실행하세요.'] };
    }
    if (!parsed.dataset_id?.trim() || !parsed.table_id?.trim())
      return { ...empty, issues: [{ code: 'invalid_connection', message: '테이블 연결에는 dataset_id와 table_id가 모두 필요합니다.' }] };
    const dataset_id = checkDataset(parsed.dataset_id.trim()), table_id = checkTable(parsed.table_id.trim());
    const table = await ctx.bigquery.getTable(project_id, dataset_id, table_id);
    const fields = schema(table.schema?.fields ?? []), source_name = parsed.source_name?.trim() ?? table_id;
    return { fields, issues: [], validation: 'bigquery_table_metadata', source_name,
      preparation: { tool: 'datasource_add', arguments: { report_id, connector: 'bigquery', project_id, dataset_id, table_id, source_name } },
      notes: ['선택한 테이블의 BigQuery 메타데이터만 읽었습니다. 데이터 행과 보고서는 변경하지 않았습니다.',
        '표시된 자료형은 BigQuery 자료형입니다. 연결 후 실제 Looker Studio 필드와 집계 규칙으로 차트 계획을 다시 실행하세요.',
        ...(fields.some(field => field.requires_projection) ? ['중첩·반복 열은 필요한 값만 평탄화하는 SELECT가 필요할 수 있습니다. 자동으로 펼치거나 집계하지 않습니다.'] : [])] };
  } catch (error) {
    return { ...empty, issues: [{ code: 'connection_unavailable', message: errorMessage(error) }] };
  }
}
