import { isDeepStrictEqual } from 'node:util';
import type { PageDoc } from '../../core/session.js';
import { applyStyle, labelsFor } from '../../core/style.js';
import { PROPERTIES } from '../chart-options/common.js';
import { styleTables } from '../chart-options/styles.js';
import { invalid } from './store.js';

type Json = Record<string, any>;
function analysisOf(component: Json) {
  const { propertyConfig, attributeConfig: _geometry, ...identity } = component;
  const { componentProperty = {}, ...configuration } = propertyConfig ?? {};
  // Native chart appearance lives under these chart-family property blocks.
  // Everything else includes dataset, concepts, roles, filters, periods,
  // comparison, breakdowns, sort and row settings, including unknown additions.
  const presentationBlocks = new Set(Object.values(PROPERTIES));
  const analyticalProperties = Object.fromEntries(Object.entries(componentProperty).filter(([key]) => !presentationBlocks.has(key)));
  return structuredClone({ identity, configuration, analyticalProperties });
}

/** Freeze the whole page, allowing only the requested native presentation writes
 * on one existing chart. Unknown data properties and other components remain
 * protected without maintaining an incomplete list of analytical fields.
 * This checks a style operation, not whether the caller chose the right metrics. */
export function expectedPageAfterAppearance(page: PageDoc, componentId: string, style: Record<string, unknown>) {
  const expected = structuredClone({ pageId: page.pageId, page: page.page, chartCondition: page.chartCondition });
  const component = expected.page.componentConfig?.find(c => c.componentId === componentId);
  if (!component) throw invalid('The appearance target is missing from its page.');
  const analysisBefore = analysisOf(component);
  const plan = applyStyle(component, labelsFor(styleTables, String(component.type), typeof component.preset === 'string' ? component.preset : undefined), style);
  if (plan.notApplied.length) throw invalid(`Unsupported appearance properties: ${plan.notApplied.join(', ')}.`);
  if (!isDeepStrictEqual(analysisBefore, analysisOf(component))) throw invalid('Appearance style mapping changes analytical properties. No page was saved.');
  // A display adapter's broad Style panel also exposes analytical operations.
  // The page appearance profile must never change these via that channel.
  const semantic = new Set(['Rows per page', 'Axis min', 'Axis max', 'Log scale', 'Show summary row']);
  if (Object.keys(style).some(key => semantic.has(key.replace(/#\d+$/, '')))) throw invalid('The appearance profile contains a non-presentation operation.');
  return expected;
}
export function assertPageAnalysisPreserved(expected: ReturnType<typeof expectedPageAfterAppearance>, actual: PageDoc): void {
  if (!isDeepStrictEqual(expected, { pageId: actual.pageId, page: actual.page, chartCondition: actual.chartCondition }))
    throw invalid('Appearance changed content beyond its permitted presentation properties. No page was saved.');
}
