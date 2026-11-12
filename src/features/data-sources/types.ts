import { LookerError } from '../../core/errors.js';

// Field types (Looker Studio's semantic types) and default aggregations, with
// the names the editor's field menus show.

interface TypeEntry {
  // The editor's type menu the entry sits in.
  menu: string;
  label: string;
  semanticType: number;
  // Other names it goes by (the enum name is always accepted).
  also?: string[];
}

// semanticType numbers as the editor's enum has them.
const ENUM: Record<string, number> = {
  YEAR: 6, YEAR_QUARTER: 40, YEAR_MONTH: 3, YEAR_WEEK: 4, YEAR_MONTH_DAY: 2, YEAR_MONTH_DAY_HOUR: 1,
  YEAR_MONTH_DAY_MINUTE: 36, YEAR_MONTH_DAY_SECOND: 37, DATETIME_MICROSECOND: 45, QUARTER: 39, MONTH: 7,
  WEEK: 8, MONTH_DAY: 38, DAY_OF_WEEK: 5, DAY: 9, HOUR: 10, MINUTE: 11, NUMBER: 33, CURRENCY: 12,
  PERCENT: 14, COUNTRY: 16, COUNTRY_CODE: 17, CONTINENT: 18, CONTINENT_CODE: 19, SUB_CONTINENT: 20,
  SUB_CONTINENT_CODE: 21, REGION: 22, REGION_CODE: 23, CITY: 24, CITY_CODE: 25, METRO: 26, METRO_CODE: 27,
  DURATION: 28, TEXT: 32, BOOLEAN: 34, LATITUDE_LONGITUDE: 35, URL: 41, HYPERLINK: 42, IMAGE: 43,
  IMAGE_LINK: 44, POSTAL_CODE: 47, ADDRESS: 48, GEOSPATIAL: 49, SUB_REGION: 50,
};

const TYPES: TypeEntry[] = [
  { menu: 'Number', label: 'Number', semanticType: 33 },
  { menu: 'Number', label: 'Percent', semanticType: 14 },
  { menu: 'Number', label: 'Duration', semanticType: 28, also: ['Duration (sec.)', 'Duration (seconds)'] },
  // Currency takes a code: "Currency > EUR".
  { menu: 'Currency', label: 'Currency', semanticType: 12 },
  { menu: 'Text', label: 'Text', semanticType: 32 },
  { menu: 'Boolean', label: 'Boolean', semanticType: 34 },
  { menu: 'Date & Time', label: 'Date', semanticType: 2, also: ['Date (YYYYMMDD)'] },
  { menu: 'Date & Time', label: 'Date & Time', semanticType: 37, also: ['Date & Time (YYYYMMDDhhmmss)'] },
  { menu: 'Date & Time', label: 'Date Hour', semanticType: 1, also: ['Date Hour (YYYYMMDDhh)'] },
  { menu: 'Date & Time', label: 'Date Hour Minute', semanticType: 36, also: ['Date Hour Minute (YYYYMMDDhhmm)'] },
  { menu: 'Date & Time', label: 'Year', semanticType: 6, also: ['Year (YYYY)'] },
  { menu: 'Date & Time', label: 'Year Quarter', semanticType: 40 },
  { menu: 'Date & Time', label: 'Year Month', semanticType: 3, also: ['Year Month (YYYYMM)'] },
  { menu: 'Date & Time', label: 'ISO Year Week', semanticType: 4, also: ['ISO Year Week (YYYYww)', 'Year Week'] },
  { menu: 'Date & Time', label: 'Quarter', semanticType: 39 },
  { menu: 'Date & Time', label: 'Month', semanticType: 7, also: ['Month (MM)'] },
  { menu: 'Date & Time', label: 'ISO Week', semanticType: 8, also: ['ISO Week (ww)', 'Week'] },
  { menu: 'Date & Time', label: 'Month Day', semanticType: 38 },
  { menu: 'Date & Time', label: 'Day of Week', semanticType: 5, also: ['Day of Week (D)'] },
  { menu: 'Date & Time', label: 'Day of Month', semanticType: 9, also: ['Day of Month (DD)', 'Day'] },
  { menu: 'Date & Time', label: 'Hour', semanticType: 10, also: ['Hour (hh)'] },
  { menu: 'Date & Time', label: 'Minute', semanticType: 11, also: ['Minute (mm)'] },
  { menu: 'Geo', label: 'Latitude, Longitude', semanticType: 35 },
  { menu: 'Geo', label: 'Address', semanticType: 48 },
  { menu: 'Geo', label: 'Postal code', semanticType: 47 },
  { menu: 'Geo', label: 'City', semanticType: 24 },
  { menu: 'Geo', label: 'City code', semanticType: 25 },
  { menu: 'Geo', label: 'Country subdivision (2nd level)', semanticType: 50 },
  { menu: 'Geo', label: 'Country subdivision (1st level)', semanticType: 22, also: ['Region'] },
  { menu: 'Geo', label: 'Country subdivision (1st level) code', semanticType: 23, also: ['Region code'] },
  { menu: 'Geo', label: 'Designated market area', semanticType: 26, also: ['Metro'] },
  { menu: 'Geo', label: 'Designated market area code', semanticType: 27, also: ['Metro code'] },
  { menu: 'Geo', label: 'Country', semanticType: 16 },
  { menu: 'Geo', label: 'Country code', semanticType: 17 },
  { menu: 'Geo', label: 'Subcontinent', semanticType: 20 },
  { menu: 'Geo', label: 'Subcontinent code', semanticType: 21 },
  { menu: 'Geo', label: 'Continent', semanticType: 18 },
  { menu: 'Geo', label: 'Continent code', semanticType: 19 },
  { menu: 'URL', label: 'URL', semanticType: 41 },
  { menu: 'URL', label: 'Hyperlink', semanticType: 42 },
  { menu: 'URL', label: 'Image', semanticType: 43 },
  { menu: 'URL', label: 'Image link', semanticType: 44 },
];

