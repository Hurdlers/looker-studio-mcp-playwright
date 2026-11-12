import { z } from 'zod';

import { LookerError } from '../core/errors.js';
import { DATABASE_FIELDS, SHEETS_FIELDS } from './sheets-input.js';
import type { Ga4Source } from './types.js';

export const ga4Input = {
  account_id: z.string().optional().describe('GA4 계정의 숫자 ID. connector:ga4일 때 property_id와 함께 지정합니다.'),
  property_id: z.string().optional().describe('GA4 속성의 숫자 ID. UA-로 시작하는 추적 ID나 G- 측정 ID가 아닙니다.'),
  view_id: z.unknown().optional().describe('지원하지 않는 Universal Analytics 보기 ID입니다. 지정하면 거부합니다.'),
};
export const GA4_FIELDS = Object.keys(ga4Input) as Array<keyof typeof ga4Input>;
const INAPPLICABLE = ['project_id', 'dataset_id', 'table_id', 'sql', 'date_range_params', 'viewer_email_param', ...SHEETS_FIELDS, ...DATABASE_FIELDS] as const;
type Input = Partial<Record<keyof typeof ga4Input | (typeof INAPPLICABLE)[number], unknown>>;

export function rejectGa4Inputs(input: Partial<Record<keyof typeof ga4Input, unknown>>): void {
  const given = GA4_FIELDS.filter(key => input[key] !== undefined);
  if (given.length) throw new LookerError('invalid', `${given.join(', ')} apply only to connector ga4. Remove them or select ga4.`);
}

/** Connection selection only. Access is checked by the connector before any
 * report or source is created; no account enumeration or consent is performed. */
export function parseGa4Input(input: Input): Ga4Source {
  if (input.view_id !== undefined) throw new LookerError('invalid', 'GA4 has no view_id. Universal Analytics views are not supported.');
  const foreign = INAPPLICABLE.filter(key => input[key] !== undefined);
  if (foreign.length) throw new LookerError('invalid', `${foreign.join(', ')} do not apply to GA4. Give account_id and property_id only.`);
  const parse = (key: 'account_id' | 'property_id'): string => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!/^[1-9]\d*$/.test(value)) throw new LookerError('invalid', `GA4 ${key} must be a positive numeric ID string without leading zeros. Do not use a UA tracking ID or G measurement ID.`);
    return value;
  };
  return { accountId: parse('account_id'), propertyId: parse('property_id') };
}
