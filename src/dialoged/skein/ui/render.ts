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
import { SearchResults } from '../search';
import { DerivedKnot, KnotStatus, Marker, SkeinTree } from '../tree';
import { ansiToHtml, ansiToMarkers } from './ansi';
import { DiffSegment, diffText } from './diff';
import { renderKnotMenu } from './knot-menu';
import { ALL_MARKERS, MARKER_LABEL, MARKER_SWATCH_CLASS } from './marker-colors';
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
 * tracks this directly as a `parent-prompt` field; dialog-ide doesn't). tree.promptTypeAt reads
 * whichever of response/unblessedResponse is current, since most live knots won't have a blessed
 * response yet.
 */
function reachedViaKeystroke(tree: SkeinTree, knot: DerivedKnot): boolean {
  return tree.promptTypeAt(knot.parentId) === 'key';
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
    knot.marker
      ? `<span class="w-3 h-3 rounded-full shrink-0 ${MARKER_SWATCH_CLASS[knot.marker]}" aria-hidden="true"></span>`
      : ''
  }${
    knot.label
      ? `<span class="font-bold bg-neutral text-neutral-content px-1 py-0.5 rounded text-sm">${escapeHtml(knot.label)}</span>`
      : ''
  }${renderKnotMenu(knot.id, knot.unblessedResponse !== null, knot.id === transcriptMenuId, '/actions/open-transcript-menu', active, knot.label, knot.command, 'prominent', tree.promptTypeAt(knot.parentId) === 'key', tree.getEngine(), knot.marker)}</div>`;

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
 * What kind of input the active knot currently expects next. Defaults to 'line' when there's no
 * active knot or no response info yet - see tree.ts's promptTypeAt.
 */
function activeInputType(tree: SkeinTree): 'line' | 'key' {
  return tree.promptTypeAt(tree.getActiveKnotId());
}

// Buttons for the keystroke widget's replies that don't correspond to a single visible character
// - matches session.ts's KEYSTROKE_KEY_CODES, which is what actually resolves these same friendly
// names to the byte(s) sent to the process. A plain letter/digit/symbol key needs no button at
// all (the input below sends it directly), but Enter/Backspace produce no visible character to
// type into a maxlength=1 field, and a literal space typed there is easy to miss having landed.
const SPECIAL_KEYSTROKE_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'enter', label: 'Enter' },
  { key: 'space', label: 'Space' },
  { key: 'backspace', label: 'Backspace' }
];

/**
 * The keystroke variant of the command input - rendered instead of renderCommandInput's normal
 * text field when activeInputType is 'key' (a "[MORE]"/"Press any key" style prompt, which reads
 * exactly one keystroke rather than a line - see io.ts's PromptType). Mirrors dialog-tool's
 * command-input.clj new-keystroke-input (a single-character field plus buttons for Enter/Space/
 * Backspace), but drives all of it - including Enter/Backspace - straight off the field's own
 * data-on:keydown rather than dialog-tool's keypress-driven field plus separate click-only
 * buttons: keypress is deprecated and, in every current browser, simply never fires for Enter or
 * Backspace at all (only keydown reliably does), so a keypress-only field would leave a keyboard
 * user no way to submit either one without reaching for the mouse. The buttons stay - not as the
 * only way in, but for discoverability (a first-time user may not realize Enter/Backspace are
 * being captured at all) and for anyone using a pointer instead of the keyboard.
 *
 * Each matched branch evt.preventDefault()s before acting - there's nothing to correct or clear,
 * each keystroke is submitted the moment it's pressed, same as clicking a button, so the browser
 * must not also type the character in, erase one, or (for Enter) submit an enclosing form. Every
 * unmatched key - Tab included - is left alone, so this never traps keyboard focus in the field.
 * The physical space bar falls through to the plain evt.key.length === 1 branch (browsers report
 * `evt.key === ' '` for it) rather than a dedicated case - handleSendKeystroke/normalizeKeystroke
 * on the server normalizes that literal space to the same "space" text the button sends, so
 * either input method records the identical command. Every other named key (Shift, ArrowLeft,
 * F5, ...) reports evt.key.length > 1 and isn't a real game keystroke, so it's simply ignored.
 *
 * Shares #new-command-input's id with the normal widget (only one is ever rendered at a time) so
 * main.js's sk.resetAndFocusCommandInput keeps working unchanged for both.
 */
function renderKeystrokeInput(): string {
  const buttons = SPECIAL_KEYSTROKE_BUTTONS.map(
    ({ key, label }) =>
      `<button type="button" class="btn btn-sm" data-on:click="$newKeystroke = '${key}'; @post('/actions/send-keystroke')">${label}</button>`
  ).join('\n  ');

  return `<div class="flex items-center gap-2 mt-4 mb-8">
  <span class="text-gray-400" aria-hidden="true">Key:</span>
  <input id="new-command-input" type="text" aria-label="Enter keystroke" maxlength="1" size="2"
         class="w-12 text-center rounded-md border-base-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm p-2 border"
         data-init="el.focus(); el.scrollIntoView({block: 'nearest', behavior: 'smooth'})"
         data-on:keydown="if (evt.key === 'Enter') { evt.preventDefault(); $newKeystroke = 'enter'; @post('/actions/send-keystroke') }
           else if (evt.key === 'Backspace') { evt.preventDefault(); $newKeystroke = 'backspace'; @post('/actions/send-keystroke') }
           else if (evt.key.length === 1) { evt.preventDefault(); $newKeystroke = evt.key; @post('/actions/send-keystroke') }" />
  <span class="text-sm text-base-content/60">or</span>
  ${buttons}
