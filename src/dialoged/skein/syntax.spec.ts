import * as fs from 'fs';
import * as path from 'path';
import { INITIAL } from 'vscode-textmate';
import { loadDialogGrammar, renderHighlightedSnippet } from './syntax';

const GRAMMAR_PATH = path.join(
  process.env.HOME ?? '',
  '.vscode',
  'extensions',
  'sideburns3000.dialog-language-support-1.1.0',
  'syntaxes',
  'dialog.tmLanguage.json'
);

function isGrammarInstalled(): boolean {
  try {
    return fs.existsSync(GRAMMAR_PATH);
  } catch {
    return false;
  }
}

// Mirrors dgdebug-integration.spec.ts's describeIfDgdebug: skip (not fail) when the real
// dialog-language-support extension isn't installed on this machine, so the rest of the suite
// stays portable to machines/CI without it.
const describeIfGrammarInstalled = isGrammarInstalled() ? describe : describe.skip;

const STDLIB_PATH = path.join(__dirname, '__fixtures__', 'project', 'dgsample', 'lib', 'dialog', 'stdlib.dg');

describeIfGrammarInstalled('syntax highlighting against the real installed Dialog grammar', () => {
  let allLines: string[];

  beforeAll(() => {
    allLines = fs.readFileSync(STDLIB_PATH, 'utf8').split('\n');
  });

  describe('loadDialogGrammar', () => {
    it('loads a grammar that can tokenize a line', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const result = grammar.tokenizeLine('%% a comment', INITIAL);
      expect(result.tokens.length).toBeGreaterThan(0);
    });

    it('memoizes the grammar for the same path rather than reloading it', async () => {
      const first = await loadDialogGrammar(GRAMMAR_PATH);
      const second = await loadDialogGrammar(GRAMMAR_PATH);
      expect(second).toBe(first);
    });
  });

  describe('renderHighlightedSnippet', () => {
    it('colors a %% comment line with dg-comment', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      // stdlib.dg's line 4 (1-indexed) is a full-line %% comment (see the fixture itself).
      const commentLineIdx = allLines.findIndex((line) => line.trim().startsWith('%%'));
      expect(commentLineIdx).toBeGreaterThanOrEqual(0);

      const html = renderHighlightedSnippet(grammar, allLines, commentLineIdx, commentLineIdx + 1, commentLineIdx + 1);

      expect(html).toContain('class="dg-comment"');
      expect(html).toContain(String(commentLineIdx + 1));
    });

    it('colors ~(...) as dg-keyword/dg-predicate and a $variable as dg-variable', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      // "\t\t\t~($Point blocks light)" - a real negated nested query from stdlib.dg.
      const lineIdx = allLines.findIndex((line) => line.trim() === '~($Point blocks light)');
      expect(lineIdx).toBeGreaterThanOrEqual(0);

      const html = renderHighlightedSnippet(grammar, allLines, lineIdx, lineIdx + 1, lineIdx + 1);

      expect(html).toContain('class="dg-keyword"');
      expect(html).toContain('class="dg-predicate"');
      expect(html).toContain('class="dg-variable"');
      expect(html).toContain('>$Point<');
    });

    it('produces one row per line in the window, in order, each carrying its 1-indexed line number', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const html = renderHighlightedSnippet(grammar, allLines, 10, 15, 12);

      const rows = html.match(/<div class="trace-source-line[^>]*>/g) ?? [];
      expect(rows).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(html).toContain(`trace-source-ln">${11 + i}<`);
      }
    });

    it('flags only the requested (1-indexed) line as highlighted', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const html = renderHighlightedSnippet(grammar, allLines, 10, 15, 12);

      expect(html.match(/trace-source-line highlighted/g) ?? []).toHaveLength(1);
      // The highlighted row is the third of the five (lines 11,12,13,14,15 -> line 12 is index 1).
      const rows = html.split('<div class="trace-source-line');
      expect(rows[2].startsWith(' highlighted"')).toBe(true);
    });

    it('renders a full 9-line window (4 before/4 after) when not clamped by file boundaries', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const line = 428; // 1-indexed
      const context = 4;
      const start = Math.max(0, line - context - 1);
      const end = Math.min(allLines.length, line + context);

      const html = renderHighlightedSnippet(grammar, allLines, start, end, line);

      expect(end - start).toBe(9);
      expect(html.match(/<div class="trace-source-line[^>]*>/g) ?? []).toHaveLength(9);
    });

    it('clamps the window at the start of the file rather than reading negative indices', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const line = 2; // 1-indexed, near the very top of the file
      const context = 4;
      const start = Math.max(0, line - context - 1); // would be -3 unclamped
      const end = Math.min(allLines.length, line + context);

      expect(start).toBe(0);
      const html = renderHighlightedSnippet(grammar, allLines, start, end, line);
      expect(html.match(/<div class="trace-source-line[^>]*>/g) ?? []).toHaveLength(end - start);
    });

    it('HTML-escapes special characters in the source text', async () => {
      const grammar = await loadDialogGrammar(GRAMMAR_PATH);
      const html = renderHighlightedSnippet(grammar, ['x & y < z > "q"'], 0, 1, 1);

      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
      expect(html).toContain('&quot;');
    });
  });
});
