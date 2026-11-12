import type { Tool } from '../../core/tool.js';
import { batchApply, reportSpecApply } from './apply.js';
import { reportSpecExport } from './export.js';

export const tools: Tool[] = [reportSpecExport, reportSpecApply, batchApply];
