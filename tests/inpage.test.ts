import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { inPageCode, parseOutcome, waitForCode } from '../src/browser/inpage.js';

interface FakePage {
  document: { visibilityState: string };
  state: Record<string, unknown>;
  mutate: () => void;
}

function fakePage(): FakePage & Record<string, unknown> {
  const observers: Array<() => void> = [];
  class MutationObserver {
    constructor(private readonly cb: () => void) {}
    observe(): void {
      observers.push(this.cb);
    }
    disconnect(): void {
      observers.splice(observers.indexOf(this.cb), 1);
    }
  }
  return {
    document: { visibilityState: 'visible' },
    state: {},
    mutate: () => observers.slice().forEach((cb) => cb()),
    MutationObserver,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
}

async function run(code: string, page: Record<string, unknown>): Promise<unknown> {
  return parseOutcome(await runInNewContext(code, page));
}

describe('inPageCode', () => {
  it('runs the function with its arguments in the worker tab', async () => {
    const code = inPageCode((a: { x: number; y: number }) => a.x + a.y, { x: 2, y: 3 });

    expect(await run(code, fakePage())).toEqual({ ok: true, value: 5, visible: true });
  });

  it('awaits async functions', async () => {
    const code = inPageCode(async (a: { s: string }) => a.s.toUpperCase(), { s: 'ok' });

    expect(await run(code, fakePage())).toMatchObject({ ok: true, value: 'OK' });
  });

  it('reports page errors with their message', async () => {
    const code = inPageCode(() => {
      throw new Error('boom');
    }, {});

    expect(await run(code, fakePage())).toEqual({ ok: false, code: 'page_error', error: 'boom' });
  });

  it('reports a hidden tab', async () => {
    const page = fakePage();
    page.document.visibilityState = 'hidden';

    expect(await run(inPageCode(() => 1, {}), page)).toMatchObject({ ok: true, visible: false });
  });
});

describe('waitForCode', () => {
  it('resolves on the first DOM change that makes the predicate true', async () => {
    const page = fakePage();
    const code = waitForCode(
      (a: { key: string }) => (globalThis as unknown as FakePage).state[a.key],
      { key: 'ready' },
      5_000,
    );

    const pending = run(code, page);
    page.state.ready = 'yes';
    page.mutate();

    expect(await pending).toMatchObject({ ok: true, value: 'yes' });
  });

  it('resolves immediately when the predicate already holds', async () => {
    const code = waitForCode(() => 42, {}, 5_000);

    expect(await run(code, fakePage())).toMatchObject({ ok: true, value: 42 });
  });

  it('times out', async () => {
    const code = waitForCode(() => false, {}, 50);

    expect(await run(code, fakePage())).toMatchObject({ ok: false, code: 'timeout' });
  });
});

describe('parseOutcome', () => {
  it('rejects a value that is not an outcome string', () => {
    expect(() => parseOutcome(7)).toThrow(/unexpected/i);
  });
});
