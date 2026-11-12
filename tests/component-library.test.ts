import { describe, expect, it } from 'vitest';

import { instantiateComponentRecipe, replaceRecipeValues, type ComponentRecipe } from '../src/core/component-library.js';
import type { SourceField } from '../src/core/datasource.js';

// This native fixture is synthetic. The absolute and share columns bind the
// same amount role, while the title and the plot remain separate components.
function recipe(): ComponentRecipe {
  return {
    version: 1, id: 'amount-share', width: 480, height: 300,
    roles: [
      { key: 'category', kind: 'dimension', label: 'Category' },
      { key: 'amount', kind: 'metric', label: 'Amount', numeric_required: true },
    ],
    text_slots: [{ key: 'title', default: '항목별 지표', format: 'html', max_units: 12 }],
    theme_encoding: { mapValue: { entry: [{ key: 'id', value: { stringValue: '$theme' } }] } },
    page_background: { color: '#172534', opacity: 0.85 },
    notes: ['Bind a new source.'],
    native_components: [
      {
        componentId: 'component_table', type: 'simple-table', datasourceId: '$data_source',
        attributeConfig: { componentAttribute: { left: 0, top: 40, width: 480, height: 260 } },
        propertyConfig: { componentProperty: {
          dataset: { datasetType: 1, datasetId: '$data_source' },
          dimensions: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['dimension'] } }] },
          metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['absolute', 'share'] } }] },
          sort: [{ sortColumn: 'absolute', sortDir: 1 }],
          tableProperty: {
            columnsWidth: [37.125, 282.875, 160], headerColor: { color: '#153347', opacity: 0.8 },
            headerFontColor: { color: '#FFFFFF', themeRef: { index: 2 } },
            fontFamily: 'Roboto', showPagination: false, futureNativeStyle: { keep: [false, 0, 'custom'] },
          },
        } },
        conceptDefs: [
          { id: 't0.dimension', name: 'dimension', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '$role:category' } } },
          { id: 't0.absolute', name: 'absolute', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '$role:amount', aggregation: 6 } } },
          { id: 't0.share', name: 'share', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '$role:amount', aggregation: 6 } }, resultTransformation: { analyticalFunction: 1, isRelativeToBase: false, bypassCanvasFilters: true } },
        ],
      },
      {
        componentId: 'component_title', type: 'simple-description',
        attributeConfig: { componentAttribute: { left: 0, top: 0, width: 480, height: 40 } },
        propertyConfig: { componentProperty: { descriptionProperty: { text: '<b>$text:title</b>', fontSize: 20 } } },
      },
    ],
  };
}

const fields: SourceField[] = [
  { id: '_segment_', name: 'Segment', dataType: 0, aggregation: 0, semanticType: 32 },
  { id: '_amount_', name: 'Amount', dataType: 3, aggregation: 6, semanticType: 33 },
  { id: '_day_', name: 'Day', dataType: 8, aggregation: 0, semanticType: 2, outputSemanticInfo: { semanticConfig: [{ semanticType: 2, dateTimeOptions: { useNativeDateTime: true } }] } },
];
const input = { data_source_id: 'fresh-source', fields, bindings: { category: 'Segment', amount: { field: 'Amount', label: 'Revenue' } } };

