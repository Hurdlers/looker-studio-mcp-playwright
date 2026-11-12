// Builds the code strings evaluated in the worker tab. Functions passed here
// are serialized with toString(): they must not close over anything outside
// their own body.

export type OutcomeCode = 'page_error' | 'timeout';

export type Outcome<R = unknown> =
  | { ok: true; value: R; visible: boolean }
  | { ok: false; code: OutcomeCode; error: string };

const TIMEOUT_MARK = '__looker_studio_mcp_timeout__';

export function inPageCode<A, R>(fn: (args: A) => R | Promise<R>, args: A): string {
  return wrap(fn.toString(), args);
}

// Waits inside the page, so waiting costs one round trip instead of a poll
// per check. It re-checks on every DOM change (MutationObserver callbacks
// are not throttled in background tabs, timers are) and every 250 ms for
// conditions no mutation announces.
export function waitForCode<A>(
  predicate: (args: A) => unknown,
  args: A,
  timeoutMs: number,
): string {
  const waiter = `(args) => new Promise((resolve, reject) => {
    const pred = (${predicate.toString()});
    let done = false;
    let queued = false;
    const finish = (settle, v) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearInterval(tick);
      clearTimeout(deadline);
      settle(v);
    };
    const check = async () => {
      queued = false;
      try {
        const v = await pred(args);
        if (v) finish(resolve, v);
      } catch {}
    };
    const schedule = () => {
      if (queued || done) return;
      queued = true;
      Promise.resolve().then(check);
    };
    const obs = new MutationObserver(schedule);
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = setInterval(schedule, 250);
    const deadline = setTimeout(() => finish(reject, new Error(${JSON.stringify(TIMEOUT_MARK)})), ${timeoutMs});
    check();
  })`;
  return wrap(waiter, args);
}

export function parseOutcome<R = unknown>(raw: unknown): Outcome<R> {
  if (typeof raw !== 'string') throw new Error(`Unexpected in-page result: ${JSON.stringify(raw)}`);
  return JSON.parse(raw) as Outcome<R>;
}

function wrap(fnSource: string, args: unknown): string {
  return `(async () => {
  try {
    const value = await (${fnSource})(${JSON.stringify(args)});
    return JSON.stringify({ ok: true, value, visible: document.visibilityState === 'visible' });
  } catch (e) {
    const error = String((e && e.message) || e);
    return JSON.stringify(error === ${JSON.stringify(TIMEOUT_MARK)}
      ? { ok: false, code: 'timeout', error: 'timed out' }
      : { ok: false, code: 'page_error', error });
  }
})()`;
}
