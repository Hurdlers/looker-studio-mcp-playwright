import { describe, expect, it } from 'vitest';

import { fromMapValue, toMapValue } from '../src/core/mapvalue.js';

describe('mapValue', () => {
  it('writes plain JSON the way the editor stores behavior and themes', () => {
    expect(toMapValue({ onSelect: [{ action: 'x', isControl: true, init: { rowsCount: 100, ratio: 0.5 } }], gone: undefined, none: null })).toEqual({
      mapValue: {
        entry: [
          {
            key: 'onSelect',
            value: {
              arrayValue: {
                value: [
                  {
                    mapValue: {
                      entry: [
                        { key: 'action', value: { strValue: 'x' } },
                        { key: 'isControl', value: { boolValue: true } },
                        { key: 'init', value: { mapValue: { entry: [{ key: 'rowsCount', value: { int64Value: '100' } }, { key: 'ratio', value: { doubleValue: 0.5 } }] } } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    });
  });

  it('reads it back, keeping int64 strings too large for a number', () => {
    const plain = { a: 'x', n: 7, f: 1.5, b: false, list: [1, 'y'], deep: { e: {} } };
    expect(fromMapValue(toMapValue(plain))).toEqual(plain);
    expect(fromMapValue({ int64Value: '9007199254740993' })).toBe('9007199254740993');
    expect(fromMapValue({ mapValue: {} })).toEqual({});
    expect(fromMapValue({ arrayValue: {} })).toEqual([]);
    expect(fromMapValue({ unknownValue: 1 })).toBeUndefined();
  });

  it('keeps a double a double when writing over a stored value', () => {
    const stored = toMapValue({ opacity: 0.5, size: 3, list: [0.5] });
    expect(toMapValue({ opacity: 1, size: 4, list: [2], extra: 1 }, stored)).toEqual({
      mapValue: {
        entry: [
          { key: 'opacity', value: { doubleValue: 1 } },
          { key: 'size', value: { int64Value: '4' } },
          { key: 'list', value: { arrayValue: { value: [{ doubleValue: 2 }] } } },
          { key: 'extra', value: { int64Value: '1' } },
        ],
      },
    });
    const round = { mapValue: { entry: [{ key: 'opacity', value: { doubleValue: 1 } }] } };
    expect(toMapValue(fromMapValue(round), round)).toEqual(round);
  });
});
