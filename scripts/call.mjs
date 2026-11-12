// Calls one MCP tool over stdio and prints its text:
//   node scripts/call.mjs <tool> ['{"json":"args"}']
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [tool, rawArgs = '{}'] = process.argv.slice(2);
if (!tool) {
  console.error(`usage: node scripts/call.mjs <tool> '{"arg": "value"}'`);
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'call', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [join(root, 'build/cli.js'), 'serve'] }));
const started = performance.now();
// Some calls (renders, big reports) take longer than the SDK's 60 s default.
const res = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) }, undefined, { timeout: 600_000 });
for (const c of res.content) if (c.type === 'text') console.log(c.text);
console.error(`(${tool}: ${Math.round(performance.now() - started)} ms${res.isError ? ', ERROR' : ''})`);
await client.close();
process.exitCode = res.isError ? 1 : 0;