describe('instantiateComponentRecipe', () => {
  it('binds a fresh source while retaining native design, amount/share semantics and sorting', () => {
    const source = recipe(), before = structuredClone(source);
    const result = instantiateComponentRecipe(source, { ...input, left: 20, top: 30, texts: { title: 'A < B' } });
    const chart = result.components[0]!;
    expect(chart.datasourceId).toBe('fresh-source');
    expect(chart.propertyConfig.componentProperty.dataset).toEqual({ datasetType: 1, datasetId: 'fresh-source' });
    expect(chart.propertyConfig.componentProperty.tableProperty).toEqual({
      columnsWidth: [37.125, 282.875, 160], headerColor: { color: '#153347', opacity: 0.8 },
      headerFontColor: { color: '#FFFFFF', themeRef: { index: 2 } },
      fontFamily: 'Roboto', showPagination: false, futureNativeStyle: { keep: [false, 0, 'custom'] },
    });
    expect(chart.conceptDefs[1].queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: '_amount_', aggregation: 6 });
    expect(chart.conceptDefs[2].resultTransformation).toEqual({ analyticalFunction: 1, isRelativeToBase: false, bypassCanvasFilters: true });
    expect(chart.conceptDefs[2].queryTimeTransformation.displayTransformation.displayName).toBe('Revenue (비중)');
    expect(chart.propertyConfig.componentProperty.sort).toEqual([{ sortColumn: chart.conceptDefs[1].name, sortDir: 1 }]);
    expect(chart.attributeConfig.componentAttribute).toMatchObject({ left: 20, top: 70 });
    expect(result.components[1]!.propertyConfig.componentProperty.descriptionProperty.text).toBe('<b>A &lt; B</b>');
    expect(result).toMatchObject({ width: 480, height: 300, page_background: { color: '#172534', opacity: 0.85 }, notes: ['Bind a new source.'] });
    expect(result.theme_encoding).toEqual({ mapValue: { entry: [{ key: 'id', value: { stringValue: '$theme' } }] } });
    expect(source).toEqual(before);
    expect(JSON.stringify(result.components)).not.toMatch(/\$role:|\$label:|\$text:|\$data_source/);
  });
});


describe('native display transformations', () => {
  it('keeps a date-to-month display conversion and its native date options', () => {
    const source = recipe();
    source.roles[0] = { key: 'category', kind: 'date', format_type: 4 };
    const chart = source.native_components[0]!;
    chart.propertyConfig.componentProperty.dateRangeDimension = 'dimension';
    chart.conceptDefs[0].queryTimeTransformation.displayTransformation = {
      outputSemanticInfo: { semanticConfig: [{ semanticType: 4, dateTimeOptions: { useNativeDateTime: true, nativeDisplayOption: 2 } }] },
    };
    const result = instantiateComponentRecipe(source, { ...input, bindings: { ...input.bindings, category: 'Day' } });
    const output = result.components[0]!;
    expect(output.conceptDefs[0].queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual({
      semanticConfig: [{ semanticType: 4, dateTimeOptions: { useNativeDateTime: true, nativeDisplayOption: 2 } }],
    });
    expect(output.propertyConfig.componentProperty.dateRangeDimension).toBe(output.conceptDefs[0].name);
    expect(output.conceptDefs[0].queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_day_');
  });
});

function currencyField(code: string): SourceField {
  return { id: '_money_', name: 'Money', dataType: 3, aggregation: 6, semanticType: 12,
    outputSemanticInfo: { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: code, auto: false } }] } };
}

it('uses the newly selected currency or percent type instead of a stale Number display', () => {
  for (const field of [currencyField('EUR'), { ...fields[1]!, id: '_rate_', name: 'Rate', semanticType: 14 }]) {
    const source = recipe();
    source.native_components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation = {
      outputSemanticInfo: { semanticConfig: [{ semanticType: 33 }] },
    };
    const result = instantiateComponentRecipe(source, { ...input, fields: [...fields, field], bindings: { category: 'Segment', amount: field.name } });
    expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation.outputSemanticInfo.semanticConfig[0].semanticType).toBe(field.semanticType);
  }
});

it('preserves an explicit matching currency format and refuses a different currency', () => {
  const source = recipe();
  source.roles[1]!.currency = 'EUR';
  source.native_components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation = {
    outputSemanticInfo: { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'EUR', auto: false, displayStyle: 2 } }] },
  };
  const args = { ...input, fields: [...fields, currencyField('EUR')], bindings: { category: 'Segment', amount: 'Money' } };
  const result = instantiateComponentRecipe(source, args);
  expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual({
    semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'EUR', auto: false, displayStyle: 2 } }],
  });
  expect(() => instantiateComponentRecipe(source, { ...args, fields: [...fields, currencyField('USD')] })).toThrow(/통화.*EUR/);
});

