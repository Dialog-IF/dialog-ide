/**
 * Dialog source syntax highlighting for the trace panel's hover/source snippets.
 *
 * Reuses the real TextMate grammar vendored under this extension's own `syntaxes/` directory
 * (originally from the `sideburns3000.dialog-language-support` extension, MIT-licensed - see
 * THIRD_PARTY_LICENSES.md) rather than a hand-written tokenizer - the grammar is the actual
 * source of truth for what Dialog syntax looks like. `vscode-textmate`/`vscode-oniguruma` are
 * standalone libraries (not the `vscode` module), so this stays in the vscode-agnostic skein/
 * layer - extension.ts resolves the grammar's file path (which needs `context.extensionPath`)
 * and hands it down as a plain string.
 */

import * as fs from 'fs/promises';
import * as oniguruma from 'vscode-oniguruma';
import { Registry, parseRawGrammar, INITIAL, IGrammar, IToken } from 'vscode-textmate';

const DIALOG_SCOPE_NAME = 'source.dg';

/**
 * Maps grammar scope prefixes to the `dg-*` CSS classes already defined in styles/input.css
 * (originally added matching dialog-tool's own syntax.clj token categories - comment/keyword/
 * object/variable/number/dict-word/predicate/heading/escape/punctuation/error - so this reuses
 * that existing palette rather than inventing a parallel one). `dg-string` is the one addition,
 * for the grammar's string.quoted/string.unquoted scopes, which that category set didn't have
 * a slot for. Scopes are walked most-specific-first (the last entry in a token's scope stack is
 * the innermost, per the TextMate spec), so the first matching prefix here wins. A couple of
 * scopes with no clean semantic match (variable.language - the `*` current-topic marker;
 * storage.modifier - the `@` access-predicate prefix) fall back to dg-keyword, the closest
 * existing category for a special control-ish marker.
 */
const SCOPE_CLASS_MAP: [prefix: string, className: string][] = [
  ['comment.', 'dg-comment'],
  ['string.', 'dg-string'],
  ['constant.numeric.', 'dg-number'],
  ['constant.character.escape.', 'dg-escape'],
  ['constant.language.', 'dg-object'],
  ['entity.name.function.', 'dg-predicate'],
  ['keyword.', 'dg-keyword'],
  ['storage.', 'dg-keyword'],
  ['variable.language.', 'dg-keyword'],
  ['variable.parameter.', 'dg-variable'],
  ['variable.other.', 'dg-variable'],
  ['variable.', 'dg-variable'],
  ['punctuation.', 'dg-punctuation'],
  ['invalid.', 'dg-error'],
  ['markup.heading.', 'dg-heading']
];

function classForScopes(scopes: string[]): string | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    for (const [prefix, className] of SCOPE_CLASS_MAP) {
      if (scope.startsWith(prefix)) {
        return className;
      }
    }
  }
  return null;
}

function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightLine(lineText: string, tokens: IToken[]): string {
  if (lineText === '') {
    return '';
  }
  return tokens
    .map((token) => {
      const text = htmlEscape(lineText.slice(token.startIndex, token.endIndex));
      const className = classForScopes(token.scopes);
      return className ? `<span class="${className}">${text}</span>` : text;
    })
    .join('');
}

/**
 * Same row markup as renderHighlightedSnippet, without tokenizing - the fallback service.ts
 * uses when no grammarPath was configured (defensive: extension.ts always resolves one today,
 * since the grammar is a vendored, always-present asset, but this keeps the source-preview
 * endpoint working rather than erroring if that ever isn't true).
 */
export function renderPlainSnippet(allLines: string[], windowStart: number, windowEnd: number, highlightedLine: number): string {
  const rows: string[] = [];
  for (let i = windowStart; i < windowEnd; i++) {
    const lineNumber = i + 1;
    const isHighlighted = lineNumber === highlightedLine;
    rows.push(
      `<div class="trace-source-line${isHighlighted ? ' highlighted' : ''}">` +
        `<span class="trace-source-ln">${lineNumber}</span>` +
        `<span class="trace-source-code">${htmlEscape(allLines[i] ?? '')}</span>` +
        `</div>`
    );
  }
  return rows.join('');
}

let cachedGrammar: Promise<IGrammar> | null = null;
let cachedGrammarPath: string | null = null;

/**
 * Loads (and memoizes) the Dialog grammar from the given .tmLanguage.json path. Re-loads only
 * if called with a different path than last time - in practice this extension only ever has
 * one grammarPath for its whole lifetime, but memoizing on the path (rather than unconditionally
 * caching forever) keeps this safe to call from tests with different fixture paths too.
 */
export function loadDialogGrammar(grammarPath: string): Promise<IGrammar> {
  if (cachedGrammar && cachedGrammarPath === grammarPath) {
    return cachedGrammar;
  }

  cachedGrammarPath = grammarPath;
  cachedGrammar = (async () => {
    const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
    const wasmBin = await fs.readFile(wasmPath);
    await oniguruma.loadWASM(wasmBin.buffer as ArrayBuffer);

    const onigLib = Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text)
    });

    const registry = new Registry({
      onigLib,
      loadGrammar: async (scopeName: string) => {
        if (scopeName !== DIALOG_SCOPE_NAME) {
          return null;
        }
        const content = await fs.readFile(grammarPath, 'utf8');
        return parseRawGrammar(content, grammarPath);
      }
    });

    const grammar = await registry.loadGrammar(DIALOG_SCOPE_NAME);
    if (!grammar) {
      throw new Error(`Failed to load Dialog grammar from ${grammarPath}`);
    }
    return grammar;
  })();

  return cachedGrammar;
}

/**
 * Renders a syntax-highlighted HTML snippet for lines [windowStart, windowEnd) of allLines,
 * with the (1-indexed) highlightedLine flagged. Tokenizes the WHOLE file from the beginning,
 * threading ruleStack forward line-by-line, and only renders the requested window - the
 * grammar has multi-line begin/end constructs (e.g. an unclosed paren spanning lines), so
 * tokenizing the window in isolation from INITIAL would sometimes mis-highlight; source files
 * here are small, so tokenizing the whole thing is cheap.
 */
export function renderHighlightedSnippet(
  grammar: IGrammar,
  allLines: string[],
  windowStart: number,
  windowEnd: number,
  highlightedLine: number
): string {
  let ruleStack = INITIAL;
  const rows: string[] = [];

  for (let i = 0; i < windowEnd; i++) {
    const line = allLines[i] ?? '';
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;

    if (i >= windowStart) {
      const lineNumber = i + 1;
      const isHighlighted = lineNumber === highlightedLine;
      const code = highlightLine(line, result.tokens);
      rows.push(
        `<div class="trace-source-line${isHighlighted ? ' highlighted' : ''}">` +
          `<span class="trace-source-ln">${lineNumber}</span>` +
          `<span class="trace-source-code">${code}</span>` +
          `</div>`
      );
    }
  }

  return rows.join('');
}
