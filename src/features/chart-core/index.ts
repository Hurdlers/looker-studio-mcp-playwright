import { chartAdd } from './chart-add.js';
import { componentDelete } from './component-delete.js';
import { componentInspect } from './component-inspect.js';
import { componentList } from './component-list.js';

// chart-core: chart_add (kinds come from chart-types-a/b and community through
// ctx.ext.chartKind; options such as filters and style from other groups'
// updaters), component_list, component_inspect and component_delete.
export const tools = [chartAdd, componentList, componentInspect, componentDelete];
