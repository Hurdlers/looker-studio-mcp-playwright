import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { resultText } from '../../../src/core/tool.js';
import { buildServer } from '../../../src/mcp/server.js';
import { fake, ORIGINAL, type Json } from '../spec/fake.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function definition(): Json { return {
  version: 1, id: 'sample-card', name: '합계 카드', purpose: '측정값의 합계', priority: 1, fingerprint: 'verified-version', theme_hash: 'family-one', width: 200, height: 100,
  provenance: { report_id: 'private-report-reference' }, blockers: [], notes: [], text_slots: [],
  roles: [{ key: 'metric_1', kind: 'metric', label: 'private-source-label', source_field: 'private-field-id', source_name: 'private-source-name', numeric_required: true }],
  native_components: [{ componentId: 'old-card', type: 'kpi-metric', datasourceId: '$data_source', attributeConfig: { componentAttribute: { left: 0, top: 0, width: 200, height: 100 } },
    propertyConfig: { componentProperty: { dataset: { datasetType: 1, datasetId: '$data_source' }, metrics: { labeledConcepts: [{ key: 'primary', value: { conceptNames: ['old-value'] } }] }, kpiMetricProperty: { primaryDecimalPrecision: 0 } } },
    conceptDefs: [{ name: 'old-value', id: 't0.old-value', namespace: 't0', queryTimeTransformation: { dataTransformation: { sourceFieldName: '$role:metric_1', aggregation: 6 } } }],
  }],
}; }
async function setup(recipe = definition()) {
  const dir = await mkdtemp(join(tmpdir(), 'component-store-')); dirs.push(dir); await mkdir(join(dir, 'recipes'));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({ version: 1, components: [recipe] }));
  await writeFile(join(dir, 'validation.json'), JSON.stringify({ [recipe.id]: { status: 'pass', fingerprint: 'verified-version' } }));
  await writeFile(join(dir, 'recipes', recipe.id + '.json'), JSON.stringify(recipe));
  const f = fake(); f.ctx.config.componentLibrary = dir; f.original.shareable.name = '[looker-studio-mcp-lab-1] sample';
  return { ...f, dir };
}
const args = { report_id: ORIGINAL, template_id: 'sample-card', bindings: { metric_1: { field: 'value', aggregation: 'sum' } } };

