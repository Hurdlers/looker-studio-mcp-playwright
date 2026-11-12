import { z } from 'zod';

import { resolveField } from '../../core/components.js';
import type { ComponentUpdater, UpdateTarget } from '../../core/extensions.js';
import { fromMapValue, toMapValue } from '../../core/mapvalue.js';
import type { ToolContext } from '../../core/tool.js';
import { CHART_TYPES, chartProperty, fieldsFor, findConcept, hex, invalid, nameOf, prop, requireType, usedConcepts, type Json } from './common.js';
import { conditionalFormatsInput, referenceBandsInput, referenceLinesInput, seriesInput, type ConditionalSpec, type ReferenceBandSpec, type ReferenceLineSpec, type SeriesSpec } from './inputs.js';
import { normalizeCondition } from './filters.js';

const seriesTypes = ['simple-linechart', 'simple-combochart', 'simple-barchart', 'simple-areachart'];
export const seriesUpdater: ComponentUpdater = {
  key: 'series', input: seriesInput, types: CHART_TYPES,
  apply: ({ component }, value) => {
    const specs = value as SeriesSpec[];
    for (const spec of specs) if (spec.color !== undefined) hex(spec.color);
    if (!seriesTypes.includes(component.type)) return specs.length ? 'Warning: this chart has no per-series settings; series was not applied.' : undefined;
    const metrics = usedConcepts(component, 'metrics');
    const property = chartProperty(component);
    const warnings: string[] = [];
    for (const spec of specs) {
      const index = metrics.findIndex((metric) => nameOf(metric).toLowerCase() === spec.metric.toLowerCase());
      if (index === -1) { warnings.push(`No series named "${spec.metric}" (choices: ${metrics.map(nameOf).join(', ')}).`); continue; }
      const series: Json[] = (property.seriesProperty ??= []);
      while (series.length <= index) series.push(structuredClone(series[0] ?? {}));
      const current = series[index]!;
      if (spec.type !== undefined) {
        if (['simple-combochart', 'simple-linechart'].includes(component.type)) current.seriesType = spec.type === 'line' ? 0 : 1;
        else warnings.push(`The type of "${spec.metric}" is fixed for this chart.`);
      }
      if (spec.axis !== undefined) {
        if (['simple-combochart', 'simple-linechart'].includes(component.type)) current.seriesAxisIndex = spec.axis === 'right' ? 1 : 0;
        else warnings.push(`The axis of "${spec.metric}" is fixed for this chart.`);
      }
      if (spec.color !== undefined) current.seriesColor = { color: hex(spec.color), opacity: 1 };
    }
    return warnings.length ? `Warning: ${warnings.join(' ')}` : undefined;
  },
  read: (component) => {
    if (!seriesTypes.includes(component.type)) return undefined;
    const list = chartProperty(component).seriesProperty ?? [];
    return usedConcepts(component, 'metrics').flatMap((metric, i) => list[i] ? [{ metric: nameOf(metric),
      ...(list[i].seriesType === 0 || list[i].seriesType === 1 ? { type: list[i].seriesType === 0 ? 'line' : 'bars' } : {}),
      ...(list[i].seriesAxisIndex !== undefined ? { axis: list[i].seriesAxisIndex === 1 ? 'right' : 'left' } : {}),
      ...(list[i].seriesColor?.color ? { color: list[i].seriesColor.color } : {}),
    }] : []);
  },
};

const valueColorTypes = ['simple-piechart', 'simple-barchart', 'simple-linechart', 'simple-combochart', 'simple-areachart', 'simple-scatterchart', 'simple-treemap', 'simple-sankey', 'simple-funnel'];
export const valueColorsUpdater: ComponentUpdater = {
  key: 'value_colors', input: z.record(z.string(), z.string()).describe('차원 값별 고정 색. 값은 #RRGGBB이며 같은 리포트의 다른 차트에도 적용됩니다.'), types: valueColorTypes, touchesReport: true,
  apply: ({ component, doc }, value) => {
    const pairs = Object.entries(value as Record<string, string>).map(([key, color]) => [key, hex(color)] as const);
    const resource = (doc.report.resource ??= {}) as Json;
    const configs: Json[] = (resource.colorMappingList ??= {}).colorMappingConfig ??= [];
    if (!configs.length) configs.push({ colorMapping: [] });
    const mapping: Json[] = (configs[0]!.colorMapping ??= []);
    for (const [key, color] of pairs) {
      const existing = mapping.find((entry) => entry.key?.value === key);
      if (existing) { existing.color = color; existing.colorType = { color, opacity: 1 }; }
      else mapping.push({ key: { value: key }, color, colorType: { color, opacity: 1 } });
    }
    if (mapping.length > 1500) throw invalid('A report accepts at most 1500 dimension color mappings.');
    chartProperty(component).coordinatedColoring = 3;
  },
  read: (component, doc) => chartProperty(component).coordinatedColoring === 3 ? Object.fromEntries(((doc.report.resource as Json | undefined)?.colorMappingList?.colorMappingConfig?.[0]?.colorMapping ?? []).map((entry: Json) => [entry.key.value, entry.colorType?.color ?? entry.color])) : undefined,
};

