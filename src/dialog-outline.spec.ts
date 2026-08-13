import * as fs from 'fs';
import * as path from 'path';
import { DialogSymbol, findRuleHeadEnd, parseDialogOutline } from './dialog-outline';

function names(symbols: DialogSymbol[]): string[] {
  return symbols.map((s) => s.name);
}

describe('parseDialogOutline', () => {
  it('returns an empty array for an empty file', () => {
    expect(parseDialogOutline('')).toEqual([]);
  });

  it('returns an empty array for a comment-only file', () => {
    expect(parseDialogOutline('%% just a comment\n%% another one\n')).toEqual([]);
  });

  it('returns an empty array for a blank-lines-only file', () => {
    expect(parseDialogOutline('\n\n\n')).toEqual([]);
  });

  it('parses a single topic with no rules', () => {
    const result = parseDialogOutline('#player\n');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('topic');
    expect(result[0].name).toBe('#player');
    expect(result[0].children).toEqual([]);
    expect(result[0].selectionRange).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 7 }
    });
  });

  it('excludes a trailing %% comment from a topic name', () => {
    const result = parseDialogOutline('#player %% a note\n');
    expect(result[0].name).toBe('#player');
  });

  it('excludes a trailing %% comment from a rule name', () => {
    const result = parseDialogOutline('(descr *) %% comment\n');
    expect(result[0].kind).toBe('rule');
    expect(result[0].name).toBe('(descr *)');
  });

  it('keeps rules before the first topic as top-level, un-nested entries', () => {
    const text = ['(story title)', '    The Title', '(story author)', '    Someone', ''].join(
      '\n'
    );
    const result = parseDialogOutline(text);
    expect(names(result)).toEqual(['(story title)', '(story author)']);
    expect(result.every((s) => s.kind === 'rule')).toBe(true);
    expect(result.every((s) => s.children.length === 0)).toBe(true);
  });

  it('nests several single-line rules under their topic, in order', () => {
    const text = ['#player', '(current player *)', '(descr *)', '    body text', ''].join('\n');
    const result = parseDialogOutline(text);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('topic');
    expect(names(result[0].children)).toEqual(['(current player *)', '(descr *)']);
  });

  it('captures a rule head with nested parens in full', () => {
    const result = parseDialogOutline('(global variable (my-var $))\n');
    expect(result[0].name).toBe('(global variable (my-var $))');
  });

  it('recognizes an @-prefixed rule head, including the prefix in the name', () => {
    const result = parseDialogOutline('@(some access predicate *)\n');
    expect(result[0].kind).toBe('rule');
    expect(result[0].name).toBe('@(some access predicate *)');
  });

  it('recognizes a ~-prefixed rule head, including the prefix in the name', () => {
    const result = parseDialogOutline('~(negated-rule *)\n');
    expect(result[0].kind).toBe('rule');
    expect(result[0].name).toBe('~(negated-rule *)');
  });

  it('lets a blank line between rules stay part of the preceding rule range', () => {
    const text = ['#player', '(descr *)', '    body', '', '(current player *)', ''].join('\n');
    const result = parseDialogOutline(text);
    const [descr, currentPlayer] = result[0].children;
    expect(descr.name).toBe('(descr *)');
    expect(currentPlayer.name).toBe('(current player *)');
    // range extends through the blank line, up to the start of the next top-level definition
    expect(descr.range.end).toEqual({ line: 4, character: 0 });
  });

  it('resumes scanning correctly after a rule head spanning multiple lines', () => {
    const text = ['(global variable', '    (my-var $))', '#next', ''].join('\n');
    const result = parseDialogOutline(text);
    expect(result[0].kind).toBe('rule');
    expect(result[0].name).toBe('(global variable\n    (my-var $))');
    expect(result[1].kind).toBe('topic');
    expect(result[1].name).toBe('#next');
  });

  it('ends the last rule under a topic at the start of the next topic', () => {
    const text = ['#a', '(x *)', '#b', '(y *)', ''].join('\n');
    const result = parseDialogOutline(text);
    expect(result[0].children[0].range.end).toEqual({ line: 2, character: 0 });
  });

  it('ends the last definition in the file at true end of file', () => {
    const text = ['#a', '(x *)', '#b', '(y *)', ''].join('\n');
    const result = parseDialogOutline(text);
    expect(result[1].children[0].range.end).toEqual({ line: 4, character: 0 });
  });

  it('does not throw on an unterminated rule head at end of file', () => {
    expect(() => parseDialogOutline('(descr *')).not.toThrow();
    const result = parseDialogOutline('(descr *');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('rule');
  });

  describe('against the real dgsample fixtures', () => {
    const fixtureDir = path.join(
      __dirname,
      'dialoged',
      'skein',
      '__fixtures__',
      'project',
      'dgsample'
    );

    it('nests orb.dg rules under their three topics, in order', () => {
      const text = fs.readFileSync(path.join(fixtureDir, 'src', 'orb.dg'), 'utf8');
      const result = parseDialogOutline(text);

      expect(names(result)).toEqual(['#featureless-space', '#player', '#orb']);
      expect(result.every((s) => s.kind === 'topic')).toBe(true);

      expect(names(result[0].children)).toEqual(['(room *)', '(name *)', '(look *)']);
      expect(names(result[1].children)).toEqual([
        '(current player *)',
        '(descr *)',
        '(* is #in #featureless-space)'
      ]);
      expect(names(result[2].children)).toEqual([
        '(item *)',
        '(name *)',
        '(descr *)',
        '(* is #in #featureless-space)'
      ]);
    });

    it('keeps meta.dg rules flat and un-nested (no topics in the file)', () => {
      const text = fs.readFileSync(path.join(fixtureDir, 'src', 'meta.dg'), 'utf8');
      const result = parseDialogOutline(text);

      expect(names(result)).toEqual([
        '(story title)',
        '(story author)',
        '(story blurb)',
        '(story noun)',
        '(story release 0)',
        '(story ifid)'
      ]);
      expect(result.every((s) => s.kind === 'rule')).toBe(true);
      expect(result.every((s) => s.children.length === 0)).toBe(true);
    });
  });
});

describe('findRuleHeadEnd', () => {
  it('finds the matching close paren on a single line', () => {
    const lines = ['(descr *)'];
    expect(findRuleHeadEnd(lines, 0, 0)).toEqual({ line: 0, character: 9 });
  });

  it('finds the outer, final close paren for nested parens', () => {
    const lines = ['(global variable (my-var $))'];
    expect(findRuleHeadEnd(lines, 0, 0)).toEqual({ line: 0, character: 28 });
  });

  it('finds the close paren on a later line for a multi-line head', () => {
    const lines = ['(global variable', '    (my-var $))'];
    expect(findRuleHeadEnd(lines, 0, 0)).toEqual({ line: 1, character: 15 });
  });

  it('lets a %% comment on a continuation line truncate the scan for that line', () => {
    const lines = ['(descr', '    %% (fake) )', '    *)'];
    // The comment hides its parens from the scan, so the head only closes on line 2.
    expect(findRuleHeadEnd(lines, 0, 0)).toEqual({ line: 2, character: 6 });
  });

  it('returns undefined when the parens never balance before end of file', () => {
    const lines = ['(descr *'];
    expect(findRuleHeadEnd(lines, 0, 0)).toBeUndefined();
  });
});
