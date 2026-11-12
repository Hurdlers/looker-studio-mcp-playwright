import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { parseReportId } from '../../looker/view.js';
import { describeVersion, pickVersion, readVersions } from './revisions.js';

const reportIdInput = z.string().describe('Report id or its Looker Studio URL.');

function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}

export const tools = [
  defineTool({
    name: 'version_list',
    title: 'List report versions',
    description:
      "Lists a report's saved versions from its version history, newest first: position (1 = the latest saved version; edits saved after it are not listed yet), name (or the date and time when it has none, in this computer's time zone), and who edited it. " +
      'Use it to find a version to pass to version_restore. Positions shift every time the report is saved (edits a few minutes apart share one version), so list again right before restoring. ' +
      'Versions named "looker-studio-mcp: before …" are the undo points this server takes before its own writes.',
    input: { report_id: reportIdInput },
    write: false,
    run: async (ctx, a) => {
      const reportId = reportIdOf(a.report_id);
      const versions = await readVersions(ctx.rap, reportId);
      if (!versions.length) return text(`Report ${reportId} has no saved versions.`);
      return text([`${versions.length} version${versions.length === 1 ? '' : 's'} of report ${reportId}, newest first:`, ...versions.map(describeVersion)].join('\n'));
    },
  }),
  defineTool({
    name: 'version_restore',
    title: 'Restore a report version',
    description:
      'Puts the whole report back as it was at an earlier version from its version history. ' +
      'Give `version` as a position from version_list (1 or more; 1 is the latest saved version, which differs from the report as it is now when edits were saved after it) or as a name: an exact name (case ignored) wins, otherwise the newest version whose name contains the text, so part of a date such as "7:07 PM" works too. ' +
      'Positions shift on every save, so the list is read again just before restoring. The state being replaced stays in the version history and an undo point is named before the restore, so a restore can itself be undone.',
    input: {
      report_id: reportIdInput,
      version: z
        .union([z.number().int(), z.string()])
        .describe('Position from version_list (an integer, 1 or more) or the version name or part of it (text).'),
    },
    write: true,
    run: async (ctx, a) => {
      const reportId = reportIdOf(a.report_id);
      const versions = await readVersions(ctx.rap, reportId);
      const v = pickVersion(versions, a.version);
      const what = `version ${v.index} "${v.name}" (revision ${v.revisionNumber})`;
      if (ctx.dryRun) return text(`Would restore report ${reportId} to ${what}.`);
      const res = await ctx.session.restore(reportId, v.revisionNumber, `restore ${v.name}`);
      return {
        ...text(
          `Restored report ${reportId} to ${what}; report version is now ${res.version}.` +
            (res.snapshot ? ` To undo, run version_restore with version "looker-studio-mcp: before restore ${v.name}" (revision ${res.snapshot}).` : ''),
        ),
        audit: { reportId, version: res.version, ...(res.snapshot ? { snapshot: res.snapshot } : {}), detail: `restored ${what}` },
      };
    },
  }),
];
