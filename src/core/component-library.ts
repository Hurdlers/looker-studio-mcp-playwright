import { randomBytes } from 'node:crypto';

import { fieldConcept, resolveField } from './components.js';
import type { SourceField } from './datasource.js';
import { LookerError } from './errors.js';
import { metricConcept } from '../features/chart-core/chart-add.js';
import { AGGREGATIONS, AUTO, type AggregationName } from '../features/chart-core/common.js';

// Native component and theme messages deliberately keep unknown properties.
// The file store validates recipe JSON; this module only materializes it.
export type Json = Record<string, any>;

export interface ComponentRecipeRole {
  key: string;
  kind: 'dimension' | 'metric' | 'date';
  label?: string | undefined;
  format_type?: number | undefined;
  numeric_required?: boolean | undefined;
  currency?: string | undefined;
  requires_filtered_input?: boolean | undefined;
  concepts?: Json[] | undefined;
  [key: string]: unknown;
}

export interface ComponentRecipeTextSlot {
  key: string;
  default?: string | undefined;
  format?: 'text' | 'html' | undefined;
  max_units?: number | undefined;
}

export interface ComponentRecipe {
  version: 1;
  id?: string | undefined;
  name?: string | undefined;
  status?: string | undefined;
  width: number;
  height: number;
  roles: ComponentRecipeRole[];
  text_slots?: ComponentRecipeTextSlot[] | undefined;
  native_components: Json[];
  blockers?: string[] | undefined;
  theme?: Json | undefined;
  theme_encoding?: Json | undefined;
  page_background?: Json | undefined;
  notes?: string[] | undefined;
  [key: string]: unknown;
}

export interface ComponentRecipeBinding {
  field: string;
  aggregation?: AggregationName | undefined;
  label?: string | undefined;
}

export interface InstantiateComponentRecipeInput {
  data_source_id: string;
  fields: SourceField[];
  bindings: Record<string, string | ComponentRecipeBinding>;
  texts?: Record<string, string> | undefined;
  left?: number | undefined;
  top?: number | undefined;
}

export interface InstantiatedComponentRecipe {
  components: Json[];
  width: number;
  height: number;
  theme?: Json | undefined;
  theme_encoding?: Json | undefined;
  page_background?: Json | undefined;
  notes: string[];
}

const NUMERIC_TYPES = new Set([12, 13, 14, 15, 28, 33]);
const DATE_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 36, 37, 38, 39, 40]);
const AGGREGATION_NAMES = new Map<number, AggregationName>(Object.entries(AGGREGATIONS).map(([name, id]) => [id, name as AggregationName]));
function invalid(message: string): never {
  throw new LookerError('invalid', message);
}

// Replace exact strings and object keys. This also covers source-field keys
// and serialized behavior, without changing unrelated text or style values.
export function replaceRecipeValues<T>(value: T, replacements: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') return (replacements.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => replaceRecipeValues(v, replacements)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [replacements.get(key) ?? key, replaceRecipeValues(v, replacements)])) as T;
  return value;
}

