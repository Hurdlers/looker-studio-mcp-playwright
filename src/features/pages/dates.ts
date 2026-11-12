import { LookerError } from '../../core/errors.js';

export type Duration = Record<string, number | string>;

const offset = (su: number, s: number, eu = su, e = s): Duration => ({ startOffsetUnit: su, startOffset: s, endOffsetUnit: eu, endOffset: e });
const presets: Record<string, Duration | undefined> = {
  'Auto date range': undefined,
  Today: offset(3, 0),
  Yesterday: offset(3, 1),
  ...Object.fromEntries([7, 14, 28, 30].map((n) => [`Last ${n} days`, offset(3, n, 3, 1)])),
  'Last week (starts Sunday)': offset(4, 1),
  'Last week (starts Monday)': offset(5, 1),
  'Last month': offset(6, 1),
  'Last quarter': offset(7, 1),
  'Last year': offset(8, 1),
  'This week (starts Sunday)': offset(4, 0),
  'This week (starts Monday)': offset(5, 0),
  'This week to date (starts Sunday)': offset(4, 0, 3, 1),
  'This week to date (starts Monday)': offset(5, 0, 3, 1),
  'This month': offset(6, 0),
  'This month to date': offset(6, 0, 3, 1),
  'This quarter': offset(7, 0),
  'This quarter to date': offset(7, 0, 3, 1),
  'This year': offset(8, 0),
  'This year to date': offset(8, 0, 3, 1),
};

export const DATE_PRESETS = Object.keys(presets);

export function parseDateRange(input: string): Duration | undefined {
  const hit = DATE_PRESETS.find((name) => name.toLowerCase() === input.trim().toLowerCase());
  if (hit) return structuredClone(presets[hit]);
  const fixed = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(input.trim());
  if (fixed) {
    const start = fixed[1]!;
    const end = fixed[2]!;
    if (validDay(start) && validDay(end) && start <= end)
      return { startAnchor: start.replaceAll('-', ''), endAnchor: end.replaceAll('-', '') };
  }
  throw new LookerError('invalid', `Invalid date_range "${input}". Use YYYY-MM-DD..YYYY-MM-DD with valid, ordered dates, or: ${DATE_PRESETS.join(', ')}.`);
}

function validDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;
}