const referenceTypes = ['simple-barchart', 'simple-linechart', 'simple-combochart', 'simple-areachart', 'simple-scatterchart'];
function activeReferenceLine(line: Json): boolean {
  return line.referenceLineNumberValue !== undefined || line.referenceLineDateValue !== undefined ||
    line.referenceLineMetric !== undefined || line.referenceLineParameter !== undefined ||
    line.referenceLineType === 1 || line.referenceLineType === 2;
}
const REFERENCE_CALCULATIONS = ['Average', 'Median', 'Percentile', 'Min', 'Max', 'Total'];
async function referenceMetric(target: UpdateTarget, name: string | undefined, ctx: ToolContext): Promise<Json> {
  const metrics = usedConcepts(target.component, 'metrics');
  if (!name) {
    if (!metrics.length) throw invalid('A metric reference line needs a chart metric.');
    return metrics[0]!;
  }
  try { return findConcept(target.component, name, metrics); }
  catch {
    const field = resolveField(await fieldsFor(target, ctx), name);
    const concept = metrics.find((entry) => entry.queryTimeTransformation?.dataTransformation?.sourceFieldName === field.id);
    if (!concept) throw invalid(`"${name}" is not a metric displayed in this chart.`);
    return concept;
  }
}
function axis(text: string | undefined, component: Json): number {
  if (text === undefined) return 0;
  const normalized = text.toLowerCase();
  if (['left y-axis', 'y-axis', 'bottom x-axis'].includes(normalized)) return 0;
  if (normalized === 'right y-axis' && ['simple-linechart', 'simple-combochart'].includes(component.type)) return 1;
  if (normalized === 'x-axis' && component.type === 'simple-scatterchart') return 2;
  throw invalid(`Axis "${text}" is unavailable for ${component.type}. Use Left Y-axis${component.type === 'simple-scatterchart' ? ' or X-axis' : ['simple-linechart', 'simple-combochart'].includes(component.type) ? ' or Right Y-axis' : ''}.`);
}