export function instantiateComponentRecipe(recipe: ComponentRecipe, input: InstantiateComponentRecipeInput): InstantiatedComponentRecipe {
  if (!recipe || recipe.version !== 1) invalid('지원하지 않는 컴포넌트 버전입니다.');
  if (recipe.blockers?.length) invalid(`추가 지원이 필요한 컴포넌트: ${recipe.blockers.join('; ')}`);
  if (recipe.status === 'blocked' || recipe.status === 'needs_support') invalid('추가 지원이 필요한 컴포넌트입니다.');
  const { data_source_id, fields, bindings, texts = {}, left = 0, top = 0 } = input;
  if (!data_source_id?.trim() || !Array.isArray(fields) || !bindings) invalid('데이터 소스와 필드 목록·연결 역할이 필요합니다.');
  if (![left, top].every((v) => Number.isFinite(v) && v >= 0)) invalid('위치는 0 이상의 유한한 숫자여야 합니다.');
  if (![recipe.width, recipe.height].every((v) => Number.isFinite(v) && v > 0)) invalid('컴포넌트 크기는 양의 유한한 숫자여야 합니다.');

  const roles = new Map(recipe.roles.map((role) => [role.key, role]));
  for (const key of Object.keys(bindings)) if (!roles.has(key)) invalid(`알 수 없는 데이터 역할: ${key}`);
  const resolved = new Map<string, { role: ComponentRecipeRole; binding: ComponentRecipeBinding; field: SourceField }>();
  for (const role of recipe.roles) {
    const value = bindings[role.key];
    const binding = typeof value === 'string' ? { field: value } : value;
    if (!binding?.field?.trim()) invalid(`필수 데이터 역할이 비었습니다: ${role.key}${role.label ? ` (${role.label})` : ''}`);
    const field = resolveField(fields, binding.field);
    if ((role.kind === 'date' || DATE_TYPES.has(role.format_type ?? -1)) && !DATE_TYPES.has(field.semanticType ?? -1))
      invalid(`${role.key}에는 날짜 필드가 필요합니다.`);
    if (role.kind === 'metric' && role.numeric_required && !NUMERIC_TYPES.has(field.semanticType ?? -1))
      invalid(`${role.key}에는 숫자 필드가 필요합니다.`);
    if (role.format_type === 14 && field.semanticType !== 14)
      invalid(`${role.key}는 비율 필드입니다. 퍼센트 타입과 값의 의미를 먼저 확인하세요.`);
    const currency = (field.outputSemanticInfo as Json | undefined)?.semanticConfig?.[0]?.currencyOptions?.currencyCode;
    if (role.currency && currency !== role.currency) invalid(`${role.key}의 통화는 ${role.currency}여야 합니다.`);
    resolved.set(role.key, { role, binding, field });
  }

  const componentIds = new Map<string, string>();
  for (const component of recipe.native_components) componentIds.set(component.componentId, `cd-${randomBytes(5).toString('hex')}`);
  const components = recipe.native_components.map((native) => {
    const ids = new Map(componentIds);
    for (const definition of native.conceptDefs ?? []) {
      const name = `qt_${randomBytes(7).toString('hex')}`;
      ids.set(definition.name, name);
      if (definition.id) ids.set(definition.id, `${definition.namespace ?? 't0'}.${name}`);
    }
    const component = replaceRecipeValues(structuredClone(native), ids);
    const property = component.propertyConfig?.componentProperty ?? {};
    if (component.datasourceId === '$data_source' || property.dataset?.datasetId === '$data_source') {
      component.datasourceId = data_source_id;
      property.dataset = { ...property.dataset, datasetType: 1, datasetId: data_source_id };
    }
    for (const definition of component.conceptDefs ?? []) {
      const transformation = definition.queryTimeTransformation?.dataTransformation;
      const match = /^\$role:(.+)$/.exec(transformation?.sourceFieldName ?? '');
      if (!match) continue;
      const value = resolved.get(match[1]!);
      if (!value) invalid(`알 수 없는 데이터 역할: ${match[1]}`);
      const { role, binding, field } = value;
      const originalAggregation = transformation.aggregation;
      // An Auto field already aggregates its rows. A recipe's SUM/AVG is
      // only a default for raw fields, not a request to aggregate it again.
      // Explicit user choices still go through metricConcept's validation.
      const inheritAggregation = role.kind !== 'metric' || field.aggregation !== AUTO;
      const aggregation = binding.aggregation ?? (inheritAggregation && originalAggregation !== undefined ? AGGREGATION_NAMES.get(originalAggregation) : undefined);
      if (inheritAggregation && originalAggregation !== undefined && aggregation === undefined) invalid(`${role.key}: 지원하지 않는 집계 ${originalAggregation}`);
      if (role.kind === 'metric' && field.formula && field.aggregation === 0 && NUMERIC_TYPES.has(field.semanticType ?? -1)
        && binding.aggregation === undefined && (aggregation === undefined || aggregation === 'none'))
        invalid(`${role.key}: "${field.name}"은 기본 집계가 none인 숫자 계산필드입니다. SUM/AVG 등 목적에 맞는 집계를 binding에 지정하거나 field_update로 설정하세요.`);
      const concept = role.kind === 'metric'
        ? metricConcept(field, { ...(aggregation === undefined ? {} : { aggregation }), label: binding.label ?? field.name })
        : fieldConcept(field, { label: binding.label ?? field.name });
      transformation.sourceFieldName = field.id;
      if (role.kind === 'metric') {
        const checkedAggregation = concept.queryTimeTransformation.dataTransformation.aggregation;
        if (checkedAggregation === undefined) delete transformation.aggregation;
        else transformation.aggregation = checkedAggregation;
      }
      const display = definition.queryTimeTransformation.displayTransformation ??= {};
      const label = binding.label ?? field.name;
      display.displayName = definition.resultTransformation?.analyticalFunction === 1 ? `${label} (비중)` : label;
      const nativeSemantic = display.outputSemanticInfo?.semanticConfig?.[0];
      // A date-to-month display is a chart transformation. Explicit unit
      // contracts are also part of its design; ordinary Number metadata is
      // replaced by the newly bound field's type, rather than hiding its unit.
      const keepNativeFormat = (DATE_TYPES.has(nativeSemantic?.semanticType) && DATE_TYPES.has(field.semanticType ?? -1))
        || (role.format_type === 14 && nativeSemantic?.semanticType === 14)
        || (role.currency !== undefined && nativeSemantic?.currencyOptions?.currencyCode === role.currency);
      if (!keepNativeFormat) {
        if (field.outputSemanticInfo) display.outputSemanticInfo = structuredClone(field.outputSemanticInfo);
        else if (field.semanticType !== undefined) display.outputSemanticInfo = { semanticConfig: [{ semanticType: field.semanticType }] };
        else delete display.outputSemanticInfo;
      }
    }
    const position = component.attributeConfig?.componentAttribute;
    if (position) {
      position.left = (position.left ?? 0) + left;
      position.top = (position.top ?? 0) + top;
    }
    return component;
  });

  const replacements = new Map<string, string>();
  const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  for (const slot of recipe.text_slots ?? []) {
    const value = texts[slot.key] ?? slot.default;
    if (typeof value !== 'string') invalid(`${slot.key}: 텍스트가 필요합니다.`);
    const units = [...value].reduce((n, character) => n + (/^[\u0000-\u007f]$/.test(character) ? 0.55 : 1), 0);
    if (slot.max_units !== undefined && units > slot.max_units) invalid(`${slot.key}: 제목이 준비된 영역보다 깁니다. 짧은 제목을 사용하세요.`);
    replacements.set(`$text:${slot.key}`, slot.format === 'html' ? escapeHtml(value) : value);
  }
  for (const [key, { binding, field }] of resolved) {
    replacements.set(`$role:${key}`, field.id);
    replacements.set(`$label:${key}`, binding.label ?? field.name);
  }
  const fillText = (value: any): any => {
    if (typeof value === 'string') return value.replace(/\$text:[a-z_0-9]+/g, (token) => replacements.get(token) ?? token);
    if (Array.isArray(value)) return value.map(fillText);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, fillText(v)]));
    return value;
  };
  return {
    components: fillText(replaceRecipeValues(components, replacements)), width: recipe.width, height: recipe.height,
    theme: structuredClone(recipe.theme), theme_encoding: structuredClone(recipe.theme_encoding),
    page_background: structuredClone(recipe.page_background), notes: structuredClone(recipe.notes ?? []),
  };
}
