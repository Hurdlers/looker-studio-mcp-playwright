import type { SourceField } from '../../core/datasource.js';
import { allowedAggregations, AUTO } from '../chart-core/common.js';
import { DATE_TYPES } from '../chart-options/dates.js';
import type { CommonBinding } from './common-contract.js';

export interface BindingRole { key: string; required: boolean; kind: string; }
export interface BindingIssue {
  code: string;
  role?: string;
  message: string;
  candidates?: Array<{ id: string; name: string }>;
}

const normalized = (value: string) => value.trim().toLowerCase();
const publicFields = (fields: SourceField[]) => fields.map(({ id, name }) => ({ id, name }));

/** Resolve explicit field references without guessing their business meaning or
 * accepting the first of several same-name fields. Valid output uses source IDs
 * so later execution cannot choose a different same-name field. */
export function planBindings(
  fields: SourceField[],
  roles: BindingRole[],
  input: Record<string, CommonBinding>,
): { bindings: Record<string, CommonBinding>; issues: BindingIssue[] } {
  const bindings: Record<string, CommonBinding> = {}, issues: BindingIssue[] = [];
  const known = new Map(roles.map(role => [role.key, role]));
  for (const key of Object.keys(input)) {
    if (!known.has(key)) issues.push({ code: 'unknown_role', role: key, message: `알 수 없는 역할입니다: ${key}. 지원 역할: ${roles.map(role => role.key).join(', ')}.` });
  }
  for (const role of roles) {
    const raw = input[role.key];
    const issue = (code: string, message: string, candidates?: SourceField[]) => {
      issues.push({ code, role: role.key, message, ...(candidates ? { candidates: publicFields(candidates) } : {}) });
    };
    if (raw === undefined) {
      if (role.required) issue('missing_binding', `${role.key} 역할에 사용할 필드를 지정하세요.`);
      continue;
    }
    const binding = typeof raw === 'string' ? { field: raw } : raw;
    if (!binding || typeof binding.field !== 'string' || !binding.field.trim()) {
      issue('invalid_binding', `${role.key} 역할에는 비어 있지 않은 필드 이름이나 ID가 필요합니다.`);
      continue;
    }
    if (!['metric', 'date', 'dimension'].includes(role.kind)) {
      issue('invalid_binding', `${role.key} 역할의 종류를 지원하지 않습니다: ${role.kind}.`);
      continue;
    }
    const ref = binding.field.trim(), want = normalized(ref);
    const exact = fields.filter(field => field.id === ref);
    const named = exact.length ? exact : fields.filter(field => normalized(field.name) === want);
    const matches = named.length ? named : fields.filter(field => normalized(field.id) === want || normalized(field.id) === `_${want}_`);
    if (!matches.length) {
      issue('field_not_found', `${role.key}에 지정한 필드 "${ref}"를 데이터 소스에서 찾지 못했습니다.`);
      continue;
    }
    const field = matches[0]!;
    const sameId = fields.filter(candidate => candidate.id === field.id);
    if (matches.length !== 1 || sameId.length !== 1) {
      issue('ambiguous_field', `${role.key}의 필드 "${ref}"가 여러 항목과 일치합니다. 고유한 필드 ID를 지정하세요.`, matches.length > 1 ? matches : sameId);
      continue;
    }
    if (role.kind !== 'metric') {
      if (binding.aggregation !== undefined || binding.label !== undefined) {
        issue('invalid_binding', `${role.key}에는 필드만 지정하세요. 집계와 지표 라벨은 측정항목 역할에서 사용합니다.`);
        continue;
      }
      if (field.aggregation === AUTO) {
        issue('invalid_binding', `${role.key}에는 이미 집계된 Auto 필드를 측정기준으로 사용할 수 없습니다.`);
        continue;
      }
      if (role.kind === 'date' && !DATE_TYPES.has(field.semanticType ?? -1)) {
        issue('invalid_date', `${role.key}의 "${field.name}"는 날짜 필드가 아닙니다. 날짜 자료형을 가진 필드를 지정하세요.`);
        continue;
      }
      bindings[role.key] = field.id;
      continue;
    }
    if (field.aggregation === AUTO) {
      if (binding.aggregation !== undefined) {
        issue('invalid_aggregation', `"${field.name}"는 이미 집계된 Auto 필드입니다. aggregation을 생략하세요.`);
        continue;
      }
    } else {
      const allowed = allowedAggregations(field);
      if (binding.aggregation === undefined) {
        issue('aggregation_required', `${role.key}의 "${field.name}"를 어떻게 집계할지 지정하세요: ${allowed.join(', ')}.`);
        continue;
      }
      if (!allowed.includes(binding.aggregation)) {
        issue('invalid_aggregation', `"${field.name}"에 ${binding.aggregation} 집계를 사용할 수 없습니다. 가능한 집계: ${allowed.join(', ')}.`);
        continue;
      }
    }
    bindings[role.key] = {
      field: field.id,
      ...(binding.aggregation === undefined ? {} : { aggregation: binding.aggregation }),
      ...(binding.label === undefined ? {} : { label: binding.label }),
    };
  }
  return { bindings, issues };
}