it('enforces Percent as a unit contract and keeps its native format', () => {
  const source = recipe();
  source.roles[1]!.format_type = 14;
  source.native_components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation = {
    outputSemanticInfo: { semanticConfig: [{ semanticType: 14, numberOptions: { precision: 1 } }] },
  };
  expect(() => instantiateComponentRecipe(source, input)).toThrow(/퍼센트/);
  const rate: SourceField = { id: '_rate_', name: 'Rate', dataType: 3, semanticType: 14, aggregation: 1 };
  const result = instantiateComponentRecipe(source, { ...input, fields: [...fields, rate], bindings: { category: 'Segment', amount: 'Rate' } });
  expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.displayTransformation.outputSemanticInfo).toEqual({
    semanticConfig: [{ semanticType: 14, numberOptions: { precision: 1 } }],
  });
});

it('generates independent component and concept identifiers for every addition', () => {
  const first = instantiateComponentRecipe(recipe(), input), second = instantiateComponentRecipe(recipe(), input);
  const ids = (result: typeof first): string[] => result.components.flatMap((component) => [component.componentId, ...(component.conceptDefs ?? []).map((d: any) => d.id)]);
  expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
  expect(first.components[0]!.componentId).toMatch(/^cd-[0-9a-f]+$/);
  expect(first.components[0]!.conceptDefs[0].id).toBe(`t0.${first.components[0]!.conceptDefs[0].name}`);
});

it('keeps concepts local when two original charts used the same concept name', () => {
  const source = recipe();
  source.native_components.push({ ...structuredClone(source.native_components[0]!), componentId: 'component_other' });
  const result = instantiateComponentRecipe(source, input);
  expect(result.components[0]!.conceptDefs[1].name).not.toBe(result.components[2]!.conceptDefs[1].name);
  expect(result.components[2]!.propertyConfig.componentProperty.sort[0].sortColumn).toBe(result.components[2]!.conceptDefs[1].name);
});

it('rebinds source-field object keys and chart behavior without touching style text', () => {
  const source = recipe();
  const chart = source.native_components[0]!;
  chart.behavior = { mapValue: { entry: [{ key: 'sort', value: { mapValue: { entry: [
    { key: 'conceptName', value: { stringValue: 'absolute' } },
    { key: 'sourceFieldName', value: { stringValue: '$role:amount' } },
  ] } } }] } };
  chart.extra = { '$role:category': '$label:category', literal: 'absolute color', sibling: 'component_title' };
  const result = instantiateComponentRecipe(source, input), output = result.components[0]!;
  const entries = output.behavior.mapValue.entry[0].value.mapValue.entry;
  expect(entries[0].value.stringValue).toBe(output.conceptDefs[1].name);
  expect(entries[1].value.stringValue).toBe('_amount_');
  expect(output.extra).toEqual({ _segment_: 'Segment', literal: 'absolute color', sibling: result.components[1]!.componentId });
});

