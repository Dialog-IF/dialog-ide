import { TraceNode, TraceTree } from '../trace';
import { renderTraceApp, renderTracePage } from './traceRender';

function node(overrides: Partial<TraceNode>): TraceNode {
  return {
    id: 0,
    depth: 0,
    type: 'enter',
    text: null,
    source: null,
    children: [],
    expanded: true,
    match: false,
    hasMatch: false,
    ...overrides
  };
}

describe('renderTraceApp indentation', () => {
  // Regression: renderRow nests each child's .trace-node inside its parent's, so a per-node
  // `margin-left: depth * step` compounded every ancestor's offset (and node.depth is dgdebug's
  // raw stack depth, starting well above 0) - the indent blew out to hundreds of rem. Indent is
  // now one fixed CSS step on the .trace-children wrapper.
  const tree: TraceTree = new Map<number, TraceNode>([
    [0, node({ id: 0, depth: -1, type: null, children: [1] })],
    [1, node({ id: 1, depth: 3, type: 'enter', text: '(root)', source: 'stdlib.dg:100', children: [2] })],
    [2, node({ id: 2, depth: 4, type: 'query', text: '(child)', source: 'a.dg:10', children: [3] })],
    [3, node({ id: 3, depth: 5, type: 'found', text: '(grandchild)', source: 'b.dg:20', children: [] })]
  ]);

  it('carries no per-node inline margin/indent style - the staircase is CSS on .trace-children', () => {
    const html = renderTraceApp({ tree, commandLabel: 'x', sourceKnotId: null, searchTerm: '', projectRoot: '/p' });
    expect(html).not.toMatch(/margin-left/);
    expect(html).not.toMatch(/style="[^"]*rem/);
    // Top row rendered directly; its child and grandchild each sit in a .trace-children wrapper.
    expect(html.match(/class="trace-children"/g)).toHaveLength(2);
  });
});

describe('renderTracePage', () => {
  describe('theme', () => {
    it('defaults <html data-theme> to light when unspecified', () => {
      const html = renderTracePage(null);
      expect(html).toContain('<html lang="en" data-theme="light">');
    });

    it('honors an explicit dark theme', () => {
      const html = renderTracePage(null, false, 'dark');
      expect(html).toContain('<html lang="en" data-theme="dark">');
    });
  });

  describe('standalone', () => {
    it('adds data-standalone to <html> only when asked', () => {
      expect(renderTracePage(null)).not.toContain('data-standalone');
      expect(renderTracePage(null, false, 'dark', true)).toContain(
        '<html lang="en" data-theme="dark" data-standalone="true">'
      );
    });
  });
});
