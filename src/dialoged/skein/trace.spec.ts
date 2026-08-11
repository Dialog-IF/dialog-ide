import * as fs from 'fs';
import * as path from 'path';
import {
  buildTraceTree,
  parseTraceLines,
  getNode,
  countNodes,
  expandAll,
  collapseAll,
  toggleExpanded,
  searchTree,
  expandToMatches,
  findFirstMatch,
  parseSource,
  TraceNode,
  TraceTree
} from './trace';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'trace');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('parseTraceLines', () => {
  it('parses an ENTER line', () => {
    const [line] = parseTraceLines('| 3 ENTER (parse commandline [i] with choices []) ../lib/dialog/stdlib.dg:5767');
    expect(line).toEqual({
      depth: 3,
      type: 'enter',
      text: '(parse commandline [i] with choices [])',
      source: '../lib/dialog/stdlib.dg:5767'
    });
  });

  it('parses a QUERY line', () => {
    const [line] = parseTraceLines('| 3 QUERY (save undo 1) ../lib/dialog/stdlib.dg:5769');
    expect(line).toMatchObject({ depth: 3, type: 'query', text: '(save undo 1)' });
  });

  it('parses a FOUND line', () => {
    const [line] = parseTraceLines('| 5 FOUND (current player #player) ../lib/dialog/stdlib.dg:5803');
    expect(line).toMatchObject({ depth: 5, type: 'found', text: '(current player #player)' });
  });

  it('parses a NOW line', () => {
    const [line] = parseTraceLines('| 5 NOW (current actor #player) ../lib/dialog/stdlib.dg:5804');
    expect(line).toMatchObject({ depth: 5, type: 'now', text: '(current actor #player)' });
  });

  it('preserves a leading ~ negation on the predicate text', () => {
    const [line] = parseTraceLines('| 3 NOW ~(allowing parse errors) ../lib/dialog/stdlib.dg:5782');
    expect(line.text).toBe('~(allowing parse errors)');
  });

  it('preserves a leading * multi-clause marker on the predicate text', () => {
    const [line] = parseTraceLines('| 5 QUERY *(understand [i] as $) ../lib/dialog/stdlib.dg:5835');
    expect(line.text).toBe('*(understand [i] as $)');
  });

  it('parses double-digit depths with no space before the type keyword', () => {
    const [line] = parseTraceLines('|10 ENTER (action [inventory] requires $ to be present) ../lib/dialog/stdlib.dg:3518');
    expect(line).toMatchObject({ depth: 10, type: 'enter' });
  });

  it('drops game text, prompts, and blank lines, keeping only trace lines', () => {
    const input = [
      '> i',
      '| 3 FOUND (get input [i]) ../lib/dialog/stdlib.dg:4888',
      'You have no possessions.',
      '',
      '| 3 QUERY (nonempty []) ../lib/dialog/stdlib.dg:5775',
      '>'
    ].join('\n');
    const lines = parseTraceLines(input);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: 'found', text: '(get input [i])' });
    expect(lines[1]).toMatchObject({ type: 'query', text: '(nonempty [])' });
  });

  it('returns an empty array for input with no trace lines', () => {
    expect(parseTraceLines('')).toEqual([]);
    expect(parseTraceLines('no trace lines here\njust game text')).toEqual([]);
  });

  it('strips ANSI escape sequences before matching', () => {
    const [line] = parseTraceLines('| 3 FOUND [1m(get input [i])[0m ../lib/dialog/stdlib.dg:4888');
    expect(line).toMatchObject({ depth: 3, type: 'found', text: '(get input [i])' });

    const [reset] = parseTraceLines('[0m| 5 QUERY (save undo 1) ../lib/dialog/stdlib.dg:5769');
    expect(reset).toMatchObject({ depth: 5, type: 'query' });
  });

  it('trims trailing whitespace', () => {
    const [line] = parseTraceLines('| 3 FOUND (get input [i]) ../lib/dialog/stdlib.dg:4888   ');
    expect(line).toMatchObject({ depth: 3, type: 'found' });
  });
});

