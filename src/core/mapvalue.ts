// Looker Studio keeps some settings (component behavior, themes) as protobuf
// Struct-like values: {mapValue: {entry: [{key, value}]}}, {arrayValue: {value:
// […]}}, {strValue}, {int64Value: "5"}, {boolValue}. These turn them into plain
// JSON and back, so tools can read and change them like any other object.

export type MapValue =
  | { strValue: string }
  | { int64Value: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { mapValue: { entry?: Array<{ key: string; value: MapValue }> } }
  | { arrayValue: { value?: MapValue[] } };

type Plain = string | number | boolean | Plain[] | { [key: string]: Plain };

// Whole numbers go as int64Value strings, the way the editor writes them,
// except where `like` (the value being replaced, as stored) holds a
// doubleValue: there a whole number stays a double (opacity 1.0), so a value
// read with fromMapValue and written back keeps its form.
// undefined and null are left out (in arrays too): the format has no null.
export function toMapValue(value: unknown, like?: unknown): MapValue {
  const was = (like && typeof like === 'object' ? like : {}) as Record<string, any>;
  if (typeof value === 'string') return { strValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number')
    return Number.isInteger(value) && !('doubleValue' in was) ? { int64Value: String(value) } : { doubleValue: value };
  if (typeof value === 'bigint') return { int64Value: String(value) };
  if (Array.isArray(value)) {
    const old = (was.arrayValue?.value ?? []) as unknown[];
    return { arrayValue: { value: value.filter((v) => v != null).map((v, i) => toMapValue(v, old[i])) } };
  }
  if (value && typeof value === 'object') {
    const old = new Map(((was.mapValue?.entry ?? []) as Array<{ key: string; value: unknown }>).map((e) => [e.key, e.value]));
    return {
      mapValue: {
        entry: Object.entries(value)
          .filter(([, v]) => v != null)
          .map(([key, v]) => ({ key, value: toMapValue(v, old.get(key)) })),
      },
    };
  }
  throw new TypeError(`Cannot store ${String(value)} as a mapValue.`);
}

// int64Value becomes a number when it fits one exactly, else stays a string.
// Anything unknown comes back as undefined.
export function fromMapValue(value: unknown): Plain | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, any>;
  if ('strValue' in v) return String(v.strValue);
  if ('boolValue' in v) return Boolean(v.boolValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('int64Value' in v) {
    const n = Number(v.int64Value);
    return Number.isSafeInteger(n) ? n : String(v.int64Value);
  }
  if ('arrayValue' in v)
    return ((v.arrayValue?.value ?? []) as unknown[]).map(fromMapValue).filter((x): x is Plain => x !== undefined);
  if ('mapValue' in v) {
    const out: Record<string, Plain> = {};
    for (const e of (v.mapValue?.entry ?? []) as Array<{ key: string; value: unknown }>) {
      const x = fromMapValue(e.value);
      if (x !== undefined) out[e.key] = x;
    }
    return out;
  }
  return undefined;
}
