import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blankTemplate, fieldConcept, formulaConcept, place, RECORD_COUNT, resolveField, setSlot, template } from '../src/core/components.js';
import { fromMapValue, toMapValue } from '../src/core/mapvalue.js';
import { sourceFields, withSchema, type SourceField } from '../src/core/datasource.js';
import type { Rap } from '../src/looker/rap.js';

const FIELDS: SourceField[] = [
  { id: '_sessions_', name: 'sessions', dataType: 3, aggregation: 6 },
  { id: '_device_category_', name: 'Device Category', dataType: 0, aggregation: 0 },
];

describe('templates', () => {
  it('ships the shared templates with a fresh component id each time', () => {
    const a = template('kpi-metric');
    const b = template('kpi-metric');
    expect(a.type).toBe('kpi-metric');
    expect(a.componentId).toMatch(/^cd-[0-9a-f]{10}$/);
    expect(a.componentId).not.toBe(b.componentId);
    expect(template('simple-description').propertyConfig.componentProperty.descriptionProperty).toBeDefined();
  });

  it("finds a group's templates, including community types named by URL", () => {
    const root = mkdtempSync(join(tmpdir(), 'kl-fx-'));
    mkdirSync(join(root, 'community', 'templates'), { recursive: true });
    writeFileSync(join(root, 'community', 'templates', 'datastudio_visualizations_funnel_v4_prod.json'), '{"type":"funnel"}');
    writeFileSync(join(root, 'community', 'templates', 'generic-shape.json'), '{"type":"generic-shape","preset":"shape-rectangle"}');
    writeFileSync(join(root, 'community', 'templates', 'generic-shape.shape-star.json'), '{"type":"generic-shape","preset":"shape-star"}');
    expect(template('gs://datastudio_visualizations/funnel/v4/prod', undefined, root).type).toBe('funnel');
    expect(template('generic-shape', 'shape-star', root).preset).toBe('shape-star');
    // No file of its own: the type's file, with the preset asked for.
    expect(template('generic-shape', 'shape-heart', root).preset).toBe('shape-heart');
    expect(template('generic-shape', undefined, root).preset).toBe('shape-rectangle');
    expect(() => template('nope', undefined, root)).toThrow(/No template/);
  });

  it('takes the data out of an editor component and keeps the styling', () => {
    const blank = blankTemplate({
      componentId: 'cd-x',
      datasourceId: 'ds',
      type: 'simple-barchart',
      conceptDefs: [{ name: 'qt_a' }],
      propertyConfig: {
        componentProperty: {
          dataset: { datasetId: 'ds' },
          dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_a'] } }] },
          sort: [{ sortColumn: 'qt_a' }],
          dateDuration: {},
          barChartProperty: { showStack: true },
        },
      },
    });
    expect(blank).toEqual({
      componentId: 'cd-template',
      type: 'simple-barchart',
      conceptDefs: [],
      propertyConfig: {
        componentProperty: {
          dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: [] } }] },
          sort: [],
          barChartProperty: { showStack: true },
        },
      },
    });
  });
});

describe('blankTemplate', () => {
  it('drops rows per page, pivot sorting and a behavior starting state that names fields', () => {
    const behavior = toMapValue({
      onSelect: [{ action: 'cross-filtering', isControl: true }],
      onSort: [
        {
          action: 'sort',
          isControl: false,
          init: { sortOptions: { sortData: [{ sortDir: 1, sortColumn: { name: 'qt_25ma', dataTransformation: { sourceFieldName: '_sessions_' } } }], isNewSortConfig: true } },
        },
      ],
      onPaginate: [{ action: 'paginate', init: { startRow: 0, rowsCount: 100 } }],
    });
    const blank = blankTemplate({
      type: 'pivot-table',
      behavior,
      propertyConfig: {
        componentProperty: {
          row: 5001,
          pivotTableProperty: { pivotDisplayConfig: { row: [{ sort: [{ sortDir: 0, sortColumn: 'qt_kp' }] }], col: [{ sort: [] }], hierarchy: [] }, fontSize: 16 },
        },
      },
    });
    expect(blank.propertyConfig.componentProperty).toEqual({ pivotTableProperty: { pivotDisplayConfig: { row: [], col: [], hierarchy: [] }, fontSize: 16 } });
    expect(fromMapValue(blank.behavior)).toEqual({
      onSelect: [{ action: 'cross-filtering', isControl: true }],
      // As in a chart the editor just made: the sort list is empty.
      onSort: [{ action: 'sort', isControl: false, init: { sortOptions: { sortData: [], isNewSortConfig: true } } }],
      onPaginate: [{ action: 'paginate', init: { startRow: 0, rowsCount: 100 } }],
    });
    expect(JSON.stringify(blank)).not.toMatch(/qt_|_sessions_/);
  });

  it('leaves a behavior that names no field exactly as stored', () => {
    const behavior = { mapValue: { entry: [{ key: 'onSelect', value: { arrayValue: { value: [{ mapValue: { entry: [{ key: 'opacity', value: { doubleValue: 1 } }] } }] } } }] } };
    expect(blankTemplate({ type: 'x', behavior }).behavior).toEqual(behavior);
  });
});

