import { blockFields, type ResolvedSource, type SourceField } from '../../core/datasource.js';
import type { ReportDoc } from '../../core/session.js';
import type { Json } from './common.js';

// Blends (the editor's "Blend data") live in the report itself, under
// report.resource.dataViewResource.entry[] {key, value.blockDatasource}. A
// chart reads one with componentProperty.dataset {datasetType: 2, datasetId:
// <entry key>} and no component datasourceId, as the editor's component
// serializer writes it (dataViewActive → datasetType 2, dataViewResource =
// the entry key; the component datasourceId only comes from a datasetType 1
// dataset).

export interface Blend {
  key: string;
  name: string;
  fields: SourceField[];
}

// The source a chart reads: a data source, or a blend (blend = its entry key).
export type PickedSource = ResolvedSource & { blend?: string };

export const BLEND_DATASET_TYPE = 2;

export function blendsOf(doc: ReportDoc): Blend[] {
  const entries = ((doc.report.resource as Json | undefined)?.dataViewResource?.entry ?? []) as Json[];
  return entries.flatMap((e) => {
    const bd = e?.value?.blockDatasource as Json | undefined;
    if (typeof e?.key !== 'string' || !bd) return [];
    const name = String(bd.datasourceBlock?.name ?? e.key);
    return [{ key: e.key, name, fields: blendFields(bd) }];
  });
}

// The blend's output fields (datasourceBlock.fields, ids like calc_x_dv0).
// They carry no default aggregation of their own: a field made from a table
// metric takes that metric's aggregation (and its semantic type), so it
// counts as a metric; the others are dimensions.
function blendFields(bd: Json): SourceField[] {
  const concepts = new Map<string, Json>();
  for (const block of (bd.blocks ?? []) as Json[]) walkJoin(block?.treeQueryBlockConfig?.join, concepts);
  const columns = (bd.datasourceBlock?.fields ?? []) as Json[];
  const fields = blockFields({ published: bd });
  return fields.map((f, i) => {
    const col = columns[i] ?? {};
    if (col.enabled === false) return undefined;
    const source = col.queryTimeTransformation?.dataTransformation?.sourceFieldName as string | undefined;
    const concept = source ? concepts.get(source) : undefined;
    const aggregation = concept?.queryTimeTransformation?.dataTransformation?.aggregation as number | undefined;
    const semantic = ((concept?.semantic ?? []) as unknown[]).find((s): s is number => typeof s === 'number');
    const out: SourceField = { ...f };
    if (aggregation !== undefined && f.aggregation === 0) out.aggregation = aggregation;
    if (out.semanticType === undefined && semantic !== undefined) out.semanticType = semantic;
    if (concept) out.kind = aggregation !== undefined ? 'metric' : 'dimension';
    return out;
  }).filter((f): f is SourceField => f !== undefined);
}

// join.left may itself be a join (three or more tables).
function walkJoin(node: Json | undefined, into: Map<string, Json>): void {
  if (!node) return;
  for (const side of [node.left, node.right] as Array<Json | undefined>) {
    if (!side) continue;
    if (side.join) walkJoin(side.join, into);
    for (const c of (side.query?.concepts ?? []) as Json[]) {
      const name = c?.id?.name ?? c?.name;
      if (typeof name === 'string') into.set(name, c);
    }
  }
}

// A blend by entry key, else by name: the exact name first, then the only
// one equal without case and surrounding spaces. Undefined when none fits;
// several equal without case: the first exact is not there, so none.
export function findBlend(blends: Blend[], name: string): { blend: Blend; exact: boolean } | undefined {
  const byKey = blends.find((b) => b.key === name.trim());
  if (byKey) return { blend: byKey, exact: true };
  const exact = blends.filter((b) => b.name === name);
  if (exact.length === 1) return { blend: exact[0]!, exact: true };
  const want = name.trim().toLowerCase();
  const loose = blends.filter((b) => b.name.trim().toLowerCase() === want);
  return loose.length === 1 ? { blend: loose[0]!, exact: false } : undefined;
}

export function asSource(blend: Blend): PickedSource {
  return { datasourceId: blend.key, alias: '', name: blend.name, fields: blend.fields, blend: blend.key };
}
