import { randomUUID } from 'node:crypto';

import { defineTool, text } from '../../core/tool.js';
import { safeText } from './common.js';

const SIGN_IN_HELP = 'Run the server\'s "login" command and sign in to Google in the browser window it opens, then retry.';
export const connectionCheck = defineTool({
  name: 'connection_check',
  title: 'Check the browser and Google connection',
  description: 'Checks Google credentials, the server\'s dedicated browser and the signed-in Looker Studio tab, then reports the project and write settings. Use it when preparing a session or diagnosing a connection; failed checks remain readable results and credentials are never included.',
  input: {},
  write: false, readOnlyHint: false,
  run: async (ctx) => {
    const lines: string[] = [];
    try {
      const token = await ctx.google.token();
      if (!token) throw new Error('No Google access token was available. Set up Application Default Credentials.');
      const email = await ctx.google.email().catch(() => undefined);
      lines.push(`BigQuery: OK${email ? ` (${safeText(email)})` : ''}. Token available; project permissions were not tested.`);
    } catch (err) {
      lines.push(`BigQuery: failed — ${safeText(err)}`);
    }
    // The worker tab starts the dedicated browser when it is not running yet.
    let signIn: string;
    try {
      const started = Date.now();
      const page = await ctx.worker.run(() => {
        const preload = (window as unknown as { preload?: { user?: { activeSession?: { emailAddress?: string } } } }).preload;
        return { url: location.href, hasXsrf: /(?:^|;\s*)RAP_XSRF_TOKEN=/.test(document.cookie), email: preload?.user?.activeSession?.emailAddress, visible: document.visibilityState === 'visible' };
      }, null);
      const host = new URL(page.url).hostname;
      if (!['datastudio.google.com', 'lookerstudio.google.com'].includes(host) || !page.hasXsrf)
        signIn = `Looker Studio: failed — not signed in. ${SIGN_IN_HELP}`;
      else {
        // An unguessable title avoids reading the user's report catalog.
        await ctx.rap.call('getShareableList', { type: [0], trashed: false, titleContains: `__connection_${randomUUID()}__`, shareableIds: [], sharedWithMe: false, ownedByMe: true, fromHomePage: false, aclModes: [], projectNumbers: [], reportType: [] });
        signIn = `Looker Studio: signed in${page.email ? ` (${safeText(page.email)})` : ''}. Worker ${page.visible ? 'visible' : 'in the background'}; round trip ${Date.now() - started} ms.`;
      }
    } catch (err) {
      signIn = `Looker Studio: failed — ${safeText(err)}. ${SIGN_IN_HELP}`;
    }
    try {
      const status = await ctx.browser.status();
      lines.push(`Browser: ${status.running ? `OK (${status.version ?? 'Chrome'})` : 'failed — not running'}.`);
    } catch (err) {
      lines.push(`Browser: failed — ${safeText(err)}`);
    }
    lines.push(signIn);
    const project = ctx.config.bigquery.billingProject ?? await ctx.google.projectId().catch(() => undefined);
    lines.push(`Default project: ${project ? safeText(project) : 'not set'}.`);
    lines.push(`Writes: ${ctx.config.writesEnabled ? 'enabled' : 'disabled (read tools only)'}.`);
    lines.push(`Dry run: ${ctx.config.dryRun ? 'enabled' : 'disabled'}.`);
    return text(lines.join('\n'));
  },
});
