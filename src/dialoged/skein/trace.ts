/**
 * Trace output parsing for the Skein engine.
 * Parses dgdebug's `(trace on)`/`--trace` output into a flat, searchable node tree, matching
 * dialog-tool's skein/trace.clj (dgdebug-only; verified against its real trace.txt fixture -
 * see trace.spec.ts). Ephemeral: a trace tree is wholesale-regenerated per trace and never
 * touches SkeinTree - it's a side query, not a tree mutation (see session.ts's traceKnot).
 *
 * Trace output lines have the format:
 *   |N TYPE predicate source:line
 * where N is the numeric nesting depth, TYPE is ENTER/QUERY/FOUND/NOW, predicate is the Dialog
 * predicate being traced, and source:line is where it's defined. Lines that don't match this
 * shape (blank lines, plain game text printed mid-trace) are silently dropped.
 *
 * Node 0 is an invisible root whose children are the top-level nodes. Tree structure comes
 * purely from comparing each line's numeric depth to its neighbors - a node's children are the
 * immediately-following lines whose depth is strictly greater than its own, not ENTER/FOUND
 * pair-matching (this also means a FOUND with no earlier matching ENTER, e.g. because tracing
 * started partway through a call, is handled the same as everything else: it's just a node).
 */

export type TraceLineType = 'enter' | 'query' | 'found' | 'now';

export interface TraceNode {
  id: number;
  depth: number; // -1 for the synthetic root (id 0)
  type: TraceLineType | null; // null for root
  text: string | null; // predicate S-expr, e.g. "(get input [i])" - null for root
  source: string | null; // raw "file:line", e.g. "../lib/dialog/stdlib.dg:4888" - null for root
  children: number[];
  expanded: boolean;
  match: boolean;
  hasMatch: boolean;
}

export type TraceTree = Map<number, TraceNode>;

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const TRACE_LINE_RE = /^\|\s*(\d+)\s+(ENTER|QUERY|FOUND|NOW)\s+(.+?)\s+(\S+:\d+)$/;

export interface TraceLine {
  depth: number;
  type: TraceLineType;
  text: string;
  source: string;
}

function parseTraceLine(line: string): TraceLine | null {
  const cleaned = line.replace(ANSI_RE, '').trim();
  const match = TRACE_LINE_RE.exec(cleaned);
  if (!match) {
    return null;
  }
  const [, depthStr, type, text, source] = match;
  return { depth: parseInt(depthStr, 10), type: type.toLowerCase() as TraceLineType, text, source };
}

/** Extracts and parses trace lines from a raw dgdebug response, dropping everything else. */
export function parseTraceLines(rawResponse: string): TraceLine[] {
  const lines: TraceLine[] = [];
  for (const line of rawResponse.split('\n')) {
    const parsed = parseTraceLine(line);
    if (parsed) {
      lines.push(parsed);
    }
  }
  return lines;
}

function makeNode(id: number, line: TraceLine, children: number[]): TraceNode {
  return {
    id,
    depth: line.depth,
    type: line.type,
    text: line.text,
    source: line.source,
    children,
    expanded: false,
    match: false,
    hasMatch: false
  };
}

/**
 * Partitions lines[start, end) at minLevel: each line at exactly minLevel becomes a node in the
 * returned id list, and every line following it up to (but not including) the next line at
 * minLevel or shallower becomes that node's descendants (recursed one level deeper). Mirrors
 * trace.clj's build-tree* line-for-line.
 */
function buildLevel(lines: TraceLine[], start: number, end: number, minLevel: number, nodes: Map<number, TraceNode>, nextId: { value: number }): number[] {
  const result: number[] = [];
  let idx = start;
  while (idx < end) {
    const line = lines[idx];
    if (line.depth < minLevel) {
      break;
    }
    const id = ++nextId.value;
    const childLevel = line.depth + 1;
    const childStart = idx + 1;
    let childEnd = childStart;
    while (childEnd < end && lines[childEnd].depth >= childLevel) {
      childEnd++;
    }
    const children = childStart < childEnd ? buildLevel(lines, childStart, childEnd, childLevel, nodes, nextId) : [];
    nodes.set(id, makeNode(id, line, children));
    result.push(id);
    idx = childEnd;
  }
  return result;
}

/**
 * Parses a raw dgdebug response (containing trace-tagged lines, possibly interleaved with
 * plain game text) into a flat TraceTree keyed by id, with an invisible root at id 0.
 */
