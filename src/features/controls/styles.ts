import type { StyleLabel, StyleTable } from '../../core/style.js';

type Label = StyleLabel & { hex?: true };

function card(base: string): Label[] {
  const path = `${base}.backgroundAndBorderProperty`;
  return [
    { label: 'Background', kind: 'color', path: `${path}.background` },
    { label: 'Opacity', kind: 'percent', path: `${path}.opacity`, min: 0, max: 1 },
    { label: 'Border opacity', kind: 'percent', path: `${path}.border.opacity`, min: 0, max: 1 },
    { label: 'Border color', kind: 'text', path: `${path}.border.color`, hex: true },
    { label: 'Border weight', kind: 'select', path: `${path}.border.size`, options: { None: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 } },
    { label: 'Border style', kind: 'select', path: `${path}.border.style`, options: { Solid: 0, Dashed: 1, Dotted: 2, Double: 3 } },
    { label: 'Border radius', kind: 'number', path: `${path}.border.radius`, min: 0, max: 100 },
    { label: 'Add border shadow', kind: 'toggle', path: `${path}.boxShadow` },
  ];
}

function text(base: string, dimension = false): Label[] {
  return [
    { label: 'Font color', kind: 'color', path: `${base}.${dimension ? 'labelFontColor' : 'fontColor'}` },
    { label: 'Font size', kind: 'number', path: `${base}.${dimension ? 'labelFontSize' : 'fontSize'}`, min: 1 },
    { label: 'Font', kind: 'text', path: `${base}.${dimension ? 'labelFontFamily' : 'fontFamily'}` },
  ];
}
function header(base: string, dimension: boolean, date = false): Label[] {
  return [
    { label: 'Header color', kind: 'color', path: `${base}.${dimension ? 'headerBackgroundColor' : 'highlightColor'}` },
    { label: 'Header font color', kind: 'color', path: `${base}.${dimension ? 'headerFontColor' : 'highlightFontColor'}` },
    ...(!date ? [{ label: 'Header font', kind: 'text', path: `${base}.${dimension ? 'headerFontFamily' : 'highlightFontFamily'}` } as Label] : []),
  ];
}
function spacing(base: string): Label[] {
  return [
    { label: 'Line height', kind: 'number', path: `${base}.lineHeight`, min: 0 },
    { label: 'Top padding', kind: 'number', path: `${base}.paddingTop`, min: 0 },
    { label: 'Left padding', kind: 'number', path: `${base}.paddingLeft`, min: 0 },
    { label: 'Right padding', kind: 'number', path: `${base}.paddingRight`, min: 0 },
    { label: 'Center vertically', kind: 'toggle', path: `${base}.centerVertical` },
  ];
}
function filterLabels(preset = 'default'): Label[] {
  const b = 'dimensionFilterProperty';
  const mode = preset === 'control-checkbox' ? 3 : preset === 'control-slider' ? 2 : ['control-textbox', 'control-search-all'].includes(preset) ? 1 : 0;
  const positions = mode === 3 ? { Right: 4, Top: 2, Hidden: 1 } : { Top: 2, Left: 3, Hidden: 1, ...(mode === 2 ? {} : { 'Left (Legacy)': 0 }) };
  return [
    { label: 'Drop-down', kind: 'radio', path: `${b}.expandable`, value: true },
    { label: 'Fixed-size', kind: 'radio', path: `${b}.expandable`, value: false },
    { label: 'Single-select', kind: 'toggle', path: `${b}.singleSelect` },
    { label: 'Allow "Select all"', kind: 'toggle', path: `${b}.allowSelectAll` },
    { label: 'Enable search box', kind: 'toggle', path: `${b}.showSearch` },
    { label: 'Show values', kind: 'toggle', path: `${b}.showMetricsValue` },
    { label: 'Compact numbers', kind: 'toggle', path: `${b}.compactNumbers` },
    { label: 'Decimal precision', kind: 'select', path: `${b}.decimalPrecision`, options: { Auto: -1, '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 } },
    { label: 'Label position', kind: 'select', path: `${b}.labelPosition`, options: positions },
    { label: 'Input box auto width', kind: 'toggle', path: `${b}.isAutoInputBoxWidth` },
    { label: 'Input box width', kind: 'number', path: `${b}.inputBoxWidth`, min: 0 },
    { label: 'Slider mode', kind: 'select', path: `${b}.sliderMode`, options: { Range: 0, 'Single value': 1, 'Locked min': 2, 'Locked max': 3 } },
    { label: 'Min value', kind: 'number', path: `${b}.sliderMinValue` },
    { label: 'Max value', kind: 'number', path: `${b}.sliderMaxValue` },
    { label: 'Show text boxes', kind: 'toggle', path: `${b}.sliderShowTextBoxes` },
    { label: 'Step size', kind: 'number', path: `${b}.sliderStepSize`, min: 0 },
    { label: 'Show tick marks', kind: 'toggle', path: `${b}.sliderShowTicks` },
    { label: 'Tick interval', kind: 'number', path: `${b}.sliderTickSize`, min: 0 },
    { label: 'Button text size', kind: 'number', path: `${b}.labelFontSize`, min: 1 },
    { label: 'List text size', kind: 'number', path: `${b}.itemFontSize`, min: 1 },
    { label: 'Item font size', kind: 'number', path: `${b}.itemFontSize`, min: 1 },
    { label: 'Focus color', kind: 'color', path: `${b}.inputBoxFocusColor` },
    { label: 'Divider color', kind: 'color', path: `${b}.dividerColor` },
    { label: 'Checkbox color', kind: 'color', path: `${b}.checkboxColor` },
    { label: 'Check box color', kind: 'color', path: `${b}.checkboxColor` },
    { label: 'Checkbox border color', kind: 'color', path: `${b}.checkboxBorderColor` },
    { label: 'Check box border color', kind: 'color', path: `${b}.checkboxBorderColor` },
    { label: 'Checkmark color', kind: 'color', path: `${b}.checkboxCheckmarkColor` },
    { label: 'Check mark color', kind: 'color', path: `${b}.checkboxCheckmarkColor` },
    { label: 'Thumb color', kind: 'color', path: `${b}.sliderThumbColor` },
    { label: 'Track fill color', kind: 'color', path: `${b}.sliderTrackFillColor` },
    { label: 'Track background color', kind: 'color', path: `${b}.sliderTrackBackgroundColor` },
    ...text(b, true), ...header(b, true), ...spacing(b), ...card(b),
  ];
}

// The saved-property names come from the editor's control serializers;
// each control owns its table, while the shared style updater applies it.
export const styleTables: StyleTable[] = [
  { type: 'dimension-filter', labels: filterLabels() },
  ...['control-open-list', 'control-textbox', 'control-search-all', 'control-slider', 'control-checkbox'].map((preset) => ({ type: 'dimension-filter', preset, labels: filterLabels(preset) })),
  { type: 'simple-daterangepicker', labels: [...text('dateRangePickerProperty'), ...header('dateRangePickerProperty', false, true), ...spacing('dateRangePickerProperty'), ...card('dateRangePickerProperty')] },
  { type: 'dataset-picker', labels: [...text('datasetPickerProperty'), ...header('datasetPickerProperty', false), ...spacing('datasetPickerProperty'), ...card('datasetPickerProperty')] },
  { type: 'dimension-control', labels: [...text('dimensionControlProperty', true), ...header('dimensionControlProperty', true), ...spacing('dimensionControlProperty'), ...card('dimensionControlProperty')] },
  { type: 'button', labels: [{ label: 'Text', kind: 'text', path: 'buttonProperty.text' }, ...text('buttonProperty'), ...card('buttonProperty')] },
];
