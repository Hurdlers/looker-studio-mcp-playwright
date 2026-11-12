import { z } from 'zod';

import {
  addDataSource,
  datasourceInfo,
  grantViewerEmailConsent,
  hasViewerEmailConsent,
  renameDatasource,
  type BigQuerySource,
} from '../../core/datasource.js';
import { prepareConnection, requireConnector } from '../../connectors/registry.js';
import { DATABASE_FIELDS, parseSheetsInput, sheetsInput } from '../../connectors/sheets-input.js';
import { ga4Input, parseGa4Input, rejectGa4Inputs } from '../../connectors/ga4-input.js';
import { isDryRun } from '../../core/dryrun.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { reportIdInput, reportIdOf } from './inputs.js';
import { checkParams, checkSelect, defaultProject, dryRunQuery } from '../../connectors/bigquery-query.js';

export const CONNECTORS = ['bigquery', 'google_sheets', 'ga4', 'postgresql', 'mysql'] as const;

// Preserve the public helper while connector availability has one owner.
export function rejectConnector(connector: string | undefined): void {
  requireConnector(connector);
}

// Inputs that do not belong to BigQuery. Keep this list to reject mixed
// connection requests instead of silently ignoring their fields.
const FOREIGN = [
  'spreadsheet',
  'worksheet',
  'worksheet_id',
  'range',
  'use_first_row_as_headers',
  'include_hidden_and_filtered_cells',
  'host',
  'port',
  'database',
  'user',
  'password',
  'ssl',
] as const;

const foreignInput = Object.fromEntries(
  DATABASE_FIELDS.map((k) => [k, z.unknown().optional().describe('Not supported: database connectors are not available here. Giving this input is an error.')]),
) as Record<(typeof DATABASE_FIELDS)[number], z.ZodOptional<z.ZodUnknown>>;

