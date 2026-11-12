import type { FeatureExtensions } from '../../core/extensions.js';
import { controlAdd } from './add.js';
import { buttonUpdater } from './button.js';
import { styleTables } from './styles.js';

export const tools = [controlAdd];
export const extensions: FeatureExtensions = { updaters: [buttonUpdater], styles: styleTables };
