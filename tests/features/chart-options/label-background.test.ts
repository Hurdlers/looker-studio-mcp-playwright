import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const args = { report_id: ORIGINAL, type: 'time_series', dimensions: ['day'], metrics: [{ field: 'value', aggregation: 'sum' }], date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day' };
describe('public data label background styles', () => {
  it('maps explicit background and opacity to the selected native series without changing data', async () => {
    const f=fake();
    const result=await f.run('chart_add',{...args,style:{'Data label background color':'#F1F2F3','Data label background opacity':1,'Data label background color#2':'#ABCDEF','Data label background opacity#2':'50%'}});
    expect(result.isError,resultText(result)).toBeFalsy();
    const chart=f.original.page[0]!.page.componentConfig![0] as Json,p=chart.propertyConfig.componentProperty;
    expect(p.lineChartProperty.seriesProperty[0].labelStyleProperty).toMatchObject({labelsBackgroundColor:{color:'#F1F2F3',opacity:1},labelsOpacity:1});
    expect(p.lineChartProperty.seriesProperty[1].labelStyleProperty).toMatchObject({labelsBackgroundColor:{color:'#ABCDEF',opacity:1},labelsOpacity:0.5});
    const before={conceptDefs:structuredClone(chart.conceptDefs),dates:structuredClone(p.dateDuration),source:chart.datasourceId};
    await f.run('component_update',{report_id:ORIGINAL,component_id:chart.componentId,style:{'Data label background opacity':0}});
    const changed=f.original.page[0]!.page.componentConfig![0] as Json;
    expect(changed.propertyConfig.componentProperty.lineChartProperty.seriesProperty[0].labelStyleProperty.labelsOpacity).toBe(0);
    expect(changed.conceptDefs).toEqual(before.conceptDefs);expect(changed.datasourceId).toBe(before.source);expect(changed.propertyConfig.componentProperty.dateDuration).toEqual(before.dates);
  });
  it.each([-1,101,'invalid'])('rejects invalid opacity %s without saving',async value=>{
    const f=fake();await expect(f.run('chart_add',{...args,style:{'Data label background opacity':value}})).rejects.toThrow();expect(f.writes()).toEqual([]);
  });
  it('leaves the legacy background unchanged when these styles are omitted',async()=>{
    const f=fake();await f.run('chart_add',args);
    const c=f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.propertyConfig.componentProperty.lineChartProperty.seriesProperty[0].labelStyleProperty.labelsBackgroundColor.color).toBe('transparent');
  });
});
