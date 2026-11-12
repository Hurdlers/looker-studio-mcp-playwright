import type { FeatureExtensions } from '../../core/extensions.js';
import { embedAdd, embedUrlUpdater } from './embed.js';
import { imageAdd } from './image.js';
import { lineAdd } from './line.js';
import { shapeAdd } from './shape.js';
import { STYLE_TABLES } from './styles.js';
import { textAdd } from './text.js';
import { styleUpdater } from './update.js';

// Static components: text boxes, shapes, lines, images and URL embeds.
export const tools = [textAdd, shapeAdd, lineAdd, imageAdd, embedAdd];

// For component_update (owned by another group): the style labels of these
// component types, the style input (any type with a label table) and the
// embed_url input.
export const extensions: FeatureExtensions = {
  styles: STYLE_TABLES,
  updaters: [styleUpdater, embedUrlUpdater],
};
