/**
 * Left-pane tree graph for the Skein UI - the whole knot tree, not just the active spine.
 *
 * Ported from dialog-tool's tree_pane.clj (render-node/render-subtree/render-tree-pane) and
 * main.js's initTreeGraph()/drawTreeArrows(), adapted to SkeinTree/DerivedKnot.
 *
 * Expand/collapse (SkeinTree.toggleCollapsed/DerivedKnot.collapsed, toggled via renderTreeNode's
 * chevron) is deliberately inverted from dialog-tool's :expanded-ids: dialog-tool defaults every
 * node to collapsed and opt-in expands ancestors of the active spine, where dialog-ide defaults
 * every node to expanded (its existing "always render the full tree" behavior) and opt-in
 * collapses individual subtrees - purely additive over what was here before, not a
 * default-visibility change. The toggle is its own small button below the node pill, distinct
 * from the actions-menu trigger (renderKnotMenu) inside it - two separate concerns that shouldn't
 * share a slot. A collapsed knot's children are simply not rendered at all (not hidden via CSS),
 * so drawTreeArrows() - which only ever looks at [data-tree-node-id] elements actually in the DOM
 * - needs no changes to skip connector lines for them.
 *
 * Click-to-select and the per-knot actions menu are both wired declaratively via
 * data-on:*="@post(...)", the same Datastar pattern render.ts's command input already uses - see
 * renderTreeNode and knot-menu.ts's renderKnotMenu.
 */

import { DerivedKnot, KnotStatus, SkeinTree } from '../tree';
import { renderKnotMenu } from './knot-menu';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The active spine's knot ids, root to its *selected* leaf - used to tint off-spine nodes
 * differently from on-spine ones, matching tree_pane.clj's spine-ids'. Deliberately walks up from
 * getSelectedLeafId(), not activeKnotId: activeKnotId (since selectKnot) can be any knot navigated
 * to partway up the spine, but the spine itself - same "whole spine" render.ts's selectedKnots
 * renders into the transcript, and what Bless Transcript/replayAll operate on - always continues
 * on to whatever's already been explored past it (see getSelectedLeafId's own doc comment).
 * Starting from activeKnotId instead used to leave every already-explored knot between it and the
 * leaf marked off-spine (dim/neutral) even though the transcript still shows them as part of the
 * same spine - activeKnotId is always an ancestor of (or equal to) the selected leaf, so walking
 * up from the leaf instead still includes it and every real ancestor, just not stopping short.
 */
function spineIds(tree: SkeinTree): Set<number> {
  const ids = new Set<number>();
  let currentId: number | null = tree.getSelectedLeafId();
  while (currentId !== null) {
    ids.add(currentId);
    currentId = tree.getKnot(currentId)?.parentId ?? null;
  }
  return ids;
}

/**
 * Background/text classes for a node pill, ported from tree_pane.clj's node-color-class. Own
 * status takes priority; when own status is 'valid', a faded tint is applied based on the worst
 * descendant status so problem knots are visible from their ancestors. DerivedKnot.treeState
 * already equals "the greatest of a knot's own state and its descendants'" (see tree.ts's
 * propagateTreeState) - since 'valid' is the identity element under that max, treeState exactly
 * equals dialog-tool's separately-tracked descendant-status whenever a knot's own state is
 * 'valid', so no extra field is needed here.
 */
function nodeColorClass(status: KnotStatus, treeState: KnotStatus, onSpine: boolean, active: boolean): string {
  if (status === 'new') {
    return active
      ? 'bg-warning text-warning-content'
      : onSpine
        ? 'bg-warning/80 text-warning-content'
        : 'bg-warning/40 text-warning-content';
  }
  if (status === 'error') {
    return active
      ? 'bg-error text-error-content'
      : onSpine
        ? 'bg-error/80 text-error-content'
        : 'bg-error/40 text-error-content';
  }
  if (treeState === 'error') {
    return active
      ? 'bg-error/50 text-base-content'
      : onSpine
        ? 'bg-error/30 text-base-content'
        : 'bg-error/20 text-base-content';
  }
  if (treeState === 'new') {
    return active
      ? 'bg-warning/50 text-base-content'
      : onSpine
        ? 'bg-warning/30 text-base-content'
        : 'bg-warning/20 text-base-content';
  }
  return active
    ? 'bg-primary text-primary-content'
    : onSpine
      ? 'bg-primary-content text-primary'
      : 'bg-neutral-content text-neutral';
}

/**
 * A single node pill, with its actions menu trigger inside it (right-aligned via ml-auto).
 * data-tree-node-id/data-parent-id are read by main.js's ported drawTreeArrows() to draw
 * connector lines.
 *
 * Click-to-select and click-to-open-menu are both plain Datastar wiring: $knotId is set to this
 * knot's (literal, server-known) id and then @post() sends it straight through - the same pattern
 * the command input/navbar already use. Left-click on the pill's own body only ever selects;
 * opening the menu is only ever its "..." trigger (see session.ts's openGraphMenu doc comment) -
 * there is no right-click affordance. The trigger and every menu item stop their own click from
 * propagating, but the pill's own select-knot handler *also* checks evt.target.closest('details')
 * defensively rather than relying on that alone - belt and suspenders, since the menu is nested
 * inside the pill's clickable body either way. The pill itself is a div rather than a real
 * <button> (a <button> can't contain the nested <details> the menu needs), with role="button"/
 * tabindex/a keydown handler standing in for the native semantics/keyboard activation a real
 * button would give for free. The menu itself (renderKnotMenu) is inline, native <details> markup
 * positioned by plain CSS - no custom JS needed to open or position it.
 *
 * The expand/collapse chevron only renders when the knot actually has children (nothing to
 * toggle otherwise) - a small ghost button below the pill, matching tree_pane.clj's placement
 * and sizing (btn-xs). ▾ (expanded, pointing down at the children below) / ▸ (collapsed,
 * pointing at what's hidden) mirrors dialog-tool exactly; a plain Unicode glyph rather than a new
 * SVG/.icon-* asset since none of the existing icons are a bare single chevron.
 */
