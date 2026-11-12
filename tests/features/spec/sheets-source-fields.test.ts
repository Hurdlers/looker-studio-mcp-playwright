import { describe, expect, it } from 'vitest';

import { resolveField } from '../../../src/core/components.js';
import { blockFields } from '../../../src/core/datasource.js';
import type { Json, Source } from '../../../src/features/spec/model.js';
import { exportFieldOverrides, overridesDiffer } from '../../../src/features/spec/source-fields.js';

function sheetsSource(options: { renamed?: boolean; duplicate?: boolean; labelOnly?: boolean; noHeader?: boolean } = {}): Source {
  const raw: Json = {
    field: { ns: 't0', name: 'B' },
    ...(!options.labelOnly && !options.noHeader ? { outputName: 'Category' } : {}),
    mutableVersion: { ns: 't0', name: '_sheet_category_', ...(!options.noHeader ? { label: 'Category' } : {}) },
    dataType: 0,
  };
  const output: Json = {
    field: { ns: 't0', name: '_sheet_category_' }, immutableVersion: { ns: 't0', name: 'B' },
    outputName: options.renamed ? 'Segment' : 'Category', columnType: 1, createdBy: 1,
    outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] }, dataType: 0, defaultAggregationType: 0,
  };
  const columns = options.duplicate ? [raw, { ...structuredClone(raw), field: { name: 'C' }, mutableVersion: { name: '_other_category_', label: 'category' }, outputName: 'category' }] : [raw];
  const fields = options.duplicate ? [output, { ...structuredClone(output), field: { name: '_other_category_' }, immutableVersion: { name: 'C' }, outputName: 'category' }] : [output];
  const block = { blocks: [{ connectorBlockConfig: { connectorConfig: { datasourceType: 8, sheetsConfig: { key: 'example_sheet', sheetId: '0' } } }, fields: columns }], datasourceBlock: { fields } };
  return { id: 'source-id', name: 'Sheet data', alias: 'ds1', block, fields: blockFields({ published: block }) };
}

describe('portable Sheets field overrides', () => {
  it('addresses a recreated field by its header instead of an immutable column letter or generated id', () => {
    const source = sheetsSource(), notes: string[] = [];
    const overrides = exportFieldOverrides(source, notes);
    expect(overrides).toEqual([{ field: 'Category', type: 'Text' }]);
    const recreated = sheetsSource();
    recreated.fields[0]!.id = '_different_generated_id_';
    expect(resolveField(recreated.fields, overrides[0]!.field).name).toBe('Category');
    expect(notes).toEqual([]);
  });

  it('keeps the original header as the target when restoring a renamed field', () => {
    const source = sheetsSource({ renamed: true }), notes: string[] = [];
    const overrides = exportFieldOverrides(source, notes);
    expect(overrides).toEqual([{ field: 'Category', name: 'Segment', type: 'Text' }]);
    expect(overridesDiffer(source, overrides)).toBe(false);
    expect(overridesDiffer(source, [{ field: 'Category', name: 'Other' }])).toBe(true);
    expect(overridesDiffer(source, [{ field: 'Category', type: 'Number' }])).toBe(true);
  });

  it('checks renamed overrides against their connector identity when another output uses the original header', () => {
    const source = sheetsSource({ renamed: true });
    source.fields.unshift({ ...source.fields[0]!, id: '_another_field_', name: 'Category' });
    expect(overridesDiffer(source, [{ field: 'Category', name: 'Segment', type: 'Text' }])).toBe(false);
  });

  it('uses the connector mutable label when outputName is absent', () => {
    expect(exportFieldOverrides(sheetsSource({ labelOnly: true }), [])).toEqual([{ field: 'Category', type: 'Text' }]);
  });

  it('does not silently target the first of duplicate case-insensitive headers', () => {
    const source = sheetsSource({ duplicate: true }), notes: string[] = [];
    expect(exportFieldOverrides(source, notes)).toEqual([]);
    expect(notes.join('\n')).toContain('ambiguous');
    expect(overridesDiffer(source, [{ field: 'Category', type: 'Text' }])).toBe(true);
  });

  it('reports missing header metadata instead of exporting an unusable column letter', () => {
    const notes: string[] = [];
    expect(exportFieldOverrides(sheetsSource({ noHeader: true }), notes)).toEqual([]);
    expect(notes.join('\n')).toContain('header');
  });
});
