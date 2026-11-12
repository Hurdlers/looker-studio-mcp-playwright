import { describe, expect, it } from 'vitest';

import { GuardedRap, SHARING } from '../src/core/guard.js';
import type { Rap } from '../src/looker/rap.js';

function inner() {
  const sent: string[] = [];
  const rap: Rap = {
    call: async (endpoint) => {
      sent.push(endpoint);
      return {} as never;
    },
    callMany: async (requests) => {
      sent.push(...requests.map((r) => r.endpoint));
      return requests.map(() => ({ ok: true, value: {} as never }));
    },
  };
  return { rap, sent };
}

const endpoints = new Set(['getReport', 'updatePage', 'deleteShareable', 'createTempReport', 'shareReport', 'getShareableList']);

describe('GuardedRap', () => {
  it('passes reads and writes the policy allows', async () => {
    const { rap, sent } = inner();
    const guarded = new GuardedRap(rap, { endpoints, canWrite: (id) => id === 'lab1' });

    await guarded.call('getReport', { reportId: 'other1' });
    await guarded.call('updatePage', { reportId: 'lab1' });
    await guarded.call('createTempReport', {});

    expect(sent).toEqual(['getReport', 'updatePage', 'createTempReport']);
  });

  it('refuses writes to other reports before sending anything', async () => {
    const { rap, sent } = inner();
    const guarded = new GuardedRap(rap, { endpoints, canWrite: (id) => id === 'lab1' });

    await expect(guarded.call('updatePage', { reportId: 'other1' })).rejects.toMatchObject({ code: 'refused' });
    await expect(guarded.callMany([{ endpoint: 'getReport', body: {} }, { endpoint: 'deleteShareable', body: { id: 'other1' } }])).rejects.toMatchObject({
      code: 'refused',
    });
    expect(sent).toEqual([]);
  });

  it('never calls sharing or mail, even when listed, and nothing unlisted', async () => {
    const { rap } = inner();
    const guarded = new GuardedRap(rap, { endpoints, canWrite: () => true });

    await expect(guarded.call('shareReport', {})).rejects.toThrow(/never called/);
    await expect(guarded.call('copyReport', {})).rejects.toThrow(/not an allowed endpoint/);
    await expect(guarded.call('getShareableList', {})).resolves.toEqual({});
  });

  it.each(['batchSchedule', 'toggleScheduleStatus', 'setLinkSharing', 'updateSharing', 'sendEmail', 'getEmbedCode', 'transferOwnership'])(
    'treats %s as sharing or mail',
    (endpoint) => {
      expect(SHARING.test(endpoint)).toBe(true);
    },
  );

  it.each(['getShareableList', 'deleteShareable', 'getShareablesById', 'updatePage', 'publishReport'])('lets %s through the sharing rule', (endpoint) => {
    expect(SHARING.test(endpoint)).toBe(false);
  });

  it('lets an experiment call an unknown write only with ids it made, and learns the ids writes answer with', async () => {
    const lab = new Set(['00000000-0000-4000-8000-00000000000a']);
    const made = '00000000-0000-4000-8000-00000000000b';
    const other = '00000000-0000-4000-8000-0000000000ff';
    const sent: unknown[] = [];
    const rap: Rap = {
      call: async (endpoint, body) => {
        sent.push(endpoint);
        return (endpoint === 'createThing' ? { thing: { id: made } } : { listed: [other] }) as never;
      },
      callMany: async () => [],
    };
    const guarded = new GuardedRap(rap, {
      endpoints: new Set(['createThing', 'renameThing', 'getThings']),
      canWrite: () => true,
      owned: { reads: new Set(['getThings']), owns: (id) => lab.has(id), learn: (ids) => ids.forEach((id) => lab.add(id)) },
    });

    await guarded.call('getThings', { ids: [other] });
    await expect(guarded.call('renameThing', { id: other })).rejects.toThrow(/did not create/);
    await guarded.call('createThing', { reportId: [...lab][0] });
    await guarded.call('renameThing', { id: made });

    expect(sent).toEqual(['getThings', 'createThing', 'renameThing']);
    expect(lab.has(other)).toBe(false);
  });
});

