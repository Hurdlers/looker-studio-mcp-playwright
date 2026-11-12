import { z } from 'zod';

import { CREATED_BY } from '../../core/bigquery.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { fieldLines, formatBytes, kindLabel, markdownTable, typedCell } from './format.js';
import { checkDataset, checkIdentifier, checkTable, datasetArg, projectArg, resolveProject, tableArg } from './names.js';
import { readOnlySql } from './sql.js';

// BigQuery tools: they talk to BigQuery directly with the user's Application
// Default Credentials (ctx.bigquery), not through Looker Studio.

// A GoogleSQL string literal body: backslashes, quotes and line breaks escaped.
function sqlString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export function viewDdl(project: string, dataset: string, view: string, select: string, description?: string): string {
  const options = [
    ...(description ? [`description = '${sqlString(description)}'`] : []),
    `labels = [("${CREATED_BY.key}", "${CREATED_BY.value}")]`,
  ];
  return `CREATE OR REPLACE VIEW \`${project}.${dataset}.${view}\`\nOPTIONS (${options.join(', ')})\nAS\n${select}`;
}

export const tools = [
  defineTool({
    name: 'bq_dataset_list',
    title: 'List BigQuery datasets',
    description:
      'Lists every dataset in a Google Cloud project with its location (region), following all result pages. Use it to find which dataset holds the tables you want before bq_table_list. Hidden datasets (names starting with _) are not listed; without project_id the configured billing project, then the credentials\' project, is used.',
    input: { project_id: projectArg },
    write: false,
    run: async (ctx, a) => {
      const project = await resolveProject(ctx, a.project_id);
      const datasets = await ctx.bigquery.listDatasets(project);
      if (!datasets.length) return text(`No datasets in project ${project}.`);
      const lines = datasets.map((d) => `- ${d.id}${d.location ? ` (${d.location})` : ''}`);
      return text(`Datasets in ${project} (${datasets.length}):\n${lines.join('\n')}`);
    },
  }),

  defineTool({
    name: 'bq_table_list',
    title: 'List BigQuery tables',
    description:
      'Lists the tables and views of a dataset with their kind (table, view, materialized view, external, snapshot), reading every page. Use it to pick a table for bq_table_describe, a query, or a Looker Studio data source. The dataset id takes letters, digits and underscores only.',
    input: { project_id: projectArg, dataset_id: datasetArg },
    write: false,
    run: async (ctx, a) => {
      const dataset = checkDataset(a.dataset_id);
      const project = await resolveProject(ctx, a.project_id);
      const tables = await ctx.bigquery.listTables(project, dataset);
      if (!tables.length) return text(`No tables in dataset ${project}.${dataset}.`);
      const lines = tables.map((t) => `- ${t.id} (${kindLabel(t.type)})`);
      return text(`Tables in ${project}.${dataset} (${tables.length}):\n${lines.join('\n')}`);
    },
  }),

  defineTool({
    name: 'bq_table_describe',
    title: 'Describe a BigQuery table',
    description:
      'Shows a table or view: full name, kind, description, row count (plain tables only) and its fields with type, mode (when not NULLABLE) and description, RECORD sub-fields indented. For a view or materialized view, the SQL that defines it is shown at the end. Use it to learn column names and types before writing a query or adding the table as a data source.',
    input: { project_id: projectArg, dataset_id: datasetArg, table_id: tableArg },
    write: false,
    run: async (ctx, a) => {
      const dataset = checkDataset(a.dataset_id);
      const table = checkTable(a.table_id);
      const project = await resolveProject(ctx, a.project_id);
      const t = await ctx.bigquery.getTable(project, dataset, table);
      const lines = [`\`${project}.${dataset}.${table}\` (${kindLabel(t.type)})`];
      if (t.description) lines.push(`Description: ${t.description}`);
      if ((t.type ?? 'TABLE') === 'TABLE' && t.numRows !== undefined) lines.push(`Rows: ${t.numRows}`);
      const fields = t.schema?.fields ?? [];
      lines.push('', 'Fields:', ...(fields.length ? fieldLines(fields) : ['_none_']));
      const definition = t.type === 'VIEW' ? t.view?.query : t.type === 'MATERIALIZED_VIEW' ? t.materializedView?.query : undefined;
      if (definition) lines.push('', 'Defined by:', '```sql', definition, '```');
      return text(lines.join('\n'));
    },
  }),

  defineTool({
    name: 'bq_query_run',
    title: 'Run a BigQuery query',
    description:
      'Runs one read-only GoogleSQL query (a single SELECT or WITH statement) and returns the rows as a Markdown table, ending with rows received / total rows, bytes scanned and whether the cache was used. Use it to look at data or check numbers; with dry_run it only validates the query and estimates the bytes it would scan. Anything that changes data is refused before it is sent (save SQL with bq_view_create instead); the configured max_bytes_billed caps the cost, and max_rows above the configured limit is lowered to it.',
    input: {
      project_id: projectArg,
      sql: z.string().describe('One GoogleSQL statement starting with SELECT or WITH; one trailing semicolon is fine.'),
      max_rows: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .optional()
        .describe('Most rows to return (1–10000). Defaults to max_rows in the config (500), which is also the upper limit.'),
      dry_run: z.boolean().default(false).describe('Only validate the query and estimate the bytes it would scan, without running it.'),
    },
    write: false,
    run: async (ctx, a) => {
      readOnlySql(a.sql);
      const project = await resolveProject(ctx, a.project_id);
      if (a.dry_run) {
        const dry = await ctx.bigquery.dryRun(project, a.sql);
        if (dry.statementType && dry.statementType !== 'SELECT')
          throw new LookerError('refused', `BigQuery reads this as a ${dry.statementType}; only SELECT queries run here.`);
        return text(`The query is valid. Running it would scan about ${formatBytes(dry.bytesProcessed)} (${dry.bytesProcessed} bytes).`);
      }
      const limit = ctx.config.bigquery.maxRows;
      const maxRows = Math.min(a.max_rows ?? limit, limit);
      const res = await ctx.bigquery.query(project, a.sql, { maxRows });
      const rows = res.rows.map((r) => Object.fromEntries(res.fields.map((f) => [f.name, typedCell(f, r[f.name])])));
      const parts = [rows.length ? markdownTable(res.fields, rows) : 'The query returned no rows.'];
      const notes = [`rows ${rows.length} / ${res.totalRows}`, `scanned ${formatBytes(res.bytesProcessed)}`, res.cacheHit ? 'cache hit' : 'cache miss'];
      parts.push('', notes.join(' · '));
      if (res.totalRows > rows.length)
        parts.push(`Truncated: only ${rows.length} of ${res.totalRows} rows are shown. Add a LIMIT or aggregate (GROUP BY) to get what you need.`);
      if (a.max_rows !== undefined && a.max_rows > limit)
        parts.push(`max_rows ${a.max_rows} was lowered to ${limit}, the max_rows limit in the config.`);
      return text(parts.join('\n'));
    },
  }),

  defineTool({
    name: 'bq_view_create',
    title: 'Create a BigQuery view',
    description:
      'Saves a SELECT query as a view in a dataset (CREATE OR REPLACE VIEW), replacing a view of the same name, after a dry run has validated it; then says how many bytes reading the view scans. Use it to keep a query in BigQuery, e.g. as a table for a Looker Studio data source. The SQL must be one read-only SELECT or WITH statement; nothing is saved when validation fails. The view is labelled created_by: looker-studio-mcp (only such views can be deleted with bq_view_delete); replacing a view without a description clears its old description.',
    input: {
      project_id: projectArg,
      dataset_id: datasetArg,
      view_id: z.string().describe('View id to write; an existing view with this id is overwritten (letters, digits and underscores).'),
      sql: z.string().describe('The SELECT (or WITH) query the view runs; one trailing semicolon is dropped.'),
      description: z.string().optional().describe('Description stored on the view. Left out or empty: no description.'),
    },
    write: true,
    run: async (ctx, a) => {
      const dataset = checkDataset(a.dataset_id);
      const view = checkIdentifier(a.view_id, 'view id');
      const select = readOnlySql(a.sql);
      const project = await resolveProject(ctx, a.project_id);
      const dry = await ctx.bigquery.dryRun(project, a.sql);
      if (dry.statementType && dry.statementType !== 'SELECT')
        throw new LookerError('refused', `BigQuery reads this as a ${dry.statementType}; a view needs a SELECT query.`);
      const ddl = viewDdl(project, dataset, view, select, a.description);
      await ctx.bigquery.ddl(project, ddl);
      const name = `${project}.${dataset}.${view}`;
      const scan = `Reading it scans about ${formatBytes(dry.bytesProcessed)}.`;
      const body = ctx.dryRun
        ? `Validated. Would create or replace view \`${name}\` with:\n\`\`\`sql\n${ddl}\n\`\`\`\nNothing was saved. ${scan}`
        : `Created or replaced view \`${name}\`. ${scan}`;
      return { ...text(body), audit: { detail: `view ${name}` } };
    },
  }),

  defineTool({
    name: 'bq_view_delete',
    title: 'Delete a BigQuery view',
    description:
      'Deletes a view that bq_view_create made (labelled created_by: looker-studio-mcp). It reads the target first: a table, materialized view or other kind is left alone with a note saying so, and a view without that label is refused. Use it to clean up views this server created; a missing target is reported as not found.',
    input: {
      project_id: projectArg,
      dataset_id: datasetArg,
      view_id: z.string().describe('Name of the view to delete, as BigQuery shows it.'),
    },
    write: true,
    run: async (ctx, a) => {
      const dataset = checkDataset(a.dataset_id);
      const view = checkTable(a.view_id);
      const project = await resolveProject(ctx, a.project_id);
      const name = `${project}.${dataset}.${view}`;
      const t = await ctx.bigquery.getTable(project, dataset, view);
      if (t.type !== 'VIEW') return text(`\`${name}\` is a ${kindLabel(t.type)}, not a view: nothing was deleted.`);
      if (t.labels?.[CREATED_BY.key] !== CREATED_BY.value)
        throw new LookerError(
          'refused',
          `\`${name}\` has no label ${CREATED_BY.key}: ${CREATED_BY.value}, so this server did not make it; delete it in BigQuery yourself if you mean to.`,
        );
      await ctx.bigquery.deleteTable(project, dataset, view);
      return { ...text(ctx.dryRun ? `Would delete view \`${name}\`.` : `Deleted view \`${name}\`.`), audit: { detail: `view ${name}` } };
    },
  }),
];
