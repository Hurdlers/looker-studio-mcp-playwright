import { z } from 'zod';

import { resolveSource } from '../../core/datasource.js';
import { dryRunContext } from '../../core/dryrun.js';
import { errorMessage, resultText, runTool, type ToolContext } from '../../core/tool.js';
import type { RapRequest } from '../../looker/rap.js';
import { parseReportId } from '../../looker/view.js';
import { calculatedFieldAdd } from '../fields/calculated.js';
import { ambiguousFieldReferences } from '../fields/parameter-reference.js';
import type { BindingIssue } from './plan-bindings.js';

export const calculatedFieldInput = z.object({
  name: z.string().trim().min(1).describe('새 계산 필드 이름. 기존 필드와 같은 이름은 사용할 수 없습니다.'),
  formula: z.string().trim().min(1).describe('업무 정의를 확인한 Looker Studio 계산식. 수식은 추측하거나 자동 생성하지 않습니다.'),
}).strict();
export type CalculatedFieldInput = z.infer<typeof calculatedFieldInput>;
export interface CalculatedFieldPlan {
  validation: 'formula_preflight';
  issues: BindingIssue[];
  preparation?: {
    tool: 'calculated_field_add';
    arguments: { report_id: string; data_source: string; name: string; formula: string };
  };
}

/** Validate one prerequisite through the existing public creation tool. Its
 * temporary field ID and inferred type never become a chart execution plan;
 * the caller must create the field and re-plan from the real source schema. */
export async function planCalculatedField(
  ctx: ToolContext,
  report: string,
  dataSource: string,
  definition: CalculatedFieldInput,
): Promise<CalculatedFieldPlan> {
  try {
    const reportId = parseReportId(report), doc = await ctx.session.load(reportId);
    const source = await resolveSource(ctx.rap, doc, dataSource);
    const args = { report_id: reportId, data_source: source.datasourceId, ...calculatedFieldInput.parse(definition) };
    const ambiguous = ambiguousFieldReferences(source, args.formula);
    if (ambiguous.length) {
      const names = new Set(ambiguous.map(name => name.toLowerCase()));
      return { validation: 'formula_preflight', issues: [{ code: 'ambiguous_formula_field',
        message: `계산식의 필드 참조가 여러 항목과 일치합니다: ${ambiguous.join(', ')}. 충돌하지 않는 이름·내부 ID를 사용하거나 필드 이름을 변경하세요.`,
        candidates: source.fields.filter(field => names.has(field.name.toLowerCase()) || names.has(field.id.toLowerCase())).map(({ id, name }) => ({ id, name })),
      }] };
    }
    const dry = dryRunContext(ctx).ctx;
    dry.tools = new Map([...ctx.tools, [calculatedFieldAdd.name, calculatedFieldAdd]]);
    // Publishing is recorded by DryRap, so it needs no real credential. Keep
    // the DryRap instance and intercept only this unnecessary token lookup.
    const call = dry.rap.call.bind(dry.rap);
    dry.rap.call = <T = unknown>(endpoint: string, body: unknown, timeoutMs?: number, mode?: RapRequest['mode']): Promise<T> =>
      endpoint === 'getFirstPartyAccessToken'
        ? Promise.resolve({ accessToken: 'dry-run-placeholder' } as T)
        : call<T>(endpoint, body, timeoutMs, mode);
    const result = await runTool(dry, calculatedFieldAdd.name, args);
    if (result.isError) throw new Error(resultText(result));
    return { validation: 'formula_preflight', issues: [], preparation: { tool: 'calculated_field_add', arguments: args } };
  } catch (error) {
    return { validation: 'formula_preflight', issues: [{ code: 'calculated_field_invalid', message: errorMessage(error) }] };
  }
}
