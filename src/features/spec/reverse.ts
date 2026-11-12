import type { ToolContext } from '../../core/tool.js';
import type { Json, Source, Spec, State } from './model.js';
import { exportFieldOverrides } from './source-fields.js';
import { parseType, typeLabel } from '../data-sources/types.js';
import { ga4Config } from '../../connectors/ga4.js';

export const AGGREGATIONS: Record<number, string> = { 0: 'none', 1: 'avg', 2: 'count', 3: 'count_distinct', 4: 'max', 5: 'min', 6: 'sum' };
const CONDITIONS: Record<string, string> = { EQ: 'equals', IN: 'in', PT: 'contains', BW: 'starts_with', BT: 'between', GTE: 'gte', GT: 'gt', LTE: 'lte', LT: 'lt', NU: 'is_null', RM: 'regexp_match', RC: 'regexp_contains' };
const GROUP_CONDITIONS = ['unknown', 'equals', 'contains', 'starts_with', 'unknown', 'between', 'gte', 'gt', 'lte', 'lt', 'is_null', 'regexp_match', 'regexp_contains', 'unknown', 'unknown', 'in'];
export const property = (component: Json): Json => component.propertyConfig?.componentProperty ?? {};
export const sourceOf = (concept?: Json): string | undefined => concept?.queryTimeTransformation?.dataTransformation?.sourceFieldName;
export const fieldName = (source: Source | undefined, id: string): string => source?.fields.find((field) => field.id === id)?.name ?? (id === 'datastudio_record_count_system_field_id_98323387' ? 'Record Count' : id);
export const color = (value: unknown): unknown => {
  if (typeof value === 'string') return value === 'transparent' ? undefined : /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(value) ? value.toUpperCase() : value;
  if (value && typeof value === 'object') {
    const item = value as Json;
    if (item.color === 'transparent' || item.opacity === 0) return undefined;
    if (typeof item.color === 'string') return item.opacity === undefined || item.opacity === 1 ? color(item.color) : { color: color(item.color), opacity: item.opacity };
  }
  return value;
};

export function filterSpecs(keys: string[], state: State): Json[] {
  const entries: Json[] = (state.doc.report.resource as Json | undefined)?.filter?.entry ?? [];
  const clause = (definition: Json, source?: Source): Json | undefined => {
    const expression = definition.filterExpression;
    if (!expression) return undefined;
    const id = expression.queryTimeTransformation?.dataTransformation?.sourceFieldName ?? expression.sourceFieldName ?? expression.concept?.name;
    if (!id) { state.notes.push('A filter expression has no readable field and was omitted.'); return undefined; }
    if (!CONDITIONS[expression.filterConditionType]) state.notes.push(`Filter condition ${expression.filterConditionType} has no known alias; its original code was retained.`);
    return { field: fieldName(source, id), condition: CONDITIONS[expression.filterConditionType] ?? expression.filterConditionType,
      values: (expression.numberValues?.length ? expression.numberValues : expression.stringValues ?? []).map(String), ...(expression.include === false ? { exclude: true } : {}) };
  };
  return keys.map((key) => {
    const entry = entries.find((item) => item.key === key)?.value;
    if (!entry) { state.notes.push(`Filter ${key} has no resource definition; only its name was retained.`); return { name: key }; }
    const source = state.sources.find((item) => item.id === entry.datasourceId);
    const definition = entry.filterDefinition ?? {};
    const one = clause(definition, source);
    if (one) return { name: entry.name, ...one };
    const groups: Json[] = definition.and?.filterDefinitions ?? [definition];
    const clauses = groups.map((group) => (group.or?.filterDefinitions ?? [group]).flatMap((item: Json) => { const found = clause(item, source); return found ? [found] : []; })).filter((group) => group.length);
    return clauses.length ? { name: entry.name, clauses } : { name: entry.name };
  });
}

export function settingsOf(ctx: ToolContext, target: Json, scope: 'page' | 'report', state: State): Json | undefined {
  const p = target.propertyConfig?.[scope === 'page' ? 'pageProperty' : 'reportProperty'] ?? {};
  const source = state.sources.find((entry) => entry.id === p.dataset?.datasetId);
  const out: Json = {};
  if (p.dataset?.datasetId) out.data_source = source?.name ?? p.dataset.datasetId;
  if (p.dateRangeDimension) {
    const concept = (target.conceptDefs ?? []).find((entry: Json) => entry.name === p.dateRangeDimension);
    if (sourceOf(concept)) out.date_range_dimension = fieldName(source, sourceOf(concept)!);
  }
  if (p.dateDuration) {
    const range = ctx.ext.updater('date_range')?.read?.({ propertyConfig: { componentProperty: { dateDuration: p.dateDuration } } }, state.doc);
    if (range !== undefined) out.date_range = range;
    else state.notes.push(`${scope} has a date range that the current tools cannot reproduce.`);
  }
  if (p.filters?.length) out.filters = filterSpecs(p.filters, state);
  if (scope === 'page') {
    const style: Json = {}, a = target.attributeConfig?.pageAttribute ?? {};
    if (p.backgroundColor && color(p.backgroundColor) !== undefined) style['Page background'] = color(p.backgroundColor);
    if (a.width !== undefined) style['Width (px)'] = a.width;
    if (a.height !== undefined) style['Height (px)'] = a.height;
    if (Object.keys(style).length) out.style = style;
  }
  return Object.keys(out).length ? out : undefined;
}

