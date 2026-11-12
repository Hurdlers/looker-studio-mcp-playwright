import { describe, expect, it } from 'vitest';

import { checkPage } from '../../../src/core/check.js';
import { problemFor } from '../../../src/features/verify/errors.js';
import { chart, looker, type Json } from './fake.js';

const metric = () => {
  const component = chart('cd-null', 'google://devrel/gauge');
  component.conceptDefs[0].queryTimeTransformation.dataTransformation.aggregation = 6;
  component.propertyConfig.componentProperty.metrics.labeledConcepts[0].key = '0';
  component.propertyConfig.componentProperty.dimensions = { labeledConcepts: [] };
  return component;
};
const scalar = (column: Json = { nullIndex: [0] }, overrides: Json = {}): Json => ({ dataResponse: [{ dataSubset: [{ dataset: { tableDataset: {
  columnInfo: [{ ns: 't0', name: 'qt_cd-null' }], totalCount: 1, column: [column], size: 1,
  metadata: { columnMetadata: [{ imageContainsDynamicData: false }] }, ...overrides,
} } }] }] });
const check = { componentId: 'cd-null', type: 'google://devrel/gauge', ok: true, rows: 1 };
const problem = (raw: Json, component = metric()) => problemFor(check, component, raw, 30);

describe('empty scalar metric diagnostics', () => {
  it('report_check reports a NULL aggregate instead of counting its physical row as normal', async () => {
    const fake = looker();
    fake.doc.page.find((page) => page.pageId === 'p1')!.page.componentConfig = [metric()];
    fake.replies.set('cd-null', scalar());
    const before = structuredClone(fake.doc);
    const text = await fake.check({ page: 'Overview' });
    expect(text).toContain('0 normal / 1 total');
    expect(text).toContain('cd-null');
    expect(text).toContain('no data: aggregate metric is NULL');
    expect(fake.doc).toEqual(before);
    expect(fake.calls.some((call) => /update|grant|publish|create/i.test(call.endpoint))).toBe(false);
  });

  it('preserves successful requests and the returned aggregate row count in the core API', async () => {
    const fake = looker();
    fake.doc.page.find((page) => page.pageId === 'p1')!.page.componentConfig = [metric()];
    fake.replies.set('cd-null', scalar());
    expect(await checkPage(fake.rap, fake.doc, 'p1')).toEqual([check]);
  });

  it('describes the empty metric value without inventing a server error card', () => {
    expect(problem(scalar())).toMatchObject({ kind: 'no data', message: expect.stringContaining('aggregate metric is NULL') });
    expect(problem(scalar())?.message).not.toContain('Invalid Metric Value');
  });

  it('reports a size-only NULL scalar while keeping a size-only zero scalar normal', async () => {
    const fake = looker();
    const empty = metric(); empty.type = 'kpi-metric';
    const zero = metric(); zero.componentId = 'cd-zero'; zero.type = 'kpi-metric';
    fake.doc.page.find((page) => page.pageId === 'p1')!.page.componentConfig = [empty, zero];
    const nullReply = scalar({ nullIndex: [0] });
    const zeroReply = scalar({ nullIndex: [], longColumn: { values: ['0'] } });
    delete nullReply.dataResponse[0].dataSubset[0].dataset.tableDataset.totalCount;
    delete zeroReply.dataResponse[0].dataSubset[0].dataset.tableDataset.totalCount;
    fake.replies.set('cd-null', nullReply);
    fake.replies.set('cd-zero', zeroReply);
    const before = structuredClone(fake.doc);
    const text = await fake.check({ page: 'Overview' });
    expect(text).toContain('1 normal / 2 total');
    expect(text).toContain('cd-null');
    expect(text).toContain('no data: aggregate metric is NULL');
    expect(text).not.toContain('cd-zero');
    expect(fake.doc).toEqual(before);
    expect(fake.calls.some((call) => /update|grant|publish|create/i.test(call.endpoint))).toBe(false);
  });

  it('accepts missing totalCount only when the size-only scalar shape is unambiguous', () => {
    expect(problem(scalar({ nullIndex: [0] }, { totalCount: undefined, size: 1 }))?.kind).toBe('no data');
    for (const size of [undefined, null, false, true, '1', 0, -1, 1.5, NaN, Infinity])
      expect(problem(scalar({ nullIndex: [0] }, { totalCount: undefined, size }))).toBeUndefined();
    for (const totalCount of [null, false, 0, 2])
      expect(problem(scalar({ nullIndex: [0] }, { totalCount, size: 1 }))).toBeUndefined();
    expect(problem(scalar({ nullIndex: [0] }, { totalCount: '1', size: '1' }))?.kind).toBe('no data');
  });

  it('requires every selected metric to be NULL and maps columns by name rather than order', () => {
    const component = metric(); component.type = 'simple-table';
    component.conceptDefs.push({ name: 'qt_other' });
    component.propertyConfig.componentProperty.metrics.labeledConcepts[0].value.conceptNames.push('qt_other');
    const raw = scalar({ nullIndex: [0] }, { columnInfo: [{ ns: 't0', name: 'qt_other' }, { ns: 't0', name: 'qt_cd-null' }], column: [{ nullIndex: [0] }, { nullIndex: [0] }] });
    expect(problem(raw, component)?.kind).toBe('no data');
    raw.dataResponse[0].dataSubset[0].dataset.tableDataset.column[0] = { longColumn: { values: ['0'] } };
    expect(problem(raw, component)).toBeUndefined();
  });

  it.each([
    { longColumn: { values: ['0'] } },
    { doubleColumn: { values: [0] }, nullIndex: [] },
    { stringColumn: { values: [''] } },
    { boolColumn: { values: [false] } },
    {},
  ])('does not confuse a non-NULL zero, blank, false or unspecified value with NULL: %j', (column) => {
    expect(problem(scalar(column))).toBeUndefined();
  });

  it('does not classify a mixture of NULL and non-NULL rows as empty', () => {
    expect(problem(scalar({ nullIndex: [0], longColumn: { values: ['2'] } }, { totalCount: 2, size: 2 }))).toBeUndefined();
  });

  it.each([
    { columnInfo: undefined }, { column: undefined }, { size: undefined },
    { size: 1, totalCount: 2 }, { columnInfo: [{ ns: 't1', name: 'qt_cd-null' }] },
    { columnInfo: [{ ns: 't0', name: 'unrelated' }] },
    { columnInfo: [{ ns: 't0', name: 'qt_cd-null' }, { ns: 't0', name: 'qt_cd-null' }] },
  ])('does not infer an empty aggregate from missing or ambiguous metadata: %j', (metadata) => {
    expect(problem(scalar({ nullIndex: [0] }, metadata))).toBeUndefined();
  });

  it('leaves a dimension-only NULL result outside scalar metric diagnostics', () => {
    const component = chart('cd-null', 'simple-table', '_amount_', 'amount', 'dimensions');
    expect(problem(scalar(), component)).toBeUndefined();
  });

  it('leaves grouped charts outside scalar metric diagnostics', () => {
    const component = metric(); component.type = 'simple-table';
    component.propertyConfig.componentProperty.dimensions.labeledConcepts.push({ key: 'primary', value: { conceptNames: ['qt_group'] } });
    expect(problem(scalar(), component)).toBeUndefined();
  });

  it('ignores NULL columns that are not selected metrics', () => {
    const raw = scalar({ longColumn: { values: ['0'] } });
    const table = raw.dataResponse[0].dataSubset[0].dataset.tableDataset;
    table.columnInfo.push({ ns: 't0', name: 'qt_unused' }); table.column.push({ nullIndex: [0] });
    expect(problem(raw)).toBeUndefined();
  });

  it('does not treat a NULL comparison result as an empty main result', () => {
    const raw = scalar({ longColumn: { values: ['0'] } });
    raw.dataResponse[0].dataSubset.push(scalar().dataResponse[0].dataSubset[0]);
    expect(problem(raw)).toBeUndefined();
  });

  it('retains server errors, missing fields and timeout precedence', () => {
    const raw = scalar(); raw.dataResponse[0].errorStatus = { category: 7 };
    expect(problem(raw)?.kind).toBe('consent');
    expect(problemFor({ ...check, ok: false, error: 'fields not in the data source: _amount_' }, metric(), scalar(), 30)?.kind).toBe('configuration');
    expect(problemFor({ ...check, timedOut: true }, metric(), scalar(), 30)?.kind).toBe('loading');
  });
});