it('keeps two filtered input roles separate even when they originated from one field', () => {
  const source = recipe();
  source.roles.push({ key: 'filtered_amount', kind: 'metric', numeric_required: true, requires_filtered_input: true });
  source.roles[1]!.requires_filtered_input = true;
  source.native_components[0]!.conceptDefs[2].queryTimeTransformation.dataTransformation.sourceFieldName = '$role:filtered_amount';
  expect(() => instantiateComponentRecipe(source, input)).toThrow(/filtered_amount/);
  const mobile: SourceField = { ...fields[1]!, id: '_mobile_amount_', name: 'Mobile amount' };
  const result = instantiateComponentRecipe(source, { ...input, fields: [...fields, mobile], bindings: { ...input.bindings, filtered_amount: 'Mobile amount' } });
  expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_amount_');
  expect(result.components[0]!.conceptDefs[2].queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_mobile_amount_');
});

it('uses source default aggregation for a self-aggregating calculated metric', () => {
  const source = recipe();
  delete source.native_components[0]!.conceptDefs[1].queryTimeTransformation.dataTransformation.aggregation;
  delete source.native_components[0]!.conceptDefs[2].queryTimeTransformation.dataTransformation.aggregation;
  const calculated: SourceField = { id: 'calculated_total', name: 'Calculated total', dataType: 3, semanticType: 33, aggregation: 7, formula: 'SUM(value)' };
  const result = instantiateComponentRecipe(source, { ...input, fields: [...fields, calculated], bindings: { category: 'Segment', amount: 'Calculated total' } });
  expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: 'calculated_total' });
  expect(result.components[0]!.conceptDefs[2].resultTransformation.analyticalFunction).toBe(1);
});

it('does not inherit native SUM for an Auto calculated metric in absolute and share columns', () => {
  const source = recipe(), before = structuredClone(source);
  const calculated: SourceField = {
    id: 'calculated_amount', name: 'Calculated amount', dataType: 3, semanticType: 12,
    aggregation: 7, formula: 'COUNT(category)',
    outputSemanticInfo: { semanticConfig: [{ semanticType: 12, currencyOptions: { currencyCode: 'KRW' } }] },
  };
  const result = instantiateComponentRecipe(source, { ...input, fields: [...fields, calculated], bindings: { category: 'Segment', amount: 'Calculated amount' } });
  for (const index of [1, 2])
    expect(result.components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation).toEqual({ sourceFieldName: 'calculated_amount' });
  expect(result.components[0]!.conceptDefs[2].resultTransformation).toEqual({ analyticalFunction: 1, isRelativeToBase: false, bypassCanvasFilters: true });
  expect(result.components[0]!.conceptDefs[2].queryTimeTransformation.displayTransformation.displayName).toBe('Calculated amount (비중)');
  expect(source).toEqual(before);
});

it.each(['sum', 'none'] as const)('still rejects an explicit %s override for an Auto calculated field', (aggregation) => {
  const calculated: SourceField = { id: 'calculated_amount', name: 'Calculated amount', dataType: 3, semanticType: 33, aggregation: 7, formula: 'COUNT(category)' };
  expect(() => instantiateComponentRecipe(recipe(), { ...input, fields: [...fields, calculated], bindings: { category: 'Segment', amount: { field: 'Calculated amount', aggregation } } })).toThrow('aggregates itself');
});

it.each([6, 1])('preserves native aggregation %s for an ordinary numeric field', (aggregation) => {
  const source = recipe(), ordinary = { ...fields[1]!, aggregation: aggregation === 6 ? 1 : 6 };
  for (const index of [1, 2]) source.native_components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation.aggregation = aggregation;
  const before = structuredClone(source);
  const result = instantiateComponentRecipe(source, { ...input, fields: [fields[0]!, ordinary] });
  for (const index of [1, 2]) expect(result.components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation.aggregation).toBe(aggregation);
  expect(source).toEqual(before);
});

