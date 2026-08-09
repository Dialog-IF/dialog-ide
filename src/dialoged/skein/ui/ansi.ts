/**
 * Converts ANSI SGR escape codes to either styled HTML (for settled/blessed output) or visible
 * pseudo-markers like "[B]...[/B]" (for diff output, where real styling would be overridden by
 * the diff spans anyway) - a port of dialog-tool's ansi.clj, same SGR-code interpretation
 * (including its dgdebug-specific quirks: SGR 4 is treated as italic, SGR 7 as underline - see
 * that file's own note on why).
 *
 * SGR effects are tracked as a stack; each push adds a StackEntry. A reset (code 0) unwinds the
 * whole stack. SGR 38;2;R;G;B sets a 24-bit RGB foreground color (dgdebug's own convention);
 * known RGB triplets map to named colors, others fall back to an inline hex style. SGR 39
 * (default foreground) pops the most recently pushed color entry specifically.
 */

interface StackEntry {
  tag: string;
  css: string | null;
  style?: string;
  color?: boolean;
}

type SgrAction =
  | { type: 'reset' }
  | { type: 'popColor' }
  | { type: 'push'; entry: StackEntry | null };

type Segment = { type: 'text'; value: string } | { type: 'sgr'; params: number[] };

// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

const COLOR_NAMES: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white'
};

// See https://github.com/Dialog-IF/dialog/blob/6107864a00b56c1f9de2a63a70d4f99ec2241d39/src/term_tty.c#L173
const KNOWN_RGB_COLORS: Record<string, string> = {
  '38,38,38': 'black',
  '223,32,80': 'red',
  '24,170,73': 'green',
  '181,169,41': 'yellow',
  '99,97,234': 'blue',
  '191,28,191': 'magenta',
  '33,186,186': 'cyan',
  '242,242,242': 'white'
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseSgr(paramsStr: string): number[] {
  if (paramsStr === '') {
    return [0];
  }
  return paramsStr.split(';').map((part) => parseInt(part, 10));
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  SGR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_PATTERN.exec(text)) !== null) {
    if (match.index > pos) {
      segments.push({ type: 'text', value: text.slice(pos, match.index) });
    }
    segments.push({ type: 'sgr', params: parseSgr(match[1]) });
    pos = match.index + match[0].length;
  }
  if (pos < text.length) {
    segments.push({ type: 'text', value: text.slice(pos) });
  }
  return segments;
}

function rgbEntry(r: number, g: number, b: number): StackEntry {
  const name = KNOWN_RGB_COLORS[`${r},${g},${b}`];
  if (name) {
    return { tag: name.toUpperCase(), css: `ansi-${name}`, color: true };
  }
  const hex = [r, g, b].map((n) => n.toString(16).padStart(2, '0').toUpperCase()).join('');
  return { tag: `#${hex}`, css: null, style: `color:#${hex.toLowerCase()}`, color: true };
}

function codeToEntry(code: number): StackEntry | null {
  switch (code) {
    case 0:
      return null;
    case 1:
      return { tag: 'B', css: 'ansi-bold' };
    case 4:
      return { tag: 'I', css: 'ansi-italic' };
    case 7:
      return { tag: 'U', css: 'ansi-underline' };
    case 50:
      return { tag: 'TT', css: 'ansi-fixed' };
    default: {
      const name = COLOR_NAMES[code];
      if (name) {
        return { tag: name.toUpperCase(), css: `ansi-${name}`, color: true };
      }
      return { tag: String(code), css: null };
    }
  }
}

function sgrActions(codes: number[]): SgrAction[] {
  const actions: SgrAction[] = [];
  let i = 0;
  while (i < codes.length) {
    const code = codes[i];
    if (code === 0) {
      actions.push({ type: 'reset' });
      i += 1;
    } else if (code === 39) {
      actions.push({ type: 'popColor' });
      i += 1;
    } else if (code === 38 && codes[i + 1] === 2 && codes.length - i >= 5) {
      actions.push({ type: 'push', entry: rgbEntry(codes[i + 2], codes[i + 3], codes[i + 4]) });
      i += 5;
    } else {
      actions.push({ type: 'push', entry: codeToEntry(code) });
      i += 1;
    }
  }
  return actions;
}

/** Finds and removes the most recently pushed color entry. Returns [newStack, popped]. */
function popColorEntry(stack: StackEntry[]): [StackEntry[], StackEntry | null] {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].color) {
      return [[...stack.slice(0, i), ...stack.slice(i + 1)], stack[i]];
    }
  }
  return [stack, null];
}

function stackToClassAndStyle(stack: StackEntry[]): { class?: string; style?: string } | null {
  const classes = [...new Set(stack.map((e) => e.css).filter((css): css is string => css !== null))].join(' ');
  const style = stack
    .map((e) => e.style)
    .filter((s): s is string => s !== undefined)
    .join(';');
  if (!classes && !style) {
    return null;
  }
  const attrs: { class?: string; style?: string } = {};
  if (classes) {
    attrs.class = classes;
  }
  if (style) {
    attrs.style = style;
  }
  return attrs;
}

/**
 * Converts ANSI SGR codes to styled HTML spans - for settled/blessed output where real visual
 * styling (bold, color...) is wanted. Escapes text content; safe to embed directly.
 */
export function ansiToHtml(text: string): string {
  if (!text.includes('\x1b')) {
    return escapeHtml(text);
  }

  const segments = parseSegments(text);
  let stack: StackEntry[] = [];
  let html = '';

  for (const segment of segments) {
    if (segment.type === 'sgr') {
      for (const action of sgrActions(segment.params)) {
        if (action.type === 'reset') {
          stack = [];
        } else if (action.type === 'popColor') {
          stack = popColorEntry(stack)[0];
        } else if (action.entry) {
          stack = [...stack, action.entry];
        }
      }
    } else {
      const attrs = stackToClassAndStyle(stack);
      const escaped = escapeHtml(segment.value);
      if (attrs) {
        const classAttr = attrs.class ? ` class="${attrs.class}"` : '';
        const styleAttr = attrs.style ? ` style="${attrs.style}"` : '';
        html += `<span${classAttr}${styleAttr}>${escaped}</span>`;
      } else {
        html += escaped;
      }
    }
  }

  return html;
}

/**
 * Converts ANSI SGR codes to plain text with visible pseudo-markers ("[B]...[/B]" etc.) - for
 * diff output, where the diff spans (added/removed) would override real styling anyway, so the
 * styling is shown as text instead. Returns plain (unescaped) text - the caller escapes after
 * diffing, same as any other diff segment.
 */
export function ansiToMarkers(text: string): string {
  if (!text.includes('\x1b')) {
    return text;
  }

  const segments = parseSegments(text);
  let stack: StackEntry[] = [];
  let out = '';

  for (const segment of segments) {
    if (segment.type === 'sgr') {
      for (const action of sgrActions(segment.params)) {
        if (action.type === 'reset') {
          for (let i = stack.length - 1; i >= 0; i--) {
            out += `[/${stack[i].tag}]`;
          }
          stack = [];
        } else if (action.type === 'popColor') {
          const [newStack, popped] = popColorEntry(stack);
          if (popped) {
            out += `[/${popped.tag}]`;
          }
          stack = newStack;
        } else if (action.entry) {
          out += `[${action.entry.tag}]`;
          stack = [...stack, action.entry];
        }
      }
    } else {
      out += segment.value;
    }
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    out += `[/${stack[i].tag}]`;
  }

  return out;
}
