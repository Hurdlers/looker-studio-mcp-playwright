import { tmpdir } from 'node:os';

import type { WorkerTab } from '../browser/worker.js';
import { parseConfig } from '../config.js';
import type { Rap } from '../looker/rap.js';
import { BigQueryClient, type GoogleAccount } from './bigquery.js';
import { LookerError } from './errors.js';
import { Extensions } from './extensions.js';
import { ReportSession } from './session.js';
import type { Tool, ToolContext } from './tool.js';

// Builds a ToolContext from the parts given, with harmless stand-ins for the
// rest. The server uses it, and so can unit tests:
//   const ctx = createContext({ rap: fakeRap });
// The stand-in Google account has no credentials; the stand-in worker fails
// when used and the stand-in browser reports that it is not running.

export type ContextParts = Partial<Omit<ToolContext, 'tools'>> & { rap: Rap; tools?: Iterable<Tool> };

export function createContext(parts: ContextParts): ToolContext {
  const config = parts.config ?? parseConfig({ writes_enabled: true }, parts.home ?? tmpdir());
  const google = parts.google ?? noAccount;
  return {
    rap: parts.rap,
    worker: parts.worker ?? (unavailable('worker tab') as WorkerTab),
    session: parts.session ?? new ReportSession(parts.rap, { snapshots: false }),
    audit: parts.audit ?? { write: async () => undefined },
    home: parts.home ?? config.home,
    config,
    browser: parts.browser ?? { status: async () => ({ running: false, profile: '' }) },
    google,
    bigquery: parts.bigquery ?? new BigQueryClient(google, config.bigquery),
    ext: parts.ext ?? new Extensions(),
    tools: new Map([...(parts.tools ?? [])].map((t) => [t.name, t])),
    dryRun: parts.dryRun ?? false,
  };
}

const noAccount: GoogleAccount = {
  token: async () => {
    throw new LookerError('refused', 'No Google credentials in this context.');
  },
  projectId: async () => undefined,
  email: async () => undefined,
};

function unavailable(what: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'then'
          ? undefined
          : () => {
              throw new Error(`No ${what} in this context.`);
            },
    },
  );
}
