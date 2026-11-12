import { z } from 'zod';

const nonempty = (description: string) => z.string().trim().min(1).describe(description);
const value = z.union([z.string(), z.number()]);
export const clauseInput = z.object({
  field: nonempty('조건에 쓸 필드 이름 또는 ID.'), condition: nonempty('조건 별칭 또는 편집기 목록의 문구.'),
  values: z.array(value).optional().describe('비교 값. between은 두 개, is_null은 생략합니다.'),
  exclude: z.boolean().optional().describe('true이면 조건에 맞는 행을 뺍니다.'),
});
export const filtersInput = z.array(z.object({
  name: nonempty('필터 이름. 같은 소스에 이 이름의 필터가 있으면 그대로 씁니다.'),
  field: clauseInput.shape.field.optional(), condition: clauseInput.shape.condition.optional(),
  values: clauseInput.shape.values, exclude: clauseInput.shape.exclude,
  clauses: z.array(z.array(clauseInput)).optional().describe('바깥 묶음은 AND, 각 묶음 안은 OR로 연결합니다.'),
})).describe('차트에 덧붙일 필터. 이름만 주면 저장된 필터를 연결합니다.');
export const fieldsInput = z.record(nonempty('설정 칸 제목.'), z.array(nonempty('필드 이름 또는 ID.'))).describe('설정 칸 제목별 필드 목록. 기존 목록을 이 목록으로 바꿉니다.');
export const labelsInput = z.record(nonempty('현재 필드 이름 또는 표시 이름.'), nonempty('새 표시 이름.')).describe('차원과 지표의 표시 이름을 바꿉니다. 계열과 조건부 서식에는 바뀐 이름을 씁니다.');
export const sortsInput = z.array(z.object({ field: nonempty('정렬할 필드 이름 또는 ID.'), ascending: z.boolean().default(false).describe('오름차순 여부. 기본은 내림차순입니다.') })).describe('표는 기존 정렬 뒤에 덧붙이며 합쳐서 열 개까지입니다. 필드 기반 드롭다운·고정 목록은 한 개의 정렬만 받으며 기존 정렬을 교체합니다. []는 목록 컨트롤의 정렬을 지웁니다.');
export const seriesInput = z.array(z.object({
  metric: nonempty('차트에 현재 표시된 지표 이름.'), type: z.enum(['line', 'bars']).optional().describe('계열을 선 또는 막대로 표시합니다.'),
  axis: z.enum(['left', 'right']).optional().describe('왼쪽 또는 오른쪽 세로축.'), color: z.string().optional().describe('계열 색. #RRGGBB 형식입니다.'),
})).describe('계열별 모양, 축, 색. 없는 지표와 지원하지 않는 설정은 경고로 알립니다.');
export const referenceLinesInput = z.array(z.object({
  value: z.number().finite().optional().describe('Constant value 참조선에 필요한 값. Metric에는 쓰지 않습니다.'), label: z.string().optional().describe('참조선 옆에 보일 글자.'),
  color: z.string().optional().describe('참조선 색. #RRGGBB 형식입니다.'), type: z.string().optional().describe('Constant value 또는 Metric. Parameter는 바인딩 미지원으로 거부합니다.'),
  axis: z.string().optional().describe('Left Y-axis, Right Y-axis, X-axis 등 차트의 축 이름.'),
  metric: nonempty('Metric 참조선에 쓸 현재 차트 지표의 표시 이름 또는 필드 ID. 생략하면 첫 지표.').optional(),
  calculation: nonempty('Metric 계산: Average, Median, Percentile, Min, Max, Total. 기본 Average.').optional(),
  percentile: z.number().finite().min(0).max(100).optional().describe('Percentile 계산의 백분위 값, 0~100.'),
  weight: z.union([z.number().finite().positive(), z.literal('Auto')]).optional().describe('참조선 두께. 양수 픽셀 값이며 기본은 2입니다. Auto는 원본의 자동 두께를 유지합니다.'),
})).describe('비어 있지 않으면 기존 선에 덧붙이는 참조선. 합쳐 열 개까지이며, 빈 배열 []는 기존 참조선을 모두 지웁니다.');
export const referenceBandsInput = z.array(z.object({
  from: z.number().finite().describe('띠의 시작값.'), to: z.number().finite().describe('띠의 끝값. 시작값보다 커야 합니다.'),
  label: z.string().optional().describe('띠의 설명 글자.'), color: z.string().optional().describe('띠 색. #RRGGBB 형식입니다.'),
})).describe('왼쪽 세로축의 두 값 사이를 칠할 참조 띠.');
export const conditionalFormatsInput = z.array(z.object({
  rules: z.array(z.array(z.object({
    field: nonempty('조건에 쓸 차트의 표시 이름.'), condition: nonempty('equals, not_equals, gt, gte, lt, lte 등의 조건.'),
    value: value.optional().describe('비교 값. is_null과 is_not_null은 생략합니다.'),
  }))).describe('바깥 묶음은 AND, 각 묶음 안은 OR입니다.'),
  apply_to: z.string().optional().describe('Entire row 또는 특정 열의 현재 표시 이름.'),
  font_color: z.string().optional().describe('조건에 맞는 글자색. #RRGGBB 형식입니다.'),
  background_color: z.string().optional().describe('조건에 맞는 배경색. #RRGGBB 형식입니다.'),
})).describe('차트에 덧붙일 단색 조건부 서식. 글자색이나 배경색을 하나 이상 줍니다.');

export type FilterSpec = z.infer<typeof filtersInput>[number];
export type ClauseSpec = z.infer<typeof clauseInput>;
export type SeriesSpec = z.infer<typeof seriesInput>[number];
export type ReferenceLineSpec = z.infer<typeof referenceLinesInput>[number];
export type ReferenceBandSpec = z.infer<typeof referenceBandsInput>[number];
export type ConditionalSpec = z.infer<typeof conditionalFormatsInput>[number];
