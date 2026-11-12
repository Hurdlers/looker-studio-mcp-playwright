import type { FeatureExtensions } from '../../core/extensions.js';
import type { Tool } from '../../core/tool.js';
import { chartKinds } from './kinds.js';

export { chartKinds, setupSlots } from './kinds.js';
export const tools: Tool[] = [];
export const extensions: FeatureExtensions = { chartKinds };