export const referenceLinesUpdater: ComponentUpdater = {
  key: 'reference_lines', input: referenceLinesInput, types: CHART_TYPES,
  apply: async (target, value, ctx) => {
    const { component } = target;
    requireType(component, referenceTypes, 'reference_lines');
    const specs = value as ReferenceLineSpec[];
    const property = chartProperty(component);
    if (!specs.length) { property.referenceLineProperty = []; return; }
    const previous: Json[] = (property.referenceLineProperty ?? []).filter(activeReferenceLine);
    if (previous.length + specs.length > 10) throw invalid('A chart accepts at most ten reference lines.');
    const lines: Json[] = [];
    for (const spec of specs) {
      const normalized = (spec.type ?? 'Constant value').toLowerCase();
      const type = normalized === 'constant value' ? 0 : normalized === 'metric' ? 1 : normalized === 'parameter' ? 2 : undefined;
      if (type === undefined) throw invalid('Reference line type choices: Constant value, Metric, Parameter.');
      if (type === 2) throw invalid('Parameter reference lines cannot be preserved: parameter binding is not supported. Use a Constant value or Metric line.');
      const line: Json = {
        referenceLineType: type, referenceLineShowLabel: true, referenceLineShowValueInLabel: false,
        ...(spec.weight === 'Auto' ? {} : { referenceLineWeight: spec.weight ?? 2 }), referenceLineStyle: 0, referenceLineAxis: axis(spec.axis, component),
        ...(spec.label !== undefined ? { referenceLineLabel: spec.label } : {}),
        ...(spec.color !== undefined ? { referenceLineColor: { color: hex(spec.color), opacity: 1 } } : {}),
      };
      if (type === 0) {
        if (spec.value === undefined) throw invalid('A Constant value reference line needs value.');
        if (spec.metric !== undefined || spec.calculation !== undefined || spec.percentile !== undefined) throw invalid('metric, calculation and percentile apply only to Metric reference lines.');
        line.referenceLineNumberValue = spec.value;
      }
      else if (type === 1) {
        const metric = await referenceMetric(target, spec.metric, ctx);
        const calculation = REFERENCE_CALCULATIONS.findIndex((name) => name.toLowerCase() === (spec.calculation ?? 'Average').toLowerCase());
        if (calculation < 0) throw invalid(`Reference line calculations: ${REFERENCE_CALCULATIONS.join(', ')}.`);
        if (calculation === 2 && spec.percentile === undefined) throw invalid('A Percentile reference line needs percentile (0–100).');
        if (calculation !== 2 && spec.percentile !== undefined) throw invalid('percentile applies only to the Percentile calculation.');
        line.referenceLineMetric = metric.name;
        line.referenceLineCalculation = calculation;
        if (calculation === 2) line.referenceLinePercentile = spec.percentile;
      }
      lines.push(line);
    }
    property.referenceLineProperty = [...previous, ...lines];
  },
  read: (component) => (chartProperty(component).referenceLineProperty ?? []).filter(activeReferenceLine).map((line: Json) => {
    const type = line.referenceLineType ?? 0;
    if (type === 2) throw invalid('Parameter reference lines cannot be preserved: parameter binding is not supported.');
    if (![0, 1].includes(type)) throw invalid(`Unknown native reference line type ${type}.`);
    const out: Json = {
    ...(line.referenceLineLabel !== undefined ? { label: line.referenceLineLabel } : {}),
    ...(line.referenceLineColor?.color ? { color: canonicalColor(line.referenceLineColor.color) } : {}),
    weight: line.referenceLineWeight ?? 'Auto',
    type: ['Constant value', 'Metric'][type],
    axis: ['Left Y-axis', 'Right Y-axis', 'X-axis'][line.referenceLineAxis ?? 0],
    };
    if (type === 0) {
      if (typeof line.referenceLineNumberValue !== 'number') throw invalid('A native date or unset Constant value reference line cannot be preserved as a number.');
      out.value = line.referenceLineNumberValue;
    } else {
      const metrics = usedConcepts(component, 'metrics');
      const ref = typeof line.referenceLineMetric === 'object' ? line.referenceLineMetric?.name : line.referenceLineMetric;
      const metric = ref ? metrics.find((entry) => entry.name === ref) : metrics[0];
      if (!metric) throw invalid('The native reference line metric is not present in this chart.');
      const calculation = REFERENCE_CALCULATIONS[line.referenceLineCalculation ?? 0];
      if (!calculation) throw invalid(`Unknown native reference line calculation ${line.referenceLineCalculation}.`);
      out.metric = nameOf(metric);
      out.calculation = calculation;
      if (calculation === 'Percentile') {
        if (typeof line.referenceLinePercentile !== 'number' || line.referenceLinePercentile < 0 || line.referenceLinePercentile > 100) throw invalid('The native Percentile reference line has no valid percentile.');
        out.percentile = line.referenceLinePercentile;
      }
    }
    return out;
  }),
};

