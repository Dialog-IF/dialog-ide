/**
 * HTML rendering for the Skein web UI - navbar + linear transcript (the active spine, root to
 * active leaf). Mirrors dialog-tool's app.clj navbar/render-knot markup and Tailwind/DaisyUI
 * class names closely; media/style.css is generated from styles/input.css by a real Tailwind
 * build (`npm run build:css`) that scans this project's own source, so any class used here is
 * automatically included - no more guessing whether a class happens to exist in a frozen,
 * vendored-from-elsewhere stylesheet.
 */

import { DynamicProcessor, DynamicState } from '../dynamic';
import { EngineType } from '../process';
import { DerivedKnot, KnotStatus, SkeinTree } from '../tree';
import { ansiToHtml, ansiToMarkers } from './ansi';
import { DiffSegment, diffText } from './diff';
import { renderKnotMenu } from './knot-menu';
import { renderTreePane } from './tree-pane';

export interface SessionDisplayInfo {
  sessionId: string;
  engine: EngineType;
  seed: number;
}

const STATUS_BORDER_CLASS: Record<KnotStatus, string> = {
  valid: 'border-base-300',
  new: 'border-warning',
  error: 'border-error'
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Makes whitespace visible within an added/removed diff segment, matching dialog-tool's
 * app.clj visible-whitespace: spaces become a middle-dot + zero-width space (so the browser
 * still gets a soft-wrap point), newlines become "↵" followed by the real newline. Applied only
 * within diff spans, not to unchanged text, same as dialog-tool.
 */
function visibleWhitespace(text: string): string {
  return text.replace(/ /g, '·​').replace(/\n/g, '↵\n');
}

const DIFF_SEGMENT_CLASS: Record<'added' | 'removed', string> = {
  added: 'text-info font-bold',
  removed: 'text-error font-bold line-through'
};

/**
 * Renders a knot's current text as a diff between its blessed response and any pending
 * unblessed one, matching dialog-tool's render-diff exactly: with nothing pending, the settled
 * response renders with real ANSI styling (bold, color...); with something pending (whether or
 * not there's a blessed response to compare against - a never-blessed knot has none, and diffs
 * as fully "added"), both sides are first converted to ANSI markers ("[B]...[/B]") since the
 * diff spans would override real styling anyway, then diffed word-by-word.
 */
function renderDiff(response: string | null, unblessedResponse: string | null): string {
  if (unblessedResponse === null) {
    return response !== null ? ansiToHtml(response) : '';
  }

  const segments: DiffSegment[] = diffText(
    response !== null ? ansiToMarkers(response) : null,
    ansiToMarkers(unblessedResponse)
  );

  return segments
    .map((segment) => {
      const escaped = escapeHtml(segment.value);
      if (segment.type === 'unchanged') {
        return escaped;
      }
      return `<span class="${DIFF_SEGMENT_CLASS[segment.type]}">${visibleWhitespace(escaped)}</span>`;
    })
    .join('');
}

/**
 * The selected spine, root to leaf - ported from dialog-tool's session/selected-knots, which
 * walks root down via selectedChild all the way to a leaf, entirely independent of
 * activeKnotId (only used for highlighting which knot in that chain is "active" - see
 * renderKnot). Deliberately NOT root-to-activeKnotId: activeKnotId can be any knot clicked
 * elsewhere in the tree (see tree.ts's selectKnot), and stopping there would make a plain click
 * on an ancestor look like it discarded everything already explored past it, when nothing
 * actually changed - only creating a new child (addChild's own selectedChild reassignment) is
 * a real, deliberate change to what's displayed.
 */
function selectedKnots(tree: SkeinTree): DerivedKnot[] {
  const chain: DerivedKnot[] = [];
  let currentId: number | null = 0;
  while (currentId !== null) {
    const knot = tree.getDerivedKnot(currentId);
    if (!knot) {
      break;
    }
    chain.push(knot);
    currentId = knot.selectedChild;
  }
  return chain;
}

function totals(tree: SkeinTree): Record<KnotStatus, number> {
  const counts: Record<KnotStatus, number> = { valid: 0, new: 0, error: 0 };
  for (const wireKnot of tree.getAllKnots()) {
    const derived = tree.getDerivedKnot(wireKnot.id);
    if (derived) {
      counts[derived.state]++;
    }
  }
  return counts;
}

/**
 * A knot was "reached via keystroke" when its parent's response ended on a keystroke prompt -
 * dialog-ide's DerivedKnot.inputType describes a knot's own (blessed-only) response, not the
 * command that produced it, so this looks at the parent rather than the knot itself (dialog-tool
 * tracks this directly as a `parent-prompt` field; dialog-ide doesn't). DerivedKnot.inputType
 * also only reflects a *blessed* response, which most live knots won't have yet - so this reads
 * the parent's raw WireKnot instead, checking whichever of response/unblessedResponse is current.
 */
function reachedViaKeystroke(tree: SkeinTree, knot: DerivedKnot): boolean {
  if (knot.parentId === null) {
    return false;
  }
  const parent = tree.getKnot(knot.parentId);
  const currentResponse = parent?.response ?? parent?.unblessedResponse;
  return currentResponse?.inputType === 'key';
}

const dynamicProcessor = new DynamicProcessor();
const EMPTY_DYNAMIC_STATE: DynamicState = { flags: new Set(), vars: {} };

/**
 * The nearest ancestor's captured @dynamic state, walking up via parentId until one is found or
 * root is exhausted - mirrors dialog-tool's app.clj find-dynamic-state. Needed because a knot
 * reached via a keystroke prompt has no capture of its own (session.ts's captureDynamicState
 * skips those), so a descendant's diff still needs to compare against whatever the nearest
 * capturing ancestor last saw rather than treating every knot below a keystroke as starting from
 * an empty baseline. Root's own startup banner IS captured (see launchProcessAndCaptureBanner),
 * specifically so the walk normally bottoms out there rather than at an empty baseline - without
 * it, the first real command's diff would show every flag/var dgdebug sets up during init (e.g.
 * "(game started)") as freshly "added" by that command, which is misleading. Reaching root
 * without finding anything (a non-dgdebug engine, most likely) still falls back to
 * EMPTY_DYNAMIC_STATE in renderDynamicChanges below, so this is safe either way.
 */
function findDynamicState(tree: SkeinTree, knotId: number | null): DynamicState | null {
  let currentId = knotId;
  while (currentId !== null) {
    const state = tree.getDynamicState(currentId);
    if (state) {
      return state;
    }
    currentId = tree.getKnot(currentId)?.parentId ?? null;
  }
  return null;
}

/** Sorts predicates the way dialog-tool's app.clj compare-pred does: ignoring "#" (object-id disambiguator) characters, so e.g. "orb#2" sorts next to "orb#1" rather than after every non-numbered name. */
function comparePred(a: string, b: string): number {
  return a.replace(/#/g, '').localeCompare(b.replace(/#/g, ''));
}

const DYNAMIC_CHIP_CLASS: Record<'added' | 'removed' | 'changed', string> = {
  added: 'border-success bg-success/20 text-success-content',
  removed: 'border-warning bg-warning/20 text-warning-content',
  changed: 'border-info bg-info/10'
};

/**
 * The navbar's dynamic-state toggle's per-knot payload: which predicates were added, removed, or
 * changed since the nearest ancestor's own capture - mirrors dialog-tool's app.clj render-dynamic
 * (its own `(pos? id)` guard). Renders nothing for root - it has its own captured dynamic state
 * now (see launchProcessAndCaptureBanner), but only as a baseline for the first real command's
 * diff, not something to show a diff of itself (there's no earlier state to diff root's banner
 * against, so every flag/var dgdebug's startup sets would show as "added" noise). Also renders
 * nothing when this knot has no dynamic capture of its own for another reason (a keystroke-
 * reached knot, or - for a freshly loaded skein - a knot never touched this session; see
 * SkeinTree.getDynamicState's own doc comment), regardless of whether the toggle is on - callers
 * gate that separately (see renderKnot).
 */
function renderDynamicChanges(tree: SkeinTree, knot: DerivedKnot): string {
  if (knot.parentId === null) {
    return '';
  }
  const after = tree.getDynamicState(knot.id);
  if (!after) {
    return '';
  }
  const before = findDynamicState(tree, knot.parentId) ?? EMPTY_DYNAMIC_STATE;
  const { added, removed, changed } = dynamicProcessor.diff(before, after);

  const tuples: Array<['added' | 'removed' | 'changed', string]> = [
    ...Array.from(added, (predicate): ['added', string] => ['added', predicate]),
    ...Array.from(removed, (predicate): ['removed', string] => ['removed', predicate]),
    ...Array.from(changed, ([, afterValue]): ['changed', string] => ['changed', afterValue])
  ].sort((a, b) => comparePred(a[1], b[1]));

  if (tuples.length === 0) {
    return '';
  }

  const chips = tuples
    .map(([kind, predicate]) => {
      const prefix = kind === 'added' ? '<span class="font-bold mr-1">+</span>' : kind === 'removed' ? '<span class="font-bold mr-1">&minus;</span>' : '';
      return `<span class="rounded-box border ${DYNAMIC_CHIP_CLASS[kind]} px-2 py-1">${prefix}${escapeHtml(predicate)}</span>`;
    })
    .join('');

  return `<div class="font-sans flex flex-wrap gap-1 mt-4 text-xs">${chips}</div>`;
}

function renderKnot(
  tree: SkeinTree,
  knot: DerivedKnot,
  activeKnotId: number | null,
  transcriptMenuId: number | null,
  showDynamicState: boolean
): string {
  const active = knot.id === activeKnotId;
  const activeBorderClass = active ? ' border-l-primary' : '';

  const activeMarker = active
    ? '<div class="icon icon-arrow-right" role="img" aria-label="Selected"></div>'
    : '';
  const statusIcon =
    knot.state === 'new'
      ? '<div class="icon icon-warning w-4 h-4" role="img" aria-label="New knot"></div>'
      : knot.state === 'error'
        ? '<div class="icon icon-error w-4 h-4" role="img" aria-label="Error knot"></div>'
        : '';

  // Floats top-right within the response container (pl-2/pb-1 give surrounding text room to
  // wrap around it) - the lock icon and label chip if present, and always the knot's actions
  // menu trigger, so it's one cluster in one place rather than the trigger sitting off in the
  // gutter on its own.
  const floatCluster = `<div class="float-right flex flex-row items-center gap-1 pl-2 pb-1">${
    knot.locked ? '<div class="icon icon-lock" role="img" aria-label="Locked"></div>' : ''
  }${
    knot.label
      ? `<span class="font-bold bg-neutral text-neutral-content px-1 py-0.5 rounded text-sm">${escapeHtml(knot.label)}</span>`
      : ''
  }${renderKnotMenu(knot.id, knot.unblessedResponse !== null, knot.id === transcriptMenuId, '/actions/open-transcript-menu', active, knot.label, knot.command)}</div>`;

  const keystrokeChip =
    reachedViaKeystroke(tree, knot)
      ? `<div class="w-fit bg-neutral-content rounded-md border border-neutral px-2 py-1 text-sm">${escapeHtml(knot.command)}</div>`
      : '';

  // knot.response is '' (not blessed yet, see tree.ts's addChild) rather than genuinely null -
  // normalize to null so renderDiff can tell "never blessed" apart from "blessed as empty text".
  const responseText = renderDiff(knot.response || null, knot.unblessedResponse);
  // Mono font + visible whitespace only matters where there's a diff to line up - a knot with no
  // pending changes just shows its settled response, which reads better in the normal proportional
  // font. The floatCluster's menu (renderKnotMenu) opts back out of this via its own font-sans -
  // it's nested inside this same container (to sit inline with the response text) but its text
  // isn't part of the diff and shouldn't inherit the mono font.
  const monoClass = knot.state !== 'valid' ? ' font-mono' : '';

  // The response container below is whitespace-pre-wrap (needed to preserve the game's real
  // newlines), so its content must be built with no stray template-literal indentation/blank
  // lines of its own - unlike everywhere else in this file, a naive multi-line template with
  // conditionally-empty ${...} slots would leave visible leading whitespace before the text.
  const dynamicChanges = showDynamicState ? renderDynamicChanges(tree, knot) : '';

  const responseContainerContent = [floatCluster, keystrokeChip, responseText, dynamicChanges].filter(Boolean).join('');

  // Click-to-select and click-to-open-menu are both plain Datastar wiring ($knotId is this
  // literal, server-known id, then @post()) - no custom JS dispatch anywhere. There is no right-
  // click affordance; the menu only opens via its own "..." trigger (inside floatCluster above,
  // renderKnotMenu). The trigger and every menu item stop their own click from propagating, but
  // this row's own select-knot handler also checks evt.target.closest('details') defensively
  // rather than relying on that alone - belt and suspenders, since the menu is nested inside this
  // row's clickable body either way. The dropdown itself is inline, native <details> markup
  // positioned by plain CSS, with its `open` attribute driven by transcriptMenuId (tracked
  // separately from the tree pane's own graphMenuId - see session.ts).
  //
  // "grow" below MUST be followed by a literal space before the next ${...} - Tailwind's content
  // scanner does regex text-extraction over this raw .ts source, not JS-aware parsing. A class
  // glued directly onto "${" with no space (as this used to be: `grow${activeBorderClass}`) gets
  // merged with the interpolation into one non-matching candidate token and silently dropped, so
  // .grow never made it into the compiled stylesheet. Without flex-grow, this box was shrink-
  // wrapping to its own content width instead of filling the row - the actual root cause of the
  // misaligned/inconsistent right borders reported earlier (found via a headless-browser layout
  // inspection, after CSS guesses alone failed twice).
  return `<div class="flex flex-row" id="knot-${knot.id}"
    data-knot-id="${knot.id}"
    data-on:click="if (!evt.target.closest('details')) { $knotId = ${knot.id}; @post('/actions/select-knot') }">
  <div class="w-5 shrink-0 flex flex-col items-center justify-start pt-2 gap-1 pr-1">
    ${activeMarker}
    ${statusIcon}
  </div>
  <div class="border-x-8 grow ${activeBorderClass} ${STATUS_BORDER_CLASS[knot.state]}">
    <div class="w-full flow-root whitespace-pre-wrap break-words p-2 bg-base-100${monoClass}">${responseContainerContent}</div>
  </div>
</div>`;
}

/**
 * What kind of input the active knot currently expects next - same current-response-or-
 * unblessed pattern reachedViaKeystroke uses for a knot's parent, applied to the active knot
 * itself. Defaults to 'line' when there's no active knot or no response info yet.
 */
function activeInputType(tree: SkeinTree): 'line' | 'key' {
  const activeId = tree.getActiveKnotId();
  const knot = activeId !== null ? tree.getKnot(activeId) : null;
  const currentResponse = knot?.response ?? knot?.unblessedResponse;
  return currentResponse?.inputType ?? 'line';
}

/**
 * The command input, rendered right after the transcript - matches dialog-tool's
 * command-input.clj placement and markup (minus the keystroke variant, deferred - see the
 * Command Input plan). Submits on the input's native "change" event (fires on Enter/blur),
 * matching dialog-tool's own data-on:change. data-init="el.focus(); el.scrollIntoView(...)" covers
 * the initial page load - a long transcript can otherwise leave the input below the fold, focused
 * but not visible; after each submission, service.ts's execute-script broadcast (main.js's
 * sk.resetAndFocusCommandInput) clears and refocuses it the same way. Re-scrolling the *input*
 * into view is only right when a just-run command's response is the newest thing on screen
 * (right above it) - select-knot/new-child instead pass their own knotId through so it scrolls
 * that knot's transcript row into view (see resetAndFocusCommandInput's own doc comment), since
 * the transcript keeps showing the whole spine regardless of which knot on it was clicked.
 * Datastar's morph preserves this element's identity across patches (same id), so focus survives
 * ordinary re-renders on its own.
 *
 * Always shown (for a 'line'-expecting active knot), regardless of whether the active knot is
 * where the process actually is - "time travel" (jumping to an earlier knot and typing a
 * different command to explore an alternate branch) is normal, everyday use, not a special mode
 * requiring confirmation. session.ts's runCommand replays there first automatically when needed;
 * see processPositionId's own doc comment for why that's just an optimization, not a gate.
 */
function renderCommandInput(tree: SkeinTree): string {
  if (activeInputType(tree) === 'key') {
    return `<div class="mt-4 mb-8 text-sm text-base-content/60">Keystroke input isn't supported yet.</div>`;
  }

  return `<div class="flex items-center gap-2 mt-4 mb-8">
  <span class="text-gray-400" aria-hidden="true">&gt;</span>
  <input id="new-command-input" type="text" name="command" aria-label="Enter command"
         placeholder="Enter command..."
         class="flex-1 rounded-md border-base-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm p-2 border"
         data-bind="newCommand" data-init="el.focus(); el.scrollIntoView({block: 'nearest', behavior: 'smooth'})"
         data-on:change="@post('/actions/send-command')" />
</div>`;
}

/**
 * The navbar: ok/new/error badges, the dynamic-state toggle, and three equally-weighted primary
 * actions - Save, Replay All, Bless Transcript - a deliberately smaller set than dialog-tool's
 * app.clj navbar + operations toolbar. Session identity (which .skein file this is) lives in the
 * webview panel's own tab title now (extension.ts's panelTitle), not duplicated here - that
 * frees the middle of the navbar for the dynamic-state toggle (session.ts's showDynamicState/
 * toggleShowDynamicState), with room still left beside it for the not-yet-built knot search (see
 * the technical-design.md Core Component 5 plan). Generic app actions still deferred to native
 * VS Code commands
 * (Undo/Redo/Reload/Quit/Jump - no webview<->extension-host bridge exists yet) and per-knot
 * operations (New Child, Edit Label, Toggle Lock, Delete, Splice Out, Replay to Here, and
 * single-knot Bless Knot) are dropped from here on purpose - they live in the per-knot actions
 * menu shared by the tree pane and the transcript (see knot-menu.ts's renderKnotMenu), so nothing
 * is lost by Bless Transcript no longer being a dropdown with a single-knot option alongside it.
 * All three target things known server-side at render time (the active session; the active
 * spine's leaf), so each is baked directly into its button's data-on:click - same Datastar
 * data-on:*="@post(...)" pattern as everywhere else in this file, no custom JS dispatch needed.
 * Save is explicit-only and deliberately so: nothing else in this app ever writes the .skein file
 * on its own initiative (see service.ts's saveHandler and extension.ts's stopActiveSession) -
 * matches dialog-tool's own model, where stopping or replacing a session never implies the user
 * wanted to persist it.
 *
 * Bless Transcript posts to /actions/bless-changes (session.blessChanges -> tree.blessTranscript),
 * which blesses every non-valid knot from root to the given id inclusive - targeting
 * tree.getSelectedLeafId() (not activeKnotId - see that method's doc comment) makes that exactly
 * the whole spine selectedKnots/renderKnotList render into the transcript pane, regardless of
 * which knot on it the user last clicked. So "blesses everything visible in the transcript" is
 * that route's existing behavior, not new logic - only the button's label, target, and (no longer
 * a dropdown) presentation changed to say so directly.
 */
export function renderNavbar(info: SessionDisplayInfo, tree: SkeinTree, showDynamicState: boolean = false): string {
  const t = totals(tree);
  const spineLeafId = tree.getSelectedLeafId();
  const dgdebug = info.engine === 'dgdebug';
  return `<nav class="bg-base-100 text-base-content border-base-200 divide-base-200 px-2 sm:px-4 py-2.5 w-full border-b shrink-0"
  data-spine-leaf-id="${spineLeafId}">
  <div class="w-full flex items-center gap-2">
    <div class="join shrink-0">
      <div class="bg-success text-success-content p-2 font-semibold rounded-l-lg" aria-label="${t.valid} ok knots">${t.valid}</div>
      <div class="bg-warning text-warning-content p-2 font-semibold" aria-label="${t.new} new knots">${t.new}</div>
      <div class="bg-error text-error-content p-2 font-semibold rounded-r-lg" aria-label="${t.error} error knots">${t.error}</div>
    </div>
    <button type="button" class="btn btn-sm ${showDynamicState ? 'btn-primary' : 'btn-ghost'}" ${dgdebug ? '' : 'disabled'}
      aria-pressed="${showDynamicState}"
      data-on:click="@post('/actions/toggle-dynamic-state')"
      title="${dgdebug ? 'Show which dynamic properties (flags/variables) changed after each knot' : 'Dynamic state requires the dgdebug engine'}">
      <div class="icon icon-dynamic" aria-hidden="true"></div><span class="hidden lg:inline">Dynamic State</span>
    </button>
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <button type="button" class="btn btn-primary" data-on:click="@post('/actions/save')" title="Save this skein to its file - the only thing that ever writes to disk (⌘S)">
        <div class="icon icon-save" aria-hidden="true"></div><span class="hidden lg:inline">Save</span>
      </button>
      <button type="button" class="btn btn-primary" data-on:click="@post('/actions/replay-all')" title="Re-run every command on every path in the tree against a fresh process (⌥⇧R)">
        <div class="icon icon-play" aria-hidden="true"></div><span class="hidden lg:inline">Replay All</span>
      </button>
      <button type="button" class="btn btn-primary" data-on:click="$knotId = ${spineLeafId}; @post('/actions/bless-changes')" title="Bless every changed knot visible in the transcript (the active spine) (⌥⇧B)">
        <div class="icon icon-bless" aria-hidden="true"></div><span class="hidden lg:inline">Bless Transcript</span>
      </button>
    </div>
  </div>
</nav>`;
}

export function renderKnotList(
  tree: SkeinTree,
  transcriptMenuId: number | null = null,
  showDynamicState: boolean = false
): string {
  const activeId = tree.getActiveKnotId();
  return selectedKnots(tree)
    .map((knot) => renderKnot(tree, knot, activeId, transcriptMenuId, showDynamicState))
    .join('\n');
}

/**
 * The #skein-app patch target - service.ts's SSE broadcast re-renders this on every session
 * change and sends it as a Datastar datastar-patch-elements event, which morphs it into the
 * live DOM by matching this id.
 *
 * The whole app is a fixed-height (h-screen) flex column, not a normal scrolling page: the
 * navbar is a shrink-0 row at the top that never scrolls out of view, and everything below it
 * (the row wrapper, min-h-0 so it can't grow past what's left of the screen) fills the rest of
 * the viewport exactly, no more and no less. The tree/graph pane and the transcript pane are
 * each their own overflow-y-auto column within that row, so they scroll independently of each
 * other and of the navbar - neither the transcript nor the document itself ever needs to scroll
 * for the navbar to stay put. data-preserve-attr keeps Datastar's morph from resetting the
 * inline width that main.js's drag handler writes on resize.
 */
export function renderApp(
  info: SessionDisplayInfo,
  tree: SkeinTree,
  graphMenuId: number | null = null,
  transcriptMenuId: number | null = null,
  showDynamicState: boolean = false
): string {
  return `<div id="skein-app" class="flex flex-col h-screen">
  ${renderNavbar(info, tree, showDynamicState)}
  <div class="flex-1 min-h-0 flex flex-row w-full">
    <div id="tree-pane-outer"
      class="shrink-0 h-full flex flex-row"
      style="width: 21rem"
      data-preserve-attr="style"
      data-init="sk.initTreePaneResize()">
      <div class="flex-1 min-w-0 bg-base-200 border-r border-base-300">
        ${renderTreePane(tree, graphMenuId)}
      </div>
      <div id="tree-pane-handle" class="w-1 shrink-0 cursor-col-resize bg-base-300 hover:bg-primary transition-colors"></div>
    </div>
    <div class="flex-1 min-w-0 overflow-y-auto px-2">
      ${renderKnotList(tree, transcriptMenuId, showDynamicState)}
      ${renderCommandInput(tree)}
    </div>
  </div>
</div>`;
}

export function renderPage(
  info: SessionDisplayInfo | undefined,
  tree: SkeinTree | undefined,
  graphMenuId: number | null = null,
  transcriptMenuId: number | null = null,
  showDynamicState: boolean = false
): string {
  const body =
    info && tree
      ? renderApp(info, tree, graphMenuId, transcriptMenuId, showDynamicState)
      : '<div id="skein-app" class="p-4">No skein session running.</div>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Dialog Skein</title>
<link rel="stylesheet" href="/style.css" />
<script type="module" src="/js/datastar.js"></script>
<script type="module" src="/js/main.js"></script>
</head>
<body data-init="@get('/events', {openWhenHidden: true})">
${body}
</body>
</html>`;
}
