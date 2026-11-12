import type { UpdateTarget } from '../../core/extensions.js';
import { toMapValue } from '../../core/mapvalue.js';
import type { ToolContext } from '../../core/tool.js';
import { controlSource, invalid, prop, putFields, type ControlKind, type Json } from './model.js';

// Keep field changes on controls subject to the same slot and type rules as
// creation. Control behavior also carries the selected dimension concept.
export async function applyControlFields(target: UpdateTarget, fields: Record<string, string[]>, ctx: ToolContext): Promise<void> {
  const c = target.component;
  const kinds: Record<string, ControlKind> = {
    default: 'drop_down', 'control-open-list': 'fixed_size_list',
    'control-textbox': 'input_box', 'control-search-all': 'advanced_filter',
    'control-slider': 'slider', 'control-checkbox': 'checkbox',
  };
  const kind = kinds[c.preset ?? 'default'];
  if (!kind) throw invalid('This control preset does not support field updates.');
  if (prop(c).dimensionFilterProperty?.controlParameter)
    throw invalid('Field updates are unavailable for parameter controls. Use a field-based control.');
  const id = c.datasourceId ?? prop(c).dataset?.datasetId;
  if (!id) throw invalid('The control needs a data source before changing its fields.');
  const source = await controlSource(ctx, target.doc, target.page.pageId, String(id));
  putFields(c, kind, fields, source.fields);
  const name = prop(c).dimensions?.labeledConcepts?.find((slot: Json) => slot.key === 'primary')?.value?.conceptNames?.[0];
  if (!name && !prop(c).dimensionFilterProperty?.controlParameter)
    throw invalid('A field-based control needs a populated Control field slot.');
  if (kind === 'fixed_size_list' || kind === 'slider') {
    const concept = c.conceptDefs.find((entry: Json) => entry.name === name);
    c.behavior = toMapValue({ onSelect: [{ action: 'lego-dimension-filter', isControl: true, init: { dConcept: concept } }] }, c.behavior);
  }
}
