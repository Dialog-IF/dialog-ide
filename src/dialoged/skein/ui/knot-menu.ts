/**
 * The per-knot actions menu, shared by the tree pane (tree-pane.ts) and the transcript
 * (render.ts). Rendered inline as part of that knot's own markup - a native <details class=
 * "dropdown"> whose `open` attribute the server sets directly stays the single source of truth
 * for open/closed (session.ts's graphMenuId/transcriptMenuId, unchanged - see its own doc
 * comment). Every item bakes this knot's own (literal, server-known) id directly into its
 * data-on:click, the same $knotId = N; @post(url) pattern used everywhere else in this UI - no
 * custom JS dispatch, no shared client-side state to keep in sync.
 *
 * The dropdown-content <ul> is *also* a native popover ([popover] + id, toggled via el.togglePopover
 * (isOpen) in a data-effect reacting to the server-rendered open/closed boolean baked directly into
 * that expression - the only bit of "JS" involved, one declarative line, not a positioning
 * algorithm). This is what actually makes the menu render above everything: a plain positioned
 * descendant (even position:fixed) is still confined to whatever stacking context its ancestors
 * establish, and #tree-pane-outer is position:sticky - which *always* creates one, regardless of
 * its own z-index - so a menu nested inside it could never out-rank the transcript column next to
 * it, no matter how high its own z-index was set (confirmed with a headless-browser stacking trace:
 * a transcript status icon with computed z-index:auto was still painting over a nested
 * position:fixed menu with z-index:10). The Popover API's top layer is a separate compositing
 * layer above the entire document, bypassing every ancestor stacking context outright - the only
 * mechanism that actually solves this without relocating the DOM node via custom JS.
 *
 * popover="manual", not the default "auto": an "auto" popover has its own built-in light-dismiss
 * (closes itself on outside pointerdown, and on Escape) that runs entirely in the browser, with
 * no JS involved and nothing to tell the server about it. Originally openGraphMenu/
 * openTranscriptMenu just unconditionally set the id, so a second click on an already-open
 * trigger never changed graphMenuId/transcriptMenuId at all - the re-rendered markup was
 * byte-for-byte identical, so the patched-in data-effect string never changed either, and
 * Datastar only re-runs an attribute's effect when the attribute's value actually changes (see
 * datastar.js's morph/attribute-patch code). That first click's "auto" light-dismiss (fired by
 * the very next outside click, including the trigger itself) would silently close the popover
 * client-side while the server still believed it was open - and because the server's id genuinely
 * hadn't changed, nothing would ever force a resync: one click opened it, the next closed it (via
 * the browser, not us), and the one after that appeared to do nothing, since server state hadn't
 * actually moved. Making the routes real toggles (session.ts's openGraphMenu/openTranscriptMenu)
 * fixes the "nothing happens" half by guaranteeing every click is a real state transition; "manual"
 * fixes the rest by removing every implicit, un-reported way the popover could close itself
 * (outside click, Escape) so el.togglePopover(isOpen) is the *only* thing that ever opens or
 * closes it and the visible state can never drift from graphMenuId/transcriptMenuId. The
 * outside-click-closes behavior a user would expect from "auto" is provided explicitly instead -
 * see the document click listener in main.js, which now closes the popover itself, not just the
 * <details> element.
 *
 * direction ('right' for the tree pane, 'left' for the transcript - see tree-pane.ts/render.ts's
 * call sites) picks which of daisyUI's dropdown-left/dropdown-right modifiers to use (see
 * node_modules/daisyui/components/dropdown.css) - which side the menu opens on relative to its
 * trigger. The transcript is the right-hand column, so its trigger sits near the window's right
 * edge; opening rightward there ran the menu off-screen, hence 'left' for that pane.
 *
 * position:fixed + real CSS anchor positioning (anchor-name/position-anchor, both real, current
 * CSS - see https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning) replaces
 * daisyUI's own plain `position:absolute` for just this dropdown-content (see the
 * .knot-menu-popover override in styles/input.css): an absolutely-positioned descendant is
 * clipped by any scrolling ancestor's overflow (the tree pane's own overflow-x/y-auto), but a
 * fixed-positioned one anchored the same way is not - confirmed with a headless-browser check
 * (position:absolute inside a scroller got visibly clipped; position:fixed with the same
 * anchor-name/position-anchor did not) before relying on it here. daisyUI's dropdown-left/
 * dropdown-right classes already compute a `position-area` custom property pair for exactly this
 * purpose, so switching position from absolute to fixed and supplying position-anchor is the only
 * change needed - the direction/side logic itself is untouched. position-try-fallbacks:flip-inline
 * lets the browser flip sides on its own if the chosen one would still overflow the viewport,
 * without needing per-pane hardcoding to be exactly right in every scroll position.
 *
 * Each trigger's anchor-name has to be unique among everything simultaneously in the DOM (every
 * knot's menu exists in the markup at once, just hidden when closed) - id + pane keeps a graph-
 * pane and transcript menu for the *same* knot from colliding.
 *
 * Opening the menu (its "..." trigger, nothing else - there is no right-click affordance) posts
 * to openRoute - /actions/open-graph-menu or /actions/open-transcript-menu - every time it's
 * clicked, including to close its own already-open menu (a real toggle server-side, see
 * session.ts's openGraphMenu doc comment for why that's load-bearing, not just nicer UX), tracked
 * as two separate ids on SkeinSession (graphMenuId/transcriptMenuId) precisely so the graph pane
 * and the transcript never open each other's menu just because they happen to show the same knot.
 * Deliberately does NOT change the active knot - see session.ts's openGraphMenu doc comment.
 *
 * The trigger and every item below stop the click from propagating (Datastar's __stop modifier -
 * see media/js/datastar.js's "on" plugin, which calls evt.stopPropagation() before running the
 * expression): this menu is rendered *inside* the knot's own clickable body (which selects the
 * knot on click), so without this a click on the trigger or any item would also fire that outer
 * select-knot handler. The trigger also uses __prevent: clicking a <summary> natively toggles its
 * <details> open/closed as a browser default action, independent of any JS - without
 * preventDefault() that native toggle races the server round-trip that's the actual source of
 * truth for `open` (graphMenuId/transcriptMenuId), which can flip the menu shut right after the
 * click and then have it reappear (or not) once the SSE patch lands.
 *
 * font-sans on the <details> itself: the transcript nests this menu inside a changed knot's
 * response container, which is font-mono there (see render.ts's monoClass) so the diff text lines
 * up - but menu labels aren't diff text and shouldn't inherit that. Setting it directly here (not
 * relying on some ancestor never being mono) keeps the menu's own font independent of whatever
 * happens to contain it.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function menuItemClass(disabled: boolean): string {
  return disabled ? ' class="menu-disabled"' : '';
}

function menuItemAttrs(disabled: boolean): string {
  return disabled ? ' disabled' : '';
}

export type KnotMenuOpenRoute = '/actions/open-graph-menu' | '/actions/open-transcript-menu';

const PANE_CONFIG: Record<KnotMenuOpenRoute, { pane: string; directionClass: string }> = {
  '/actions/open-graph-menu': { pane: 'graph', directionClass: 'dropdown-right' },
  '/actions/open-transcript-menu': { pane: 'transcript', directionClass: 'dropdown-left' }
};

// Trigger button + icon sizing for the "..." menu trigger. 'compact' (the tree pane's tight,
// fixed-width node pills - see tree-pane.ts's own min-w-16/max-w-48) keeps the original tiny
// footprint; 'prominent' (the transcript's floatCluster - see render.ts's renderKnot) is a touch
// bigger and carries a persistent faint backdrop (the same 10% base-content tint daisyUI's own
// .btn-ghost only applies on hover - see button.css - made permanent here instead) so the trigger
// reads as a real, findable control sitting on the transcript's plain bg-base-100 rather than
// disappearing into it until the mouse happens to land on it.
const TRIGGER_SIZE_CLASSES: Record<'compact' | 'prominent', { button: string; icon: string }> = {
  compact: { button: 'btn btn-xs btn-ghost py-0 px-0.5 min-h-0 h-4 w-4 leading-none', icon: 'icon icon-dots-vertical w-3 h-3' },
  prominent: {
    button: 'btn btn-xs btn-ghost py-0 px-1 min-h-0 h-6 w-6 leading-none bg-base-content/10',
    icon: 'icon icon-dots-vertical w-4 h-4'
  }
};

/**
 * hint(label, key) - the keyboard-shortcut title suffix for a menu item, shown only when isActive
 * (main.js's Option+letter accelerators always act on the active knot - see its own doc comment -
 * so a hint on every knot's copy of this menu, active or not, would misleadingly imply the
 * shortcut acts on whichever knot's menu happens to be open).
 */