function parameterValue(value: Json, type: number): unknown {
  const plain = value.stringValue ?? value.int64Value ?? value.doubleValue ?? value.boolValue;
  if (plain === undefined) return undefined;
  return type === 3 || type === 4 ? Number(plain) : type === 2 ? plain === true || plain === 'true' : String(plain);
}

function publicFormula(source: Source, value: unknown): string {
  const names = new Map(source.fields.map((field) => [field.id.toLowerCase(), field.name]));
  const ids = [...names.keys()].sort((a, b) => b.length - a.length).map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const reference = ids.length ? new RegExp(`(?<![.\\p{L}\\p{N}_\\uE000])(?:t0\\.)?(${ids.join('|')})(?![\\p{L}\\p{N}_]|\\s*\\()`, 'giu') : undefined;
  // String contents and comments are not references, even when they contain an ID.
  return String(value).split(/('(?:\\.|''|[^'\\])*'|"(?:\\.|""|[^"\\])*"|\/\*[\s\S]*?\*\/|--[^\n]*)/g).map((part, i) => {
    if (i % 2) return part;
    const fields = reference ? part.replace(reference, (_, id: string) => names.get(id.toLowerCase())!) : part;
    return fields.replace(/\uE000([A-Za-z_][A-Za-z0-9_.]*)/g, '$1');
  }).join('');
}

// Formula validation supplies an inferred type and aggregation. Persisted
// field settings can differ, so restore them after recreating the formula.
function calculatedSettings(column: Json, label: string, notes: string[]): Json {
  const settings: Json = {};
  const semantics: Json[] = column.outputSemanticInfo?.semanticConfig ?? [];
  const semantic = semantics[0];
  if (semantic) {
    const type = semantic.semanticType === 12 && semantic.currencyOptions?.currencyCode
      ? `Currency > ${semantic.currencyOptions.currencyCode}` : typeLabel(semantic.semanticType);
    try {
      if (parseType(type).semanticType === semantic.semanticType) settings.type = type;
      else notes.push(`${label}: calculated field type ${semantic.semanticType} cannot be reproduced by field_update.`);
    } catch { notes.push(`${label}: calculated field type ${semantic.semanticType} cannot be reproduced by field_update.`); }
    const { semanticType: _type, currencyOptions, ...extra } = semantic;
    if (currencyOptions) {
      const { currencyCode: _code, ...other } = currencyOptions;
      if (Object.keys(other).length) extra.currencyOptions = other;
    }
    if (Object.keys(extra).length) notes.push(`${label}: calculated field semantic options ${JSON.stringify(extra)} cannot be set through field_update; preservation depends on formula validation.`);
  }
  if (semantics.length > 1) notes.push(`${label}: additional calculated field semantic configurations cannot be reproduced by field_update.`);
  const aggregation = column.defaultAggregationType;
  // Auto is restored by formula validation, not a second aggregation.
  if (aggregation !== undefined && aggregation !== 7) {
    if (AGGREGATIONS[aggregation] !== undefined) settings.aggregation = AGGREGATIONS[aggregation];
    else notes.push(`${label}: calculated field aggregation ${aggregation} cannot be reproduced by field_update.`);
  }
  return settings;
}

