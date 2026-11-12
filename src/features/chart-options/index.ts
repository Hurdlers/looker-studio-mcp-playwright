import type { FeatureExtensions } from '../../core/extensions.js';
import type { Tool } from '../../core/tool.js';
import { conditionalFormatsUpdater, referenceBandsUpdater, referenceLinesUpdater, seriesUpdater, setupUpdater, valueColorsUpdater } from './appearance.js';
import { chartTypeUpdater, fieldsUpdater, labelsUpdater, sortAscendingUpdater, sortByUpdater, sortsUpdater, titleUpdater } from './data.js';
import { comparisonUpdater, dateRangeDimensionUpdater, dateRangeUpdater } from './dates.js';
import { filterUpdater } from './filters.js';
import { fieldFormatsUpdater } from './formats.js';
import { styleTables } from './styles.js';

export const tools: Tool[] = [];
export const extensions: FeatureExtensions = {
  updaters: [chartTypeUpdater, titleUpdater, fieldsUpdater, labelsUpdater, sortByUpdater, sortAscendingUpdater, filterUpdater, dateRangeUpdater, dateRangeDimensionUpdater,
    comparisonUpdater, sortsUpdater, seriesUpdater, referenceLinesUpdater, referenceBandsUpdater, conditionalFormatsUpdater, valueColorsUpdater, setupUpdater, fieldFormatsUpdater],
  styles: styleTables,
};
