import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import { parseReportId } from '../../looker/view.js';

export const reportIdInput = z.string().describe('Report id or its Looker Studio URL.');

export const dataSourceInput = z
  .string()
  .describe('The data source: its alias as datasource_list shows it (ds1, ds2 …), its id, or its name (case ignored). Two sources with the same name need the alias.');

export function reportIdOf(input: string): string {
  try {
    return parseReportId(input);
  } catch {
    throw new LookerError('invalid', `Not a Looker Studio report id or URL: ${input}. Give the id or the report's link.`);
  }
}
