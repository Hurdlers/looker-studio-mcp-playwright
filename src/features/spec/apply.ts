import { z } from 'zod';

import { DRY_RUN_REPORT } from '../../core/dryrun.js';
import { defineTool, resultText, runTool, text } from '../../core/tool.js';
import { reportUrl } from '../../looker/reports.js';
import { actionInput, runActions, validateActions } from './engine.js';
import { checkDeferred, COMPONENT_TOOLS, invalid, loadSpec, readState, reportIdOf, reportInput, sourceArgs, sourceName, type Json, type Spec, type State } from './model.js';
import { specToActions } from './plan.js';

function checkSources(spec: Spec, state?: State): void {
  const known = new Set([...spec.data_sources.map(sourceName), ...(spec.blends as Json[] ?? []).map((entry) => entry.name), ...(state?.sources.flatMap((source) => [source.name, source.alias, source.id]) ?? [])]);
  const problems: string[] = [];
  const inspect = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const at = `${path}.${key}`;
      if (key === 'data_source' && typeof item === 'string' && !known.has(item)) problems.push(`${at}: unknown data source "${item}".`);
      inspect(item, at);
    }
  };
  inspect(spec, 'spec');
  if (problems.length) throw invalid(problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n'));
}

function checkComponents(spec: Spec): void {
  const problems: string[] = [];
  const check = (component: Json, path: string) => {
    if (component.component === 'other') return;
    if (!COMPONENT_TOOLS[component.component]) problems.push(`${path}.component: unknown kind ${JSON.stringify(component.component)}.`);
  };
  spec.pages.forEach((page, i) => page.components.forEach((component, j) => check(component, `pages[${i}].components[${j}]`)));
  spec.report_components.forEach((component, i) => check(component, `report_components[${i}]`));
  if (spec.pages.every((page) => page.hidden)) problems.push('pages: at least one page must remain visible.');
  if (problems.length) throw invalid(problems.join('\n'));
}

export const batchApply = defineTool({
  name: 'batch_apply', title: 'Apply actions to a report',
  description: 'Checks and runs an ordered list of report editing tools against one report. Use it for a sequence of related edits; validation errors prevent all writes, runtime failures are reported per action, and continue_on_error controls whether later actions run.',
  input: { report_id: reportInput, actions: z.array(actionInput).min(1).max(200).describe('순서대로 실행할 동작 1~200개. 도구 이름과 그 도구의 인자를 적습니다.'), continue_on_error: z.boolean().default(false).describe('실행 중 실패해도 뒤의 동작을 계속할지 정합니다. 기본은 첫 실패 뒤 중단합니다.') },
  write: true,
  run: async (ctx, input) => {
    const reportId = reportIdOf(input.report_id);
    await validateActions(ctx, reportId, input.actions);
    if (ctx.dryRun) return text(`Planned ${input.actions.length} actions:\n${input.actions.map((action, index) => `${index + 1}. ${action.tool}: ${JSON.stringify(action.args)}`).join('\n')}`);
    const result = await runActions(ctx, reportId, input.actions, input.continue_on_error);
    return { ...text(`${result.text}${result.isError ? '\nSuccessful actions remain saved. Use version_restore with the saved undo revision if you want to reverse them.' : ''}`), isError: result.isError, audit: { reportId, detail: `${input.actions.length} actions` } };
  },
});

