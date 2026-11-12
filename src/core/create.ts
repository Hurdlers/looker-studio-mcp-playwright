import type { Rap } from '../looker/rap.js';
import { getReportBody } from '../looker/reports.js';
import { DRY_RUN_PAGE, DRY_RUN_REPORT } from './dryrun.js';
import { LookerError } from './errors.js';
import { pageRequest, reportRequest, type ReportDoc } from './session.js';

// A new blank report, made the way the editor's "Create report" button makes
// one: a temporary report from the blank template, then saved for good.
// (A plain createReport call is refused.) In a dry run nothing is made: the
// calls are recorded and the dry run's placeholder report comes back
// (DRY_RUN_REPORT with page DRY_RUN_PAGE for the first one), which later steps
// can read and edit like a real one.

// The blank template the "Create report" button uses.
export const BLANK_TEMPLATE = 'f6be87a0-8b98-42a4-a175-c70e8a461663';

export { DRY_RUN_PAGE, DRY_RUN_REPORT };

export interface CreatedReport {
  reportId: string;
  // Its one page.
  pageId: string;
  name: string;
}

export async function createReport(rap: Rap, name: string): Promise<CreatedReport> {
  const title = name.trim();
  if (!title) throw new LookerError('invalid', 'A report name cannot be empty.');
  const temp = await rap.call<{ reportConfig?: ReportDoc }>('createTempReport', {
    datasourceTemplateConfig: [],
    templateId: BLANK_TEMPLATE,
    reportTitle: title,
    userTimestamp: new Date().toLocaleString('en-US'),
    pluginParameters: [],
    creationType: 4,
  });
  const cfg = temp.reportConfig;
  if (!cfg) throw new LookerError('format_changed', 'createTempReport answered without a report: Looker Studio may have changed its internal API.');
  const res = await rap.call<{ reportConfig?: ReportDoc }>('persistTempReport', {
    dyads: [],
    reportRequest: { ...reportRequest(cfg), sourceReportId: cfg.shareable.id },
    pageRequest: cfg.page.map(pageRequest),
    reportName: title,
    templateId: BLANK_TEMPLATE,
  });
  const reportId = res.reportConfig?.shareable.id;
  if (!reportId) throw new LookerError('format_changed', 'persistTempReport answered without a report id: Looker Studio may have changed its internal API.');
  let pageId = res.reportConfig?.page?.[0]?.pageId;
  if (!pageId) {
    const read = await rap.call<{ reportConfig?: ReportDoc }>('getReport', getReportBody(reportId, true));
    pageId = read.reportConfig?.page?.[0]?.pageId;
  }
  if (!pageId) throw new LookerError('format_changed', `Report ${reportId} was made without a page.`);
  return { reportId, pageId, name: title };
}
