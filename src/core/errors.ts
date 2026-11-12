import { isTransient, RapError } from '../looker/rap.js';

// Failures a tool reports to the AI. Each code says what to do next:
//   version_conflict  someone saved the report meanwhile and the edit no longer applies: read it again
//   not_found         no such report, page, component or data source (or no access to it)
//   busy              Looker Studio kept rate-limiting or failing: try again later
//   format_changed    Looker Studio refused a request it used to accept: its internal API may have changed
//   refused           a safety rule blocked the call before it was sent
//   invalid           the input does not describe something Looker Studio can do
export type LookerErrorCode = 'version_conflict' | 'not_found' | 'busy' | 'format_changed' | 'refused' | 'invalid';

export class LookerError extends Error {
  override readonly name = 'LookerError';

  constructor(
    readonly code: LookerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// What a failed internal API call means for the caller.
export function explain(err: unknown): LookerError | undefined {
  if (err instanceof LookerError) return err;
  if (!(err instanceof RapError)) return undefined;
  if (isTransient(err.status)) return new LookerError('busy', `Looker Studio is busy (${err.endpoint}): try again in a minute.`);
  if (err.status === 404 || err.status === 403)
    return new LookerError('not_found', `${err.endpoint}: not found, or this account cannot open it.`);
  if (err.status === 400 && /"code":\s*3\b/.test(err.message))
    return new LookerError(
      'format_changed',
      `${err.endpoint} refused the request (${reason(err.message)}). Either the input is wrong or Looker Studio changed its internal API.`,
    );
  return undefined;
}

function reason(message: string): string {
  return /"reasonStr":"([A-Z_]+)"/.exec(message)?.[1] ?? 'no reason given';
}