describe('buildTraceTree', () => {
  function childText(tree: TraceTree, id: number): (TraceNode | undefined)[] {
    return tree.get(id)!.children.map((childId) => tree.get(childId));
  }

  it('builds an invisible root with no children from empty input', () => {
    const tree = buildTraceTree('');
    expect(countNodes(tree)).toBe(0);
    expect(tree.get(0)?.children).toEqual([]);
  });

  it('makes same-level lines siblings with no children', () => {
    const raw = ['| 3 QUERY A a.dg:1', '| 3 QUERY B b.dg:2', '| 3 FOUND C c.dg:3'].join('\n');
    const tree = buildTraceTree(raw);
    expect(countNodes(tree)).toBe(3);
    const siblings = childText(tree, 0);
    expect(siblings.map((n) => n?.text)).toEqual(['A', 'B', 'C']);
    expect(siblings.every((n) => n?.children.length === 0)).toBe(true);
  });

  it('nests a deeper line as a child of the preceding line', () => {
    const raw = ['| 3 ENTER parent a.dg:1', '| 4 QUERY child a.dg:2'].join('\n');
    const tree = buildTraceTree(raw);
    const [parent] = childText(tree, 0);
    expect(parent?.text).toBe('parent');
    const [child] = childText(tree, parent!.id);
    expect(child?.text).toBe('child');
    expect(child?.children).toEqual([]);
  });

  it('starts a new sibling when depth drops back to the parent level', () => {
    const raw = ['| 3 ENTER first a.dg:1', '| 4 QUERY child-of-first a.dg:2', '| 3 FOUND second a.dg:3'].join('\n');
    const tree = buildTraceTree(raw);
    const [first, second] = childText(tree, 0);
    expect(first?.text).toBe('first');
    expect(second?.text).toBe('second');
    expect(second?.children).toEqual([]);
    const [childOfFirst] = childText(tree, first!.id);
    expect(childOfFirst?.text).toBe('child-of-first');
  });

  it('handles three levels of nesting', () => {
    const raw = [
      '| 5 ENTER grandparent a.dg:1',
      '| 6 ENTER parent a.dg:2',
      '| 7 QUERY child a.dg:3',
      '| 7 FOUND child-found a.dg:4',
      '| 6 FOUND parent-found a.dg:5',
      '| 5 FOUND grandparent-found a.dg:6'
    ].join('\n');
    const tree = buildTraceTree(raw);
    const [gp, gpFound] = childText(tree, 0);
    expect(gp?.text).toBe('grandparent');
    expect(gpFound?.text).toBe('grandparent-found');
    expect(gpFound?.children).toEqual([]);

    const [parent, parentFound] = childText(tree, gp!.id);
    expect(parent?.text).toBe('parent');
    expect(parentFound?.text).toBe('parent-found');

    const [child, childFound] = childText(tree, parent!.id);
    expect(child?.text).toBe('child');
    expect(childFound?.text).toBe('child-found');
  });

  it('assigns unique, positive ids to every visible node', () => {
    const raw = ['| 3 ENTER A a.dg:1', '| 4 QUERY B b.dg:2', '| 4 FOUND C c.dg:3', '| 3 QUERY D d.dg:4'].join('\n');
    const tree = buildTraceTree(raw);
    const visibleIds = [...tree.keys()].filter((id) => id !== 0);
    expect(visibleIds).toHaveLength(4);
    expect(visibleIds.every((id) => id > 0)).toBe(true);
    for (const [id, node] of tree) {
      if (id !== 0) expect(node.id).toBe(id);
    }
  });

  it('matches the real trace.txt fixture structure', () => {
    const raw = readFixture('trace-sample.txt');
    const lines = parseTraceLines(raw);
    const tree = buildTraceTree(raw);

    expect(countNodes(tree)).toBe(lines.length);

    const root = tree.get(0)!;
    expect(root.children.length).toBeGreaterThan(0);

    // The fixture starts mid-stream at depth 3, so that's the first root child.
    const firstChild = tree.get(root.children[0])!;
    expect(firstChild).toMatchObject({ depth: 3, type: 'found', text: '(get input [i])' });

    // Depth-1 lines appear later in the fixture and are also root children.
    expect(root.children.some((id) => tree.get(id)!.depth === 1)).toBe(true);
  });
});

