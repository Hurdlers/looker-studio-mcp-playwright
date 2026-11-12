import { z } from 'zod';

import { resolveField } from '../../core/components.js';
import { editDatasource, resolveSource, sourceFields, type SourceField } from '../../core/datasource.js';
import { isDryRun } from '../../core/dryrun.js';
import { LookerError } from '../../core/errors.js';
import { defineTool, text } from '../../core/tool.js';
import { reportIdInput, reportIdOf } from './inputs.js';
import { AGGREGATIONS, aggregationLabel, checkAggregation, parseType, TYPE_HELP, typeLabel, type AggregationName } from './types.js';

type Json = Record<string, any>;

function findField(fields: SourceField[], ref: string): SourceField {
  try {
    return resolveField(fields, ref);
  } catch (err) {
    if (err instanceof LookerError) throw new LookerError('not_found', err.message);
    throw err;
  }
}

function describeField(f: SourceField, currency?: string): string {
  const kind = f.kind ? `, ${f.kind}` : '';
  return `"${f.name}" (${f.id}): ${typeLabel(f.semanticType, currency)}${kind}, default aggregation ${aggregationLabel(f.aggregation)}`;
}

export const fieldUpdate = defineTool({
  name: 'field_update',
  title: 'Change a data source field',
  description:
    "Changes a field of a report's data source: its type, its default aggregation, or its name, saved in the data source so every chart using it follows. Answers the field's name, type, dimension or metric, and default aggregation as read back. " +
    `type takes the editor's names: ${TYPE_HELP}; a bare name is looked up at the top of the type menu and in every submenu. ` +
    'aggregation sets the default: sum, avg, count, count_distinct, min, max, none, median, std_dev, variance; amounts (sum, avg, median, std_dev, variance) need a numeric type, so change a text field to Number first. ' +
    'name renames the field as charts show it; charts keep pointing at it. type, aggregation and name together are saved at once. ' +
    'Use it after adding a custom query whose column types Looker Studio guessed wrongly. data_source may be left out when the report has one source.',
  input: {
    report_id: reportIdInput,
    data_source: z.string().optional().describe('The data source: alias (ds1 …), id or name. May be left out when the report has only one.'),
    field: z.string().describe('The field, by the name the editor shows (sessions) or its id (_sessions_).'),
    type: z.string().optional().describe('New type, e.g. "Number", "Percent", "Date", "Currency > EUR", "Geo > Country".'),
    aggregation: z
      .enum(Object.keys(AGGREGATIONS) as [AggregationName, ...AggregationName[]])
      .optional()
      .describe('New default aggregation.'),
    name: z.string().optional().describe('New field name (not empty).'),
  },
  write: true,
  run: async (ctx, a) => {
    const newName = a.name?.trim();
    if (a.type === undefined && a.aggregation === undefined && a.name === undefined)
      throw new LookerError('invalid', 'Nothing to change: give type, aggregation or name.');
    if (a.name !== undefined && !newName) throw new LookerError('invalid', 'A field name cannot be empty.');
    const semantic = a.type !== undefined ? parseType(a.type) : undefined;

    const reportId = reportIdOf(a.report_id);
    const doc = await ctx.session.load(reportId);
    const src = await resolveSource(ctx.rap, doc, a.data_source);
    const field = findField(src.fields, a.field);
    if (semantic && field.id.startsWith('datastudio_'))
      throw new LookerError('invalid', `"${field.name}" is a field Looker Studio provides; its type cannot be changed.`);
    if (a.aggregation) checkAggregation(a.aggregation, semantic?.semanticType ?? field.semanticType, field.name);

    await editDatasource(
      ctx.rap,
      reportId,
      src.datasourceId,
      (ds) => {
        const target = (((ds as Json).datasourceBlock?.fields ?? []) as Json[]).find((f) => f.field?.name === field.id);
        if (!target) throw new LookerError('not_found', `Field "${field.name}" (${field.id}) is not in data source ${src.alias}'s field list.`);
        if (semantic) {
          const current = target.outputSemanticInfo?.semanticConfig?.[0];
          // Reapplying a portable type must not discard native options that
          // the public type name cannot express (for example native dates).
          if (current?.semanticType !== semantic.semanticType || current?.currencyOptions?.currencyCode !== semantic.currencyOptions?.currencyCode)
            target.outputSemanticInfo = { ...(target.outputSemanticInfo ?? {}), semanticConfig: [semantic] };
        }
        if (a.aggregation) target.defaultAggregationType = AGGREGATIONS[a.aggregation];
        if (newName) target.outputName = newName;
      },
      `update field ${field.name}`,
    );

    let after: SourceField | undefined;
    if (!isDryRun(ctx.rap)) {
      const fields = await sourceFields(ctx.rap, src.datasourceId, { reportId });
      after = fields.find((f) => f.id === field.id);
      if (!after || (newName && after.name !== newName))
        throw new LookerError('format_changed', `The field was saved but reads back as ${after ? `"${after.name}"` : 'missing'}: Looker Studio may have changed its internal API.`);
    } else
      after = {
        ...field,
        ...(newName ? { name: newName } : {}),
        ...(semantic ? { semanticType: semantic.semanticType } : {}),
        ...(a.aggregation ? { aggregation: AGGREGATIONS[a.aggregation] } : {}),
      };
    return {
      ...text(`Updated field in ${src.alias} "${src.name}": ${describeField(after, semantic?.currencyOptions?.currencyCode)}.`),
      audit: { reportId, detail: `updated field ${field.id} of ${src.alias}` },
    };
  },
});
