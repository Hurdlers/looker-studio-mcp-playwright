import type { AggregationName } from '../chart-core/common.js';

export type CommonBinding = string | { field: string; aggregation?: AggregationName | undefined; label?: string | undefined };
export type RoleKind = 'dimension' | 'metric' | 'date';
export interface CommonFamilyDefinition {
  template_id: string;
  family: string;
  name: string;
  purpose: string;
  required: readonly string[];
  optional: readonly string[];
  options: readonly string[];
  role_kinds: Record<string, RoleKind>;
}
export interface FamilyPlanInput {
  template_id: string;
  bindings: Record<string, CommonBinding>;
  options: Record<string, unknown>;
}
export interface FamilyChartPlan {
  type: string;
  dimensions: string[];
  metrics: Array<Record<string, unknown>>;
  sort?: { field: string; ascending: boolean } | undefined;
  breakdown?: string | undefined;
  fields?: Record<string, string[]> | undefined;
  series?: Array<Record<string, unknown>> | undefined;
  style?: Record<string, unknown> | undefined;
  notes?: string[] | undefined;
}
export function roleBinding(input: FamilyPlanInput, role: string): Exclude<CommonBinding, string> | undefined {
  const value = input.bindings[role];
  return typeof value === 'string' ? { field: value } : value;
}
