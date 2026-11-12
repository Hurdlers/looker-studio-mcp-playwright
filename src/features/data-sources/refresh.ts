import { findConnector } from '../../connectors/registry.js';
import { editDatasource, type BlockDatasource } from '../../core/datasource.js';
import { defineTool, text } from '../../core/tool.js';
import { changed, describeChanges, foldColumns, readColumns } from './columns.js';
import { dataSourceInput, reportIdInput, reportIdOf } from './inputs.js';
import { connectorOf, pickSource, sourceRefs, type SourceRef } from './sources.js';

export const datasourceRefresh = defineTool({
  name: 'datasource_refresh',
  title: 'Refresh data source fields',
  description:
    "Reads a data source's columns again from BigQuery, Google Sheets or GA4 and brings its field list up to date: new columns become fields, removed columns are dropped, and changed types are updated. Calculated fields and the names and aggregations given to fields are kept. " +
    'Use it after changing a table, view or worksheet. Answers the new field names (and what was dropped or retyped); when nothing changed, nothing is saved. ' +
    'Without name every supported data source of the report is refreshed.',
  input: {
    report_id: reportIdInput,
    name: dataSourceInput.optional().describe('The data source to refresh: alias (ds1 …), id or name. All of the report\'s sources when left out.'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const refs = await sourceRefs(ctx.rap, doc);
    const targets: SourceRef[] = a.name !== undefined ? [pickSource(refs, reportId, a.name)] : refs;
    if (!targets.length) return text(`Report ${reportId} has no data sources.`);
    const lines: string[] = [];
    let saved = 0;
    for (const src of targets) {
      const got = await ctx.rap.call<BlockDatasource>('getBlockDatasource', { datasourceId: src.datasourceId });
      const current = (got.draft ?? got.published) as Record<string, any> | undefined;
      const head = `${src.alias} "${src.name}"`;
      if (!findConnector(connectorOf(current))) {
        lines.push(`${head}: skipped, not a supported data source.`);
        continue;
      }
      const columns = await readColumns(ctx, current!.blocks[0].connectorBlockConfig);
      const preview = foldColumns(structuredClone(current!), columns);
      if (!changed(preview)) {
        lines.push(`${head}: no new fields.`);
        continue;
      }
      let changes = preview;
      await editDatasource(ctx.rap, reportId, src.datasourceId, (ds) => {
        changes = foldColumns(ds, columns);
      }, `refresh fields of ${src.alias}`);
      saved++;
      lines.push(`${head}: ${describeChanges(changes)}.`);
    }
    return { ...text(lines.join('\n')), audit: { reportId, detail: `refreshed ${saved} of ${targets.length} data source(s)` } };
  },
});