describe('setSlot', () => {
  const c = () => ({
    conceptDefs: [{ name: 'qt_old' }, { name: 'qt_keep' }],
    propertyConfig: {
      componentProperty: {
        dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_old'] } }] },
        metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_keep'] } }] },
      },
    },
  });

  it('replaces what a slot held and keeps conceptDefs in step', () => {
    const out = setSlot(c(), 'dimensions', 'primary', [{ name: 'qt_new' }]);
    expect(out.propertyConfig.componentProperty.dimensions.labeledConcepts).toEqual([{ key: 'primary', value: { conceptNames: ['qt_new'] } }]);
    expect(out.conceptDefs.map((d: { name: string }) => d.name)).toEqual(['qt_keep', 'qt_new']);
  });

  it('adds a slot the template lacks, and keeps a concept another part still uses', () => {
    const x = c();
    (x.propertyConfig.componentProperty as Record<string, unknown>).sort = [{ sortColumn: 'qt_old' }];
    const out = setSlot(x, 'dimensions', 'breakdown', [{ name: 'qt_b' }]);
    expect(out.propertyConfig.componentProperty.dimensions.labeledConcepts[1]).toEqual({ key: 'breakdown', value: { conceptNames: ['qt_b'] } });
    setSlot(out, 'dimensions', 'primary', []);
    expect(out.conceptDefs.map((d: { name: string }) => d.name)).toEqual(['qt_old', 'qt_keep', 'qt_b']);
  });

  it('replaces the definition of a concept given again under its name', () => {
    const x = c();
    setSlot(x, 'metrics', 'primary', [{ name: 'qt_keep', label: 'Sum' }]);
    expect(x.conceptDefs).toEqual([{ name: 'qt_old' }, { name: 'qt_keep', label: 'Sum' }]);
  });

  it('names the Record Count field every data source has', () => {
    expect(RECORD_COUNT).toBe('datastudio_record_count_system_field_id_98323387');
  });
});

describe('component parts', () => {
  it('places a component by left, top, width and height', () => {
    expect(place({ attributeConfig: { componentAttribute: { flipVertical: false } } }, { left: 1, top: 2, width: 3, height: 4 })).toEqual({
      attributeConfig: { componentAttribute: { flipVertical: false, left: 1, top: 2, width: 3, height: 4 } },
    });
  });

  it('makes field and formula concepts the way the editor does', () => {
    expect(fieldConcept(FIELDS[0]!, { aggregation: 6 }).queryTimeTransformation).toEqual({
      dataTransformation: { sourceFieldName: '_sessions_', aggregation: 6 },
      displayTransformation: { displayName: 'sessions' },
    });
    const f = formulaConcept('SUM(t0._pageviews_) / SUM(t0._sessions_)', 'pages per session');
    expect(f.queryTimeTransformation.dataTransformation).toMatchObject({ sourceFieldName: f.name, aggregation: 7, textFormula: 'SUM(t0._pageviews_) / SUM(t0._sessions_)', formulaOutputDataType: 2 });
  });

  it('keeps a source currency and its options when making an independent field concept', async () => {
    const semanticInfo = { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'EUR' } }] };
    const column = {
      columnType: 1, field: { ns: 't0', name: '_revenue_' }, outputName: 'Revenue', dataType: 5,
      defaultAggregationType: 6, outputSemanticInfo: semanticInfo,
    };
    const rap: Rap = {
      call: async <T>() => ({ published: { datasourceBlock: { fields: [column] } } }) as T,
      callMany: async () => { throw new Error('A schema request is not needed here.'); },
    };
    const field = (await sourceFields(rap, 'source-eur'))[0]!;
    expect(field.semanticType).toBe(12);
    expect(field.outputSemanticInfo).toEqual(semanticInfo);
    const concept = fieldConcept(field, { aggregation: 6 });
    const display = concept.queryTimeTransformation.displayTransformation;
    expect(display.outputSemanticInfo).toEqual(semanticInfo);
    expect(display.outputSemanticInfo.semanticConfig[0].currencyOptions.currencyCode).toBe('EUR');

    // Changing this chart's format must not change the source or another chart.
    display.outputSemanticInfo.semanticConfig[0].currencyOptions.currencyCode = 'GBP';
    expect(field.outputSemanticInfo).toEqual(semanticInfo);
    expect(column.outputSemanticInfo.semanticConfig[0]!.currencyOptions.currencyCode).toBe('EUR');
  });

  it('uses the schema type in field concepts and keeps options when the type is unchanged', () => {
    const [location] = withSchema([
      { id: '_location_', name: 'Location', dataType: 0, aggregation: 0, semanticType: 32, outputSemanticInfo: { semanticConfig: [{ semanticType: 32 }] } },
    ], { schema: { dimensions: [{ name: '_location_', semanticInfo: { semanticConfig: [{ semanticType: 16 }] } }] } });
    expect(location!.semanticType).toBe(16);
    expect(fieldConcept(location!).queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual({ semanticConfig: [{ semanticType: 16 }] });

    const currency = { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'EUR' } }] };
    const [revenue] = withSchema([
      { id: '_revenue_', name: 'Revenue', dataType: 5, aggregation: 6, semanticType: 12, outputSemanticInfo: currency },
    ], { schema: { metrics: [{ name: '_revenue_', semanticInfo: { semanticConfig: [{ semanticType: 12 }] } }] } });
    expect(fieldConcept(revenue!).queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual(currency);
  });

  it('finds fields by id or by the name people see', () => {
    expect(resolveField(FIELDS, '_sessions_').id).toBe('_sessions_');
    expect(resolveField(FIELDS, 'device category').id).toBe('_device_category_');
    expect(resolveField(FIELDS, 'SESSIONS').id).toBe('_sessions_');
    expect(() => resolveField(FIELDS, 'revenue')).toThrow(/No field "revenue".*sessions, Device Category/);
  });
});