describe('convertEmbeddedDatasource', () => {
  const rap = () =>
    new GuardedRap({ call: async () => ({}) as never, callMany: async () => [] }, {
      endpoints: new Set(['convertEmbeddedDatasource']),
      canWrite: (id) => id === 'mine',
      canWriteSource: (id) => id === 'd',
    });

  it('is allowed only when it leaves sharing untouched', async () => {
    await rap().call('convertEmbeddedDatasource', { reportId: 'mine', datasourceId: 'd', updateSharing: false });
    await expect(rap().call('convertEmbeddedDatasource', { reportId: 'mine', datasourceId: 'd', updateSharing: true })).rejects.toThrow(/never called/);
    await expect(rap().call('convertEmbeddedDatasource', { reportId: 'mine', datasourceId: 'd' })).rejects.toThrow(/never called/);
    await expect(rap().call('convertEmbeddedDatasource', { reportId: 'other', datasourceId: 'd', updateSharing: false })).rejects.toThrow(/not allowed/);
  });
});

describe('write targets', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const OTHER = '00000000-0000-4000-8000-0000000000ff';
  const all = new Set([
    'deleteClaim', 'updateDataAccessControl', 'updateRemovedState', 'renameDatasource', 'grantConsent', 'copyReport',
    'getBlockDatasource', 'createBlockDatasource', 'publishDatasource',
  ]);
  function guarded(answers: Record<string, unknown> = {}, policy: Partial<ConstructorParameters<typeof GuardedRap>[1]> = {}) {
    const sent: Array<{ endpoint: string; body: unknown }> = [];
    const rap: Rap = {
      call: async (endpoint, body) => {
        sent.push({ endpoint, body });
        return (answers[endpoint] ?? {}) as never;
      },
      callMany: async () => [],
    };
    return { sent, rap: new GuardedRap(rap, { endpoints: all, canWrite: (id) => id === A, ...policy }) };
  }

  it.each([
    ['deleteClaim', { reportId: OTHER, datasourceId: 'd' }],
    ['updateDataAccessControl', { reportId: OTHER, datasourceId: 'd', delegatedAccessEnabled: true }],
    ['updateRemovedState', { id: OTHER, removed: true, type: 0 }],
  ])('%s needs a report the policy may write', async (endpoint, body) => {
    const { rap, sent } = guarded({}, { canWriteSource: (id) => id === 'd' });
    await expect(rap.call(endpoint, body)).rejects.toThrow(/not allowed/);
    await rap.call(endpoint, { ...body, ...('id' in body ? { id: A } : { reportId: A }) });
    expect(sent).toHaveLength(1);
  });

  it('renameDatasource needs a data source the policy may write, or one embedded in a writable report', async () => {
    const { rap, sent } = guarded({ getBlockDatasource: { embeddedInReportId: A } });
    await expect(rap.call('renameDatasource', { datasourceId: 'dsX', title: 't' })).rejects.toThrow(/data source dsX/);
    await rap.call('getBlockDatasource', { datasourceId: 'dsX' });
    await rap.call('renameDatasource', { datasourceId: 'dsX', title: 't' });

    const own = guarded({}, { canWriteSource: (id) => id === 'dsMine' });
    await own.rap.call('renameDatasource', { datasourceId: 'dsMine', title: 't' });
    expect([...sent, ...own.sent].map((s) => s.endpoint)).toEqual(['getBlockDatasource', 'renameDatasource', 'renameDatasource']);
  });

  it('lets a data source it saw created be published and renamed, even without a report (reusable)', async () => {
    const { rap } = guarded({ createBlockDatasource: { datasource: { datasourceId: '00000000-0000-4000-8000-0000000000d1' } } });
    await expect(rap.call('publishDatasource', { draft: { datasourceId: '00000000-0000-4000-8000-0000000000d1' } })).rejects.toThrow(/not allowed/);
    await rap.call('createBlockDatasource', { name: 'x', datasource: {} });
    await rap.call('publishDatasource', { draft: { datasourceId: '00000000-0000-4000-8000-0000000000d1' } });
    await rap.call('renameDatasource', { datasourceId: '00000000-0000-4000-8000-0000000000d1', title: 'x' });
  });

  it('publishes a draft only for its own data source, not on the strength of the report', async () => {
    const { rap } = guarded();
    await expect(rap.call('publishDatasource', { draft: { datasourceId: 'someone-elses' }, reportId: A })).rejects.toThrow(/data source someone-elses/);
  });

  it('grants consent only for a community visualization on a writable report', async () => {
    const { rap, sent } = guarded({}, { canWriteSource: (id) => id === 'dsMine' });
    await rap.call('grantConsent', { vizPermitted: { reportId: A, vizId: 'gs://x::y', manifestFingerprint: 'f', type: 1 } });
    await expect(rap.call('grantConsent', { vizPermitted: { reportId: OTHER, vizId: 'v' } })).rejects.toThrow(/not allowed/);
    for (const body of [
      // The viewer email consent passes the signed-in account's email on: refused too.
      { parameter: { consent: [{ consentType: 1, approval: 1 }], datasourceId: 'dsMine' } },
      { parameter: { consent: [{ consentType: 4, approval: 1 }], datasourceId: 'dsMine' } },
      { auditLogging: { reportId: A } },
      { externalImage: { reportId: A } },
      { communityVizViewersCreds: { reportId: A } },
      { vizPermitted: { reportId: A }, auditLogging: {} },
      {},
    ])
      await expect(rap.call('grantConsent', body)).rejects.toMatchObject({ code: 'refused' });
    expect(sent).toHaveLength(1);
  });

  it('changes credentials or converts only a data source it may write, not any source next to a writable report', async () => {
    const { rap, sent } = guarded({ getBlockDatasource: { embeddedInReportId: A } }, { endpoints: new Set([...all, 'convertEmbeddedDatasource']) });
    await expect(rap.call('updateDataAccessControl', { reportId: A, datasourceId: 'foreign', delegatedAccessEnabled: true })).rejects.toThrow(/data source foreign/);
    await expect(rap.call('convertEmbeddedDatasource', { reportId: A, datasourceId: 'foreign', updateSharing: false })).rejects.toThrow(/data source foreign/);
    await rap.call('getBlockDatasource', { datasourceId: 'dsIn' });
    await rap.call('updateDataAccessControl', { reportId: A, datasourceId: 'dsIn', delegatedAccessEnabled: true });
    await rap.call('convertEmbeddedDatasource', { reportId: A, datasourceId: 'dsIn', updateSharing: false });
    expect(sent.map((s) => s.endpoint)).toEqual(['getBlockDatasource', 'updateDataAccessControl', 'convertEmbeddedDatasource']);
  });

  it.each([
    ['updatePage', { pageId: 'p1' }],
    ['deleteClaim', { reportId: A }],
    ['publishDatasource', { draft: {}, reportId: A }],
    ['updateDataAccessControl', { reportId: A }],
    ['renameDatasource', { title: 't' }],
    ['deleteShareable', { type: 1 }],
    ['copyReport', {}],
  ])('refuses %s when the body names no target', async (endpoint, body) => {
    const { rap, sent } = guarded({}, { canWrite: () => true, canWriteSource: () => true, endpoints: new Set([...all, 'updatePage', 'deleteShareable']) });
    await expect(rap.call(endpoint, body)).rejects.toThrow(/names no/);
    expect(sent).toEqual([]);
  });

  it('judges a shareable of type 1 as a data source', async () => {
    const { rap, sent } = guarded({}, { endpoints: new Set([...all, 'deleteShareable']), canWriteSource: (id) => id === 'dsMine' });
    await expect(rap.call('deleteShareable', { id: A, type: 1 })).rejects.toThrow(/data source/);
    await expect(rap.call('updateRemovedState', { id: 'dsOther', removed: true, type: 1 })).rejects.toThrow(/data source dsOther/);
    await rap.call('deleteShareable', { id: 'dsMine', type: 1 });
    await rap.call('updateRemovedState', { id: A, removed: true, type: 0 });
    expect(sent.map((s) => s.endpoint)).toEqual(['deleteShareable', 'updateRemovedState']);
  });

  it('checks the report a GET request reads, falling back to canWrite without canRead', async () => {
    const { rap, sent } = guarded({}, { endpoints: new Set([...all, 'getImageV2', 'getThing']) });
    await rap.call('getImageV2', { reportId: A, id: 'img' }, undefined, 'get');
    await expect(rap.call('getImageV2', { reportId: OTHER, id: 'img' }, undefined, 'get')).rejects.toThrow(/outside the reports/);
    await expect(rap.call('getImageV2', { id: 'img' }, undefined, 'get')).rejects.toThrow(/names no report/);
    await expect(rap.call('getThing', { reportId: OTHER }, undefined, 'get')).rejects.toThrow(/outside the reports/);
    const reader = guarded({}, { endpoints: new Set([...all, 'getImageV2']), canRead: (id) => id === OTHER });
    await reader.rap.call('getImageV2', { reportId: OTHER, id: 'img' }, undefined, 'get');
    expect(sent).toHaveLength(1);
  });

  it('copies nothing without canRead unless it may write the source', async () => {
    const { rap } = guarded();
    await expect(rap.call('copyReport', { reportId: OTHER }, undefined, 'form')).rejects.toThrow(/outside the reports/);
    await rap.call('copyReport', { reportId: A }, undefined, 'form');
  });

  it('makes writable only the id a create made, not other ids its answer mentions', async () => {
    const temp = '00000000-0000-4000-8000-0000000000e1';
    const theirs = '00000000-0000-4000-8000-0000000000e2';
    const { rap } = guarded(
      { createTempReport: { reportConfig: { shareable: { id: temp }, report: { resource: { datasourceAlias: [{ datasourceId: theirs, alias: 'ds1' }] } } } } },
      { endpoints: new Set([...all, 'createTempReport', 'updatePage']), canWriteSource: () => false },
    );
    await rap.call('createTempReport', { templateId: 'tpl' });
    await rap.call('updatePage', { reportId: temp });
    await expect(rap.call('renameDatasource', { datasourceId: theirs, title: 'x' })).rejects.toThrow(/not allowed/);
    await expect(rap.call('updatePage', { reportId: theirs })).rejects.toThrow(/not allowed/);
  });

  it('lets checkEmbed through the sharing rule with a URL only', async () => {
    const { rap } = guarded({}, { endpoints: new Set([...all, 'checkEmbed']) });
    await rap.call('checkEmbed', { url: 'https://example.com' });
    await expect(rap.call('checkEmbed', { url: 'https://example.com', reportId: A })).rejects.toThrow(/never called/);
  });

  it('copies a report it may read (not write), and may then write the copy', async () => {
    const copy = '00000000-0000-4000-8000-0000000000c1';
    const { rap, sent } = guarded(
      { copyReport: { url: `https://lookerstudio.google.com/reporting/${copy}` } },
      { canRead: (id) => id === OTHER },
    );
    await rap.call('copyReport', { reportId: OTHER, datasourceMap: '{}' }, undefined, 'form');
    await expect(rap.call('copyReport', { reportId: '00000000-0000-4000-8000-0000000000ee' })).rejects.toThrow(/outside the reports/);
    await rap.call('updateRemovedState', { id: copy, removed: true, type: 0 });
    await expect(rap.call('updateRemovedState', { id: OTHER, removed: true, type: 0 })).rejects.toThrow(/not allowed/);
    expect(sent.map((s) => s.endpoint)).toEqual(['copyReport', 'updateRemovedState']);
  });

  it('keeps refusing sharing, and lets convertEmbeddedDatasource through only without sharing', async () => {
    const { rap } = guarded({}, { endpoints: new Set([...all, 'convertEmbeddedDatasource', 'updateReportSharing']), canWriteSource: (id) => id === 'd' });
    await expect(rap.call('updateReportSharing', { reportId: A })).rejects.toThrow(/never called/);
    await rap.call('convertEmbeddedDatasource', { reportId: A, datasourceId: 'd', updateSharing: false });
    await expect(rap.call('convertEmbeddedDatasource', { reportId: A, datasourceId: 'd', updateSharing: true })).rejects.toThrow(/never called/);
  });
});