export function exportSources(state: State): Pick<Spec, 'data_sources'> & Json {
  const out: Json = { data_sources: [], parameters: [], calculated_fields: [], group_fields: [], bin_fields: [], blends: [] };
  for (const source of state.sources) {
    const connection = source.block.blocks?.find((block: Json) => block.connectorBlockConfig?.connectorConfig)?.connectorBlockConfig?.connectorConfig;
    if (connection?.datasourceType === 8 && connection.sheetsConfig) {
      const config = connection.sheetsConfig;
      if (typeof config.key !== 'string' || !config.key || config.sheetId === undefined || config.sheetId === null || String(config.sheetId) === '') {
        state.notes.push(`${source.name}: Google Sheets connection has no spreadsheet or worksheet id; source was omitted.`); continue;
      }
      if (['hasHeader', 'includeHiddenCells', 'includeFilteredCells'].some((key) => typeof config[key] !== 'boolean')) {
        state.notes.push(`${source.name}: Google Sheets header or cell inclusion settings are missing; their saved defaults are unknown, so source was omitted.`); continue;
      }
      const hidden = config.includeHiddenCells, filtered = config.includeFilteredCells;
      if (hidden !== filtered) {
        state.notes.push(`${source.name}: Google Sheets hidden and filtered cell settings differ; include_hidden_and_filtered_cells cannot preserve both, so source was omitted.`); continue;
      }
      out.data_sources.push({ name: source.name, connector: 'google_sheets', spreadsheet: config.key, worksheet_id: String(config.sheetId),
        use_first_row_as_headers: config.hasHeader, include_hidden_and_filtered_cells: hidden,
        ...(config.range !== undefined ? { range: config.range } : {}) });
    } else if (connection?.datasourceType === 1) {
      const config = ga4Config(connection);
      if (!config) { state.notes.push(`${source.name}: Analytics connection is not a reproducible GA4 property configuration; source was omitted.`); continue; }
      out.data_sources.push({ name: source.name, connector: 'ga4', account_id: config.accountId, property_id: config.propertyId });
    } else if (connection?.datasourceType === 2 && connection.bigQueryConnectorConfig) {
      const config = connection.bigQueryConnectorConfig;
      const params: Json[] = connection.parameterConfiguration?.parameters ?? [];
      if (params.some((entry) => entry.key === 'DS_USER_EMAIL') || /DS_USER_EMAIL/i.test(connection.sql ?? '')) { state.notes.push(`${source.name}: viewer email parameter export is deferred; source was omitted.`); continue; }
      out.data_sources.push({ name: source.name, project_id: connection.sql ? config.billingProjectId ?? config.projectId : config.projectId,
        ...(connection.sql ? { sql: connection.sql, ...(params.some((entry) => ['DS_START_DATE', 'DS_END_DATE'].includes(entry.key)) ? { date_range_params: true } : {}) } : { dataset_id: config.datasetId, table_id: config.tableId }) });
    } else { state.notes.push(`${source.name}: 지원하지 않는 커넥터; source was omitted.`); continue; }
    const overrides = exportFieldOverrides(source, state.notes);
    if (overrides.length) out.data_sources.at(-1).field_overrides = overrides;
    const qualifier = state.sources.length > 1 ? { data_source: source.name } : {};
    for (const entry of source.block.resource?.parameterConfiguration?.parameters ?? []) {
      if (/^DS_/i.test(entry.key)) continue;
      const roles: Json[] = entry.value.parametersModifiedByRoles ?? [];
      const config = roles.find((role) => role.key === 2)?.value ?? roles.find((role) => role.key === 1)?.value ?? roles[0]?.value;
      if (!config) continue;
      if (config.validation?.rangeMin !== undefined || config.validation?.rangeMax !== undefined) { state.notes.push(`Parameter ${entry.key} uses a value range; it was omitted.`); continue; }
      const type = config.dataType ?? 1;
      if (![1, 2, 3, 4].includes(type)) { state.notes.push(`Parameter ${entry.key} has an unsupported data type and was omitted.`); continue; }
      const defaults = (config.defaultValue ?? []).map((item: Json) => parameterValue(item, type));
      const values = (config.options ?? []).map((item: Json) => parameterValue(item, type));
      out.parameters.push({ ...qualifier, name: entry.value.parameterDisplayConfiguration?.displayName ?? entry.key, id: entry.key,
        ...(type === 1 ? {} : { data_type: ({ 2: 'Boolean', 3: 'Number (decimal)', 4: 'Number (whole)' } as Json)[type] }),
        ...(values.length ? { values } : {}), ...(defaults[0] !== undefined ? { default_value: defaults[0] } : {}) });
    }
    for (const column of source.block.datasourceBlock.fields ?? []) {
      const bucket = column.bucketedFieldConfig;
      const base = { ...qualifier, name: column.outputName };
      // Connector and automatic fields can carry formulas without being user calculations.
      const automatic = !!column.immutableVersion || column.createdBy === 1 || column.createdBy === 3;
      if (bucket?.customGroups) {
        const groups = bucket.customGroups.buckets.filter((item: Json) => !item.isRemainingValues).map((item: Json) => ({ name: item.displayName, condition: GROUP_CONDITIONS[item.filterConfig?.filterConditionType] ?? String(item.filterConfig?.filterConditionType), values: item.filterConfig?.values ?? [], ...(item.filterConfig?.include === false ? { exclude: true } : {}) }));
        const remaining = bucket.customGroups.buckets.find((item: Json) => item.isRemainingValues);
        out.group_fields.push({ ...base, field: fieldName(source, bucket.sourceField), groups, ...(remaining ? { other_group: remaining.displayName } : {}) });
      } else if (bucket?.uniformBinConfig && typeof bucket.uniformBinConfig.size === 'number') {
        const b = bucket.uniformBinConfig;
        out.bin_fields.push({ ...base, field: fieldName(source, bucket.sourceField), size: b.size, ...(b.min !== undefined ? { min: b.min } : {}), ...(b.max !== undefined ? { max: b.max } : {}) });
      } else if (bucket) state.notes.push(`Field ${column.outputName} uses custom bins that cannot be exported.`);
      else if (!automatic && column.textFormula && !column.field?.name?.startsWith('datastudio_')) out.calculated_fields.push({ ...base, formula: publicFormula(source, column.frontendTextFormula ?? column.textFormula), ...calculatedSettings(column, `${source.name}.${column.outputName}`, state.notes) });
    }
  }
  const blendEntries: Json[] = (state.doc.report.resource as Json | undefined)?.dataViewResource?.entry ?? [];
  for (const entry of blendEntries) {
    const block = entry.value?.blockDatasource;
    if (!block) continue;
    const tables: Json[] = [], joins: Json[] = [], conceptNames = new Map<string, string>();
    const visit = (node: Json): void => {
      if (node.query) {
        const source = state.sources.find((item) => item.id === node.query.datasourceId);
        const dimensions: string[] = [], metrics: string[] = [];
        for (const concept of node.query.concepts ?? []) {
          const transformation = concept.queryTimeTransformation?.dataTransformation ?? {};
          const name = fieldName(source, transformation.sourceFieldName);
          conceptNames.set(concept.id?.name ?? concept.name, name);
          (transformation.aggregation !== undefined ? metrics : dimensions).push(name);
        }
        tables.push({ data_source: source?.name ?? node.query.datasourceId, dimensions, metrics });
      } else if (node.join) {
        visit(node.join.left); visit(node.join.right);
        const join = node.join;
        const keys = (join.condition?.and?.conditions ?? []).map((condition: Json) => condition.boolean?.joinKeyPair).filter(Boolean).map((pair: Json) => [conceptNames.get(pair.leftName) ?? pair.leftName, conceptNames.get(pair.rightName) ?? pair.rightName]);
        const type = ({ 1: 'inner', 2: 'full outer', 3: 'left outer', 4: 'right outer' } as Json)[join.type];
        if (!type) state.notes.push(`Blend ${block.datasourceBlock.name}: unknown join type ${join.type}; left outer will be used.`);
        joins.push({ ...(keys.length ? type ? { type } : {} : { type: 'cross' }), keys });
      }
    };
    try { for (const item of block.blocks ?? []) if (item.treeQueryBlockConfig) visit(item.treeQueryBlockConfig); }
    catch { state.notes.push(`Blend ${block.datasourceBlock.name} could not be read.`); continue; }
    if (tables.length >= 2) out.blends.push({ name: block.datasourceBlock.name, tables, joins });
    else state.notes.push(`Blend ${block.datasourceBlock.name} has no supported join tree and was omitted.`);
  }
  return out as Pick<Spec, 'data_sources'> & Json;
}

