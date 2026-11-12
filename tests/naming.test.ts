import { describe, expect, it } from 'vitest';

import { FEATURE_TOOLS } from '../src/features/registry.generated.js';

// Tool names are <resource>_<verb>, each used once.
const PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

describe('feature tool names', () => {
  it.each(FEATURE_TOOLS.map((t) => [t.name]))('%s is <resource>_<verb>', (name) => {
    expect(name).toMatch(PATTERN);
  });

  it('has no duplicates', () => {
    const names = FEATURE_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
