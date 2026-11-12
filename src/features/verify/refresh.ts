import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { reportIdOf, reportInput } from './common.js';

export const reportDataRefresh = defineTool({
  name: 'report_data_refresh', title: 'Request fresh report data',
  description: 'Requests the same report data refresh as the editor refresh action by updating its prefetch timestamp. Use after external source values or visibility settings change and cached results remain. This changes freshness state, requires writes_enabled, and does not publish a draft, edit source fields or modify chart settings. Service refresh limits and source delays still apply. No automatic retry is performed.',
  input: { report_id: reportInput },
  write: true,
  run: async (ctx, input) => {
    if (!ctx.config.writesEnabled) throw new LookerError('refused', 'Refreshing report data requires writes_enabled: true.');
    const reportId = reportIdOf(input.report_id);
    await ctx.session.load(reportId);
    if (ctx.dryRun) return text(`Would request a data refresh for report ${reportId}. Nothing was sent.`);
    await ctx.rap.call('updatePrefetch', { prefetchConfig: { reportId }, fieldMask: 'TIMESTAMP' });
    return { ...text(`Requested a data refresh for report ${reportId}. Chart settings, source schema and publication state were not changed. Service refresh limits and source delays may still apply.`),
      audit: { reportId, detail: 'refresh report data timestamp' } };
  },
});