</div>`;
}

/**
 * The command input, rendered right after the transcript - matches dialog-tool's
 * command-input.clj placement and markup. Submits on the input's native "change" event (fires on
 * Enter/blur), matching dialog-tool's own data-on:change. data-init="el.focus();
 * el.scrollIntoView(...)" covers the initial page load - a long transcript can otherwise leave
 * the input below the fold, focused but not visible; after each submission, service.ts's
 * execute-script broadcast (main.js's sk.resetAndFocusCommandInput) clears and refocuses it the
 * same way. Re-scrolling the *input* into view is only right when a just-run command's response
 * is the newest thing on screen (right above it) - select-knot/new-child instead pass their own
 * knotId through so it scrolls that knot's transcript row into view (see
 * resetAndFocusCommandInput's own doc comment), since the transcript keeps showing the whole
 * spine regardless of which knot on it was clicked. Datastar's morph preserves this element's
 * identity across patches (same id), so focus survives ordinary re-renders on its own.
 *
 * Always shown (for a 'line'-expecting active knot), regardless of whether the active knot is
 * where the process actually is - "time travel" (jumping to an earlier knot and typing a
 * different command to explore an alternate branch) is normal, everyday use, not a special mode
 * requiring confirmation. session.ts's runCommand replays there first automatically when needed;
 * see processPositionId's own doc comment for why that's just an optimization, not a gate.
 */
function renderCommandInput(tree: SkeinTree): string {
  if (activeInputType(tree) === 'key') {
    return renderKeystrokeInput();
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

const EMPTY_SEARCH_RESULTS: SearchResults = { results: [], totalMatches: 0 };

// Shared by every result's own keydown and the search input's own ArrowDown - keeps the two
// call sites (below) from drifting apart on what "move through the results" actually means.
// ArrowDown/ArrowUp move focus via sk.navigateSearchResults (main.js) rather than letting the
// browser's default happen, which - since the results list is a scrollable container - would
// otherwise just scroll it instead of moving between results (the bug this replaces). Escape
// dismisses the same way the input's own Escape handler does.
const SEARCH_RESULT_KEYDOWN =
  "if (evt.key === 'ArrowDown') { evt.preventDefault(); sk.navigateSearchResults(el, 1) }" +
  " else if (evt.key === 'ArrowUp') { evt.preventDefault(); sk.navigateSearchResults(el, -1) }" +
  " else if (evt.key === 'Escape') { $searchQuery = ''; @post('/actions/search') }";

/**
 * The search box's own results dropdown (search.ts's searchKnots) - absolutely positioned below
 * the input so it overlays whatever's beneath it rather than pushing the navbar taller. Every
 * result shows the same things regardless of which field (label or response) it actually matched
 * on, rather than a field name and knot id (which said more about the data model than about what
 * the user is actually looking at): a top row with the knot's command left-justified in the
 * normal (not mono) font, prefixed with the same "> " prompt convention used everywhere else in
 * this app for "here's a command" - except for root (knot 0), whose "command" is a synthetic
 * 'START' placeholder (tree.ts's newTree), not real text, so no prompt line is shown for it at
 * all (same suppression tree-pane.ts already does for that placeholder) - and its label, if it
 * has one, floated to the right of that same row (ml-auto) the way the transcript's own label
 * chip floats within a knot's response (render.ts's floatCluster); then the matched snippet below
 * that row. The snippet never repeats the command even when the match is near the very start of a
 * response - search.ts's searchableResponseText already strips dgdebug's own leading command-echo
 * before matching/snippet-building, specifically so it isn't shown twice. command/label/snippet
 * are all inserted raw, not escaped again here - search.ts already HTML-escapes them (and wraps
 * snippet's matched terms in <mark> - see its own doc comment).
 *
 * Clicking a result reuses the existing select-knot action (which already scrolls the transcript
 * to it - see handleKnotAction's focusAfter) rather than a bespoke "jump" endpoint, then clears
 * the query to dismiss the dropdown - there's nothing more useful to show once the user has
 * already jumped. Each result is a real, focusable <button data-search-result> - the target
 * sk.navigateSearchResults' ArrowUp/ArrowDown move focus between (see SEARCH_RESULT_KEYDOWN),
 * and Enter/Space activates natively, no extra JS needed for that part.
 */
function renderSearchResults(searchResults: SearchResults): string {
  const { results, totalMatches } = searchResults;

  if (results.length === 0) {
    return `<div class="absolute top-full left-0 mt-1 w-96 max-w-[90vw] bg-base-100 border border-base-300 rounded-md shadow-xl z-20 p-3 text-sm text-base-content/60">No matches.</div>`;
  }

  const rows = results
    .map((result) => {
      // Root's "command" is the synthetic 'START' placeholder (tree.ts's newTree), not a real
      // command - showing "> START" would be misleading, so this is the one case with no prompt
      // line at all (matching tree-pane.ts's own suppression of the same placeholder).
      const promptLine = result.knotId !== 0 ? `<span class="text-sm">&gt; ${result.command}</span>` : '';
      const labelChip = result.label
        ? `<span class="font-bold bg-neutral text-neutral-content px-1 py-0.5 rounded text-sm ml-auto shrink-0">${result.label}</span>`
        : '';

      return `<li>
      <button type="button" data-search-result class="w-full text-left px-3 py-2 hover:bg-base-200 focus:bg-base-200 focus:outline-none flex flex-col gap-1"
        data-on:click="$knotId = ${result.knotId}; $searchQuery = ''; @post('/actions/select-knot'); @post('/actions/search')"
        data-on:keydown="${SEARCH_RESULT_KEYDOWN}">
        <div class="flex items-center gap-2">${promptLine}${labelChip}</div>
        <span class="text-sm break-words">${result.snippet}</span>
      </button>
    </li>`;
    })
    .join('');

  const truncatedNote =
    totalMatches > results.length
      ? `<div class="px-3 py-1.5 text-xs text-base-content/60 border-t border-base-300">Showing ${results.length} of ${totalMatches} matches - add more search text to narrow it down.</div>`
      : '';

  // Deliberately a plain <ul>, not daisyUI's .menu: that component sets align-items:center (and
  // width:fit-content on the <ul> itself) on any non-.btn child of <li>, both unopposed by any
  // utility class here - the prompt/label row and the snippet below it just collapsed to
  // fit-content and centered instead of stretching to the button's full width, which is also why
  // the label's ml-auto (meant to float it right) had no leftover width to push into and sat
  // flush against the prompt instead. Nothing else here actually used .menu's own styling.
  return `<div class="absolute top-full left-0 mt-1 w-96 max-w-[90vw] bg-base-100 border border-base-300 rounded-md shadow-xl z-20 max-h-96 overflow-y-auto">
    <ul class="p-0" role="listbox">${rows}</ul>
    ${truncatedNote}
  </div>`;
}

/**
 * The transcript's search box (technical-design.md's Core Component 7) - matches every
 * whitespace-separated search term (AND, not OR) against each knot's label and settled response
 * (search.ts's searchKnots has the full matching rules). Fires on every keystroke, debounced, the
 * same pattern already established by the Trace panel's own filter box (traceRender.ts) - live
 * narrowing, not a submit-and-wait search. Escape clears the query and dismisses the dropdown in
 * one step, matching every other Escape-to-dismiss affordance in this app (the label/command
 * modals); so does clicking anywhere outside #skein-search-box (main.js's document click
 * listener). ArrowDown moves focus into the first result (SEARCH_RESULT_KEYDOWN continues from
 * there) rather than doing nothing useful on an <input type="search">. Cmd/Ctrl+A explicitly
 * selects the input's text - native select-all doesn't reach it reliably inside a VS Code webview
 * (the same platform quirk the label/command modals already work around).
 * id="skein-search-input" is main.js's Alt+F focus target.
 */
function renderSearchBox(searchQuery: string, searchResults: SearchResults): string {
  const showResults = searchQuery.trim() !== '';
  return `<div class="relative" id="skein-search-box">
    <label class="input input-sm flex items-center gap-2">
      <div class="icon icon-search w-4 h-4 opacity-60" aria-hidden="true"></div>
      <input type="search" id="skein-search-input" aria-label="Search knots" placeholder="Search" value="${escapeHtml(searchQuery)}"
        data-bind="searchQuery" data-on:input__debounce.300ms="@post('/actions/search')"
        data-on:keydown="if (evt.key === 'Escape') { $searchQuery = ''; @post('/actions/search') }
          else if (evt.key === 'ArrowDown') { evt.preventDefault(); sk.navigateSearchResults(el, 1) }
          else if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'a') { evt.preventDefault(); el.select() }" />
    </label>
    ${showResults ? renderSearchResults(searchResults) : ''}
  </div>`;
}

/**
 * The navbar: ok/new/error badges, the search box, the dynamic-state toggle, and three
 * equally-weighted primary actions - Save, Replay All, Bless Transcript - a deliberately smaller
 * set than dialog-tool's app.clj navbar + operations toolbar. Session identity (which .skein file
 * this is) lives in the webview panel's own tab title now (extension.ts's panelTitle), not
 * duplicated here - that frees the middle of the navbar for the search box and dynamic-state
 * toggle (session.ts's showDynamicState/toggleShowDynamicState). Generic app actions still
 * deferred to native VS Code commands
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
export function renderNavbar(
  info: SessionDisplayInfo,
  tree: SkeinTree,
  showDynamicState: boolean = false,
  searchQuery: string = '',
  searchResults: SearchResults = EMPTY_SEARCH_RESULTS,
  markerFilter: Marker | null = null
): string {
  const t = totals(tree);
  const spineLeafId = tree.getSelectedLeafId();
  const dgdebug = info.engine === 'dgdebug';
  return `<nav class="bg-base-100 text-base-content border-base-200 divide-base-200 px-2 sm:px-4 py-2.5 w-full border-b shrink-0"
  data-spine-leaf-id="${spineLeafId}">
  <div class="w-full flex items-center gap-2">
    <div class="join shrink-0">
      <div class="bg-success text-success-content p-2 font-semibold rounded-l-lg" aria-label="${t.valid} ok knots">${t.valid}</div>
      <button type="button" class="bg-warning text-warning-content p-2 font-semibold disabled:opacity-100" aria-label="${t.new} new knots"
        ${t.new === 0 ? 'disabled' : ''} data-on:click="$seekStatus = 'new'; @post('/actions/seek-status')"
        title="${t.new === 0 ? 'No new knots' : 'Jump to the next new knot, cycling through all of them'}">${t.new}</button>
      <button type="button" class="bg-error text-error-content p-2 font-semibold rounded-r-lg disabled:opacity-100" aria-label="${t.error} error knots"
        ${t.error === 0 ? 'disabled' : ''} data-on:click="$seekStatus = 'error'; @post('/actions/seek-status')"
        title="${t.error === 0 ? 'No error knots' : 'Jump to the next error knot, cycling through all of them'}">${t.error}</button>
    </div>
    ${renderSearchBox(searchQuery, searchResults)}
    <button type="button" class="btn btn-sm ${showDynamicState ? 'btn-primary' : 'btn-ghost'}" ${dgdebug ? '' : 'disabled'}
      aria-pressed="${showDynamicState}"
      data-on:click="@post('/actions/toggle-dynamic-state')"
      title="${dgdebug ? 'Show which dynamic properties (flags/variables) changed after each knot' : 'Dynamic state requires the dgdebug engine'}">
      <div class="icon icon-dynamic" aria-hidden="true"></div><span class="hidden lg:inline">Dynamic State</span>
    </button>
    <div class="join shrink-0" role="group" aria-label="Filter by marker">
      ${ALL_MARKERS.map((marker) => `
      <button type="button" class="btn btn-sm btn-square join-item ${markerFilter === marker ? 'btn-primary' : 'btn-ghost'}"
        aria-pressed="${markerFilter === marker}" aria-label="Filter to knots marked ${MARKER_LABEL[marker]}"
        data-on:click="$marker = ${marker}; @post('/actions/set-marker-filter')"
        title="Show only knots marked ${MARKER_LABEL[marker]} (or with a descendant marked ${MARKER_LABEL[marker]}) - click again to clear">
        <span class="w-3 h-3 rounded-full ${MARKER_SWATCH_CLASS[marker]}" aria-hidden="true"></span>
      </button>`).join('')}
    </div>
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
  showDynamicState: boolean = false,
  searchQuery: string = '',
  searchResults: SearchResults = EMPTY_SEARCH_RESULTS,
  markerFilter: Marker | null = null
): string {
  return `<div id="skein-app" class="flex flex-col h-screen">
  ${renderNavbar(info, tree, showDynamicState, searchQuery, searchResults, markerFilter)}
  <div class="flex-1 min-h-0 flex flex-row w-full">
    <div id="tree-pane-outer"
      class="shrink-0 h-full flex flex-row"
      style="width: 21rem"
      data-preserve-attr="style"
      data-init="sk.initTreePaneResize()">
      <div class="flex-1 min-w-0 bg-base-200 border-r border-base-300">
        ${renderTreePane(tree, graphMenuId, markerFilter)}
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
  showDynamicState: boolean = false,
  searchQuery: string = '',
  searchResults: SearchResults = EMPTY_SEARCH_RESULTS,
  markerFilter: Marker | null = null
): string {
  const body =
    info && tree
      ? renderApp(info, tree, graphMenuId, transcriptMenuId, showDynamicState, searchQuery, searchResults, markerFilter)
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