export const datasourceAdd = defineTool({
  name: 'datasource_add',
  title: 'Add a data source',
  description:
    'Connects a BigQuery table or view, or a BigQuery custom query (GoogleSQL), to a report as a new data source and gives it the next alias (ds1, ds2 …). ' +
    'For a table give dataset_id and table_id (the source is named after the table); for a custom query give sql instead. Use source_name to name either kind. project_id is the table\'s project, or for a custom query the project it runs in and is billed to; the configured billing project (then the credentials\' project) is used when it is left out. ' +
    'A custom query must be a single SELECT (or WITH) statement and is dry-run in BigQuery first: if BigQuery rejects it, its error comes back and the report is left alone. ' +
    'date_range_params lets the query read the chart\'s date range: @DS_START_DATE is its first day, @DS_END_DATE its last, both YYYYMMDD text; viewer_email_param lets it read the viewer\'s email as @DS_USER_EMAIL (row-level access), and consents to that for the signed-in account; if that consent fails the source stays added and the answer says the viewer must click Allow in the report. A query using those parameters without the option is refused. ' +
    'Google Sheets is also supported: use connector google_sheets with spreadsheet and worksheet or worksheet_id, and optional header, hidden-cell and range settings. For Google Analytics 4 use connector ga4 with numeric account_id and property_id; the signed-in account must already have access. No GA4 authorization is granted automatically. PostgreSQL and MySQL are refused.',
  input: {
    report_id: reportIdInput,
    connector: z.enum(CONNECTORS).default('bigquery').describe('The connector: bigquery, google_sheets or ga4. PostgreSQL and MySQL are not supported.'),
    project_id: z.string().optional().describe("BigQuery project: the table's project, or for sql the project the query runs in and is billed to. Defaults to the configured billing project."),
    dataset_id: z.string().optional().describe('BigQuery dataset of the table or view (with table_id).'),
    table_id: z.string().optional().describe('BigQuery table or view name (with dataset_id). Not with sql.'),
    sql: z.string().optional().describe('A GoogleSQL custom query, one SELECT or WITH statement, used instead of a table.'),
    source_name: z.string().optional().describe('Name of the new data source; defaults to the table name or "Custom query".'),
    date_range_params: z
      .boolean()
      .optional()
      .describe('Custom queries only: the query gets the chart date range, first day in @DS_START_DATE, last day in @DS_END_DATE (YYYYMMDD text).'),
    viewer_email_param: z
      .boolean()
      .optional()
      .describe("Custom queries only: pass the viewer's email to the query as @DS_USER_EMAIL, for row-level access. Each viewer consents once; the signed-in account's consent is given here."),
    ...sheetsInput,
    ...ga4Input,
    ...foreignInput,
  },
  write: true,
  run: async (ctx, a) => {
    rejectConnector(a.connector);
    if (a.connector === 'ga4') return addGa4(ctx, a);
    rejectGa4Inputs(a);
    if (a.connector === 'google_sheets') return addSheets(ctx, a);
    const foreign = FOREIGN.filter((k) => a[k] !== undefined);
    if (foreign.length)
      throw new LookerError('invalid', `${foreign.join(', ')} do not apply to BigQuery. For spreadsheet inputs choose connector "google_sheets"; database connections are not supported.`);
    const sql = a.sql?.trim() ? a.sql : undefined;
    const table = a.dataset_id !== undefined || a.table_id !== undefined;
    if (sql && table) throw new LookerError('invalid', 'sql and dataset_id/table_id exclude each other: pick a custom query or a table.');
    if (!sql && !(a.dataset_id?.trim() && a.table_id?.trim()))
      throw new LookerError('invalid', 'Give dataset_id and table_id for a BigQuery table or view, or sql for a custom query.');
    if (!sql) {
      const extra = (['date_range_params', 'viewer_email_param'] as const).filter((k) => a[k] !== undefined);
      if (extra.length)
        throw new LookerError('invalid', `${extra.join(', ')} only go with a custom query (sql); a table source takes no query parameters.`);
    } else {
      checkSelect(sql);
      checkParams(sql, { dateRange: a.date_range_params === true, viewerEmail: a.viewer_email_param === true }, {
        date: 'date_range_params: true',
        email: 'viewer_email_param: true',
      });
    }
    const project = a.project_id?.trim() || (await defaultProject(ctx));
    if (!project) throw new LookerError('invalid', 'No project_id given and no default project is configured (billing_project): give project_id.');
    const reportId = reportIdOf(a.report_id);
    if (sql) await dryRunQuery(ctx, project, sql);

    const source: BigQuerySource = sql ? { sql, billingProject: project } : { projectId: project, datasetId: a.dataset_id!.trim(), tableId: a.table_id!.trim() };
    const name = a.source_name?.trim() || undefined;
    const params = { ...(a.date_range_params ? { dateRange: true } : {}), ...(a.viewer_email_param ? { viewerEmail: true } : {}) };
    const added = await addDataSource({ rap: ctx.rap, worker: ctx.worker, session: ctx.session }, reportId, { connector: 'bigquery', source }, {
      ...(name ? { name } : {}),
      params,
    });
    const notes: string[] = [];
    const dry = ctx.dryRun || isDryRun(ctx.rap);
    // The editor names the source in a second step; make sure the list shows
    // the name given.
    if (name && !dry) {
      const [info] = await datasourceInfo(ctx.rap, [added.datasourceId]);
      if (info && info.name !== name) await renameDatasource(ctx.rap, added.datasourceId, name);
    }
    if (a.viewer_email_param) {
      if (dry) notes.push('The signed-in account would consent to sharing its email with the query.');
      else {
        // The source is already in the report: a failed consent must not hide
        // that, so the answer says what was added and what is left to do.
        try {
          if (!(await hasViewerEmailConsent(ctx.rap, added.datasourceId))) {
            await grantViewerEmailConsent(ctx.rap, added.datasourceId);
            notes.push('Consented, for the signed-in account only, to pass its email to @DS_USER_EMAIL; every other viewer is asked once.');
          }
        } catch (e) {
          const why = e instanceof Error ? e.message : String(e);
          notes.push(
            `Consent NOT given (${why}). ${added.alias} is in the report with @DS_USER_EMAIL switched on, but until a viewer allows sharing their email its charts show "Consent required": open the report and click Allow on the consent prompt (each viewer once), or remove ${added.alias} with datasource_remove.`,
          );
        }
      }
    }
    const what = 'sql' in source ? `custom query (billed to ${project})` : `table ${source.projectId}.${source.datasetId}.${source.tableId}`;
    const fields = added.fields.map((f) => f.name);
    const label = name ?? (sql ? 'Custom query' : a.table_id!.trim());
    return {
      ...text(
        [
          `Added ${added.alias} "${label}" (data source ${added.datasourceId}) to report ${reportId}: BigQuery ${what}.`,
          `${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.join(', ') || 'none'}.`,
          ...(sql ? ['Check the field types Looker Studio guessed for the query columns (datasource_list with fields: true; fix with field_update).'] : []),
          ...notes,
        ].join('\n'),
      ),
      audit: { reportId, detail: `added ${added.alias} ${added.datasourceId}` },
    };
  },
});

