import { describe, expect, it } from 'vitest';
import { expectedPageAfterAppearance } from '../../../src/features/component-templates/analysis-preservation.js';
import { styleTables } from '../../../src/features/chart-options/styles.js';
import { FEATURE_TOOLS } from '../../../src/features/registry.generated.js';
import { resultText, type Tool } from '../../../src/core/tool.js';
import type { PageDoc } from '../../../src/core/session.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const original = FEATURE_TOOLS.find(tool => tool.name === 'component_update')!;
const item = (key: string) => ({ key, template_id: 'common-kpi', bindings: { date: 'day', metric: { field: 'value', aggregation: 'sum' } }, common_options: { comparison: 'Previous period' } });
const args = { report_id: ORIGINAL, appearance: 'outlined-report', density: 'compact', controls: { data_source: 'Metrics', date_range: '2026-11-01..2026-11-03', date_range_dimension: 'day' }, items: [item('one'),item('two')] };
const prop = (c: Json): Json => c.propertyConfig.componentProperty;
const faults: Array<[string, (page: Json, c: Json) => void]> = [
  ['metric', (_p,c)=>{prop(c).metrics.labeledConcepts[0].value.conceptNames=[];}],
  ['aggregation', (_p,c)=>{c.conceptDefs[0].queryTimeTransformation.dataTransformation.aggregation=4;}],
  ['calculation', (_p,c)=>{c.conceptDefs[0].queryTimeTransformation.dataTransformation.textFormula='1';}],
  ['source', (_p,c)=>{c.datasourceId='different';}],
  ['type', (_p,c)=>{c.type='simple-table';}],
  ['period', (_p,c)=>{prop(c).dateDuration.startAnchor='20261001';}],
  ['comparison', (_p,c)=>{delete prop(c).compareDateDuration;}],
  ['filter', (_p,c)=>{prop(c).filters=[{filterId:'unexpected'}];}],
  ['sort', (_p,c)=>{prop(c).sort=[{sortColumn:'unexpected',sortDir:1}];}],
  ['extra chart', (p,c)=>{p.page.componentConfig.push({...structuredClone(c),componentId:'extra-chart'});}],
  ['conditions', (p)=>{p.chartCondition=[{chartId:'unexpected',condition:{changed:true}}];}],
];
describe('appearance analysis preservation boundary',()=>{
  it.each(faults)('rejects %s changes, including an earlier chart, before the only live save',async(_name,mutate)=>{
    let calls=0;
    const override: Tool={...original,run:async(ctx,input)=>{
      const result=await original.run(ctx,input);
      if(++calls===2) await ctx.session.editPage(ORIGINAL,'p1',page=>{
        const p=page as unknown as Json;
        const chart=p.page.componentConfig.find((c:Json)=>c.type==='kpi-metric');
        mutate(p,chart);
      },'test fault');
      return result;
    }};
    const f=fake({overrides:[override]});f.original.shareable.name='[looker-studio-mcp-lab-1] preservation';
    const before=structuredClone(f.original),sources=structuredClone(f.sources);
    await expect(f.run('component_page_add',args)).rejects.toThrow(/Appearance changed content/);
    expect(calls).toBe(2);expect(f.writes()).toEqual([]);expect(f.original).toEqual(before);expect(f.sources).toEqual(sources);
  });
  it('also rejects a native style mapping that points at an analytical field',()=>{
    const label=styleTables.find(t=>t.type==='kpi-metric')!.labels.find(l=>l.label==='Font size')!,path=label.path;
    const page:PageDoc={pageId:'p1',version:'1',page:{componentConfig:[{componentId:'chart',type:'kpi-metric',conceptDefs:[],propertyConfig:{componentProperty:{metrics:{retained:true}}}}]}};
    try{
      label.path='metrics';
      expect(()=>expectedPageAfterAppearance(page,'chart',{'Font size':26})).toThrow(/mapping changes analytical/);
      expect((page.page.componentConfig![0]!.propertyConfig as Json).componentProperty.metrics).toEqual({retained:true});
    }finally{label.path=path;}
  });
  it('keeps exactly three fixture KPIs and one trend in a two-column region without filling its empty slot', async () => {
    const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] exact fixture count';
    const fixture = [item('fixture-a'), item('fixture-b'), item('fixture-c'), {
      key: 'fixture-trend', template_id: 'common-time-trend', bindings: { date: 'day', metric: { field: 'value', aggregation: 'sum' } },
    }];
    const { items: _items, ...pageArgs } = args;
    const result = await f.run('component_page_add', { ...pageArgs, width: 1500,
      regions: [{ key: 'fixture-region', kind: 'kpi-trend', kpi_columns: 2, title: 'Test fixture', items: fixture }] });
    expect(result.isError, resultText(result)).toBeFalsy();
    const out = JSON.parse(resultText(result));
    expect(out.items.map((c: Json) => c.key)).toEqual(fixture.map(c => c.key));
    const charts = (f.original.page[0]!.page.componentConfig! as Json[]).filter(c => ['kpi-metric', 'simple-linechart'].includes(c.type));
    expect(charts).toHaveLength(4); expect(charts.filter(c => c.type === 'kpi-metric')).toHaveLength(3);
    const [a,b,c,t] = out.items;
    expect(a.position.top).toBe(b.position.top); expect(c.position.top).toBeGreaterThan(a.position.top);
    expect(c.position.left).toBe(a.position.left); expect(c.size.width).toBe(a.size.width);
    expect(t.position.left).toBeGreaterThan(b.position.left);
    expect(f.writes().filter(c => c.endpoint === 'updatePage')).toHaveLength(1);
  });
  it('permits the actual profile, preserves the explicit controls inheritance step and saves once',async()=>{
    const f=fake();f.original.shareable.name='[looker-studio-mcp-lab-1] preservation';
    const preview=await f.run('component_page_add',{...args,preview:true});
    expect(preview.isError,resultText(preview)).toBeFalsy();expect(f.writes()).toEqual([]);
    const saved=await f.run('component_page_add',args);expect(saved.isError,resultText(saved)).toBeFalsy();
    expect(f.writes().filter(c=>c.endpoint==='updatePage')).toHaveLength(1);
    const charts=(f.original.page[0]!.page.componentConfig! as Json[]).filter(c=>c.type==='kpi-metric');
    expect(charts).toHaveLength(2);
    for(const c of charts){expect(prop(c).dateDuration).toBeUndefined();expect(prop(c).compareDateDuration).toBeDefined();}
  });
});
