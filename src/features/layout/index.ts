import type { FeatureExtensions } from '../../core/extensions.js';
import { componentArrangeTool } from './arrange.js';
import { componentDuplicateTool } from './duplicate.js';
import { positionUpdater } from './position.js';
import { componentUpdateTool } from './update.js';

// Layout: where components sit and how they stack. This group owns
// component_update; other groups add its other inputs as updaters.
export const tools = [componentUpdateTool, componentDuplicateTool, componentArrangeTool];

export const extensions: FeatureExtensions = { updaters: [positionUpdater] };
