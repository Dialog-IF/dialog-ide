/**
 * Pure, vscode-free workspace symbol index over Dialog (.dg) source - flattens
 * dialog-outline.ts's per-file parse into a searchable collection keyed by file path, so a rule
 * or topic defined anywhere in the project can be found without knowing which file it's in. See
 * dialog-workspace-symbol-provider.ts for the vscode.WorkspaceSymbolProvider adapter built on
 * top of this (same pure-logic/adapter split as dialog-outline.ts/dialog-symbol-provider.ts).
 */

import * as fs from 'fs/promises';
import { DialogRange, DialogSymbol, DialogSymbolKind, parseDialogOutline } from './dialog-outline';

export interface IndexedSymbol {
  name: string;
  nameLower: string;
  kind: DialogSymbolKind;
  filePath: string;
  containerName: string;
  range: DialogRange;
  selectionRange: DialogRange;
}

const DEFAULT_LIMIT = 200;

// A rule's name can legitimately span multiple lines (see findRuleHeadEnd in dialog-outline.ts) -
// fine as a parse artifact, but this is now display text for a picker, so collapse it to one line.
function collapseWhitespace(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function flatten(symbols: DialogSymbol[], filePath: string, containerName: string, out: IndexedSymbol[]): void {
  for (const symbol of symbols) {
    const name = collapseWhitespace(symbol.name);
    out.push({
      name,
      nameLower: name.toLowerCase(),
      kind: symbol.kind,
      filePath,
      containerName,
      range: symbol.range,
      selectionRange: symbol.selectionRange
    });
    // Only topics ever have children (parseDialogOutline nests rules one level under their
    // topic) - recursing generically here just means this doesn't need to change if that ever
    // grows a second level.
    flatten(symbol.children, filePath, name, out);
  }
}

export function indexFileText(filePath: string, text: string): IndexedSymbol[] {
  const out: IndexedSymbol[] = [];
  flatten(parseDialogOutline(text), filePath, '', out);
  return out;
}

export async function readIndexedFile(filePath: string): Promise<IndexedSymbol[]> {
  const text = await fs.readFile(filePath, 'utf8');
  return indexFileText(filePath, text);
}

// 0 = exact match, 1 = starts with the (first) search term, 2 = plain substring match elsewhere.
function rankOf(nameLower: string, terms: string[]): number {
  if (terms.length === 0) {
    return 2;
  }
  if (nameLower === terms.join(' ')) {
    return 0;
  }
  return nameLower.startsWith(terms[0]) ? 1 : 2;
}

export class DialogSymbolIndex {
  private readonly byFile = new Map<string, IndexedSymbol[]>();

  setFile(filePath: string, symbols: IndexedSymbol[]): void {
    this.byFile.set(filePath, symbols);
  }

  removeFile(filePath: string): void {
    this.byFile.delete(filePath);
  }

  /**
   * Every whitespace-separated query term must be a substring of a symbol's (lowercased) name -
   * AND-matching in the same spirit as search.ts's searchKnots. A plain linear scan is fine at
   * this scale: even tens of thousands of short names is well under a millisecond per keystroke.
   */
  search(query: string, limit = DEFAULT_LIMIT): IndexedSymbol[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 0);

    const matches: { symbol: IndexedSymbol; rank: number }[] = [];
    for (const symbols of this.byFile.values()) {
      for (const symbol of symbols) {
        if (!terms.every((term) => symbol.nameLower.includes(term))) {
          continue;
        }
        matches.push({ symbol, rank: rankOf(symbol.nameLower, terms) });
      }
    }

    matches.sort((a, b) => a.rank - b.rank || a.symbol.name.localeCompare(b.symbol.name));
    return matches.slice(0, limit).map((match) => match.symbol);
  }
}
