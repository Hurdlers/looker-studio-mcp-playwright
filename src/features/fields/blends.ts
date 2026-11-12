import { z } from 'zod';

import { resolveField } from '../../core/components.js';
import { resolveSource, type SourceField } from '../../core/datasource.js';
import { defineTool, text } from '../../core/tool.js';
import { reportIdOf } from '../data-sources/inputs.js';
import { id, invalid, nonempty, numeric, reportInput, type Json } from './common.js';

const joins: Record<string, number> = { inner: 1, 'full outer': 2, 'left outer': 3, 'right outer': 4, cross: 3 };
interface Selected { field: SourceField; concept: Json; metric: boolean }

function select(fields: SourceField[], dimensions: string[], metrics: string[]): Selected[] {
  const seen = new Set<string>();
  return [...dimensions.map((ref) => ({ ref, metric: false })), ...metrics.map((ref) => ({ ref, metric: true }))].flatMap(({ ref, metric }) => {
    const field = resolveField(fields, ref);
    if (seen.has(field.id)) return [];
    seen.add(field.id);
    const name = id('qt_');
    const aggregation = numeric(field) ? field.aggregation === 0 ? 6 : field.aggregation : 3;
    return [{ field, metric, concept: {
      id: { id: `t0.${name}`, name, namespace: 't0' }, semantic: field.semanticType === undefined ? [] : [field.semanticType],
      queryTimeTransformation: { dataTransformation: { sourceFieldName: field.id, ...(metric ? { aggregation } : {}) } },
    } }];
  });
}

function joinKey(choices: Selected[], ref: string, side: string): Selected {
  const want = ref.toLowerCase();
  const matches = choices.filter(({ field, metric }) => !metric && [field.id, field.name].some((name) => name.toLowerCase() === want));
  if (matches.length !== 1) throw invalid(`${side} join key "${ref}" must identify one selected dimension. Available dimensions: ${choices.filter((c) => !c.metric).map((c) => c.field.name).join(', ') || '(none)'}.`);
  return matches[0]!;
}

export const blendCreate = defineTool({
  name: 'blend_create', title: 'Create a blend',
  description: 'Combines selected fields from two to five report data sources. Use dimension pairs for keyed joins or an empty key list for a cross join.',
  input: {
    report_id: reportInput, name: nonempty('새 혼합 데이터 이름.'),
    tables: z.array(z.object({ data_source: nonempty('테이블의 데이터 소스 별칭, 이름 또는 ID.'),
      dimensions: z.array(nonempty('선택할 차원 이름 또는 ID.')).default([]).describe('조인 키로 쓸 차원과 출력할 차원.'),
      metrics: z.array(nonempty('선택할 지표 이름 또는 ID.')).default([]).describe('출력할 지표.'),
    })).min(2).max(5).describe('혼합할 데이터 소스. 각 테이블에 차원이나 지표가 하나 이상 있어야 합니다.'),
    joins: z.array(z.object({ type: nonempty('left outer, right outer, inner, full outer, cross 중 하나.').default('left outer'),
      keys: z.array(z.tuple([nonempty('앞 테이블들에서 선택한 차원.'), nonempty('이번 테이블에서 선택한 차원.')])).default([]).describe('왼쪽과 오른쪽 차원의 쌍. cross는 빈 목록입니다.'),
    })).describe('두 번째 테이블부터 앞쪽 테이블들과 잇는 방법. 테이블 수보다 하나 적어야 합니다.'),
  },
  write: true,
  run: async (ctx, a) => {
    if (a.joins.length !== a.tables.length - 1) throw invalid('Provide exactly one join for every table after the first.');
    for (const table of a.tables) if (!table.dimensions.length && !table.metrics.length) throw invalid('Every table needs at least one selected dimension or metric.');
    const joinSpecs = a.joins.map((join) => {
      const type = join.type.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (joins[type] === undefined) throw invalid(`Unknown join type "${join.type}". Choose left outer, right outer, inner, full outer or cross.`);
      if (type === 'cross' ? join.keys.length !== 0 : join.keys.length === 0)
        throw invalid(type === 'cross' ? 'Cross joins require an empty key list.' : 'A keyed join needs at least one dimension pair.');
      return { ...join, type };
    });
    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const tables: Array<{ source: string; fields: Selected[] }> = [];
    for (const table of a.tables) {
      const source = await resolveSource(ctx.rap, doc, table.data_source);
      tables.push({ source: source.datasourceId, fields: select(source.fields, table.dimensions, table.metrics) });
    }
    const query = (table: typeof tables[number]) => ({ query: { datasourceId: table.source, concepts: table.fields.map((f) => f.concept) } });
    let tree: Json = query(tables[0]!);
    const leftFields = [...tables[0]!.fields];
    for (let i = 0; i < joinSpecs.length; i++) {
      const spec = joinSpecs[i]!;
      const right = tables[i + 1]!;
      const usedLeft = new Set<string>(), usedRight = new Set<string>();
      const conditions = spec.keys.map(([l, r]) => {
        const left = joinKey(leftFields, l, 'Left'), selected = joinKey(right.fields, r, 'Right');
        const leftName = left.concept.id.name as string, rightName = selected.concept.id.name as string;
        if (usedLeft.has(leftName) || usedRight.has(rightName)) throw invalid('A dimension may appear only once in a join condition.');
        usedLeft.add(leftName); usedRight.add(rightName);
        return { boolean: { joinKeyPair: { leftName, rightName } } };
      });
      tree = { join: { type: joins[spec.type], ...(spec.type === 'cross' ? {} : { condition: { and: { conditions } } }), left: tree, right: query(right) } };
      leftFields.push(...right.fields);
    }
    const blockId = id('block_'), key = id('dataViewResource');
    const outputNames = new Set<string>();
    const columns = tables.flatMap((table, tableIndex) => table.fields.map(({ field, concept }) => {
      let outputName = field.name, suffix = 2;
      while (outputNames.has(outputName.toLowerCase())) outputName = `${field.name} (${suffix++})`;
      outputNames.add(outputName.toLowerCase());
      const name = `${id('calc_')}_dv${tableIndex}`;
      return { columnType: 1, field: { ns: 't0', name, simpleName: name }, outputName, dataType: field.dataType,
        defaultAggregationType: 0, enabled: true, ...(field.outputSemanticInfo ? { outputSemanticInfo: structuredClone(field.outputSemanticInfo) } : {}),
        queryTimeTransformation: { dataTransformation: { sourceFieldName: concept.id.name } } };
    }));
    const blockDatasource = {
      datasourceBlock: { id: blockId, type: 1, inputBlockIds: [], outputBlockIds: [], name: a.name, fields: columns },
      blocks: [{ id: blockId, type: 6, isExperimental: true, inputBlockIds: [], outputBlockIds: [], fields: [], treeQueryBlockConfig: tree }],
      delegatedAccessEnabled: true, isUnlocked: true, isCacheable: false, allowNativeFunctions: false,
    };
    const result = await ctx.session.editReport(reportId, (d) => {
      const resource = (d.report.resource ??= {}) as Json;
      const blends = (resource.dataViewResource ??= {}) as Json;
      const entries = (blends.entry ??= []) as Json[];
      if (entries.some((e) => e.key === key)) return;
      entries.push({ key, value: { blockDatasource } });
    }, `create blend ${a.name}`);
    return { ...text(`Created blend "${a.name}" (${key}).`), audit: { reportId, version: result.version, ...(result.snapshot ? { snapshot: result.snapshot } : {}) } };
  },
});
