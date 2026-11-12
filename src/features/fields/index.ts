import { blendCreate } from './blends.js';
import { binFieldAdd, groupFieldAdd } from './buckets.js';
import { calculatedFieldAdd } from './calculated.js';
import { reportFilterEdit } from './filters.js';
import { parameterAdd } from './parameters.js';

export const tools = [calculatedFieldAdd, groupFieldAdd, binFieldAdd, parameterAdd, blendCreate, reportFilterEdit];
