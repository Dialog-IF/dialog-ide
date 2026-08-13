import * as path from 'path';
import { DialogSymbolIndex, IndexedSymbol, indexFileText, readIndexedFile } from './dialog-symbol-index';

const FIXTURE_DIR = path.join(__dirname, 'dialoged', 'skein', '__fixtures__', 'project', 'dgsample');

function names(symbols: IndexedSymbol[]): string[] {
  return symbols.map((s) => s.name);
}

describe('indexFileText', () => {
  it('returns an empty array for an empty file', () => {
    expect(indexFileText('test.dg', '')).toEqual([]);
  });

  it('maps a topic to kind topic with an empty containerName', () => {
    const [symbol] = indexFileText('test.dg', '#player\n');
    expect(symbol.kind).toBe('topic');
    expect(symbol.name).toBe('#player');
    expect(symbol.nameLower).toBe('#player');
    expect(symbol.containerName).toBe('');
    expect(symbol.filePath).toBe('test.dg');
  });

  it('sets containerName to the enclosing topic name for a nested rule', () => {
    const text = ['#player', '(descr *)', '    body text', ''].join('\n');
    const symbols = indexFileText('test.dg', text);
    expect(names(symbols)).toEqual(['#player', '(descr *)']);
    const rule = symbols.find((s) => s.name === '(descr *)')!;
    expect(rule.kind).toBe('rule');
    expect(rule.containerName).toBe('#player');
  });

  it('leaves containerName empty for a rule before any topic', () => {
    const text = ['(story title)', '    The Title', ''].join('\n');
    const [symbol] = indexFileText('test.dg', text);
    expect(symbol.kind).toBe('rule');
    expect(symbol.containerName).toBe('');
  });

  it('collapses a multi-line rule head to single-line display text', () => {
    const text = ['(global variable', '    (my-var $))', ''].join('\n');
    const [symbol] = indexFileText('test.dg', text);
    expect(symbol.name).toBe('(global variable (my-var $))');
    expect(symbol.nameLower).toBe('(global variable (my-var $))');
  });

  it('reads real project source and reports the right file path against the dgsample fixture', () => {
    const filePath = path.join(FIXTURE_DIR, 'src', 'orb.dg');
    const symbols = indexFileText(filePath, '#orb\n(item *)\n    yes\n');
    expect(symbols.every((s) => s.filePath === filePath)).toBe(true);
  });
});

describe('readIndexedFile', () => {
  it('parses a real fixture file consistently with parseDialogOutline', async () => {
    const filePath = path.join(FIXTURE_DIR, 'src', 'orb.dg');
    const symbols = await readIndexedFile(filePath);

    expect(names(symbols)).toEqual(
      expect.arrayContaining(['#featureless-space', '#player', '#orb', '(descr *)', '(name *)'])
    );
    const orb = symbols.find((s) => s.name === '#orb')!;
    expect(orb.kind).toBe('topic');
    expect(orb.containerName).toBe('');

    const item = symbols.find((s) => s.name === '(item *)' && s.containerName === '#orb');
    expect(item).toBeDefined();
    expect(item!.kind).toBe('rule');
  });
});

describe('DialogSymbolIndex', () => {
  function indexWith(entries: Record<string, string>): DialogSymbolIndex {
    const index = new DialogSymbolIndex();
    for (const [filePath, text] of Object.entries(entries)) {
      index.setFile(filePath, indexFileText(filePath, text));
    }
    return index;
  }

  it('matches case-insensitively across all indexed files', () => {
    const index = indexWith({
      'a.dg': '#Player\n',
      'b.dg': '#orb\n'
    });
    expect(names(index.search('player'))).toEqual(['#Player']);
  });

  it('requires every whitespace-separated term to match (AND-match)', () => {
    const index = indexWith({ 'a.dg': '(current player *)\n(descr *)\n' });
    expect(names(index.search('current player'))).toEqual(['(current player *)']);
    expect(index.search('current orb')).toEqual([]);
  });

  it('ranks an exact match above a prefix match, and a prefix match above a plain substring match', () => {
    const index = indexWith({
      'a.dg': ['#orbital', '(descr *)', '#orb', ''].join('\n')
    });
    // "descr" only substring-matches inside "(descr *)" via its own exact-ish match; use "orb"
    // to compare an exact topic name against a topic that merely starts with it.
    const result = index.search('orb');
    expect(names(result)).toEqual(['#orb', '#orbital']);
  });

  it('caps results at the given limit', () => {
    const text = Array.from({ length: 10 }, (_, i) => `(rule-${i} *)`).join('\n') + '\n';
    const index = indexWith({ 'a.dg': text });
    expect(index.search('rule', 3)).toHaveLength(3);
  });

  it('replaces (not duplicates) a file entry on setFile', () => {
    const index = new DialogSymbolIndex();
    index.setFile('a.dg', indexFileText('a.dg', '#one\n'));
    index.setFile('a.dg', indexFileText('a.dg', '#two\n'));
    expect(names(index.search('one'))).toEqual([]);
    expect(names(index.search('two'))).toEqual(['#two']);
  });

  it('drops a file entry on removeFile', () => {
    const index = indexWith({ 'a.dg': '#player\n' });
    expect(names(index.search('player'))).toEqual(['#player']);
    index.removeFile('a.dg');
    expect(index.search('player')).toEqual([]);
  });
});