describe('row-level calculated metric aggregation', () => {
  const row: SourceField = { id: 'calc_row_amount', name: 'Row amount', dataType: 3, semanticType: 33, aggregation: 0, kind: 'dimension', formula: 'CASE WHEN value > 0 THEN 10 ELSE 0 END' };
  const unaggregatedRecipe = (aggregation?: number) => {
    const source = recipe();
    for (const index of [1, 2]) {
      const transformation = source.native_components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation;
      if (aggregation === undefined) delete transformation.aggregation;
      else transformation.aggregation = aggregation;
    }
    return source;
  };
  const rowInput = { ...input, fields: [...fields, row], bindings: { category: 'Segment', amount: 'Row amount' } };

  it.each([undefined, 0])('requires an explicit metric aggregation when both the numeric calculation and design provide none (%s)', (aggregation) => {
    const source = unaggregatedRecipe(aggregation), before = structuredClone(source);
    expect(() => instantiateComponentRecipe(source, rowInput)).toThrow(/Row amount.*기본 집계.*none.*SUM\/AVG.*field_update/);
    expect(source).toEqual(before);
    expect(row.aggregation).toBe(0);
  });

  it.each([['sum', 6], ['avg', 1], ['none', 0]] as const)('honors an explicit %s choice without changing the source field', (aggregation, native) => {
    const result = instantiateComponentRecipe(unaggregatedRecipe(), { ...rowInput, bindings: { category: 'Segment', amount: { field: 'Row amount', aggregation } } });
    for (const index of [1, 2]) expect(result.components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation.aggregation).toBe(native);
    expect(row.aggregation).toBe(0);
  });

  it.each([6, 1])('accepts the design aggregation %s for a numeric calculation even when its source kind is dimension', (aggregation) => {
    const result = instantiateComponentRecipe(unaggregatedRecipe(aggregation), rowInput);
    for (const index of [1, 2]) expect(result.components[0]!.conceptDefs[index].queryTimeTransformation.dataTransformation.aggregation).toBe(aggregation);
  });

  it('keeps numeric dimensions, ordinary None fields and text calculation metrics outside this guard', () => {
    expect(() => instantiateComponentRecipe(recipe(), { ...rowInput, bindings: { category: 'Row amount', amount: 'Amount' } })).not.toThrow();
    const ordinary: SourceField = { ...row }; delete ordinary.formula;
    expect(() => instantiateComponentRecipe(unaggregatedRecipe(), { ...rowInput, fields: [...fields, ordinary] })).not.toThrow();
    const text: SourceField = { ...row, dataType: 0, semanticType: 32, formula: 'CONCAT(value, suffix)' };
    const source = unaggregatedRecipe(); source.roles[1]!.numeric_required = false;
    expect(() => instantiateComponentRecipe(source, { ...rowInput, fields: [...fields, text] })).not.toThrow();
  });
});

it('checks aggregation overrides with the same rules as chart creation', () => {
  const result = instantiateComponentRecipe(recipe(), { ...input, bindings: { category: 'Segment', amount: { field: 'Amount', aggregation: 'avg' } } });
  expect(result.components[0]!.conceptDefs[1].queryTimeTransformation.dataTransformation.aggregation).toBe(1);
  const source = recipe();
  source.roles[1]!.numeric_required = false;
  expect(() => instantiateComponentRecipe(source, { ...input, bindings: { category: 'Segment', amount: { field: 'Segment', aggregation: 'sum' } } })).toThrow(/cannot be aggregated/);
});

it.each([
  ['missing role', { category: 'Segment' }, /amount/],
  ['unknown role', { ...input.bindings, unknown: 'Amount' }, /알 수 없는/],
  ['unknown field', { category: 'No such field', amount: 'Amount' }, /No field/],
  ['text metric', { category: 'Segment', amount: 'Segment' }, /숫자/],
])('refuses %s before producing components', (_label, bindings, message) => {
  expect(() => instantiateComponentRecipe(recipe(), { ...input, bindings })).toThrow(message);
});

it('refuses a non-date field for either a date role or a date-format dimension', () => {
  const source = recipe();
  source.roles[0]!.kind = 'date';
  expect(() => instantiateComponentRecipe(source, input)).toThrow(/날짜/);
  source.roles[0]!.kind = 'dimension';
  source.roles[0]!.format_type = 4;
  expect(() => instantiateComponentRecipe(source, input)).toThrow(/날짜/);
});

