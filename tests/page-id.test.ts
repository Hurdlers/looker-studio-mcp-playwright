import { describe, expect, it } from 'vitest';

import { externalPageId } from '../src/looker/page-id.js';

describe('externalPageId', () => {
  it.each([
    ['0', 'A'], ['1', 'B'], ['61', '9'], ['62', 'AB'],
    ['1234567', 'XKLF'], ['9007199254740993', 'Joc7NxqPp'],
  ])('encodes numeric page %s as %s without losing precision', (internal, external) => {
    expect(externalPageId(internal)).toBe(external);
  });

  it.each(['p_123', 'page_123', 'p1', 'XKLF'])('preserves nonnumeric page %s', (id) => {
    expect(externalPageId(id)).toBe(id);
  });
});
