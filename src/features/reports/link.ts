import { z } from 'zod';

import { linkConnectionParams } from '../../connectors/registry.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { reportIdOf } from '../data-sources/inputs.js';
import { checkConnector, checkQuery, nameOf, planSource, sourceInput } from './source.js';

export const reportLinkBuild = defineTool({
  name: 'report_link_build',
  title: 'Build a report creation link',
  description: 'Builds a Looker Studio creation URL with BigQuery, Google Sheets or GA4 source substitutions and an optional template. Open the returned link yourself to create and save the report; this tool opens no browser and query parameter options require report_create or datasource_add instead.',
  input: {
    report_name: z.string().describe('링크를 열어 만들 리포트 이름.'),
    template_report_id: z.string().optional().describe('복제할 원본 리포트의 id 또는 URL.'),
    sources: z.array(z.object({ ...sourceInput, alias: z.string().optional().describe('원본 리포트 데이터 소스의 별칭.'), name: z.string().optional().describe('새 데이터 소스 이름. source_name보다 우선합니다.') })).min(1).describe('연결할 BigQuery·Google Sheets·GA4 데이터 소스 목록.'),
  },
  write: false,
  run: async (ctx, input) => {
    const name = nameOf(input.report_name, 'Report name');
    const template = input.template_report_id === undefined ? undefined : reportIdOf(input.template_report_id);
    if (!input.sources.length) throw new LookerError('invalid', 'At least one source is required.');
    for (const source of input.sources) checkConnector(source, true);
    const aliases = input.sources.map((source, i) => source.alias === undefined ? `ds${i}` : nameOf(source.alias, 'Source alias'));
    if (aliases.some((alias) => !/^[A-Za-z0-9_-]+$/.test(alias)))
      throw new LookerError('invalid', 'A source alias may contain letters, digits, underscores and hyphens only.');
    if (new Set(aliases).size !== aliases.length) throw new LookerError('invalid', 'Source aliases must be unique.');
    const plans = await Promise.all(input.sources.map((source) => planSource(ctx, source, true)));
    for (const plan of plans) await checkQuery(ctx, plan);
    const url = new URL('https://lookerstudio.google.com/reporting/create');
    url.searchParams.set('c.mode', 'edit');
    url.searchParams.set('r.reportName', name);
    if (template) url.searchParams.set('c.reportId', template);
    for (const [i, plan] of plans.entries()) {
      const prefix = !template && plans.length === 1 ? 'ds.' : `ds.${aliases[i]}.`;
      const set = (key: string, value: string): void => { url.searchParams.set(prefix + key, value); };
      for (const [key, value] of Object.entries(linkConnectionParams(plan.connection))) set(key, value);
      const source = input.sources[i]!;
      const sourceName = source.name ?? source.source_name;
      if (sourceName !== undefined) set('datasourceName', nameOf(sourceName, 'Data source name'));
    }
    return text(url.toString());
  },
});