export const reportSpecApply = defineTool({
  name: 'report_spec_apply', title: 'Apply a report specification',
  description: 'Creates a report from a JSON specification or adds its missing items to an existing report. Use a specification from report_spec_export or compose it with the creation tools’ input names; existing objects keep their settings, existing themes change only with apply_theme, and unsupported other components are skipped with notes.',
  input: {
    spec: z.unknown().optional().describe('version 1 스펙 객체. 컴포넌트는 해당 추가 도구의 인자이며 data_sources[].field_overrides는 {field, name?, type?, aggregation?}로 새 소스의 필드를 먼저 복원합니다. calculated_fields의 type과 aggregation은 계산필드를 만든 직후 복원합니다. 기존 소스는 바꾸지 않습니다. spec_path와 둘 중 하나만 지정합니다.'),
    spec_path: z.string().min(1).optional().describe('스펙 JSON 파일 경로. 상대 이미지 경로는 이 파일이 있는 폴더를 기준으로 풉니다.'),
    report_id: reportInput.optional().describe('빠진 항목을 더할 기존 리포트. 생략하면 첫 데이터 소스로 새 리포트를 만듭니다.'),
    name: z.string().trim().min(1).optional().describe('새 리포트 이름. 생략하면 스펙의 name을 쓰며 기존 리포트 이름은 바꾸지 않습니다.'),
    apply_theme: z.boolean().default(false).describe('기존 리포트에도 스펙의 테마와 캔버스 크기를 적용합니다. 기본은 기존 테마를 유지합니다.'),
    continue_on_error: z.boolean().default(false).describe('실행 중 한 동작이 실패해도 나머지를 계속할지 정합니다.'),
  },
  write: true,
  run: async (ctx, input) => {
    const spec = await loadSpec(input);
    checkComponents(spec); checkDeferred(spec, 'spec');
    const fresh = input.report_id === undefined;
    if (fresh && !spec.data_sources.length) throw invalid('A new report needs a data source. Add data_sources or give report_id for an existing report.');
    const reportId = input.report_id === undefined ? DRY_RUN_REPORT : reportIdOf(input.report_id);
    const maximum = specToActions(spec, undefined, { fresh: true, allSources: true });
    // Every possible action is checked, including items an update may skip.
    await validateActions(ctx, reportId, maximum.actions, false);
    let state = fresh ? undefined : await readState(ctx, reportId);
    checkSources(spec, state);
    const initial = specToActions(spec, state, { fresh, applyTheme: input.apply_theme });
    if (!fresh) await validateActions(ctx, reportId, initial.actions);
    if (ctx.dryRun) return text(`Planned ${fresh ? 'new report' : reportId}:\n${fresh ? `report_create ${input.name ?? spec.name ?? 'Untitled report'}\n` : ''}${(fresh ? maximum : initial).actions.map((action, index) => `${index + 1}. ${action.tool}: ${JSON.stringify(action.args)}`).join('\n')}`);
    let id = reportId;
    const notes = [...initial.notes];
    if (fresh) {
      const name = input.name ?? spec.name ?? 'Untitled report';
      const created = await runTool({ ...ctx, audit: { write: async () => undefined } }, 'report_create', { ...sourceArgs(spec.data_sources[0]!), name });
      if (created.isError) return created;
      const match = /\|\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s*\|/i.exec(resultText(created));
      if (!match) throw invalid(`report_create returned no usable report id: ${resultText(created)}`);
      id = match[1]!; state = await readState(ctx, id);
    } else if (input.name) notes.push('The existing report name was not changed.');
    const plan = specToActions(spec, state, { fresh, applyTheme: input.apply_theme, ...(state?.doc.page[0]?.pageId ? { firstPageId: state.doc.page[0].pageId } : {}) });
    const result = await runActions(ctx, id, plan.actions, input.continue_on_error);
    const allNotes = [...new Set([...notes, ...plan.notes, ...(state?.notes ?? [])])];
    return { ...text([
      `${fresh ? 'Created' : 'Updated'} ${id}: ${reportUrl(id)}`,
      plan.actions.length ? result.text : 'Nothing was missing.',
      ...allNotes.map((note) => `Note: ${note}`),
      ...(result.isError ? ['Successful actions remain saved. Apply the same spec again with report_id to add missing items; version_restore can restore the saved undo revision.'] : []),
    ].join('\n')), isError: result.isError, audit: { reportId: id, detail: `spec "${spec.name ?? input.name ?? ''}", ${spec.pages.length} pages` } };
  },
});
