import { invalid } from './store.js';
import { pageControlsPreferredWidth, planPageControls, type PageControls } from './page-controls.js';

interface Box { left: number; top: number; width: number; height: number }
export interface PageHeaderPlan {
  height: number; texts: HeaderText[]; inline: boolean;
  controls?: ReturnType<typeof planPageControls> | undefined;
  panel?: Box | undefined; scope?: HeaderText | undefined; logo?: Box | undefined;
}
export interface PageHeaderInput {
  title: string; description?: string | undefined;
  /** Header surface color. Text switches to whichever of white or the theme text reads better on it. */
  band_color?: string | undefined;
  /** Image placed before the title. Uploaded after the page is saved. */
  logo?: { image: string; width?: number | undefined; height?: number | undefined; alt_text?: string | undefined } | undefined;
}
interface HeaderText { text: string; box: Box; fontSize: number; bold: boolean }
export function planPageHeader(input: { left: number; top: number; width: number; gap: number;
  header?: PageHeaderInput | undefined; controls?: PageControls | undefined }): PageHeaderPlan {
  const title = input.header?.title.trim(), description = input.header?.description?.trim();
  const band = input.header?.band_color, logoInput = input.header?.logo;
  // A logo keeps its given box; the title starts after it.
  const logoSize = logoInput ? { width: logoInput.width ?? 144, height: logoInput.height ?? 48 } : undefined;
  const logoSpace = logoSize ? logoSize.width + 16 : 0;
  if (input.header && !title) throw invalid('The page header needs a nonempty title.');
  const texts: HeaderText[] = [];
  const heightOf = (value: string | undefined, width: number, size: number, lineHeight: number) => value
    ? value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length * size / Math.max(1, width))), 0) * lineHeight : 0;
  const addTitle = (left: number, top: number, width: number) => {
    const th = heightOf(title, width, 24, 32), dh = heightOf(description, width, 14, 20);
    if (title) texts.push({ text: title, box: { left, top, width, height: th }, fontSize: 24, bold: true });
    if (title && description) texts.push({ text: description, box: { left, top: top + th + 8, width, height: dh }, fontSize: 14, bold: false });
    return th + (title && description ? 8 + dh : 0);
  };
  if (!input.controls && !band) {
    if (logoSize && input.width - logoSpace < 160) throw invalid('The header is too narrow for its logo and title.');
    const height = Math.max(addTitle(input.left + logoSpace, input.top, input.width - logoSpace), logoSize?.height ?? 0);
    return { height: height ? height + input.gap : 0, texts, inline: false,
      ...(logoSize ? { logo: { left: input.left, top: input.top, ...logoSize } } : {}) };
  }
  const inset = 16, innerWidth = input.width - inset * 2, innerLeft = input.left + inset, innerTop = input.top + inset;
  if (innerWidth < 240) throw invalid('The filter header needs at least 272 pixels of content width.');
  if (!input.controls) {
    // A colored band without filters: logo, title and description only.
    if (innerWidth - logoSpace < 160) throw invalid('The header is too narrow for its logo and title.');
    const textHeight = addTitle(innerLeft + logoSpace, innerTop, innerWidth - logoSpace);
    const height = Math.max(textHeight, logoSize?.height ?? 0);
    return { height: height + inset * 2 + input.gap, texts, inline: true,
      panel: { left: input.left, top: input.top, width: input.width, height: height + inset * 2 },
      ...(logoSize ? { logo: { left: innerLeft, top: innerTop + Math.floor((height - logoSize.height) / 2), ...logoSize } } : {}) };
  }
  const preferred = pageControlsPreferredWidth(input.controls, input.gap);
  const inline = !!title && innerWidth - logoSpace - preferred - 32 >= 320;
  const textWidth = (inline ? innerWidth - preferred - 32 : innerWidth) - logoSpace;
  if (textWidth < 160) throw invalid('The header is too narrow for its logo and title.');
  const titleHeight = Math.max(addTitle(innerLeft + logoSpace, innerTop, textWidth), logoSize?.height ?? 0);
  const controlTop = inline ? innerTop : innerTop + (titleHeight ? titleHeight + 16 : 0);
  const controlLeft = inline ? innerLeft + innerWidth - preferred : innerLeft;
  const controls = planPageControls(input.controls, controlLeft, controlTop, inline ? preferred : innerWidth, input.gap);
  const controlHeight = controls.height - input.gap;
  if (inline && titleHeight > controlHeight) {
    const offset = Math.floor((titleHeight - controlHeight) / 2);
    for (const entry of controls.entries) entry.top += offset;
  }
  const bottom = Math.max(innerTop + titleHeight, ...controls.entries.map(entry => entry.top + entry.height));
  const scopeWidth = inline ? preferred : innerWidth;
  const scopeText = '필터는 아래 모든 차트에 적용됩니다.';
  const scope = { text: scopeText, box: { left: controlLeft, top: bottom + 8, width: scopeWidth,
    height: heightOf(scopeText, scopeWidth, 12, 18) }, fontSize: 12, bold: false };
  const panel = { left: input.left, top: input.top, width: input.width, height: scope.box.top + scope.box.height + inset - input.top };
  return { height: panel.height + input.gap, texts, controls, panel, scope, inline,
    ...(logoSize ? { logo: { left: innerLeft, top: innerTop, ...logoSize } } : {}) };
}