it.each(['blocked', 'needs_support'])('refuses a recipe marked %s even without blocker text', (status) => {
  expect(() => instantiateComponentRecipe({ ...recipe(), status }, input)).toThrow(/추가 지원/);
});

it('reports blockers and unsupported versions rather than silently dropping native dependencies', () => {
  expect(() => instantiateComponentRecipe({ ...recipe(), blockers: ['An unsupported native calculation'] }, input)).toThrow(/unsupported native calculation/);
  expect(() => instantiateComponentRecipe({ ...recipe(), version: 2 } as unknown as ComponentRecipe, input)).toThrow(/버전/);
});

it('refuses positions and sizes that cannot produce a usable composition', () => {
  for (const left of [-1, NaN, Infinity]) expect(() => instantiateComponentRecipe(recipe(), { ...input, left })).toThrow(/위치/);
  expect(() => instantiateComponentRecipe({ ...recipe(), width: 0 }, input)).toThrow(/크기/);
});

it('rejects long titles instead of shrinking text or overflowing native layout', () => {
  expect(() => instantiateComponentRecipe(recipe(), { ...input, texts: { title: '이 제목은 준비한 공간보다 지나치게 길어서 겹칩니다' } })).toThrow(/짧은 제목/);
  const source = recipe();
  source.text_slots![0]!.max_units = 4;
  expect(instantiateComponentRecipe(source, { ...input, texts: { title: '1234567' } }).components[1]!.propertyConfig.componentProperty.descriptionProperty.text).toBe('<b>1234567</b>');
  expect(() => instantiateComponentRecipe(source, { ...input, texts: { title: '한글다섯글' } })).toThrow(/제목/);
});

it('escapes title markup and clones returned theme, notes and page background', () => {
  const source = recipe();
  source.theme = { palette: ['#153347'], nativeThemeFlag: true };
  source.text_slots![0]!.max_units = 30;
  const result = instantiateComponentRecipe(source, { ...input, texts: { title: '<&">' } });
  expect(result.components[1]!.propertyConfig.componentProperty.descriptionProperty.text).toBe('<b>&lt;&amp;&quot;&gt;</b>');
  result.theme!.palette[0] = '#000000'; result.page_background!.opacity = 0; result.notes.push('changed');
  expect(source.theme).toEqual({ palette: ['#153347'], nativeThemeFlag: true });
  expect(source.page_background).toEqual({ color: '#172534', opacity: 0.85 });
  expect(source.notes).toEqual(['Bind a new source.']);
});

describe('replaceRecipeValues', () => {
  it('replaces exact values and object keys without mutating input or matching substrings', () => {
    const source = { old: [{ value: 'old', text: 'keep old text', nullable: null, flag: false, count: 0 }] };
    expect(replaceRecipeValues(source, new Map([['old', 'new']]))).toEqual({ new: [{ value: 'new', text: 'keep old text', nullable: null, flag: false, count: 0 }] });
    expect(source.old[0]!.value).toBe('old');
  });
});

it('keeps native previous-period comparison, result flags and reference-line links', () => {
  const source = recipe();
  const property = source.native_components[0]!.propertyConfig.componentProperty;
  property.compareDateDuration = { anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } };
  property.lineChartProperty = { referenceLineProperty: [{ referenceLineType: 1, referenceLineMetric: 'share', referenceLineCalculation: 0, referenceLineWeight: 1.25 }] };
  const output = instantiateComponentRecipe(source, input).components[0]!;
  expect(output.propertyConfig.componentProperty.compareDateDuration).toEqual({ anchorType: 1, config: { startOffsetUnit: 9, startOffset: 1, endOffsetUnit: 9, endOffset: 1 } });
  expect(output.propertyConfig.componentProperty.lineChartProperty.referenceLineProperty).toEqual([
    { referenceLineType: 1, referenceLineMetric: output.conceptDefs[2].name, referenceLineCalculation: 0, referenceLineWeight: 1.25 },
  ]);
});
