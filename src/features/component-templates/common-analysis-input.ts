import type { z } from 'zod';
import { sortByUpdater, sortAscendingUpdater } from '../chart-options/data.js';
import { fieldFormatsInput } from '../chart-options/formats.js';

// ComponentUpdater intentionally erases schema output types. These adapters
// retain the existing validators and their known string/boolean output types.
export const commonAnalysisInput = {
  sort_by: (sortByUpdater.input as z.ZodType<string>).optional().describe('공통 차트의 첫 정렬 필드 이름 또는 ID. 같은 필드를 여러 역할·집계로 사용하면 고유한 차트 표시 이름을 지정합니다. sort_ascending 생략 시 내림차순이며 dimension_order와 함께 지정하지 않습니다.'),
  sort_ascending: (sortAscendingUpdater.input as z.ZodType<boolean>).optional().describe('공통 차트 정렬 방향. sort_by를 함께 지정해야 하며 true는 오름차순입니다.'),
  field_formats: fieldFormatsInput.optional(),
};
export interface CommonAnalysisInput {
  sort_by?: string | undefined;
  sort_ascending?: boolean | undefined;
  field_formats?: z.infer<typeof fieldFormatsInput> | undefined;
}
