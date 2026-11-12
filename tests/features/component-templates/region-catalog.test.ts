import { describe, expect, it } from 'vitest';
import { regionEntries, REGION_KINDS } from '../../../src/features/component-templates/region-catalog.js';
import { commonEntries } from '../../../src/features/component-templates/common.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, type Json } from '../spec/fake.js';
const parsed = (result: Awaited<ReturnType<ReturnType<typeof fake>['run']>>) => JSON.parse(resultText(result));
describe('region discovery', () => {
  it('lists five read-only compositions through existing discovery without source access', async () => {
    const f = fake();
    const listed = parsed(await f.run('component_template_list', { verified_only: false, query: 'region-' }));
    expect(listed.total).toBe(5);
    expect(listed.templates.map((entry: Json) => entry.region_kind)).toEqual([...REGION_KINDS]);
    for (const entry of listed.templates) {
      expect(entry).toMatchObject({ implementation: 'built_in_region', addable: false, composition_tool: 'component_page_add', validation: 'supported_pending_review' });
      const inspected = parsed(await f.run('component_template_inspect', { template_id: entry.template_id }));
      expect(inspected).toEqual(entry);
    }
    expect(f.calls).toEqual([]); expect(f.writes()).toEqual([]);
  });
  it('keeps unverified regions out of verified-only results and common-prefix searches', async () => {
    const f = fake();
    expect(parsed(await f.run('component_template_list', { query: 'region-' })).templates).toEqual([]);
    const common = parsed(await f.run('component_template_list', { verified_only: false, query: 'common-' }));
    expect(common.templates).toHaveLength(12);
    expect(regionEntries('상세 표와 추이').map(entry => entry.region_kind)).toEqual(['table-trend']);
  });
  it('describes supported child recipes, ordering and bounds without inventing data roles', () => {
    const common = new Set(commonEntries().map(entry => entry.template_id));
    for (const entry of regionEntries()) {
      for (const child of entry.child_templates) expect(common.has(child)).toBe(true);
      expect(entry.item_count.min).toBe(entry.region_kind === 'block' ? 1 : 2);
      expect(entry.item_order).toBeTruthy();
      expect(entry.constraints.join(' ')).toContain('span');
      expect(entry.design_variants).toEqual({ surface: ['outlined', 'plain'], heading: ['plain', 'band'] });
      expect(entry.roles.map(role => role.key)).toEqual(['items']);
    }
  });
  it('documents category-line as an explicit alternative with date spacing and sort limits', () => {
    for (const kind of ['kpi-trend', 'table-trend']) {
      const entry = regionEntries().find(entry => entry.region_kind === kind)!;
      expect(entry.child_templates).toContain('common-time-trend');
      expect(entry.child_templates).toContain('common-category-line');
      expect(entry.item_order).toContain('명시적으로 선택한 common-category-line');
      const constraints = entry.constraints.join(' ');
      expect(constraints).toContain('자동 대체하지');
      expect(constraints).toContain('동간격');
      expect(constraints).toContain('누락일');
      expect(constraints).toContain('원본 날짜 형식과 정렬 순서');
      expect(constraints).toContain('같은 소스의 지정 날짜 필드');
    }
    for (const kind of ['kpi-group', 'table-share']) expect(regionEntries().find(entry => entry.region_kind === kind)!.child_templates).not.toContain('common-category-line');
  });

});
