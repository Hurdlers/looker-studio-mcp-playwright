import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIXTURES } from '../../core/components.js';
import type { FeatureExtensions } from '../../core/extensions.js';
import type { ReportDoc } from '../../core/session.js';
import type { Tool, ToolContext } from '../../core/tool.js';
import { communityVizAdd } from './add.js';
import { chartKindMetadata, setupSlots } from './component.js';
import { readRegistration, registrationPath, type Json, type VisualizationConfig } from './registration.js';
import { readCommunityStyle, styleElements } from './style.js';

const config = (file: string): VisualizationConfig => JSON.parse(readFileSync(join(FIXTURES, 'community/configs', file), 'utf8'));

export const tools: Tool[] = [communityVizAdd];
export const extensions: FeatureExtensions = {
  componentMetadata: communityMetadata,
  chartKinds: [
    chartKindMetadata({ vizId: 'google://devrel/gauge', name: 'Gauge', config: config('gauge.json') }, 'community_gauge'),
    chartKindMetadata({ vizId: 'gs://dscv/public/sunburst\u00a0sunburst_v1', name: 'Sunburst', config: config('sunburst.json') }, 'community_sunburst'),
  ],
};

// Runtime manifests can change their field inputs and style controls. A
// consumer that inspects one needs its registration, rather than a fixed
// table containing only the featured gallery visualizations.
export async function communityMetadata(ctx: Pick<ToolContext, 'rap'>, doc: ReportDoc, component: Json) {
  if (!/^(?:google|gs):\/\//.test(String(component.type))) return undefined;
  const registration = await readRegistration(ctx, doc.shareable.id, registrationPath(component.type));
  return {
    name: registration.name,
    creationTool: 'community_viz_add',
    slots: setupSlots(registration.config),
    controls: styleElements(registration.config),
    style: readCommunityStyle(component, registration.config),
  };
}