export const referenceBandsUpdater: ComponentUpdater = {
  key: 'reference_bands', input: referenceBandsInput, types: CHART_TYPES,
  apply: ({ component }, value) => {
    requireType(component, referenceTypes, 'reference_bands');
    const property = chartProperty(component);
    const previous: Json[] = (property.referenceBandProperty ?? []).filter((band: Json) =>
      band.referenceLineNumberValueBandStart !== undefined || band.referenceLineMetricBandStart !== undefined || band.referenceLineParameterBandStart !== undefined);
    const specs = value as ReferenceBandSpec[];
    if (previous.length + specs.length > 10) throw invalid('A chart accepts at most ten reference bands.');
    const bands = specs.map((spec) => {
      if (!(spec.from < spec.to)) throw invalid('A reference band needs from less than to.');
      return {
        referenceLineTypeBandStart: 0, referenceLineNumberValueBandStart: spec.from,
        referenceLineTypeBandEnd: 0, referenceLineNumberValueBandEnd: spec.to,
        referenceBandAxis: 0, referenceBandShowLabel: true, referenceBandShowValueInLabel: false,
        referenceBandLineWeight: 2, referenceBandLineStyle: 0, referenceBandOpacity: 1,
        ...(spec.label !== undefined ? { referenceBandLabel: spec.label } : {}),
        ...(spec.color !== undefined ? { referenceBandFillColor: { color: hex(spec.color), opacity: 1 } } : {}),
      };
    });
    property.referenceBandProperty = [...previous, ...bands];
  },
  read: (component) => (chartProperty(component).referenceBandProperty ?? []).filter((band: Json) =>
    ['Start', 'End'].some((side) => ['NumberValue', 'DateValue', 'Metric', 'Parameter'].some((kind) => band[`referenceLine${kind}Band${side}`] !== undefined)
      || (band[`referenceLineTypeBand${side}`] !== undefined && band[`referenceLineTypeBand${side}`] !== 0)),
  ).map((band: Json) => {
    for (const side of ['Start', 'End']) {
      if ((band[`referenceLineTypeBand${side}`] ?? 0) !== 0 || band[`referenceLineMetricBand${side}`] !== undefined || band[`referenceLineParameterBand${side}`] !== undefined)
        throw invalid('The native reference band uses a Metric, Parameter or unknown boundary type; only numeric reference bands can be preserved.');
      if (band[`referenceLineDateValueBand${side}`] !== undefined)
        throw invalid('A native date reference band cannot be preserved as numeric bounds.');
    }
    const from = band.referenceLineNumberValueBandStart, to = band.referenceLineNumberValueBandEnd;
    if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to) || !(from < to))
      throw invalid('A native reference band needs two finite numeric bounds with from less than to.');
    return { from, to,
      ...(band.referenceBandLabel !== undefined ? { label: band.referenceBandLabel } : {}),
      ...(band.referenceBandFillColor?.color ? { color: canonicalColor(band.referenceBandFillColor.color) } : {}),
    };
  }),
};

// Saved native colors can use either case; writes already use uppercase hex.
function canonicalColor(value: unknown): unknown {
  return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value.toUpperCase() : value;
}

const matchCodes: Record<string, number> = {
  equals: 1, equalto: 1, '=': 1, notequals: 2, notequalto: 2, '!=': 2, '<>': 2,
  gt: 3, '>': 3, greaterthan: 3, gte: 4, '>=': 4, greaterthanorequalto: 4,
  lt: 5, '<': 5, lessthan: 5, lte: 6, '<=': 6, lessthanorequalto: 6,
  contains: 7, notcontains: 8, doesnotcontain: 8, startswith: 9, isnull: 10, isnotnull: 11, regexpmatch: 12, regexpcontains: 12,
};
function condition(spec: ConditionalSpec, component: Json): Json {
  if (!spec.rules.length || spec.rules.some((group) => !group.length)) throw invalid('A conditional format needs nonempty rule groups.');
  const definitions = spec.rules.map((group) => ({ or: { conditionDefinition: group.map((rule): Json => {
    const concept = findConcept(component, rule.field);
    const type = matchCodes[normalizeCondition(rule.condition)];
    if (!type) throw invalid(`Unknown conditional format condition "${rule.condition}". Choices: equals, not_equals, gt, gte, lt, lte, contains, not_contains, starts_with, is_null, is_not_null, regexp_match.`);
    const isNull = type === 10 || type === 11;
    if ((!isNull && rule.value === undefined) || (isNull && rule.value !== undefined)) throw invalid(`${rule.condition} ${isNull ? 'takes no value' : 'needs a value'}.`);
    const isNumber = usedConcepts(component, 'metrics').some((entry) => entry.name === concept.name) || [12, 13, 14, 15, 28, 33].includes(concept.queryTimeTransformation?.displayTransformation?.outputSemanticInfo?.semanticConfig?.[0]?.semanticType);
    const number = isNumber && !isNull ? Number(rule.value) : undefined;
    if (number !== undefined && (!Number.isFinite(number) || String(rule.value).trim() === '')) throw invalid(`"${rule.field}" needs a numeric condition value.`);
    return { matchCondition: {
      type, input: { selector: { step: [{ string: 'cell' }, { field: { ...structuredClone(concept), semantic: [] } }] } },
      value: { numberValue: number !== undefined ? [number] : [], stringValue: !isNull && !isNumber ? [String(rule.value)] : [] },
    } };
  }) } }));
  return { and: { conditionDefinition: definitions } };
}

