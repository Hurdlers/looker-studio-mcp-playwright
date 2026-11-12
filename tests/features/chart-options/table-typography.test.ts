import { describe, expect, it } from 'vitest';
import { applyStyle, labelsFor } from '../../../src/core/style.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';

describe('table typography and row sizing', () => {
  it('releases captured row heights while preserving fields, formats and metric encodings', () => {
    const component = { type: 'simple-table', conceptDefs: [{ name: 'revenue', format: 'currency' }], propertyConfig: { componentProperty: {
      metrics: { retained: true },
      tableProperty: { rowsHeight: [31, 31, 31, 31], tableMetricProperty: [{ colType: 2, colAlignment: 3 }], chartTitleProperty: { chartTitleText: 'Revenue' } },
    } } };
    applyStyle(component, labelsFor(styleTables, component.type), {
      'Title font size': 18, 'Title alignment': 'Left',
      'Body font size': 14, 'Header font size': 14,
      'Data row height': 36, 'Header row height': 40,
      'Automatic row height': false, 'Row heights': 'Auto',
    });
    const table = component.propertyConfig.componentProperty.tableProperty;
    expect(table).toMatchObject({ fontSize: 14, headerFontSize: 14, dataRowHeight: 36, headerRowHeight: 40, bodyAutoHeight: false,
      chartTitleProperty: { chartTitleText: 'Revenue', chartTitleFontSize: 18, chartTitleTextAlignment: 1 },
      tableMetricProperty: [{ colType: 2, colAlignment: 3 }],
    });
    expect(table).not.toHaveProperty('rowsHeight');
    expect(component.conceptDefs).toEqual([{ name: 'revenue', format: 'currency' }]);
    expect(component.propertyConfig.componentProperty.metrics).toEqual({ retained: true });
  });
});
