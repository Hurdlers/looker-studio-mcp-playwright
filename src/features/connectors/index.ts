import { defineTool, text } from '../../core/tool.js';
import { listConnectors } from '../../connectors/registry.js';

export const tools = [defineTool({
  name: 'connector_list', title: 'List supported data connections',
  description: 'Lists data connectors this MCP can create and their supported connection modes. Use this before choosing a data source; a connector marked unsupported cannot create a report even if a chart design is available.',
  input: {}, write: false,
  run: async () => text(JSON.stringify({ connectors: listConnectors() }, null, 2)),
})];
