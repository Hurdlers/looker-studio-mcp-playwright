import { z } from 'zod';

import { editDatasource } from '../../core/datasource.js';
import { defineTool, text } from '../../core/tool.js';
import { id, invalid, nonempty, reportInput, sourceFor, sourceInput, type Json } from './common.js';

const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
const types: Record<string, number> = { text: 1, 'number (whole)': 4, 'number (decimal)': 3, boolean: 2 };

function option(value: string | number | boolean, type: number): Json {
  const fits = type === 1 ? typeof value === 'string' : type === 2 ? typeof value === 'boolean'
    : typeof value === 'number' && (type !== 4 || Number.isInteger(value));
  if (!fits) throw invalid(`Parameter value ${JSON.stringify(value)} does not match its data type.`);
  return type === 2 ? { label: String(value), boolValue: value } : { label: String(value), stringValue: String(value) };
}

export const parameterAdd = defineTool({
  name: 'parameter_add', title: 'Add a parameter',
  description: 'Adds a typed parameter to a report data source. Use it in formulas or parameter controls, with optional allowed values and a matching default.',
  input: {
    report_id: reportInput, data_source: sourceInput, name: nonempty('매개변수의 화면 표시 이름.'),
    id: nonempty('수식에 쓸 ID. 영문자나 밑줄로 시작하며 DS_로 시작할 수 없습니다.').optional(),
    data_type: nonempty('Text, Number (whole), Number (decimal), Boolean 중 하나.').default('Text'),
    values: z.array(scalar).min(1).optional().describe('허용 값 목록. 생략하면 유형에 맞는 값을 자유롭게 넣습니다.'),
    default_value: scalar.optional().describe('처음 사용할 값. 허용 값 목록이 있으면 그 안의 값이어야 합니다.'),
  },
  write: true,
  run: async (ctx, a) => {
    const type = types[a.data_type.toLowerCase()];
    if (!type) throw invalid('Choose Text, Number (whole), Number (decimal), or Boolean for data_type.');
    const candidate = a.name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    const key = a.id ?? (/^[A-Za-z_]/.test(candidate) && !/^DS_/i.test(candidate) ? candidate : id('param_'));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^DS_/i.test(key))
      throw invalid('A parameter id must start with a letter or underscore, contain only letters, digits and underscores, and avoid the DS_ prefix.');
    const options = (a.values ?? []).map((v) => option(v, type));
    const defaultValue = a.default_value === undefined ? [] : [option(a.default_value, type)];
    if (a.values && a.default_value !== undefined && !a.values.includes(a.default_value))
      throw invalid('default_value must be one of the allowed values.');
    const { reportId, source } = await sourceFor(ctx, a.report_id, a.data_source);
    await editDatasource(ctx.rap, reportId, source.datasourceId, (ds) => {
      const resource = (ds.resource ??= {}) as Json;
      const config = (resource.parameterConfiguration ??= {}) as Json;
      const parameters = (config.parameters ??= []) as Json[];
      if (parameters.some((p) => p.key === key) || source.fields.some((f) => f.id === key || f.name === key))
        throw invalid(`Parameter id "${key}" is already used. Choose another id.`);
      const role = { name: key, dataType: type, options, defaultValue, lock: 2 };
      parameters.push({ key, value: {
        parametersModifiedByRoles: [1, 2].map((key) => ({ key, value: structuredClone(role) })),
        parameterDisplayConfiguration: { name: key, displayName: a.name, displayType: type === 2 ? 3 : options.length ? 2 : 1 },
      } });
    }, `add parameter ${key}`);
    return text(`Added parameter "${a.name}" (${key}) to ${source.alias}.`);
  },
});
