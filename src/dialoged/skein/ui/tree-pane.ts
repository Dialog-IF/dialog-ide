/**
 * Left-pane tree graph for the Skein UI - the whole knot tree, not just the active spine.
 *
 * Ported from dialog-tool's tree_pane.clj (render-node/render-subtree/render-tree-pane) and
 * main.js's initTreeGraph()/drawTreeArrows(), adapted to SkeinTree/DerivedKnot. One deliberate
 * simplification: dialog-tool's expand/collapse-per-node state (:expanded-ids) has no equivalent
 * in SkeinTree yet, so this always renders the full tree - fine for the tree sizes dialog-ide
 * deals with today; worth revisiting if that changes. When it does, expand/collapse needs its
 * own icon/toggle distinct from the actions-menu trigger (renderKnotMenu) - the two are separate
 * concerns and shouldn't share a slot.
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
 * The active spine's knot ids, root to active leaf - used to tint off-spine nodes differently
 * from on-spine ones, matching tree_pane.clj's spine-ids'.
 */
function spineIds(tree: SkeinTree): Set<number> {
  const ids = new Set<number>();
  let currentId = tree.getActiveKnotId();
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
 */
function renderTreeNode(knot: DerivedKnot, spine: Set<number>, activeKnotId: number | null, graphMenuId: number | null): string {
  const active = knot.id === activeKnotId;
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
  const statusSuffix = knot.state === 'new' ? ' (new)' : knot.state === 'error' ? ' (error)' : '';
  const parentAttr = knot.parentId !== null ? ` data-parent-id="${knot.parentId}"` : '';
  const selectCall = `$knotId = ${knot.id}; @post('/actions/select-knot')`;

  return `<div class="flex flex-col items-center gap-1"
    data-knot-id="${knot.id}">
  <div role="button" tabindex="0"
    class="flex flex-row items-center gap-1 px-2 py-1 rounded-lg border-2 cursor-pointer select-none text-sm min-w-16 max-w-48 ${colorClass} ${borderClass}"
    data-tree-node-id="${knot.id}"${parentAttr}
    data-on:click="if (!evt.target.closest('details')) { ${selectCall} }"
    data-on:keydown="if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); ${selectCall} }"
    aria-label="${escapeHtml(knot.command)}${statusSuffix}"
    aria-pressed="${active}">${statusIcon}${lockIcon}${labelChip}<span class="truncate font-mono text-xs">${escapeHtml(knot.command)}</span><span class="ml-auto">${renderKnotMenu(knot.id, knot.unblessedResponse !== null, knot.id === graphMenuId, '/actions/open-graph-menu')}</span></div>
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
  if (children.length === 1) {
    childrenHtml = renderSubtree(tree, children[0].id, spine, activeKnotId, graphMenuId);
  } else if (children.length > 1) {
    childrenHtml = `<div class="flex flex-row items-start gap-6">
${children.map((child) => `<div class="flex flex-col items-center">${renderSubtree(tree, child.id, spine, activeKnotId, graphMenuId)}</div>`).join('\n')}
</div>`;
  }

  return `<div class="flex flex-col items-center gap-10 min-w-max">
${renderTreeNode(knot, spine, activeKnotId, graphMenuId)}
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
