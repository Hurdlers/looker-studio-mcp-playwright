// The HTML a text box keeps in descriptionProperty.text. The editor formats
// text with document.execCommand, so formatting lives in the HTML as tags
// (Chrome's default, styleWithCSS off): <b>, <i>, <u>, <strike>,
// <font color|face>, a font-size span, and the line's div for alignment.
// Every line is a <div>; an empty line is <div><br></div>.

export type Align = 'left' | 'center' | 'right';

export interface TextFormat {
  fontSize?: number;
  color?: string;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: Align;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Opening and closing tags around a line's content, outermost first:
// span(font-size) > font(color, face) > b > i > u > strike.
function wrappers(f: TextFormat): [string, string] {
  const open: string[] = [];
  const close: string[] = [];
  const add = (o: string, c: string) => {
    open.push(o);
    close.unshift(c);
  };
  if (f.fontSize !== undefined) add(`<span style="font-size: ${f.fontSize}px;">`, '</span>');
  const attrs = [f.color ? ` color="${escapeAttr(f.color)}"` : '', f.font ? ` face="${escapeAttr(f.font)}"` : ''].join('');
  if (attrs) add(`<font${attrs}>`, '</font>');
  if (f.bold) add('<b>', '</b>');
  if (f.italic) add('<i>', '</i>');
  if (f.underline) add('<u>', '</u>');
  if (f.strikethrough) add('<strike>', '</strike>');
  return [open.join(''), close.join('')];
}

function lineDiv(align?: Align): string {
  return align && align !== 'left' ? `<div style="text-align: ${align};" align="${align}">` : '<div>';
}

// Plain text (lines split on newlines) as text box HTML with the format
// applied to the whole box.
export function textHtml(text: string, format: TextFormat = {}): string {
  const [open, close] = wrappers(format);
  return text
    .split(/\r?\n/)
    .map((line) => `${lineDiv(format.align)}${line === '' ? '<br>' : `${open}${escapeHtml(line)}${close}`}</div>`)
    .join('');
}

// Re-applies font color, size and face to a whole existing text box, as
// picking the box in the editor and changing them does: the same kind of
// inline setting is taken out wherever it is, then every line is wrapped
// anew. Other formatting (bold, links, alignment) stays.
export function restyleHtml(html: string, change: Pick<TextFormat, 'color' | 'fontSize' | 'font'>): string {
  const stripped = stripInline(html, {
    color: change.color !== undefined,
    face: change.font !== undefined,
    size: change.fontSize !== undefined,
  });
  const [open, close] = wrappers({
    ...(change.fontSize !== undefined ? { fontSize: change.fontSize } : {}),
    ...(change.color !== undefined ? { color: change.color } : {}),
    ...(change.font !== undefined ? { font: change.font } : {}),
  });
  if (!open) return stripped;
  return wrapLines(stripped, open, close);
}

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

// Removes color / face attributes from <font> and font-size from span
// styles; a tag left with nothing to say goes (with its closing tag).
function stripInline(html: string, what: { color: boolean; face: boolean; size: boolean }): string {
  const stack: Array<{ name: string; drop: boolean }> = [];
  return html.replace(TAG, (tag, rawName: string) => {
    const name = rawName.toLowerCase();
    if (name !== 'font' && name !== 'span') return tag;
    if (tag.startsWith('</')) {
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at < 0) return tag;
      const [open] = stack.splice(at, 1);
      return open!.drop ? '' : tag;
    }
    if (tag.endsWith('/>')) return tag;
    let out = tag;
    if (name === 'font') {
      if (what.color) out = out.replace(/\s+color\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
      if (what.face) out = out.replace(/\s+face\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
    } else if (what.size) {
      out = out.replace(/(\sstyle\s*=\s*")([^"]*)(")/i, (_m, a: string, css: string, b: string) => {
        const rest = css
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d && !/^font-size\s*:/i.test(d));
        return rest.length ? `${a}${rest.join('; ')};${b}` : '';
      });
    }
    const drop = /^<(font|span)\s*>$/i.test(out);
    stack.push({ name, drop });
    return drop ? '' : out;
  });
}

// Wraps the content of every top-level <div> (a line) in open/close; text
// outside any div is wrapped as one line. Empty lines (<br> alone) are left.
function wrapLines(html: string, open: string, close: string): string {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  let outside = '';
  const flushOutside = () => {
    if (outside.trim()) parts.push(`${open}${outside}${close}`);
    else parts.push(outside);
    outside = '';
  };
  let lineStart = -1;
  for (const m of html.matchAll(TAG)) {
    const name = m[1]!.toLowerCase();
    const at = m.index!;
    const tag = m[0];
    if (name !== 'div') continue;
    if (!tag.startsWith('</')) {
      if (depth === 0) {
        outside += html.slice(last, at);
        flushOutside();
        parts.push(tag);
        lineStart = at + tag.length;
        last = lineStart;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const inner = html.slice(lineStart, at);
        parts.push(/^\s*(<br\s*\/?>)?\s*$/i.test(inner) ? inner : `${open}${inner}${close}`);
        parts.push(tag);
        last = at + tag.length;
      }
    }
  }
  outside += html.slice(last);
  flushOutside();
  return parts.join('');
}
