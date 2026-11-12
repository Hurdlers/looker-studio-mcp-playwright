import { z } from 'zod';

import type { ComponentUpdater } from '../../core/extensions.js';
import { listPages } from '../../core/page.js';
import type { ReportDoc } from '../../core/session.js';
import { LookerError } from '../../core/errors.js';
import { invalid, prop, type Json } from './model.js';

const ACTIONS = { 'Invite people': 1, 'Get report link': 2, 'Download report': 3, 'Reset filters': 4 } as const;
export const buttonInput = z.object({
  action: z.enum(['link', 'report_action']).describe('link는 URL·페이지 이동, report_action은 리포트 동작입니다.'),
  url: z.string().min(1).optional().describe('열 주소. page와 함께 주면 주소를 우선합니다.'),
  page: z.string().min(1).optional().describe('이 리포트 안에서 이동할 페이지 id 또는 전체 이름.'),
  new_tab: z.boolean().optional().describe('링크를 새 탭에서 열지 여부. 기본 false.'),
  report_action: z.enum(['Invite people', 'Get report link', 'Download report', 'Reset filters']).optional().describe('버튼을 누를 때 열 동작. 초대 버튼은 공유 창만 열며 도구가 공유하지 않습니다.'),
}).describe('버튼의 이동 또는 리포트 동작.');
type ButtonSpec = z.infer<typeof buttonInput>;

export function applyButton(c: Json, doc: ReportDoc, spec: ButtonSpec): string | undefined {
  if (c.type !== 'button') throw invalid('button settings require a button component.');
  const p = prop(c).buttonProperty ??= {};
  if (spec.action === 'report_action') {
    if (!spec.report_action) throw invalid('report_action is required for a report_action button.');
    Object.assign(p, { actionType: 2, internalActionType: ACTIONS[spec.report_action] });
    return spec.url !== undefined || spec.page !== undefined || spec.new_tab !== undefined ? 'Warning: url, page and new_tab are ignored for a report action.' : undefined;
  }
  if (!spec.url && !spec.page) throw invalid('A link button needs url or page.');
  let linkUrl = spec.url ?? '';
  let internalLink = '';
  if (!spec.url) {
    const pages = listPages(doc);
    const page = pages.find((p) => p.pageId === spec.page) ?? pages.find((p) => p.name.toLowerCase() === spec.page!.trim().toLowerCase());
    if (!page) throw new LookerError('not_found', `No page "${spec.page}". Pages: ${pages.map((p) => `${p.name} (${p.pageId})`).join(', ')}.`);
    internalLink = page.pageId;
    linkUrl = `http://${page.name}`;
  }
  Object.assign(p, { actionType: 1, linkType: 1, linkUrl, internalLink, linkNewTab: spec.new_tab ?? false });
  return spec.url && spec.page ? 'Warning: page was ignored because url was given.' : undefined;
}

export const buttonUpdater: ComponentUpdater = {
  key: 'button', types: ['button'], input: buttonInput,
  apply: ({ component, doc }, value) => applyButton(component, doc, value as ButtonSpec),
  read: (component) => {
    const p = prop(component).buttonProperty;
    if (p?.actionType === 2) {
      const action = Object.entries(ACTIONS).find(([, value]) => value === p.internalActionType)?.[0];
      return action ? { action: 'report_action', report_action: action } : undefined;
    }
    if (p?.actionType !== 1 || (!p.linkUrl && !p.internalLink)) return undefined;
    return { action: 'link', ...(p.internalLink ? { page: p.internalLink } : { url: p.linkUrl }), new_tab: p.linkNewTab === true };
  },
};
