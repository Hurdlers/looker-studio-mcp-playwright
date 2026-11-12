import { z } from 'zod';

import { findConnector, requireConnector } from '../../connectors/registry.js';
import { editDatasource, makeReusable, renameDatasource, schemaBody, setCredentials, type BlockDatasource, type SchemaAnswer } from '../../core/datasource.js';
import { isDryRun } from '../../core/dryrun.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { describeChanges, foldColumns, readColumns } from './columns.js';
import { dataSourceInput, reportIdInput, reportIdOf } from './inputs.js';
import { connectorOf, pickSource, sourceRefs } from './sources.js';
import { checkParams, checkSelect, defaultProject, dryRunQuery } from '../../connectors/bigquery-query.js';

// ---- Freshness ----------------------------------------------------------------

export interface ShelfLife {
  amount: number;
  // 1 minutes, 2 hours.
  chronoUnit: 1 | 2;
}

// What the editor's data freshness dialog offers.
const MINUTES = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50];
const PRESETS = new Set(['15 1', '1 2', '4 2', '12 2']);

// "1 hour", "30 minutes", "30m", "every 2 h" → shelf life.
export function parseFreshness(input: string): ShelfLife {
  const m = /^(?:every\s+)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?)$/i.exec(input.trim());
  const help = `Use 15 minutes, 1 hour, 4 hours, 12 hours, or ${MINUTES.join(', ')} minutes, or 1 to 12 hours.`;
  if (!m) throw new LookerError('invalid', `Data freshness "${input}" is not one Looker Studio offers: days are not available. ${help}`);
  const amount = Number(m[1]);
  const hours = m[2]!.toLowerCase().startsWith('h');
  if (hours ? amount < 1 || amount > 12 : !MINUTES.includes(amount))
    throw new LookerError('invalid', `Data freshness "${input}" is not one Looker Studio offers. ${help}`);
  return { amount, chronoUnit: hours ? 2 : 1 };
}

const freshnessText = (s: ShelfLife): string => `${s.amount} ${s.chronoUnit === 1 ? 'minute' : 'hour'}${s.amount === 1 ? '' : 's'}`;

// ---- The tool -----------------------------------------------------------------

type Json = Record<string, any>;

// New SQL for a custom query source: dry-run, columns read with the new query,
// then the source saved with both (same id and alias, so charts keep it).
async function replaceSql(ctx: ToolContext, reportId: string, datasourceId: string, sql: string, projectId: string | undefined): Promise<string> {
  const got = await ctx.rap.call<BlockDatasource>('getBlockDatasource', { datasourceId });
  const current = (got.draft ?? got.published) as Json | undefined;
  const config = connectorOf(current);
  if (findConnector(config)?.id === 'google_sheets')
    throw new LookerError('invalid', 'Google Sheets has no SQL query to replace. Edit the sheet values or add a different data source.');
  if (typeof config?.sql !== 'string')
    throw new LookerError('invalid', 'This data source reads a table, not a custom query: its SQL cannot be replaced. Add a custom query source with datasource_add instead.');
  // Legacy custom-query validation runs before the column loader rejects an
  // unknown connector. Keep that order while native settings belong to adapters.
  const adapter = findConnector(config) ?? requireConnector();
  if (!('query' in adapter)) throw new LookerError('invalid', 'This connector does not support SQL replacement.');
  const settings = adapter.query.settings(config);
  checkParams(sql, settings.params, {
    date: 'the date range parameters switched on (add a new source with date_range_params: true)',
    email: 'the viewer email parameter switched on (add a new source with viewer_email_param: true)',
  });
  const project = projectId?.trim() || settings.project || (await defaultProject(ctx));
  if (!project) throw new LookerError('invalid', 'No project to run the query in: give project_id.');
  await dryRunQuery(ctx, project, sql);
  const setSql = (connectorConfig: Json): void => {
    adapter.query.replaceSql(connectorConfig, sql, projectId?.trim() ? project : undefined);
  };
  const connectorBlockConfig = structuredClone(current!.blocks[0].connectorBlockConfig);
  setSql(connectorBlockConfig.connectorConfig);
  const columns = await readColumns(ctx, connectorBlockConfig);
  let changes = { added: [] as string[], removed: [] as string[], retyped: [] as string[] };
  await editDatasource(
    ctx.rap,
    reportId,
    datasourceId,
    (ds) => {
      setSql((ds as Json).blocks[0].connectorBlockConfig.connectorConfig);
      changes = foldColumns(ds, columns);
    },
    'replace custom query',
  );
  return `SQL replaced (run in ${project}); ${describeChanges(changes)}. Check the field types Looker Studio gave the query columns (datasource_list with fields: true; fix with field_update).`;
}

async function setFreshness(ctx: ToolContext, reportId: string, datasourceId: string, life: ShelfLife): Promise<string> {
  const preset = PRESETS.has(`${life.amount} ${life.chronoUnit}`);
  await editDatasource(
    ctx.rap,
    reportId,
    datasourceId,
    (ds) => {
      ds.queryCachePolicy = { shelfLife: { amount: life.amount, chronoUnit: life.chronoUnit }, ...(preset ? {} : { isCustomPolicy: true }) };
    },
    'set data freshness',
  );
  if (!isDryRun(ctx.rap)) {
    const res = await ctx.rap.call<SchemaAnswer>('getSchema', schemaBody(datasourceId, reportId));
    const now = (res.schema as { cacheShelfLife?: { amount?: number; chronoUnit?: number } } | undefined)?.cacheShelfLife;
    if (now && (now.amount !== life.amount || now.chronoUnit !== life.chronoUnit))
      throw new LookerError(
        'format_changed',
        `Data freshness was saved but reads ${now.amount} (unit ${now.chronoUnit}) instead of ${freshnessText(life)}: Looker Studio may have changed its internal API.`,
      );
  }
  return `data freshness ${freshnessText(life)}`;
}

