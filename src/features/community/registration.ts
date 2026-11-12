import { LookerError } from '../../core/errors.js';
import type { ToolContext } from '../../core/tool.js';

export type Json = Record<string, any>;
export interface Element {
  id: string;
  label: string;
  type: string;
  options?: { min?: number; max?: number; placeholder?: string } | Array<{ label: string; value: string | number | boolean }>;
  defaultValue?: unknown;
  placeholder?: string;
}
export interface VisualizationConfig {
  data?: Array<{ elements?: Element[] }>;
  style?: Array<{ elements?: Element[] }>;
}
export interface Registration {
  manifestPath: string;
  componentId: string;
  vizId: string;
  consentId: string;
  name: string;
  approvalState: number;
  fingerprint: string;
  config: VisualizationConfig;
  privileges: Json[];
}
interface GalleryPath { path: string; componentId?: string }

// Manifest locations distributed by the editor. Names come from the live
// registration response; failed registrations are omitted like hidden cards.
export const GALLERY: GalleryPath[] = [
  { path: 'google://devrel/gauge' },
  { path: 'gs://dscv/public/sunburst', componentId: 'sunburst_v1' },
  { path: 'gs://viz.supermetrics.com', componentId: 'smGanttChart' },
  { path: 'gs://cc-community-viz/chartjs', componentId: 'radar' },
  { path: 'gs://dscv/public/hexbin-map', componentId: 'v1' },
  { path: 'gs://dscv/public/timeplot', componentId: 'timeplot_v1' },
  { path: 'gs://viz.supermetrics.com', componentId: 'smDatePicker' },
  { path: 'gs://viz.supermetrics.com', componentId: 'smSelector' },
  { path: 'gs://cc-community-viz/chartjs', componentId: 'line' },
  { path: 'gs://analytics_buddy_viz/segmentor' },
  { path: 'gs://ds_com_vis_star_rating', componentId: 'starRating' },
  { path: 'gs://public-community-viz-showcase-reports/sunburst' },
  { path: 'gs://public-community-viz-showcase-reports/heatmap' },
  { path: 'gs://public-community-viz-showcase-reports/sankey' },
];

export function manifestPath(input: string): string {
  const path = input.trim();
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]*[a-z0-9](?:\/[^\s]*)?$/.test(path))
    throw new LookerError('invalid', 'manifest_path must identify a Cloud Storage manifest, for example gs://visualization-bucket/chart. Remove surrounding text and use the gs:// path.');
  return path;
}

export function decodeRegistration(path: GalleryPath, value: unknown): Registration {
  const info = value as Json;
  const components: Json[] | undefined = Array.isArray(info?.manifest?.components) ? info.manifest.components : undefined;
  const component = path.componentId ? components?.find((candidate) => candidate.id === path.componentId) : components?.[0];
  if (!component || typeof component.id !== 'string' || !component.id)
    throw new LookerError('format_changed', `The manifest ${path.path} has no usable component${path.componentId ? ` named ${path.componentId}` : ''}. Check its registration and choose another visualization.`);
  let config: VisualizationConfig;
  try { config = typeof info.config === 'string' ? JSON.parse(info.config) : info.config; }
  catch { throw new LookerError('format_changed', `The configuration returned for ${path.path} is not valid JSON.`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new LookerError('format_changed', `No data or style configuration was returned for ${path.path}.`);
  for (const key of ['data', 'style'] as const) {
    const sections = config[key];
    if (sections !== undefined && (!Array.isArray(sections) || sections.some((section) => !section || typeof section !== 'object' ||
      (section.elements !== undefined && (!Array.isArray(section.elements) || section.elements.some((element) => !element || typeof element.id !== 'string' || typeof element.label !== 'string' || typeof element.type !== 'string'))))))
      throw new LookerError('format_changed', `The visualization ${key} configuration has an unfamiliar shape. Choose another visualization or check its manifest.`);
  }
  const vizId = path.path.startsWith('google://') ? path.path : `${path.path}\u00a0${component.id}`;
  return {
    manifestPath: path.path, componentId: component.id, vizId, consentId: `${path.path}::${component.id}`,
    name: String(component.name ?? info.manifest.name ?? component.id), approvalState: Number(info.approvalState),
    fingerprint: String(info.manifestFingerprint ?? ''), config, privileges: Array.isArray(component.privileges) ? component.privileges : [],
  };
}

export async function readRegistration(ctx: Pick<ToolContext, 'rap'>, reportId: string, path: GalleryPath): Promise<Registration> {
  let info: unknown;
  try {
    info = await ctx.rap.call('getCommunityVizRegistrationInfo', { manifestPath: path.path, ...(path.componentId ? { componentId: path.componentId } : {}), reportId });
  } catch (error) {
    if (error instanceof LookerError && ['refused', 'busy'].includes(error.code)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new LookerError('invalid', `Could not read the visualization manifest ${path.path}: ${detail}. Check its location and try again.`);
  }
  return decodeRegistration(path, info);
}

export async function selectRegistration(ctx: Pick<ToolContext, 'rap'>, reportId: string, input: { name?: string; manifest_path?: string }): Promise<Registration> {
  if (input.manifest_path !== undefined) return readRegistration(ctx, reportId, { path: manifestPath(input.manifest_path) });
  const wanted = input.name!.trim().toLowerCase();
  // A preapproved built-in and the featured sunburst cover the common calls
  // without fetching the rest of the gallery.
  const quick = wanted === 'gauge' ? GALLERY[0] : wanted === 'sunburst' ? GALLERY[1] : undefined;
  if (quick) {
    const registration = await readRegistration(ctx, reportId, quick);
    if (registration.name.toLowerCase() === wanted) return registration;
  }
  const available: Registration[] = [];
  // A small batch at a time avoids flooding the tab when a gallery card has
  // disappeared. Errors for individual cards do not hide the others.
  for (let offset = 0; offset < GALLERY.length; offset += 4) {
    const found = await Promise.allSettled(GALLERY.slice(offset, offset + 4).map((entry) => readRegistration(ctx, reportId, entry)));
    for (const value of found) if (value.status === 'fulfilled') available.push(value.value);
    const match = available.find((entry) => entry.name.toLowerCase() === wanted);
    if (match) return match;
  }
  const names = [...new Set(available.map((entry) => entry.name))];
  throw new LookerError('not_found', `No gallery visualization named "${input.name}". Available names: ${names.join(', ') || '(none could be loaded)'}. Use an exact card name or provide manifest_path.`);
}

export function registrationPath(vizId: string): GalleryPath {
  const split = vizId.split('\u00a0');
  return { path: split[0]!, ...(split[1] ? { componentId: split[1] } : {}) };
}