export const conditionalFormatsUpdater: ComponentUpdater = {
  key: 'conditional_formats', input: conditionalFormatsInput, types: ['simple-table', 'pivot-table', 'kpi-metric', 'simple-barchart'],
  apply: (target, value) => {
    const component = target.component;
    const rules = (value as ConditionalSpec[]).map((spec): Json => {
      if (spec.font_color === undefined && spec.background_color === undefined) throw invalid('Set font_color, background_color, or both for each conditional format.');
      const properties: Json[] = [];
      if (spec.font_color !== undefined) properties.push({ key: 'color', value: { colorValue: { color: hex(spec.font_color), opacity: 1 } } });
      if (spec.background_color !== undefined) properties.push({ key: 'background-color', value: { colorValue: { color: hex(spec.background_color), opacity: 1 } } });
      let steps: Json[] = [{ string: 'row' }];
      if (component.type === 'kpi-metric') steps = [{ string: 'cell' }];
      else if (spec.apply_to !== undefined && spec.apply_to.toLowerCase() !== 'entire row')
        steps = [{ string: 'cell' }, { field: { ...structuredClone(findConcept(component, spec.apply_to)), semantic: [] } }, { string: 'base' }];
      return { conditionDefinition: condition(spec, component), format: { single: { property: properties } }, target: { target: { step: steps } }, scope: component.type === 'kpi-metric' ? 'cell' : 'row' };
    });
    const reportLevel = (target.doc.report.componentConfig ?? []).some((entry) => entry.componentId === component.componentId);
    const holder = reportLevel ? target.doc : target.page;
    const conditions: Json[] = (holder.chartCondition ??= []);
    let entry = conditions.find((item) => item.chartId === component.componentId);
    if (!entry) { entry = { chartId: component.componentId, conditionalFormat: { rule: [] } }; conditions.push(entry); }
    ((entry.conditionalFormat ??= {}).rule ??= []).push(...rules);
  },
};

const setupLabels = new Set(['cross-filtering', 'zoom']);
export const setupUpdater: ComponentUpdater = {
  key: 'setup', types: CHART_TYPES, input: z.record(z.string(), z.unknown()).describe('필드 칩을 제외한 설정 라벨. Cross-filtering, Zoom을 지원하며 필드는 fields로 바꿉니다.'),
  apply: ({ component }, value, ctx) => {
    const changes = value as Record<string, unknown>;
    const unknown: string[] = [];
    const previous = component.behavior;
    const behavior = (fromMapValue(previous) ?? {}) as Json;
    for (const [label, input] of Object.entries(changes)) {
      const key = label.toLowerCase();
      if (['dimension', 'metric', 'sort', 'breakdown dimension', 'row dimension', 'column dimension'].includes(key)) throw invalid(`Use fields to change the "${label}" field input.`);
      if (!setupLabels.has(key)) { unknown.push(label); continue; }
      if (typeof input !== 'boolean') throw invalid(`Setup "${label}" takes true or false.`);
      if (key === 'cross-filtering') {
        if (input) behavior.onSelect = [{ action: 'cross-filtering', isControl: true }];
        else {
          const drilling = Object.values(behavior).some((entries) => Array.isArray(entries) && entries.some((entry) => ['drill-down', 'expand-collapse'].includes(entry?.action)));
          if (drilling && component.type !== 'pivot-table') behavior.onSelect = [{ action: 'cross-filtering', isControl: false }];
          else delete behavior.onSelect;
        }
      } else {
        if (input) behavior.onZoom = [{ action: 'chart-zoom', isControl: true }]; else delete behavior.onZoom;
      }
    }
    component.behavior = toMapValue(behavior, previous);
    return unknown.length ? `Not applied: ${unknown.join(', ')}` : undefined;
  },
  read: (component) => {
    const behavior = (fromMapValue(component.behavior) ?? {}) as Json;
    return { 'Cross-filtering': behavior.onSelect?.[0]?.action === 'cross-filtering' && behavior.onSelect[0].isControl === true, Zoom: behavior.onZoom?.[0]?.action === 'chart-zoom' };
  },
};