export function decodeHtml(html: string): { text: string; format: Json; mixed: boolean; font?: string } {
  const decode = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, (token) => {
    const names: Json = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (names[token.toLowerCase()] !== undefined) return names[token.toLowerCase()];
    const number = token.slice(2, -1), point = number[0]?.toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return Number.isInteger(point) && point >= 0 && point <= 0x10FFFF ? String.fromCodePoint(point) : token;
  });
  const content = [...html.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1]!);
  const lines = (content.length ? content : [html]).map((line) => decode(line.replace(/^<br\s*\/?\s*>$/i, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')));
  const format: Json = {};
  const sizes = [...html.matchAll(/font-size:\s*([\d.]+)px/gi)].map((match) => Number(match[1]));
  const colors = [...html.matchAll(/(?:<font\b[^>]*color=["']|color:\s*)(#[a-f0-9]{3,6})/gi)].map((match) => match[1]!.toUpperCase());
  const fonts = [...html.matchAll(/<font\b[^>]*face=["']([^"']+)["']/gi)].map((match) => decode(match[1]!));
  const align = /(?:text-align:\s*|align=["'])(left|center|right)/i.exec(html)?.[1]?.toLowerCase();
  if (sizes[0] !== undefined) format.font_size = sizes[0];
  if (colors[0] !== undefined) format.color = colors[0];
  if (align && align !== 'left') format.align = align;
  for (const [key, tag] of [['bold', 'b|strong'], ['italic', 'i|em'], ['underline', 'u'], ['strikethrough', 'strike|s|del']]) if (new RegExp(`<(?:${tag})\\b`, 'i').test(html)) format[key!] = true;
  return { text: lines.join('\n'), format, mixed: new Set(sizes).size > 1 || new Set(colors).size > 1 || new Set(fonts).size > 1, ...(fonts[0] ? { font: fonts[0] } : {}) };
}
