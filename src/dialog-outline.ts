/**
 * Pure parser producing an outline (topics + rule definitions) from Dialog (.dg) source text -
 * deliberately has no dependency on the `vscode` module, so it's unit-testable the same way
 * session-runner.ts is: plain functions over plain values, no mocking needed. See
 * dialog-symbol-provider.ts for the thin vscode.DocumentSymbolProvider adapter built on top of
 * this.
 *
 * Dialog syntax rules driving this (confirmed against sideburns3000.dialog-language-support's
 * own TextMate grammar, dialog.tmLanguage.json):
 * - A topic declaration is a line starting at column 0 with `#`, e.g. `#player`.
 * - A rule definition is a line starting at column 0, optionally prefixed with `@` (access
 *   predicate) or `~` (negation), then `(`. Its "head" is the balanced-paren span from that `(`
 *   to its matching `)` - nesting can occur (`(global variable (my-var $))`), so finding the end
 *   requires depth counting, not just the first `)`.
 * - `%%` starts a line comment that runs to end of line; there are no block comments and no
 *   string-literal type in Dialog, so `%%`/`(`/`)`/`#` are never hidden inside quotes.
 * - Any line with leading whitespace is body/query content belonging to the current definition,
 *   never a new one.
 */

export type DialogSymbolKind = 'topic' | 'rule';

export interface DialogPosition {
  line: number;
  character: number;
}

export interface DialogRange {
  start: DialogPosition;
  end: DialogPosition;
}

export interface DialogSymbol {
  kind: DialogSymbolKind;
  name: string;
  range: DialogRange;
  selectionRange: DialogRange;
  children: DialogSymbol[];
}

const TOPIC_NAME_RE = /^#[\w+-]*/;

function commentIndex(line: string): number {
  const idx = line.indexOf('%%');
  return idx === -1 ? line.length : idx;
}

/**
 * Depth-counts parentheses starting at `lines[startLine][startChar]` (assumed to be `(`) to find
 * the position just after its matching `)`, possibly spanning multiple lines. A `%%` comment on
 * any line truncates that line's contribution to the scan. Returns undefined if the parens never
 * balance before end of file (e.g. a file mid-edit) - callers should fall back gracefully rather
 * than treat that as an error.
 */
export function findRuleHeadEnd(
  lines: string[],
  startLine: number,
  startChar: number
): DialogPosition | undefined {
  let depth = 0;
  let line = startLine;
  let char = startChar;
  while (line < lines.length) {
    const text = lines[line];
    const limit = commentIndex(text);
    while (char < limit) {
      const ch = text[char];
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) {
          return { line, character: char + 1 };
        }
      }
      char++;
    }
    line++;
    char = 0;
  }
  return undefined;
}

function sliceText(lines: string[], start: DialogPosition, end: DialogPosition): string {
  if (start.line === end.line) {
    return lines[start.line].slice(start.character, end.character);
  }
  const parts: string[] = [lines[start.line].slice(start.character)];
  for (let l = start.line + 1; l < end.line; l++) {
    parts.push(lines[l]);
  }
  parts.push(lines[end.line].slice(0, end.character));
  return parts.join('\n');
}

interface RawDef {
  kind: DialogSymbolKind;
  name: string;
  defStart: DialogPosition;
  selectionEnd: DialogPosition;
}

function collectDefs(lines: string[]): RawDef[] {
  const defs: RawDef[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const limit = commentIndex(line);
    const scanned = line.slice(0, limit);
    if (scanned.trim().length === 0) {
      i++;
      continue;
    }
    if (/^\s/.test(scanned)) {
      // Indented (or comment-only, already handled above) - body content, not a new definition.
      i++;
      continue;
    }
    if (scanned[0] === '#') {
      const match = TOPIC_NAME_RE.exec(scanned);
      const name = match ? match[0] : '#';
      defs.push({
        kind: 'topic',
        name,
        defStart: { line: i, character: 0 },
        selectionEnd: { line: i, character: name.length }
      });
      i++;
      continue;
    }
    let col = 0;
    while (col < scanned.length && (scanned[col] === '@' || scanned[col] === '~')) {
      col++;
    }
    if (scanned[col] === '(') {
      const defStart: DialogPosition = { line: i, character: 0 };
      const headEnd = findRuleHeadEnd(lines, i, col) ?? { line: i, character: line.length };
      defs.push({
        kind: 'rule',
        name: sliceText(lines, defStart, headEnd),
        defStart,
        selectionEnd: headEnd
      });
      i = headEnd.line + 1;
      continue;
    }
    // Unrecognized column-0 content (not '#' or an optionally-prefixed '(') - skip defensively
    // rather than throw, so a transiently invalid/mid-edit file never crashes the outline.
    i++;
  }
  return defs;
}

export function parseDialogOutline(text: string): DialogSymbol[] {
  const lines = text.split('\n');
  const defs = collectDefs(lines);
  const eof: DialogPosition = { line: lines.length - 1, character: lines[lines.length - 1].length };

  const result: DialogSymbol[] = [];
  let currentTopic: DialogSymbol | undefined;
  for (let k = 0; k < defs.length; k++) {
    const def = defs[k];
    const rangeEnd = k + 1 < defs.length ? defs[k + 1].defStart : eof;
    const symbol: DialogSymbol = {
      kind: def.kind,
      name: def.name,
      range: { start: def.defStart, end: rangeEnd },
      selectionRange: { start: def.defStart, end: def.selectionEnd },
      children: []
    };
    if (symbol.kind === 'topic') {
      result.push(symbol);
      currentTopic = symbol;
    } else if (currentTopic) {
      currentTopic.children.push(symbol);
    } else {
      result.push(symbol);
    }
  }
  return result;
}