export const datasourceUpdate = defineTool({
  name: 'datasource_update',
  title: 'Change a data source',
  description:
    "Changes one data source of a report: its name, a custom query's SQL, whose credentials it reads with, its data freshness, or makes it reusable. Give at least one of name, sql, credentials, freshness, make_reusable; several are applied in the order sql, name, credentials, freshness, then make_reusable. " +
    'sql replaces a custom query (not a table source): it is dry-run in BigQuery first (project_id, else the source\'s billing project, else the configured one), with sample values for the date range and viewer email parameters the source has switched on; if BigQuery or Looker Studio rejects it the old SQL stays. Charts keep using the source; the answer lists added, removed and retyped fields. ' +
    'credentials owner reads data with the owner\'s access for everyone; viewer makes every viewer, editors included, use and consent with their own Google account before data shows. ' +
    'freshness is how long data is cached: 15 minutes, 1 hour, 4 hours, 12 hours, or a custom interval: 1–5 minutes, 10/15/20/25/30/40/50 minutes, or 1–12 hours ("30m" and "every 2 h" work; days do not). ' +
    'make_reusable turns a source embedded in the report into a reusable one in the account (alias kept). It cannot be undone and the reusable source outlives the report; sharing it with the report\'s editors (grant_editor_access) is not available here.',
  input: {
    report_id: reportIdInput,
    data_source: dataSourceInput,
    name: z.string().optional().describe('New name for the data source (surrounding spaces trimmed; not empty).'),
    sql: z.string().optional().describe('New GoogleSQL for a custom query source: one SELECT or WITH statement.'),
    project_id: z.string().optional().describe('With sql: the BigQuery project the query runs in and is billed to. Defaults to the source\'s billing project.'),
    credentials: z.enum(['owner', 'viewer']).optional().describe('owner: everyone sees data through the owner\'s access. viewer: each viewer needs their own access and consents once.'),
    freshness: z.string().optional().describe('How often data is fetched again, e.g. "15 minutes", "1 hour", "12 hours", "30m".'),
    make_reusable: z.boolean().optional().describe('true: turn the embedded source into a reusable data source of the account. Cannot be undone.'),
    grant_editor_access: z
      .boolean()
      .optional()
      .describe('With make_reusable: share the reusable source with the report\'s editors. Only false is accepted (sharing is not done by this server).'),
  },
  write: true,
  run: async (ctx, a) => {
    const name = a.name?.trim();
    const sql = a.sql;
    if (a.name === undefined && sql === undefined && !a.credentials && a.freshness === undefined && !a.make_reusable)
      throw new LookerError('invalid', 'Nothing to change: give name, sql, credentials, freshness or make_reusable.');
    if (a.name !== undefined && !name) throw new LookerError('invalid', 'A data source name cannot be empty.');
    if (a.grant_editor_access !== undefined && !a.make_reusable)
      throw new LookerError('invalid', 'grant_editor_access only goes with make_reusable: true.');
    if (a.grant_editor_access)
      throw new LookerError('refused', "grant_editor_access would share the data source with the report's editors; this server does not share. Leave it out or false.");
    if (a.project_id !== undefined && sql === undefined) throw new LookerError('invalid', 'project_id only goes with sql (the project the new query runs in).');
    if (sql !== undefined) checkSelect(sql);
    const life = a.freshness !== undefined ? parseFreshness(a.freshness) : undefined;

    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const src = pickSource(await sourceRefs(ctx.rap, doc), reportId, a.data_source);
    const done: string[] = [];
    if (sql !== undefined) done.push(await replaceSql(ctx, reportId, src.datasourceId, sql, a.project_id));
    if (name) {
      const res = await renameDatasource(ctx.rap, src.datasourceId, name);
      done.push(`renamed to "${res.name}"`);
    }
    if (a.credentials) {
      const res = await setCredentials(ctx.rap, reportId, src.datasourceId, a.credentials);
      done.push(
        res.credentials === 'owner'
          ? "credentials: owner (everyone sees data through the owner's access)"
          : 'credentials: viewer. Everyone, editors included, must allow access with their own Google account before charts on this source show data, and needs read access to the BigQuery data',
      );
    }
    if (life) done.push(await setFreshness(ctx, reportId, src.datasourceId, life));
    if (a.make_reusable) {
      const res = await makeReusable(ctx.rap, reportId, src.datasourceId);
      done.push(
        res.converted
          ? `made reusable: it is now a data source of the account (alias ${src.alias} kept); this cannot be undone and it stays when the report is deleted`
          : 'already reusable: nothing to change',
      );
    }
    return {
      ...text(`Data source ${src.alias} "${src.name}" in report ${reportId}:\n${done.map((d) => `- ${d}`).join('\n')}`),
      audit: { reportId, detail: `updated ${src.alias} ${src.datasourceId}` },
    };
  },
});
