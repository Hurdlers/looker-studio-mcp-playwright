import { z } from 'zod';

import { LookerError } from '../../core/errors.js';
import type { ReportDoc } from '../../core/session.js';
import { parseReportId } from '../../looker/view.js';

export type Json = Record<string, any>;
export const reportInput = z.string().min(1).describe('리포트 ID 또는 Looker Studio 리포트 URL.');

export function reportIdOf(input: string): string {
  try { return parseReportId(input); }
  catch { throw new LookerError('invalid', `Invalid report reference: ${input}. Supply a Looker Studio report id or URL.`); }
}

export function components(doc: ReportDoc, pageId: string): Json[] {
  return [...(doc.page.find((p) => p.pageId === pageId)?.page.componentConfig ?? []), ...(doc.report.componentConfig ?? [])];
}

// Credentials can appear in transport errors; only a redacted explanation
// belongs in a diagnostic result.
export function safeText(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw
    .replace(/ya29\.[A-Za-z0-9._~-]+/g, '[redacted]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/((?:access_token|refresh_token|id_token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[redacted]');
}
