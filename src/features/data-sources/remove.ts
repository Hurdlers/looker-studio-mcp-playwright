import { z } from 'zod';

import { removeDatasource, sourceUses, type SourceUse } from '../../core/datasource.js';
import type { WriteResult } from '../../core/session.js';
import { defineTool, text, type ToolContext } from '../../core/tool.js';
import { dataSourceInput, reportIdInput, reportIdOf } from './inputs.js';
import { pickSource, sourceRefs } from './sources.js';

const where = (u: SourceUse): string => `${u.componentId} (${u.type}) on ${u.page === 'report level' ? 'report level' : `page "${u.page}"`}`;

// Removes a source although things use them: the same steps as the shared
// removeDatasource (alias first, then deleteClaim, alias back if that fails)
// without its in-use check.
async function removeAnyway(ctx: ToolContext, reportId: string, datasourceId: string, alias: string): Promise<WriteResult> {
  const res = await ctx.session.editReport(
    reportId,
    (d) => {
      const r = (d.report.resource ??= {});
      r.datasourceAlias = (r.datasourceAlias ?? []).filter((x) => x.datasourceId !== datasourceId);
    },
    `remove data source ${alias}`,
  );
  try {
    await ctx.rap.call('deleteClaim', { reportId, datasourceId });
  } catch (err) {
    await ctx.session
      .editReport(
        reportId,
        (d) => {
          const r = (d.report.resource ??= {});
          r.datasourceAlias = [...(r.datasourceAlias ?? []).filter((x) => x.datasourceId !== datasourceId), { datasourceId, alias }];
        },
        `undo remove data source ${alias}`,
      )
      .catch(() => undefined);
    throw err;
  }
  return res;
}

export const datasourceRemove = defineTool({
  name: 'datasource_remove',
  title: 'Remove a data source',
  description:
    'Takes a data source out of a report and says which name and alias went. ' +
    'While a chart, control, conditional format, report filter or parameter still uses it, nothing is removed and the answer names each user (component id and page); remove or repoint those first, or pass force: true. ' +
    'With force the source is removed anyway and the charts that used it are left broken ("needs to be added to the report"); the answer lists them so they can be deleted or pointed at another source. ' +
    'The freed alias (ds2 …) can be given to the next source added, so do not keep using an old alias.',
  input: {
    report_id: reportIdInput,
    data_source: dataSourceInput,
    force: z.boolean().default(false).describe('Remove it even while charts or filters use it; they are left broken. Default false.'),
  },
  write: true,
  run: async (ctx, a) => {
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const src = pickSource(await sourceRefs(ctx.rap, doc), reportId, a.data_source);
    const uses = sourceUses(doc, src.datasourceId);
    const res = a.force && uses.length ? await removeAnyway(ctx, reportId, src.datasourceId, src.alias) : await removeDatasource(ctx, reportId, src.datasourceId);
    const lines = [`Removed ${src.alias} "${src.name}" (data source ${src.datasourceId}) from report ${reportId}; report version ${res.version}.`];
    if (a.force && uses.length)
      lines.push(
        `These now have no data source and show an error: ${uses.map(where).join(', ')}. Delete them or point them at another data source.`,
      );
    lines.push(`The alias ${src.alias} may be given to the next data source added: do not refer to the removed source by it.`);
    return {
      ...text(lines.join('\n')),
      audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `removed ${src.alias} ${src.datasourceId}${a.force && uses.length ? ' (force)' : ''}` },
    };
  },
});
