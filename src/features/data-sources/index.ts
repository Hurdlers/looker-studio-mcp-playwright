import { datasourceAdd } from './add.js';
import { fieldUpdate } from './field.js';
import { datasourceList } from './list.js';
import { datasourceRefresh } from './refresh.js';
import { datasourceRemove } from './remove.js';
import { datasourceUpdate } from './update.js';
import { datasourceQuery } from './query.js';

// Data sources of a report: list, add, remove,
// refresh fields, change, and change one field.
export const tools = [datasourceList, datasourceQuery, datasourceAdd, datasourceRemove, datasourceRefresh, datasourceUpdate, fieldUpdate];
