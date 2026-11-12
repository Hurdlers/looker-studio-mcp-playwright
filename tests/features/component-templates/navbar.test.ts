import { describe, expect, it } from 'vitest';
import { planNavbar, navigationInput, type NavbarInput } from '../../../src/features/component-templates/navbar.js';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

function setup() {
  const f = fake();
  f.original.shareable.name = '[looker-studio-mcp-lab-1] navigation';
  const second = structuredClone(f.original.page[0]!); second.pageId = 'second-page'; second.position = 1;
  f.original.page.push(second);
  f.original.navigationInfo = { navItems: [
    { page: { pageId: f.original.page[0]!.pageId, displayName: '전체 현황' } },
    { page: { pageId: second.pageId, displayName: '채널 분석' } },
  ] };
  return f;
}
const themeTokens = { background: '#FFFFFF', text: '#123456', muted: '#567890', accent: '#153D77', font: 'Roboto' };
const input: NavbarInput = { report_id: ORIGINAL, page: '전체 현황', texts: { title: '매출 리포트' }, themeTokens,
  navigation: { items: [{ label: '전체 현황', page: '전체 현황' }, { label: '채널 분석', page: 'second-page' }] } };

describe('common navigation composition', () => {
  it('resolves internal IDs, highlights the current page and leaves the document unchanged', () => {
    const f = setup(), before = structuredClone(f.original);
    const plan = planNavbar(input, f.original);
    const buttons = plan.steps.filter(step => step.tool === 'control_add');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.args.button).toEqual({ action: 'link', page: f.original.page[0]!.pageId, new_tab: false });
    expect(buttons[1]!.args.button).toEqual({ action: 'link', page: 'second-page', new_tab: false });
    expect(buttons[0]!.args.style).toMatchObject({ Background: themeTokens.accent, 'Font color': '#FFFFFF' });
    expect(buttons[1]!.args.style).toMatchObject({ Background: themeTokens.background, 'Font color': themeTokens.text });
    expect(f.original).toEqual(before);
  });

  it('creates the planned buttons through existing tools with no ignored styles', async () => {
    const f = setup();
    for (const step of planNavbar(input, f.original).steps) {
      const response = await f.run(step.tool, step.args);
      expect(resultText(response)).not.toMatch(/Not applied:/);
    }
    const buttons = f.original.page[0]!.page.componentConfig!.filter((c: Json) => c.type === 'button') as Json[];
    expect(buttons.map(c => c.propertyConfig.componentProperty.buttonProperty.internalLink)).toEqual([f.original.page[0]!.pageId, 'second-page']);
    expect(buttons.every(c => c.propertyConfig.componentProperty.buttonProperty.linkNewTab === false)).toBe(true);
  });

  it('uses the same links in a vertical sidebar and keeps every element inside its box', async () => {
    const f = setup();
    const plan = planNavbar({ ...input, navigation: { ...input.navigation, layout: 'vertical' }, position: { left: 24, top: 24 }, size: { width: 240, height: 1000 } }, f.original);
    expect(plan.layout).toBe('vertical');
    const buttons = plan.steps.filter(step => step.tool === 'control_add');
    expect(buttons.map(step => (step.args.position as Json).left)).toEqual([40, 40]);
    expect(buttons.map(step => (step.args.position as Json).width)).toEqual([208, 208]);
    expect((buttons[1]!.args.position as Json).top).toBeGreaterThan((buttons[0]!.args.position as Json).top);
    for (const step of plan.steps) {
      const box = step.args.position as Json;
      expect(box.left + box.width).toBeLessThanOrEqual(264);
      expect(box.top + box.height).toBeLessThanOrEqual(1024);
      const result = await f.run(step.tool, step.args);
      expect(resultText(result)).not.toMatch(/Not applied:/);
    }
    expect(buttons[0]!.args.style).toMatchObject({ Background: themeTokens.accent });
    expect(buttons[1]!.args.button).toEqual({ action: 'link', page: 'second-page', new_tab: false });
  });

  it('keeps omitted layout identical to explicit horizontal and gives sidebar defaults', () => {
    const f = setup();
    expect(planNavbar(input, f.original)).toEqual(planNavbar({ ...input, navigation: { ...input.navigation, layout: 'horizontal' } }, f.original));
    expect(planNavbar({ ...input, navigation: { ...input.navigation, layout: 'vertical' } }, f.original)).toMatchObject({ width: 240, height: 720 });
  });

  it('rejects sidebar width, height and page-boundary overflow before creation', () => {
    const f = setup();
    const sidebar = { ...input, navigation: { ...input.navigation, layout: 'vertical' as const } };
    expect(() => planNavbar({ ...sidebar, size: { width: 240, height: 96 } }, f.original)).toThrow(/height/);
    expect(() => planNavbar({ ...sidebar, texts: { title: '긴브랜드이름으로폭을초과하는메뉴' } }, f.original)).toThrow(/width/);
    expect(() => planNavbar({ ...sidebar, position: { left: 19900, top: 0 } }, f.original)).toThrow(/coordinate limit/);
    expect(() => planNavbar({ ...sidebar, position: { left: 0, top: 19900 } }, f.original)).toThrow(/coordinate limit/);
  });

  it('rejects ambiguous names, hidden targets, external targets and duplicate destinations', () => {
    const f = setup();
    expect(() => planNavbar({ ...input, navigation: { items: [{ label: '외부', page: 'https://example.com' }] } }, f.original)).toThrow(/No page/);
    expect(navigationInput.safeParse({ items: [{ label: '공유', page: 'second-page', action: 'share' }] }).success).toBe(false);
    expect(() => planNavbar({ ...input, navigation: { items: [{ label: 'A', page: 1 }, { label: 'B', page: 1 }] } }, f.original)).toThrow(/different pages/);
    f.original.navigationInfo!.navItems![1]!.page!.hiddenFromViewer = true;
    expect(() => planNavbar(input, f.original)).toThrow(/hidden/);
    f.original.navigationInfo!.navItems![1]!.page!.hiddenFromViewer = false;
    f.original.navigationInfo!.navItems![1]!.page!.displayName = '전체 현황';
    expect(() => planNavbar(input, f.original)).toThrow(/Several pages/);
  });

  it('refuses insufficient width instead of clipping and picks contrasting active text', () => {
    const f = setup();
    expect(() => planNavbar({ ...input, size: { width: 320, height: 72 } }, f.original)).toThrow(/needs at least/);
    const plan = planNavbar({ ...input, themeTokens: { ...themeTokens, accent: '#FFFFCC' } }, f.original);
    expect(plan.steps.find(step => step.tool === 'control_add')!.args.style).toMatchObject({ 'Font color': '#000000' });
    for (const step of plan.steps) {
      const box = step.args.position as { left: number; width: number };
      expect(box.left + box.width).toBeLessThanOrEqual(plan.width);
    }
  });
});

describe('horizontal menu alignment', () => {
  it('starts the buttons at the left when asked and keeps the right alignment by default', () => {
    const f = fake();
    const pages = f.original.page.map(p => p.pageId);
    const input = { report_id: ORIGINAL, page: pages[0]!, position: { left: 24, top: 100 }, size: { width: 1200, height: 56 }, themeTokens };
    const items = [{ label: 'One', page: pages[0]! }];
    const lefts = (align?: 'start' | 'end') => planNavbar({ ...input, navigation: { layout: 'horizontal', items, ...(align ? { align } : {}) } }, f.original)
      .steps.filter(step => step.tool === 'control_add').map(step => (step.args.position as { left: number }).left);
    expect(lefts('start')[0]).toBe(24 + 16);
    expect(lefts()[0]).toBeGreaterThan(1000);
    expect(lefts('end')).toEqual(lefts());
  });
});
