/**
 * HTML rendering for the Trace panel - a second, independent webview (see extension.ts's
 * TraceViewProvider) served by the same local HTTP service as the main skein transcript, using
 * the same Datastar/SSE approach (render.ts's own doc comment). Deliberately not a section of
 * the main transcript page: it lives in its own native VS Code panel-area view, next to
 * Terminal/Output/Debug Console.
 */

import * as path from 'path';
import { getNode, TraceNode, TraceTree } from '../trace';

/** service.ts's currently-held trace result - null when nothing has been traced yet. */
export interface CurrentTraceState {
  tree: TraceTree;
  commandLabel: string;
  sourceKnotId: number | null;
  searchTerm: string;
  /** The active session's project root - used only to display/click-resolve each row's source
   *  path relative to it (dgdebug's own trace output mixes absolute and "../"-relative paths
   *  depending on how each source group was passed on its command line - see process.ts's
   *  buildCommand - so this normalizes both into one consistent, readable relative form). */
  projectRoot: string;
}

const TYPE_BADGE_CLASS: Record<string, string> = {
  enter: 'badge-info',
  query: 'badge-neutral',
  found: 'badge-success',
  now: 'badge-warning'
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "file.dg:42" -> {file: "file.dg", line: 42}, or null if it doesn't parse that way. */
function splitSource(source: string): { file: string; line: number } | null {
  const idx = source.lastIndexOf(':');
  if (idx <= 0) {
    return null;
  }
  const line = parseInt(source.slice(idx + 1), 10);
  return Number.isNaN(line) ? null : { file: source.slice(0, idx), line };
}

/**
 * Normalizes a trace node's raw source ("file:line", file possibly absolute or "../"-relative
 * depending on how dgdebug was given that source file) into a path relative to the project
 * root, for both display and the row's data-file (path.resolve/path.relative are proper
 * inverses, so extension.ts's path.join(projectRoot, file) round-trips this correctly even when
 * the original was already relative or pointed outside the project root, e.g. a vendored
 * stdlib).
 */
function relativizeSource(source: string, projectRoot: string): { file: string; line: number } | null {
  const parsed = splitSource(source);
  if (!parsed) {
    return null;
  }
  const resolved = path.resolve(projectRoot, parsed.file);
  return { file: path.relative(projectRoot, resolved), line: parsed.line };
}

function renderRow(tree: TraceTree, node: TraceNode, projectRoot: string): string {
  const hasChildren = node.children.length > 0;
  const chevron = hasChildren ? (node.expanded ? '▾' : '▸') : '';
  const badgeClass = node.type ? TYPE_BADGE_CLASS[node.type] : '';
  const displaySource = node.source ? relativizeSource(node.source, projectRoot) : null;
  const sourceAttrs = displaySource
    ? ` data-node-id="${node.id}" data-file="${escapeHtml(displaySource.file)}" data-line="${displaySource.line}"`
    : '';
  const rowClass = ['trace-row', node.match ? 'trace-row-match' : ''].filter(Boolean).join(' ');

  const childrenHtml =
    hasChildren && node.expanded
      ? `<div class="trace-children">${node.children.map((id) => renderRow(tree, getNode(tree, id)!, projectRoot)).join('')}</div>`
      : '';

  return `<div class="trace-node" style="margin-left: ${node.depth * 1.25}rem;">
  <div class="${rowClass}"${sourceAttrs}>
    ${
      hasChildren
        ? `<button type="button" class="trace-chevron" data-on:click="$nodeId = ${node.id}; @post('/actions/trace-toggle-node')" aria-label="${node.expanded ? 'Collapse' : 'Expand'}">${chevron}</button>`
        : `<span class="trace-chevron"></span>`
    }
    ${node.type ? `<span class="badge badge-xs ${badgeClass}">${node.type.toUpperCase()}</span>` : ''}
    <span class="trace-text font-mono">${escapeHtml(node.text ?? '')}</span>
    ${displaySource ? `<span class="trace-source font-mono">${escapeHtml(`${displaySource.file}:${displaySource.line}`)}</span>` : ''}
  </div>
  ${childrenHtml}
</div>`;
}

/**
 * The #trace-app patch target - service.ts's broadcastTrace re-renders this on every trace
 * mutation (a new trace, search, toggle, expand/collapse-all) and sends it as a Datastar
 * datastar-patch-elements event over /trace/events. loading is true for the window between a
 * trace-knot/trace-startup request landing and its (potentially several seconds - a real replay
 * plus a real dgdebug round trip) result coming back - service.ts broadcasts this immediately,
 * before doing any of that work, specifically so the panel shows something right away instead
 * of looking like nothing happened until it's already done.
 */
export function renderTraceApp(state: CurrentTraceState | null, loading: boolean = false): string {
  if (loading) {
    return `<div id="trace-app" class="p-4 flex items-center gap-3 text-base-content/60">
  <span class="loading loading-spinner loading-md"></span>
  <span>Tracing…</span>
</div>`;
  }

  if (!state) {
    return '<div id="trace-app" class="p-4 text-base-content/60">No trace yet - right-click a knot and choose Trace, or use Trace Startup.</div>';
  }

  const root = getNode(state.tree, 0);
  const rows = root
    ? root.children.map((id) => renderRow(state.tree, getNode(state.tree, id)!, state.projectRoot)).join('')
    : '';

  return `<div id="trace-app" class="h-full flex flex-col">
  <div class="flex items-center gap-2 p-2 border-b border-base-200 shrink-0">
    <label class="input input-sm flex items-center gap-2 flex-1">
      <div class="icon icon-search w-3 h-3 opacity-60" aria-hidden="true"></div>
      <input type="search" placeholder="Filter trace…" value="${escapeHtml(state.searchTerm)}"
        data-bind="searchTerm" data-on:input__debounce.300ms="@post('/actions/trace-search')" />
    </label>
    <button type="button" class="btn btn-sm btn-ghost" data-on:click="@post('/actions/trace-expand-all')">Expand All</button>
    <button type="button" class="btn btn-sm btn-ghost" data-on:click="@post('/actions/trace-collapse-all')">Collapse All</button>
    <span class="text-sm text-base-content/60 font-mono truncate">${escapeHtml(state.commandLabel)}</span>
  </div>
  <div id="trace-tree" class="flex-1 overflow-auto p-2 text-sm">
    ${rows}
  </div>
  <div id="trace-source-popover" popover="manual" class="trace-source-popover"></div>
</div>`;
}

export function renderTracePage(state: CurrentTraceState | null, loading: boolean = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Trace</title>
<link rel="stylesheet" href="/style.css" />
<script type="module" src="/js/datastar.js"></script>
<script type="module" src="/js/trace.js"></script>
</head>
<body data-init="@get('/trace/events', {openWhenHidden: true})" class="h-screen">
${renderTraceApp(state, loading)}
</body>
</html>`;
}