describe('getNode / countNodes', () => {
  it('finds a node by id, including nested children, and returns undefined for an unknown id', () => {
    const raw = ['| 3 ENTER parent a.dg:1', '| 4 QUERY child a.dg:2', '| 4 FOUND sibling a.dg:3'].join('\n');
    const tree = buildTraceTree(raw);
    const [parentId] = tree.get(0)!.children;
    expect(getNode(tree, parentId)?.text).toBe('parent');
    const [childId] = tree.get(parentId)!.children;
    expect(getNode(tree, childId)?.text).toBe('child');
    expect(getNode(tree, 99999)).toBeUndefined();
  });
});

function simpleTree(): TraceTree {
  // invisible root (0)
  //   -> root (1, stdlib.dg)
  //        -> child-a (2, penny.dg) - matches "penny"
  //             -> grandchild (3, stdlib.dg)
  //        -> child-b (4, tc.dg)
  const node = (overrides: Partial<TraceNode>): TraceNode => ({
    id: 0,
    depth: 0,
    type: 'enter',
    text: null,
    source: null,
    children: [],
    expanded: false,
    match: false,
    hasMatch: false,
    ...overrides
  });
  return new Map<number, TraceNode>([
    [0, node({ id: 0, depth: -1, type: null, children: [1] })],
    [1, node({ id: 1, depth: 3, type: 'enter', text: '(root action)', source: 'stdlib.dg:100', children: [2, 4] })],
    [2, node({ id: 2, depth: 4, type: 'query', text: '(find penny)', source: 'penny.dg:10', children: [3] })],
    [3, node({ id: 3, depth: 5, type: 'found', text: '(found it)', source: 'stdlib.dg:200', children: [] })],
    [4, node({ id: 4, depth: 4, type: 'query', text: '(conversation partner $)', source: 'tc.dg:345', children: [] })]
  ]);
}

describe('searchTree', () => {
  it('clears match/hasMatch flags on a blank term (deliberate deviation from trace.clj)', () => {
    const withMatches = searchTree(simpleTree(), 'penny');
    const cleared = searchTree(withMatches, '');
    for (const node of cleared.values()) {
      expect(node.match).toBe(false);
      expect(node.hasMatch).toBe(false);
    }
    const spaces = searchTree(withMatches, '   ');
    for (const node of spaces.values()) {
      expect(node.hasMatch).toBe(false);
    }
  });

  it('marks a direct predicate match and propagates hasMatch to ancestors, not siblings', () => {
    const result = searchTree(simpleTree(), 'penny');
    expect(result.get(1)).toMatchObject({ match: false, hasMatch: true });
    expect(result.get(2)).toMatchObject({ match: true, hasMatch: true, text: '(find penny)' });
    expect(result.get(4)).toMatchObject({ match: false, hasMatch: false });
  });

  it('matches on source file', () => {
    const result = searchTree(simpleTree(), 'tc.dg');
    expect(result.get(1)).toMatchObject({ match: false, hasMatch: true });
    expect(result.get(2)).toMatchObject({ match: false, hasMatch: false });
    expect(result.get(4)).toMatchObject({ match: true, hasMatch: true, source: 'tc.dg:345' });
  });

  it('is case-insensitive', () => {
    const result = searchTree(simpleTree(), 'PENNY');
    expect(result.get(1)).toMatchObject({ hasMatch: true });
    expect(result.get(2)).toMatchObject({ match: true });
  });

  it('propagates hasMatch from a grandchild up through its parent to the root', () => {
    const result = searchTree(simpleTree(), 'found it');
    expect(result.get(3)).toMatchObject({ match: true, hasMatch: true });
    expect(result.get(2)).toMatchObject({ match: false, hasMatch: true });
    expect(result.get(1)).toMatchObject({ match: false, hasMatch: true });
    expect(result.get(4)).toMatchObject({ match: false, hasMatch: false });
  });

  it('marks everything false when nothing matches', () => {
    const result = searchTree(simpleTree(), 'nonexistent');
    for (const id of [1, 2, 3, 4]) {
      expect(result.get(id)).toMatchObject({ match: false, hasMatch: false });
    }
  });
});

