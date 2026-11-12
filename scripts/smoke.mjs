// End-to-end check over stdio, as an MCP client sees the server. Touches only
// the reports named on the command line:
//   node scripts/smoke.mjs <report-id> [<report-id>…] [--shot out.png]
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const args = process.argv.slice(2);
const shotAt = args.indexOf('--shot');
if (shotAt >= 0 && (!args[shotAt + 1] || args[shotAt + 1].startsWith('--'))) {
  console.error('--shot needs an output PNG path.');
  process.exit(1);
}
const shotPath = shotAt >= 0 ? args.splice(shotAt, 2)[1] : undefined;
const ids = args;
if (!ids.length) {
  console.error('usage: node scripts/smoke.mjs <report-id> [<report-id>…] [--shot out.png]');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [join(root, 'build/cli.js'), 'serve'] }));

async function call(name, a = {}) {
  const started = performance.now();
  const res = await client.callTool({ name, arguments: a });
  const ms = Math.round(performance.now() - started);
  const textPart = res.content.find((c) => c.type === 'text')?.text ?? '';
  console.log(`\n## ${name} — ${ms} ms${res.isError ? ' (ERROR)' : ''}\n${textPart.split('\n').slice(0, 10).join('\n')}`);
  if (res.isError) throw new Error(`${name} failed: ${textPart}`);
  return res;
}

try {
  console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
  await call('connection_check');
  for (const id of ids) {
    await call('page_list', { report_id: id });
    await call('component_list', { report_id: id });
  }
  if (shotPath) {
    const shot = await call('report_render', { report_id: ids[0] });
    const image = shot.content.find((c) => c.type === 'image');
    if (!image) throw new Error('report_render returned no PNG. See the PDF path in its output.');
    if (image) {
      writeFileSync(shotPath, Buffer.from(image.data, 'base64'));
      console.log(`image → ${shotPath}`);
    }
  }
} finally {
  await client.close();
}