describe('component template public tools', () => {
  it('lists and inspects without disclosing source provenance or native definitions', async () => {
    const f = await setup();
    for (const [name, input] of [['component_template_list', {}], ['component_template_inspect', { template_id: 'sample-card' }]] as const) {
      const out = resultText(await f.run(name, input));
      expect(out).toContain('sample-card'); expect(out).toContain('metric_1'); expect(out).not.toContain('private-'); expect(out).not.toContain('native_components');
    }
    expect(f.calls).toEqual([]);
  });
  it('finds a use case through published keywords and explains public role meanings', async () => {
    const r=definition();r.keywords=['가입','전환'];r.roles[0].public_label='가입 수';r.roles[0].public_description='해당 기간에 가입한 사람 수';r.roles[0].format_type=33;
    const f=await setup(r);
    expect(resultText(await f.run('component_template_list',{query:'가입'}))).toContain('sample-card');
    const detail=JSON.parse(resultText(await f.run('component_template_inspect',{template_id:'sample-card'})));
    expect(detail.roles[0]).toMatchObject({name:'가입 수',description:'해당 기간에 가입한 사람 수',data_type:'Number'});
  });
  it('does not expose a title input that the saved design hides', async () => {
    const r=definition();r.text_slots=[{key:'text_1',default:'Hidden'},{key:'text_2',default:'Visible'}];
    r.native_components[0].propertyConfig.componentProperty.kpiMetricProperty.chartTitleProperty={chartTitleShowTitle:false,chartTitleText:'$text:text_1'};
    r.native_components.push({componentId:'title',type:'simple-description',propertyConfig:{componentProperty:{descriptionProperty:{text:'<b>$text:text_2</b>'}}}});
    const f=await setup(r);const detail=JSON.parse(resultText(await f.run('component_template_inspect',{template_id:'sample-card'})));
    expect(detail.text_inputs.map((x:Json)=>x.key)).toEqual(['text_2']);
  });
  it('adds a saved design with fresh field and concept identifiers', async () => {
    const f = await setup(); const out = JSON.parse(resultText(await f.run('component_template_add', args)));
    expect(out.saved).toBe(true); expect(out.component_ids).toHaveLength(1);expect(Object.keys(out.position).sort()).toEqual(['left','top']);
    const c = f.original.page[0]!.page.componentConfig![0] as Json;
    expect(c.componentId).not.toBe('old-card'); expect(c.conceptDefs[0].name).not.toBe('old-value');
    expect(c.conceptDefs[0].queryTimeTransformation.dataTransformation.sourceFieldName).toBe('_value_');
    expect(c.propertyConfig.componentProperty.kpiMetricProperty.primaryDecimalPrecision).toBe(0);
  });
  it('preview performs no write and missing roles fail before any save', async () => {
    const f = await setup();
    expect(JSON.parse(resultText(await f.run('component_template_add', { ...args, preview: true })))).toMatchObject({ saved: false, preview: true });
    expect(f.writes()).toEqual([]);
    await expect(f.run('component_template_add', { ...args, bindings: {} })).rejects.toThrow(/metric_1/);
    expect(f.writes()).toEqual([]);
  });
  it('adds to a report with any name and rejects stale recipe versions before writing', async () => {
    const f = await setup();f.original.shareable.name = 'Existing customer report';
    expect((await f.run('component_template_add', args)).isError).toBeFalsy();expect(f.writes().length).toBeGreaterThan(0);
    const stale = await setup({ ...definition(), fingerprint: 'changed' });
    await expect(stale.run('component_template_add', args)).rejects.toThrow(/not verified/);expect(stale.writes()).toEqual([]);
  });
  it('grows the canvas and places the next design below an oversized first component', async () => {
    const recipe=definition();recipe.height=1000;recipe.native_components[0].attributeConfig.componentAttribute.height=1000;
    recipe.theme_encoding={mapValue:{entry:[{key:'id',value:{strValue:'$theme'}}]}};
    const f=await setup(recipe);
    const first=JSON.parse(resultText(await f.run('component_template_add',args)));
    const second=JSON.parse(resultText(await f.run('component_template_add',args)));
    expect(second.position.top).toBeGreaterThanOrEqual(first.position.top+1000);
  });
  it('does not open client-selected paths or symlinks outside the library', async () => {
    const f = await setup();await expect(f.run('component_template_inspect', { template_id: '../outside' })).rejects.toThrow(/Invalid template_id/);
    const outside = await mkdtemp(join(tmpdir(), 'outside-recipe-'));dirs.push(outside);await writeFile(join(outside,'recipe.json'),JSON.stringify(definition()));
    await rm(join(f.dir,'recipes/sample-card.json'));await symlink(join(outside,'recipe.json'),join(f.dir,'recipes/sample-card.json'));
    await expect(f.run('component_template_inspect', { template_id:'sample-card' })).rejects.toThrow(/outside/);
  });
  it('exposes discovery and creation through real MCP protocol messages', async () => {
    const f = await setup();
    const server = buildServer({ ...f.ctx, audit:f.ctx.audit, worker:f.ctx.worker },'test');
    const [left,right]=InMemoryTransport.createLinkedPair();await server.connect(right);
    const client=new Client({name:'component-customer-test',version:'1'});await client.connect(left);
    try {
      const list=await client.listTools();for(const name of ['component_template_list','component_template_inspect','component_template_add','connector_list'])expect(list.tools.some(t=>t.name===name)).toBe(true);
      const found=await client.callTool({name:'component_template_list',arguments:{query:'합계'}});expect(JSON.stringify(found)).toContain('sample-card');
      const made=await client.callTool({name:'component_template_add',arguments:args});expect(made.isError).not.toBe(true);expect(JSON.parse((made.content as Array<{type:string;text?:string}>).find(c=>c.type==='text')!.text!)).toMatchObject({saved:true});
    }finally{await client.close();await server.close();}
  });
});