describe('expandToMatches', () => {
  it('expands only nodes with hasMatch that have children', () => {
    const searched = searchTree(simpleTree(), 'found it');
    const result = expandToMatches(searched);
    expect(result.get(1)?.expanded).toBe(true); // hasMatch, has children
    expect(result.get(2)?.expanded).toBe(true); // hasMatch, has children
    expect(result.get(3)?.expanded).toBe(false); // hasMatch but no children
    expect(result.get(4)?.expanded).toBe(false); // no match
  });
});

describe('findFirstMatch', () => {
  it('returns the id of the first matching node in depth-first order', () => {
    const result = searchTree(simpleTree(), 'penny');
    const id = findFirstMatch(result);
    expect(id).not.toBeNull();
    expect(getNode(result, id!)).toMatchObject({ text: '(find penny)', match: true });
  });

  it('returns null when nothing matches', () => {
    expect(findFirstMatch(searchTree(simpleTree(), 'nonexistent'))).toBeNull();
  });

  it('returns null when no search has been run yet', () => {
    expect(findFirstMatch(simpleTree())).toBeNull();
  });
});

describe('expandAll / collapseAll / toggleExpanded', () => {
  it('expandAll expands every node that has children, collapseAll collapses everything', () => {
    const expanded = expandAll(simpleTree());
    expect(expanded.get(1)?.expanded).toBe(true);
    expect(expanded.get(2)?.expanded).toBe(true);
    expect(expanded.get(3)?.expanded).toBe(false); // leaf

    const collapsed = collapseAll(expanded);
    for (const node of collapsed.values()) {
      expect(node.expanded).toBe(false);
    }
  });

  it('toggleExpanded flips a single node and returns the tree unchanged for an unknown id', () => {
    const tree = simpleTree();
    const toggled = toggleExpanded(tree, 1);
    expect(toggled.get(1)?.expanded).toBe(true);
    expect(toggleExpanded(toggled, 1).get(1)?.expanded).toBe(false);
    expect(toggleExpanded(tree, 99999)).toBe(tree);
  });
});

describe('countNodes', () => {
  it('counts visible nodes, excluding the invisible root', () => {
    expect(countNodes(buildTraceTree(''))).toBe(0);
    expect(countNodes(simpleTree())).toBe(4);
  });

  it('matches the number of parsed lines from the real trace fixture', () => {
    const raw = readFixture('trace-sample.txt');
    expect(countNodes(buildTraceTree(raw))).toBe(parseTraceLines(raw).length);
  });
});

describe('parseSource', () => {
  it.each([
    ['../lib/dialog/stdlib.dg:4888', ['../lib/dialog/stdlib.dg', 4888]],
    ['penny.dg:60', ['penny.dg', 60]],
    ['lib/ext/tc.dg:631', ['lib/ext/tc.dg', 631]]
  ] as const)('parses %s', (source, expected) => {
    expect(parseSource(source)).toEqual(expected);
  });

  it.each(['no-colon-here', ':42', 'file.dg:not-a-number', ''])('returns null for %s', (source) => {
    expect(parseSource(source)).toBeNull();
  });
});