async function addGa4(ctx: ToolContext, input: Parameters<typeof parseGa4Input>[0] & { report_id: string; source_name?: string | undefined }) {
  const source = parseGa4Input(input), reportId = reportIdOf(input.report_id);
  const name = input.source_name?.trim() ?? 'Google Analytics 4';
  if (!name) throw new LookerError('invalid', 'source_name cannot be empty.');
  const added = await addDataSource(ctx, reportId, { connector: 'ga4', source }, { name });
  if (!ctx.dryRun && !isDryRun(ctx.rap)) {
    const [info] = await datasourceInfo(ctx.rap, [added.datasourceId]);
    if (info && info.name !== name) await renameDatasource(ctx.rap, added.datasourceId, name);
  }
  const fields = added.fields.map(field => field.name);
  return {
    ...text([`Added ${added.alias} "${name}" (data source ${added.datasourceId}) to report ${reportId}: Google Analytics 4 property ${source.propertyId}.`,
      `${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.join(', ') || 'none'}.`,
      'Use the field types and aggregations returned by GA4; already aggregated Auto metrics must not be summed again.',
    ].join('\n')),
    audit: { reportId, detail: `added ${added.alias} ${added.datasourceId}` },
  };
}


async function addSheets(ctx: ToolContext, input: Parameters<typeof parseSheetsInput>[0] & { report_id: string; source_name?: string | undefined }) {
  const parsed = parseSheetsInput(input);
  const reportId = reportIdOf(input.report_id);
  const connection = await prepareConnection(ctx, { connector: 'google_sheets', source: parsed });
  if (connection.connector !== 'google_sheets') throw new LookerError('invalid', 'Google Sheets preparation returned another connector.');
  const name = input.source_name?.trim() || connection.source.worksheet || 'Spreadsheet';
  const added = await addDataSource(ctx, reportId, connection, { name });
  if (!ctx.dryRun && !isDryRun(ctx.rap)) {
    const [info] = await datasourceInfo(ctx.rap, [added.datasourceId]);
    if (info && info.name !== name) await renameDatasource(ctx.rap, added.datasourceId, name);
  }
  const fields = added.fields.map((field) => field.name);
  const source = connection.source;
  return {
    ...text([
      `Added ${added.alias} "${name}" (data source ${added.datasourceId}) to report ${reportId}: Google Sheets ${source.spreadsheetId}, worksheet ${source.worksheet ?? source.worksheetId}${source.range ? `, range ${source.range}` : ''}.`,
      `${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.join(', ') || 'none'}.`,
      'Check the field types Looker Studio inferred (datasource_list with fields: true; fix with field_update).',
    ].join('\n')),
    audit: { reportId, detail: `added ${added.alias} ${added.datasourceId}` },
  };
}
