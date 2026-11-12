import { expect, it } from 'vitest';
import { createContext } from '../../../src/core/context.js';
import { parameterFormula, canonicalFieldFormula } from '../../../src/features/fields/parameter-reference.js';
import type { ResolvedSource } from '../../../src/core/datasource.js';

it('encodes parameter identifiers and display names while preserving literals and existing markers', async () => {
  const ctx = createContext({ rap: { call: async () => ({ published: { resource: { parameterConfiguration: { parameters: [
    { key: 'target', value: { parameterDisplayConfiguration: { displayName: 'Target value' } } },
    { key: 'limit', value: { parameterDisplayConfiguration: { displayName: 'Revenue' } } },
  ] } } } }) as any } as any });
  const source = { datasourceId: 'source', fields: [{ name: 'Revenue' }] } as ResolvedSource;
  expect(await parameterFormula(ctx, source, 'SUM(Revenue) - t0.target + Target value + limit')).toBe('SUM(Revenue) - \uE000target + \uE000target + \uE000limit');
  const literal = `'target' + "Target value" /* target */ -- limit\n\uE000target + target_count`;
  expect(await parameterFormula(ctx, source, literal)).toBe(literal);
});

it('canonical field references preserve function calls, literals, other namespaces and parameter markers', () => {
  const source = { fields: [{ id: 'calc_total', name: 'Total' }, { id: '_sum_', name: 'SUM' }] } as ResolvedSource;
  expect(canonicalFieldFormula(source, 'SUM(Total) + t0.calc_total + SUM + t1.Total + \uE000Total')).toBe('SUM(t0.calc_total) + t0.calc_total + t0._sum_ + t1.Total + \uE000Total');
  expect(canonicalFieldFormula(source, "'Total' /* Total */ + Total값")).toBe("'Total' /* Total */ + Total값");
});
