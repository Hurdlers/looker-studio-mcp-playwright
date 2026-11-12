import { describe, expect, it } from 'vitest';
import { resultText } from '../../../src/core/tool.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';
const metric = { field: 'value', aggregation: 'sum' };
const item = (key: string, template_id: string): Json => ({ key, template_id, date_range: '2026-11-01..2026-11-03', bindings: { metric, date: 'day', ...(template_id === 'common-detail-table' || template_id === 'common-category-line' ? { dimension: 'category' } : {}) } });
const base = { report_id: ORIGINAL, width: 1500, density: 'compact' };
function setup() { const f = fake(); f.original.shareable.name = '[looker-studio-mcp-lab-1] appearance'; return f; }
async function add(f: ReturnType<typeof fake>, args: Json) { const r = await f.run('component_page_add', args); expect(r.isError, resultText(r)).toBeFalsy(); return JSON.parse(resultText(r)); }
const data = (c: Json) => ({ type: c.type, source: c.datasourceId, definitions: c.conceptDefs.map((d: Json)=>d.queryTimeTransformation), date: c.propertyConfig.componentProperty.dateDuration, sort: (c.propertyConfig.componentProperty.sort ?? []).map((s: Json) => ({ direction: s.sortDir, field: c.conceptDefs.find((d: Json) => d.name === s.sortColumn)?.queryTimeTransformation.dataTransformation.sourceFieldName })) });
describe('public page appearance', () => {
  it('previews without writes and saves a fully styled page once, preserving data and report settings', async () => {
    const f = setup(), legacy = setup(), before = structuredClone(f.original);
    const items = [item('kpi','common-kpi'),item('trend','common-time-trend'),item('category','common-category-line'),item('table','common-detail-table')];
    const args = { ...base, items, appearance: 'outlined-report' };
    const preview = await add(f,{...args,preview:true}); expect(preview.appearance).toBe('outlined-report');
    expect(f.writes()).toEqual([]); expect(f.original).toEqual(before);
    const out = await add(f,args); await add(legacy,{...base,items});
    expect(f.writes().filter(c=>c.endpoint==='updatePage')).toHaveLength(1);
    expect(f.writes().filter(c=>c.endpoint!=='updatePage')).toEqual([]);
    expect(f.original.report).toEqual(before.report);
    const charts = f.original.page[0]!.page.componentConfig! as Json[], old=legacy.original.page[0]!.page.componentConfig! as Json[];
    expect(charts.map(data)).toEqual(old.map(data));
    expect(charts[0]!.propertyConfig.componentProperty.kpiMetricProperty).toMatchObject({fontSize:26,textAlignment:2,metricAlignment:2,compareAlignment:2});
    expect(charts[3]!.propertyConfig.componentProperty.tableProperty).toMatchObject({dataRowHeight:32,headerRowHeight:32,fontSize:16,headerFontSize:16});
    expect(out.items[3].size.height).toBe(256);
  });
  it('measures table rows in regions and preserves sufficiently large explicit height', async () => {
    const f=setup(); const table={...item('table','common-detail-table'),height:420,common_options:{visible_rows:10}};
    const out=await add(f,{...base,appearance:'outlined-report',regions:[{key:'pair',kind:'table-trend',title:'Details',items:[table,item('trend','common-time-trend')]}]});
    expect(out.items[0].size.height).toBe(420);
    expect(f.original.page[0]!.page.componentConfig!.find((c:Json)=>c.type==='simple-table')!.propertyConfig).toBeDefined();
  });
  it.each([
    {...item('table','common-detail-table'),height:255},
    {...item('table','common-detail-table'),height:400,common_options:{visible_rows:10}},
    {...item('unsupported','common-overview-section'),bindings:{metric,dimension:'category'}},
  ])('refuses an unsupported or undersized final child without writes %#',async last=>{
    const f=setup(),before=structuredClone(f.original);
    await expect(f.run('component_page_add',{...base,appearance:'outlined-report',items:[item('first','common-kpi'),last]})).rejects.toThrow();
    expect(f.writes()).toEqual([]);expect(f.original).toEqual(before);
  });
});

describe('annotated profile line readability width', () => {
  function regions(show_values = true): Json[] { return [
    { key: 'overview', kind: 'kpi-trend', kpi_columns: 2, title: 'Overview', items: [
      ...['a','b','c','d'].map(key=>item(key,'common-kpi')),
      { ...item('line','common-category-line'), common_options: { show_values, dimension_order: 'ascending' }, height:260 },
    ] },
    { key:'detail',kind:'table-trend',title:'Details',items:[
      item('table','common-detail-table'), { ...item('line2','common-time-trend'), common_options:{show_values},height:260 },
    ] },
  ]; }
  it.each([[1500,833,764],[960,864,864],[840,744,744]])('uses readable chart widths on a %spx canvas',async(width,firstWidth,secondWidth)=>{
    const f=setup(); const out=await add(f,{...base,width,appearance:'outlined-report',regions:regions(),preview:true});
    const first=out.items.find((c:Json)=>c.key==='line'),second=out.items.find((c:Json)=>c.key==='line2');
    expect(first.size.width).toBe(firstWidth);expect(second.size.width).toBe(secondWidth);
    expect(first.size.height).toBe(260);expect(second.size.height).toBe(260);
    if(width<1500){
      const kpis=out.regions[0].items.slice(0,4);
      expect(first.position.top).toBeGreaterThanOrEqual(Math.max(...kpis.map((c:Json)=>c.position.top+c.size.height))+16);
      const table=out.items.find((c:Json)=>c.key==='table');
      expect(second.position.top).toBeGreaterThanOrEqual(table.position.top+table.size.height+16);
    }
    expect(f.writes()).toEqual([]);
  });
  it('refuses a 720px region canvas before saving with an actionable alternative',async()=>{
    const f=setup(),before=structuredClone(f.original);
    await expect(f.run('component_page_add',{...base,width:720,appearance:'outlined-report',regions:regions()})).rejects.toThrow(/720px.*Widen.*show_values:false/);
    expect(f.writes()).toEqual([]);expect(f.original).toEqual(before);
  });
  it('keeps the old side-by-side geometry when the profile is absent or labels are false',async()=>{
    for(const args of [{regions:regions()},{regions:regions(false),appearance:'outlined-report'}]){
      const f=setup();const out=await add(f,{...base,width:960,...args,preview:true});
      expect(out.items.find((c:Json)=>c.key==='line').size.width).toBe(509);
      expect(out.items.find((c:Json)=>c.key==='line2').size.width).toBe(467);
    }
  });
  it('applies the same width floor to ordinary items and preserves stored data/sort through reflow',async()=>{
    const wide=setup(),narrow=setup();
    const items=[item('kpi','common-kpi'),{...item('line','common-category-line'),height:260,common_options:{show_values:true,dimension_order:'ascending'}}];
    await add(wide,{...base,appearance:'outlined-report',items});
    const out=await add(narrow,{...base,width:960,appearance:'outlined-report',items});
    expect(out.items[1].size.width).toBe(912);
    expect(out.items[1].position.top).toBeGreaterThan(out.items[0].position.top);
    expect((narrow.original.page[0]!.page.componentConfig! as Json[]).map(data)).toEqual((wide.original.page[0]!.page.componentConfig! as Json[]).map(data));
    const tooSmall=setup();
    await expect(tooSmall.run('component_page_add',{...base,width:720,appearance:'outlined-report',items})).rejects.toThrow(/720px/);
    expect(tooSmall.writes()).toEqual([]);
  });
});