function renderTreeNode(tree: SkeinTree, knot: DerivedKnot, spine: Set<number>, activeKnotId: number | null, graphMenuId: number | null): string {
  const active = knot.id === activeKnotId;
  const hasChildren = knot.children.length > 0;
  const collapsed = knot.collapsed;
  const onSpine = spine.has(knot.id);
  const colorClass = nodeColorClass(knot.state, knot.treeState, onSpine, active);
  const borderClass = active ? 'border-primary' : 'border-transparent';

  const statusIcon =
    knot.state === 'new'
      ? '<div class="icon icon-warning w-3 h-3 shrink-0" aria-hidden="true"></div>'
      : knot.state === 'error'
        ? '<div class="icon icon-error w-3 h-3 shrink-0" aria-hidden="true"></div>'
        : '';
  const lockIcon = knot.locked ? '<div class="icon icon-lock w-3 h-3 shrink-0" aria-hidden="true"></div>' : '';
  const labelChip = knot.label
    ? `<span class="text-xs font-bold bg-neutral text-neutral-content px-1 rounded shrink-0">${escapeHtml(knot.label)}</span>`
    : '';
  // The root knot's "command" is a synthetic placeholder (tree.ts's newTree bakes in
  // command: 'START', label: 'START' - there's no real typed command to show), so showing it
  // as a second span next to the labelChip above just duplicates the same word ("START START").
  // Every other knot's label (if any) and command are genuinely different text, so only root
  // (parentId === null) needs to suppress the command span.
  const commandLabel =
    knot.parentId !== null ? `<span class="truncate font-mono text-xs">${escapeHtml(knot.command)}</span>` : '';
  const statusSuffix = knot.state === 'new' ? ' (new)' : knot.state === 'error' ? ' (error)' : '';
  const parentAttr = knot.parentId !== null ? ` data-parent-id="${knot.parentId}"` : '';
  const selectCall = `$knotId = ${knot.id}; @post('/actions/select-knot')`;
  const toggleButton = hasChildren
    ? `<button type="button" class="btn btn-xs btn-ghost py-0 px-1 min-h-0 h-5 leading-none"
    aria-label="${collapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!collapsed}"
    data-on:click="$knotId = ${knot.id}; @post('/actions/toggle-tree-node')">${collapsed ? '&#9656;' : '&#9662;'}</button>`
    : '';

  return `<div class="flex flex-col items-center gap-1"
    data-knot-id="${knot.id}">
  <div role="button" tabindex="0"
    class="flex flex-row items-center gap-1 px-2 py-1 rounded-lg border-2 cursor-pointer select-none text-sm min-w-16 max-w-48 ${colorClass} ${borderClass}"
    data-tree-node-id="${knot.id}"${parentAttr}
    data-on:click="if (!evt.target.closest('details')) { ${selectCall} }"
    data-on:keydown="if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); ${selectCall} }"
    aria-label="${escapeHtml(knot.command)}${statusSuffix}"
    aria-pressed="${active}">${statusIcon}${lockIcon}${labelChip}${commandLabel}<span class="ml-auto">${renderKnotMenu(knot.id, knot.unblessedResponse !== null, knot.id === graphMenuId, '/actions/open-graph-menu', active, knot.label, knot.command, 'compact', tree.promptTypeAt(knot.parentId) === 'key')}</span></div>
  ${toggleButton}
</div>`;
}

function renderSubtree(
  tree: SkeinTree,
  knotId: number,
  spine: Set<number>,
  activeKnotId: number | null,
  graphMenuId: number | null
): string {
  const knot = tree.getDerivedKnot(knotId)!;
  const children = knot.children
    .map((id) => tree.getDerivedKnot(id)!)
    .sort((a, b) => a.command.localeCompare(b.command));

  let childrenHtml = '';
  if (children.length > 0 && !knot.collapsed) {
    if (children.length === 1) {
      childrenHtml = renderSubtree(tree, children[0].id, spine, activeKnotId, graphMenuId);
    } else {
      childrenHtml = `<div class="flex flex-row items-start gap-6">
${children.map((child) => `<div class="flex flex-col items-center">${renderSubtree(tree, child.id, spine, activeKnotId, graphMenuId)}</div>`).join('\n')}
</div>`;
    }
  }

  return `<div class="flex flex-col items-center gap-10 min-w-max">
${renderTreeNode(tree, knot, spine, activeKnotId, graphMenuId)}
${childrenHtml}
</div>`;
}

/**
 * The full tree pane. data-init runs main.js's ported initTreeGraph() once on mount, which draws
 * the SVG connector lines (and keeps them redrawn on DOM/size changes) and enables drag-to-pan -
 * see main.js for why a separate window-resize binding isn't needed on top of that.
 */
export function renderTreePane(tree: SkeinTree, graphMenuId: number | null = null): string {
  const activeKnotId = tree.getActiveKnotId();
  return `<div id="tree-pane"
  class="overflow-x-auto overflow-y-auto p-4 relative bg-base-200 h-full cursor-grab"
  data-active-knot="${activeKnotId ?? ''}"
  data-init="sk.initTreeGraph()">
${renderSubtree(tree, 0, spineIds(tree), activeKnotId, graphMenuId)}
</div>`;
}
