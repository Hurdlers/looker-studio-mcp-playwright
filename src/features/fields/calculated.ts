import { LookerError } from '../../core/errors.js';
import { defineTool } from '../../core/tool.js';
import { appendField, nonempty, reportInput, sourceFor, sourceInput, uniqueName, validate } from './common.js';
import { parameterFormula, canonicalFieldFormula } from './parameter-reference.js';

export const calculatedFieldAdd = defineTool({
  name: 'calculated_field_add', title: 'Add a calculated field',
  description: 'Adds a validated formula to a report data source. Use it when several charts need the same calculation; field names must be unique.',
  input: { report_id: reportInput, name: nonempty('새 계산 필드 이름.'), formula: nonempty('Looker Studio 계산식. 필드의 표시 이름을 쓸 수 있습니다.'), data_source: sourceInput },
  write: true,
  run: async (ctx, a) => {
    const { reportId, doc, source } = await sourceFor(ctx, a.report_id, a.data_source);
    uniqueName(source.fields, a.name);
    let formula = await parameterFormula(ctx, source, a.formula);
    let column;
    try { column = await validate(ctx, doc, source, formula, a.name); }
    catch (error) {
      const canonical = canonicalFieldFormula(source, formula);
      if (!(error instanceof LookerError) || error.code !== 'invalid' || canonical === formula) throw error;
      column = await validate(ctx, doc, source, canonical, a.name);
      formula = canonical;
    }
    // Aggregate metric validation can omit its default aggregation. The
    // editor explicitly persists Auto; otherwise charts may sum it again.
    if (column.conceptType === 1 && column.defaultAggregationType === undefined) column.defaultAggregationType = 7;
    return appendField(ctx, reportId, source, a.name, formula, column);
  },
});
