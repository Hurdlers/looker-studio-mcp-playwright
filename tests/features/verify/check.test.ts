import { afterEach, describe, expect, it, vi } from 'vitest';

import { classify } from '../../../src/features/verify/errors.js';
import { chart, looker, success, type Json } from './fake.js';

afterEach(() => vi.useRealTimers());

describe('report_check', () => {
  it('report.check.all_pages: checks data components in navigation order and leaves the report unchanged', async () => {
    const fake = looker();
    const original = structuredClone(fake.doc);
    const text = await fake.check();
    expect(text).toContain('Checked 2 pages: 2 normal / 3 total.');
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('Page 1. Overview | cd-bad');
    expect(text).toContain('configuration');
    expect(text).toContain('broken (_gone_)');
    expect(fake.calls.filter((c) => c.endpoint === 'batchedDataV2')).toHaveLength(3);
    expect(fake.doc).toEqual(original);
    expect(fake.calls.every((c) => !/update|grant|create|publish/i.test(c.endpoint))).toBe(true);
  });

  it.each(['Inner', 'p2', 2])('report.check.page: %s selects one page and one chart', async (page) => {
    const fake = looker();
    expect(await fake.check({ page })).toContain('Checked 1 page: 1 normal / 1 total.');
    const data = fake.calls.filter((c) => c.endpoint === 'batchedDataV2');
    expect(data).toHaveLength(1);
    expect(data[0]!.body.dataRequest[0].requestContext.reportContext.componentId).toBe('cd-table');
  });

  it('report.check.page: missing pages list the available names and do not query data', async () => {
    const fake = looker();
    await expect(fake.check({ page: 'Nope' })).rejects.toMatchObject({ code: 'not_found', message: expect.stringMatching(/Overview.*Inner/) });
    expect(fake.calls.filter((c) => c.endpoint === 'batchedDataV2')).toHaveLength(0);
  });

  it('report.check.timeout: a delayed chart becomes loading while a fast chart remains normal', async () => {
    vi.useFakeTimers();
    const fake = looker();
    fake.doc.page.find((p) => p.pageId === 'p1')!.page.componentConfig = [chart('cd-fast'), chart('cd-slow')];
    fake.delays.set('cd-slow', 6000);
    const pending = fake.check({ page: 'Overview', timeout_seconds: 5 });
    await vi.advanceTimersByTimeAsync(11000);
    const text = await pending;
    expect(text).toContain('1 normal / 2 total');
    expect(text).toContain('cd-slow');
    expect(text).toContain('loading');
    expect(text).toContain('5 seconds');
    expect(text).not.toContain('cd-fast |');
  });

  it('report.check.timeout: loading takes precedence over a concurrently missing field', async () => {
    vi.useFakeTimers();
    const fake = looker();
    fake.delays.set('cd-bad', 6000);
    const pending = fake.check({ page: 'Overview', timeout_seconds: 5 });
    await vi.advanceTimersByTimeAsync(11000);
    const text = await pending;
    expect(text).toContain('cd-bad');
    expect(text).toContain('loading');
    expect(text).not.toContain('configuration');
  });

  it.each([4, 301, 2.5])('report.check.timeout: rejects out-of-range or fractional timeout %s', async (timeout_seconds) => {
    const fake = looker();
    await expect(fake.check({ timeout_seconds })).rejects.toMatchObject({ code: 'invalid' });
    expect(fake.calls).toHaveLength(0);
  });

  it('report.check.timeout: defaults to 30 seconds for each request', async () => {
    const fake = looker();
    await fake.check();
    expect(fake.calls.filter((c) => c.endpoint === 'batchedDataV2').every((c) => c.options?.timeoutMs === 30000)).toBe(true);
  });

  it('report.check.problem.no_data: empty tables are problems while a zero-valued scorecard is normal', async () => {
    const fake = looker();
    fake.doc.page.find((p) => p.pageId === 'p1')!.page.componentConfig = [chart('cd-zero'), chart('cd-empty', 'simple-table')];
    fake.replies.set('cd-empty', success(0));
    fake.replies.set('cd-zero', success(1));
    const text = await fake.check({ page: 'Overview' });
    expect(text).toContain('1 normal / 2 total');
    expect(text).toContain('cd-empty');
    expect(text).toContain('no data');
    expect(text).not.toContain('cd-zero |');
  });

  it('report.check.problem.no_data: inherits page filters in the actual chart request', async () => {
    const fake = looker();
    (fake.doc.report.resource as Json).filter = { entry: [{ key: 'filterempty', value: { datasourceId: 'ds-demo', version: 3, filterDefinition: { filterExpression: { stringValues: ['missing'] } } } }] };
    fake.doc.page.find((p) => p.pageId === 'p2')!.page.propertyConfig = { pageProperty: { filters: ['filterempty'] } };
    fake.replies.set('cd-table', success(0));
    const text = await fake.check({ page: 'Inner' });
    expect(text).toContain('no data');
    const body = fake.calls.find((c) => c.endpoint === 'batchedDataV2')!.body;
    expect(body.dataRequest[0].datasetSpec.filters[0].filterDefinition).toEqual({ filterExpression: { stringValues: ['missing'] } });
  });

  it('report.check.problem.configuration: distinguishes missing dimensions from missing metrics', async () => {
    const fake = looker();
    fake.doc.page.find((p) => p.pageId === 'p1')!.page.componentConfig = [chart('cd-dimension', 'simple-table', '_gone_', 'gone', 'dimensions'), chart('cd-metric', 'kpi-metric', '_gone_', 'broken')];
    const text = await fake.check({ page: 'Overview' });
    expect(text).toContain('Invalid dimension: fields not in the data source: gone (_gone_)');
    expect(text).toContain('Invalid metric: fields not in the data source: broken (_gone_)');
  });

  it('report.check.problem.configuration: reason 267 maps to the editor metric card', async () => {
    const fake = looker();
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { reason: 267 } }] });
    expect(await fake.check({ page: 'Inner' })).toContain('configuration: Invalid metric: This chart has an invalid metric');
  });

  it('report.check.problem.data_set: category cards and reason cards follow editor precedence', async () => {
    const fake = looker();
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { category: 2, endUserMessage: 'The query returned an error.' } }] });
    const category = await fake.check({ page: 'Inner' });
    expect(category).toContain('data set: User Configuration Error: This data source was improperly configured.');
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { category: 2, reason: 98 } }] });
    expect(await fake.check({ page: 'Inner' })).toContain('data set: Too Many Rows:');
  });

  it('report.check.problem.data_set: unrecognized statuses use the System Error fallback', async () => {
    const fake = looker();
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { code: 2 } }] });
    expect(await fake.check({ page: 'Inner' })).toContain('data set: System Error:');
  });

  it('report.check.problem.consent: each denied chart is listed and approval guidance appears once', async () => {
    const fake = looker();
    fake.doc.page.find((p) => p.pageId === 'p1')!.page.componentConfig = [chart('cd-consent-a'), chart('cd-consent-b')];
    for (const id of ['cd-consent-a', 'cd-consent-b']) fake.replies.set(id, { dataResponse: [{ errorStatus: { category: 7 } }] });
    const text = await fake.check({ page: 'Overview' });
    expect(text.match(/consent: Consent required/g)).toHaveLength(2);
    expect(text.match(/Consent: this tool/g)).toHaveLength(1);
    expect(text).toContain('Allow yourself');
    expect(text).toContain('datasource_update');
    expect(fake.calls.some((c) => c.endpoint === 'grantConsent')).toBe(false);
  });

  it('report.check.problem.other: quota cards retain their explanation and classify as error', async () => {
    const fake = looker();
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { category: 4 } }] });
    expect(await fake.check({ page: 'Inner' })).toContain('error: Quota Error: This data set has been accessed too many times.');
  });

  it.each([['Authorization Required', 'error'], ['Timed out', 'error'], ['Too Many Rows', 'data set'], ['Invalid metric', 'configuration']])('report.check.problem.other: classifies %s', (title, kind) => {
    expect(classify(title)).toBe(kind);
  });

  it('report.check.details: joins server message, BigQuery error and id, and lists source and field slots', async () => {
    const fake = looker();
    const c = chart('cd-detail', 'simple-table', '_region_', 'region', 'dimensions');
    c.conceptDefs.push({ name: 'qt_amount', queryTimeTransformation: { dataTransformation: { sourceFieldName: '_amount_' }, displayTransformation: { displayName: 'amount' } } });
    c.propertyConfig.componentProperty.metrics = { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['qt_amount'] } }] };
    c.propertyConfig.componentProperty.tableProperty = { title: 'Failed table' };
    fake.doc.page.find((p) => p.pageId === 'p2')!.page.componentConfig = [c];
    fake.replies.set('cd-detail', { dataResponse: [{ errorStatus: { category: 2, endUserMessage: 'The query returned an error.', uniqueErrorCode: 'ec-test' }, responseMetaSet: { responseMetas: [{ bqResponseMeta: { helixJobStatus: { errorStream: [{ message: 'Division by zero: 1 / 0' }] } } }] } }] });
    const text = await fake.check({ page: 'Inner' });
    expect(text).toContain('Details: The query returned an error. / Division by zero: 1 / 0 / Error ID: ec-test');
    expect(text).toContain('Source: Demo data');
    expect(text).toContain('Dimension: region; Metric: amount');
    expect(text).toContain('"Failed table"');
    expect(fake.calls.filter((call) => call.endpoint === 'getBlockDatasource')).toHaveLength(1);
    expect(fake.calls.filter((call) => call.endpoint === 'batchedDataV2')).toHaveLength(1);
  });

  it('report.check.details: preserves errorDetails messages and redacts credentials', async () => {
    const fake = looker();
    fake.replies.set('cd-table', { dataResponse: [{ errorStatus: { category: 2, errorDetails: { query: { message: 'Query failed ya29.secret-test' } }, uniqueErrorCode: 'demo-error' } }] });
    const text = await fake.check({ page: 'Inner' });
    expect(text).toContain('Query failed [redacted] / Error ID: demo-error');
    expect(text).not.toContain('ya29.');
  });
});
