import { z } from 'zod';

import { defineTool, text } from '../../core/tool.js';
import { dataSourceInput, reportIdInput, reportIdOf } from './inputs.js';
import { describeSource, pickSource, readSources } from './sources.js';

export const datasourceList = defineTool({
  name: 'datasource_list',
  title: 'List data sources',
  description:
    "Lists the data sources a report uses: alias (ds1, ds2 …), name, id, how many charts and report filters or parameters use each, the connection (BigQuery table path, or a custom query's SQL and billing project), whether it is embedded in the report or reusable, whose credentials it reads with (owner or viewer), data freshness, status and query parameters. " +
    'Use it before adding charts, removing or changing a source, to learn the aliases the other data source tools take. ' +
    'With fields: true each source also lists its fields with type, dimension or metric, and default aggregation, which is how to spot a custom query column Looker Studio typed wrongly (fix it with field_update). ' +
    'Google Sheets worksheet settings and GA4 account/property IDs are also identified. Other connectors are listed by native type.',
  input: {
    report_id: reportIdInput,
    data_source: dataSourceInput.optional().describe('Show only this data source (alias such as ds2, id, or name). All of them when left out.'),
    fields: z.boolean().default(false).describe('Also list every field of each source with its type, dimension or metric, and default aggregation.'),
  },
  write: false,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const all = await readSources(ctx.rap, doc);
    if (!all.length) return text(`Report ${reportId} has no data sources.`);
    const shown = a.data_source !== undefined ? [pickSource(all, reportId, a.data_source)] : all;
    const lines = shown.flatMap((d) => describeSource(doc, d, a.fields));
    const head = a.data_source !== undefined ? `Data source of report ${reportId}:` : `${all.length} data source${all.length === 1 ? '' : 's'} in report ${reportId}:`;
    return text([head, ...lines].join('\n'));
  },
});
