/**
 * HTML rendering for the Skein web UI - navbar + linear transcript (the active spine, root to
 * active leaf). Mirrors dialog-tool's app.clj navbar/render-knot markup and Tailwind/DaisyUI
 * class names closely; media/style.css is generated from styles/input.css by a real Tailwind
 * build (`npm run build:css`) that scans this project's own source, so any class used here is
 * automatically included - no more guessing whether a class happens to exist in a frozen,
 * vendored-from-elsewhere stylesheet.
 */

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

function renderKnot(
  tree: SkeinTree,
  knot: DerivedKnot,
  activeKnotId: number | null,
  transcriptMenuId: number | null
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
  }${renderKnotMenu(knot.id, knot.unblessedResponse !== null, knot.id === transcriptMenuId, '/actions/open-transcript-menu', active, knot.label)}</div>`;

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
  const responseContainerContent = [floatCluster, keystrokeChip, responseText].filter(Boolean).join('');

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
 * sk.resetAndFocusCommandInput) clears, refocuses, and re-scrolls it the same way - Datastar's
 * morph preserves this element's identity across patches (same id), so focus survives ordinary
 * re-renders on its own.
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
 * The navbar: session identity, ok/new/error badges, and three equally-weighted primary actions -
 * Save, Replay All, Bless Transcript - a deliberately smaller set than dialog-tool's app.clj
 * navbar + operations toolbar. Generic app actions still deferred to native VS Code commands
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
export function renderNavbar(info: SessionDisplayInfo, tree: SkeinTree): string {
  const t = totals(tree);
  const spineLeafId = tree.getSelectedLeafId();
  return `<nav class="bg-base-100 text-base-content border-base-200 divide-base-200 px-2 sm:px-4 py-2.5 w-full border-b"
  data-spine-leaf-id="${spineLeafId}">
  <div class="w-full flex items-center gap-2">
    <div class="self-center truncate text-xl font-semibold shrink min-w-0">${escapeHtml(info.sessionId)}.skein &middot; ${escapeHtml(info.engine)} &middot; seed ${info.seed}</div>
    <div class="join shrink-0 mx-auto">
      <div class="bg-success text-success-content p-2 font-semibold rounded-l-lg" aria-label="${t.valid} ok knots">${t.valid}</div>
      <div class="bg-warning text-warning-content p-2 font-semibold" aria-label="${t.new} new knots">${t.new}</div>
      <div class="bg-error text-error-content p-2 font-semibold rounded-r-lg" aria-label="${t.error} error knots">${t.error}</div>
    </div>
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <button type="button" class="btn btn-primary" data-on:click="@post('/actions/save')" title="Save this skein to its file - the only thing that ever writes to disk (⌘S)">
        <div class="icon icon-save" aria-hidden="true"></div><span class="hidden lg:inline">Save</span>
      </button>
      <button type="button" class="btn btn-primary" data-on:click="@post('/actions/replay-all')" title="Re-run every command on the active spine against a fresh process (⌥⇧R)">
        <div class="icon icon-play" aria-hidden="true"></div><span class="hidden lg:inline">Replay All</span>
      </button>
      <button type="button" class="btn btn-primary" data-on:click="$knotId = ${spineLeafId}; @post('/actions/bless-changes')" title="Bless every changed knot visible in the transcript (the active spine) (⌥⇧B)">
        <div class="icon icon-bless" aria-hidden="true"></div><span class="hidden lg:inline">Bless Transcript</span>
      </button>
    </div>
  </div>
</nav>`;
}

export function renderKnotList(tree: SkeinTree, transcriptMenuId: number | null = null): string {
  const activeId = tree.getActiveKnotId();
  return selectedKnots(tree)
    .map((knot) => renderKnot(tree, knot, activeId, transcriptMenuId))
    .join('\n');
}

/**
 * The #skein-app patch target - service.ts's SSE broadcast re-renders this on every session
 * change and sends it as a Datastar datastar-patch-elements event, which morphs it into the
 * live DOM by matching this id.
 *
 * Two-pane body, mirroring dialog-tool's skein-page: a sticky, resizable tree/graph pane on the
 * left (scrolls independently) and the transcript on the right (scrolls with the page, as it
 * always has). Unlike dialog-tool - whose two fixed toolbar rows push everything below down by a
 * fixed amount, needing a matching height offset (mt-28/h-[calc(100vh-7rem)]) - dialog-ide's
 * single navbar flows normally, so the tree pane just pins itself to the top of the viewport
 * (sticky top-0) and caps its own height at one screen (h-screen) rather than needing that
 * offset arithmetic. data-preserve-attr keeps Datastar's morph from resetting the inline width
 * that main.js's drag handler writes on resize.
 */
export function renderApp(
  info: SessionDisplayInfo,
  tree: SkeinTree,
  graphMenuId: number | null = null,
  transcriptMenuId: number | null = null
): string {
  return `<div id="skein-app">
  ${renderNavbar(info, tree)}
  <div class="flex flex-row w-full">
    <div id="tree-pane-outer"
      class="sticky top-0 shrink-0 h-screen flex flex-row"
      style="width: 21rem"
      data-preserve-attr="style"
      data-init="sk.initTreePaneResize()">
      <div class="flex-1 min-w-0 bg-base-200 border-r border-base-300">
        ${renderTreePane(tree, graphMenuId)}
      </div>
      <div id="tree-pane-handle" class="w-1 shrink-0 cursor-col-resize bg-base-300 hover:bg-primary transition-colors"></div>
    </div>
    <div class="flex-1 min-w-0 px-2">
      ${renderKnotList(tree, transcriptMenuId)}
      ${renderCommandInput(tree)}
    </div>
  </div>
</div>`;
}

export function renderPage(
  info: SessionDisplayInfo | undefined,
  tree: SkeinTree | undefined,
  graphMenuId: number | null = null,
  transcriptMenuId: number | null = null
): string {
  const body =
    info && tree
      ? renderApp(info, tree, graphMenuId, transcriptMenuId)
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