export function buildTraceTree(rawResponse: string): TraceTree {
  const lines = parseTraceLines(rawResponse);
  const nodes: Map<number, TraceNode> = new Map();
  if (lines.length === 0) {
    nodes.set(0, { id: 0, depth: -1, type: null, text: null, source: null, children: [], expanded: false, match: false, hasMatch: false });
    return nodes;
  }
  const minLevel = Math.min(...lines.map((line) => line.depth));
  const nextId = { value: 0 };
  const rootChildren = buildLevel(lines, 0, lines.length, minLevel, nodes, nextId);
  nodes.set(0, { id: 0, depth: -1, type: null, text: null, source: null, children: rootChildren, expanded: false, match: false, hasMatch: false });
  return nodes;
}

export function getNode(tree: TraceTree, id: number): TraceNode | undefined {
  return tree.get(id);
}

/** Counts visible nodes (excludes the invisible root). */
export function countNodes(tree: TraceTree): number {
  return tree.size - 1;
}

function mapNodes(tree: TraceTree, fn: (node: TraceNode) => TraceNode): TraceTree {
  const result: TraceTree = new Map();
  for (const [id, node] of tree) {
    result.set(id, fn(node));
  }
  return result;
}

export function expandAll(tree: TraceTree): TraceTree {
  return mapNodes(tree, (node) => ({ ...node, expanded: node.children.length > 0 }));
}

export function collapseAll(tree: TraceTree): TraceTree {
  return mapNodes(tree, (node) => ({ ...node, expanded: false }));
}

export function toggleExpanded(tree: TraceTree, id: number): TraceTree {
  const node = tree.get(id);
  if (!node) {
    return tree;
  }
  const result = new Map(tree);
  result.set(id, { ...node, expanded: !node.expanded });
  return result;
}

function nodeMatches(node: TraceNode, term: string): boolean {
  const lowerTerm = term.toLowerCase();
  return (node.text ?? '').toLowerCase().includes(lowerTerm) || (node.source ?? '').toLowerCase().includes(lowerTerm);
}

/**
 * Marks every node with `match` (direct match on text/source) and `hasMatch` (match, or any
 * descendant matches). A blank search term clears both flags on every node - a deliberate
 * deviation from trace.clj's search-tree, which leaves stale flags in place when given a blank
 * term; here, clearing the search box should visibly clear highlighting too.
 */
export function searchTree(tree: TraceTree, searchTerm: string): TraceTree {
  if (searchTerm.trim() === '') {
    return mapNodes(tree, (node) => ({ ...node, match: false, hasMatch: false }));
  }

  const withMatches = mapNodes(tree, (node) => ({ ...node, match: nodeMatches(node, searchTerm) }));
  const hasMatchCache = new Map<number, boolean>();

  const computeHasMatch = (id: number): boolean => {
    const cached = hasMatchCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const node = withMatches.get(id)!;
    const result = node.match || node.children.some(computeHasMatch);
    hasMatchCache.set(id, result);
    return result;
  };

  for (const id of withMatches.keys()) {
    computeHasMatch(id);
  }

  return mapNodes(withMatches, (node) => ({ ...node, hasMatch: hasMatchCache.get(node.id) ?? false }));
}

/**
 * Sets `expanded` true on every node with hasMatch that has children, false otherwise. The
 * tree must have already been processed by searchTree.
 */
export function expandToMatches(tree: TraceTree): TraceTree {
  return mapNodes(tree, (node) => ({ ...node, expanded: node.hasMatch && node.children.length > 0 }));
}

/** Depth-first walk from the root, returning the id of the first node with match true. */
export function findFirstMatch(tree: TraceTree): number | null {
  const root = tree.get(0);
  if (!root) {
    return null;
  }

  const dfs = (ids: number[]): number | null => {
    for (const id of ids) {
      const node = tree.get(id)!;
      if (node.match) {
        return id;
      }
      const found = dfs(node.children);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  return dfs(root.children);
}

/** Parses "file.dg:42" into ["file.dg", 42], or null if it doesn't have that shape. */
export function parseSource(source: string): [string, number] | null {
  const idx = source.lastIndexOf(':');
  if (idx <= 0) {
    return null;
  }
  const filePath = source.slice(0, idx);
  const lineStr = source.slice(idx + 1);
  const line = parseInt(lineStr, 10);
  if (!/^\d+$/.test(lineStr) || Number.isNaN(line)) {
    return null;
  }
  return [filePath, line];
}