export function renderKnotMenu(
  id: number,
  hasUnblessed: boolean,
  isOpen: boolean,
  openRoute: KnotMenuOpenRoute,
  isActive: boolean = false,
  currentLabel: string | null = null,
  currentCommand: string | null = null,
  triggerSize: 'compact' | 'prominent' = 'compact'
): string {
  const isRoot = id === 0;
  const { pane, directionClass } = PANE_CONFIG[openRoute];
  const anchorName = `--knot-menu-${pane}-${id}`;
  const popoverId = `knot-menu-${pane}-${id}`;
  const hint = (label: string, key: string): string => (isActive ? ` title="${label} (${key})"` : '');
  const { button: triggerButtonClass, icon: triggerIconClass } = TRIGGER_SIZE_CLASSES[triggerSize];

  return `<details class="dropdown ${directionClass} font-sans"${isOpen ? ' open' : ''} style="anchor-name: ${anchorName}">
  <summary tabindex="0" role="button" class="${triggerButtonClass}"
    data-on:click__prevent__stop="$knotId = ${id}; @post('${openRoute}')" aria-label="Knot actions">
    <div class="${triggerIconClass}" aria-hidden="true"></div>
  </summary>
  <ul id="${popoverId}" popover="manual" tabindex="0" role="menu" class="dropdown-content knot-menu-popover menu bg-base-100 rounded-box p-2 w-52 shadow-xl z-10"
    style="position-anchor: ${anchorName}"
    data-effect="el.togglePopover(${isOpen})"
    data-on:click__stop="void 0">
    <li${menuItemClass(!hasUnblessed)}><button type="button" role="menuitem"${hint('Bless Knot', '⌥B')}${menuItemAttrs(!hasUnblessed)} data-on:click="$knotId = ${id}; @post('/actions/bless-knot')">Bless Knot</button></li>
    <li><button type="button" role="menuitem"${hint('New Child', '⌥A')} data-on:click="$knotId = ${id}; @post('/actions/new-child')">New Child</button></li>
    <li><button type="button" role="menuitem"${hint('Replay to Here', '⌥R')} data-on:click="$knotId = ${id}; @post('/actions/replay-to')">Replay to Here</button></li>
    <li><button type="button" role="menuitem"${hint('Trace', '⌥T')} data-on:click="${isRoot ? `@post('/actions/trace-startup')` : `$knotId = ${id}; @post('/actions/trace-knot')`}">Trace</button></li>
    <li${menuItemClass(isRoot)}><button type="button" role="menuitem"${hint('Edit Label', '⌥L')}${menuItemAttrs(isRoot)}
      data-current-label="${escapeHtml(currentLabel ?? '')}"
      data-on:click="sk.showLabelModal(${id}, el.dataset.currentLabel)">Edit Label&hellip;</button></li>
    <li${menuItemClass(isRoot)}><button type="button" role="menuitem"${hint('Edit Command', '⌥E')}${menuItemAttrs(isRoot)}
      data-current-command="${escapeHtml(currentCommand ?? '')}"
      data-on:click="sk.showCommandModal(${id}, el.dataset.currentCommand)">Edit Command&hellip;</button></li>
    <li${menuItemClass(isRoot)}><button type="button" role="menuitem"${hint('Toggle Lock', '⌥K')}${menuItemAttrs(isRoot)} data-on:click="$knotId = ${id}; @post('/actions/toggle-lock')">Toggle Lock</button></li>
    <li${menuItemClass(isRoot)}><button type="button" role="menuitem"${menuItemAttrs(isRoot)} data-on:click="$knotId = ${id}; @post('/actions/splice-knot')">Splice Out</button></li>
    <li${menuItemClass(isRoot)}><button type="button" role="menuitem"${hint('Delete', '⌥D')}${menuItemAttrs(isRoot)} data-on:click="$knotId = ${id}; @post('/actions/delete-knot')">Delete</button></li>
  </ul>
</details>`;
}