const LABELS = new Map<number, string>([
  ...TYPES.map((t) => [t.semanticType, t.label] as [number, string]),
  [45, 'Date & Time'],
  [30, 'Milli Currency (deprecated)'],
  [31, 'Micro Currency (deprecated)'],
  [46, 'Geo Json'],
  [49, 'Geospatial'],
]);

// "Number", "Currency (KRW)", "type 99" for one the table does not know.
export function typeLabel(semanticType: number | undefined, currency?: string): string {
  if (semanticType === undefined) return 'type unknown';
  if (semanticType === 12) return currency ? `Currency (${currency})` : 'Currency';
  return LABELS.get(semanticType) ?? `type ${semanticType}`;
}

export interface SemanticConfig {
  semanticType: number;
  currencyOptions?: { currencyCode: string };
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const names = (t: TypeEntry): string[] => [t.label, ...(t.also ?? [])].map(norm);
// "EUR - Euro (€)" matches "EUR"; a menu label matches with its " - …" tail.
const labelMatches = (t: TypeEntry, want: string): boolean => names(t).some((n) => n === want || want.startsWith(`${n} - `));

export const TYPE_HELP =
  'a type name (Text, Number, Percent, Date, Country, URL, Boolean …) or a "Menu > Item" path like "Currency > EUR" or "Date & Time > Date Hour"';

// A type as the editor's menu names it ("Number", "Currency > EUR",
// "Date & Time > Date", "Geo > Country") or by its enum name (YEAR_MONTH_DAY).
// A bare name is looked up at the top level and in every submenu.
export function parseType(input: string): SemanticConfig {
  const parts = input.split('>').map(norm).filter(Boolean);
  const bad = (why: string): never => {
    throw new LookerError('invalid', `Unknown field type "${input}"${why}. Use ${TYPE_HELP}.`);
  };
  if (!parts.length) bad('');
  const [first, second] = [parts[0]!, parts[1]];
  if (parts.length > 2) bad(': give at most "Menu > Item"');
  if (first === 'currency' || first.startsWith('currency ')) {
    const code = (second ?? /^currency\s*\(?\s*([a-z]{3})\)?$/.exec(first)?.[1] ?? '').split(/[\s-]/)[0]!.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) bad(': currency needs its three-letter code, e.g. "Currency > EUR"');
    return { semanticType: 12, currencyOptions: { currencyCode: code } };
  }
  if (second !== undefined) {
    const hit = TYPES.find((t) => norm(t.menu) === first && labelMatches(t, second));
    if (!hit) bad(` (no "${second}" in the ${parts[0]} menu)`);
    return { semanticType: hit!.semanticType };
  }
  const enumName = first.toUpperCase().replace(/[\s&,-]+/g, '_');
  if (ENUM[enumName] !== undefined && enumName !== 'CURRENCY') return { semanticType: ENUM[enumName] };
  const top = TYPES.find((t) => norm(t.menu) === first && norm(t.label) === first);
  const hit = top ?? TYPES.find((t) => labelMatches(t, first));
  if (!hit) return bad('');
  return { semanticType: hit.semanticType };
}

// ---- Aggregations -----------------------------------------------------------

export const AGGREGATIONS = {
  none: 0,
  avg: 1,
  count: 2,
  count_distinct: 3,
  max: 4,
  min: 5,
  sum: 6,
  median: 10,
  variance: 11,
  std_dev: 12,
} as const;

export type AggregationName = keyof typeof AGGREGATIONS;

const AGG_LABELS = new Map<number, string>([...Object.entries(AGGREGATIONS).map(([k, v]) => [v, k] as [number, string]), [7, 'auto']]);

export function aggregationLabel(n: number): string {
  return AGG_LABELS.get(n) ?? `aggregation ${n}`;
}

// Types that hold amounts: every aggregation applies. Others (text, dates,
// places, links) only count, count distinct, min, max or none.
const NUMERIC = new Set([33, 12, 14, 28, 30, 31]);
const ANY_TYPE: AggregationName[] = ['none', 'count', 'count_distinct', 'min', 'max'];

export function checkAggregation(aggregation: AggregationName, semanticType: number | undefined, field: string): void {
  if (semanticType === undefined || NUMERIC.has(semanticType) || ANY_TYPE.includes(aggregation)) return;
  throw new LookerError(
    'invalid',
    `Field "${field}" is ${typeLabel(semanticType)}: ${aggregation} needs a number. Change its type to Number first (type: "Number"), or use ${ANY_TYPE.join(', ')}.`,
  );
}
