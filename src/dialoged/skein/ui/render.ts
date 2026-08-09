/**
 * Read-only HTML rendering for the Skein web UI - navbar + linear transcript (the active spine,
 * root to active leaf). Mirrors dialog-tool's app.clj navbar/render-knot markup and Tailwind/
 * DaisyUI class names closely so the vendored style.css (media/style.css, copied verbatim from
 * dialog-tool's compiled build) applies with no changes needed.
 *
 * No actions yet (no data-on:* attributes, no command input, no toolbar/modals/tree-pane) - see
 * the Phase 1 plan for what's deferred.
 */

import { EngineType } from '../process';
import { DerivedKnot, KnotStatus, SkeinTree } from '../tree';
import { ansiToHtml, ansiToMarkers } from './ansi';
import { DiffSegment, diffText } from './diff';

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
 * The active spine, root to active leaf - dialog-tool's session/selected-knots has no existing
 * dialog-ide equivalent; this is a small local helper rather than new SkeinTree API.
 */
function selectedKnots(tree: SkeinTree): DerivedKnot[] {
  const activeId = tree.getActiveKnotId();
  if (activeId === null) {
    return [];
  }

  const chain: DerivedKnot[] = [];
  let currentId: number | null = activeId;
  while (currentId !== null) {
    const knot = tree.getDerivedKnot(currentId);
    if (!knot) {
      break;
    }
    chain.push(knot);
    currentId = knot.parentId;
  }
  return chain.reverse();
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

function renderKnot(tree: SkeinTree, knot: DerivedKnot, activeKnotId: number | null): string {
  const active = knot.id === activeKnotId;

  const activeMarker = active
    ? '<div class="icon icon-arrow-right" role="img" aria-label="Selected"></div>'
    : '';
  const statusIcon =
    knot.state === 'new'
      ? '<div class="icon icon-warning w-4 h-4" role="img" aria-label="New knot"></div>'
      : knot.state === 'error'
        ? '<div class="icon icon-error w-4 h-4" role="img" aria-label="Error knot"></div>'
        : '';

  const lockAndLabel =
    knot.locked || knot.label
      ? `<div class="float-right flex flex-row items-center gap-1 pl-2 pb-1">${
          knot.locked ? '<div class="icon icon-lock" role="img" aria-label="Locked"></div>' : ''
        }${
          knot.label
            ? `<span class="font-bold bg-neutral text-neutral-content px-1 py-0.5 rounded text-sm">${escapeHtml(knot.label)}</span>`
            : ''
        }</div>`
      : '';

  const keystrokeChip =
    reachedViaKeystroke(tree, knot)
      ? `<div class="w-fit bg-neutral-content rounded-md border border-neutral px-2 py-1 text-sm">${escapeHtml(knot.command)}</div>`
      : '';

  const monoClass = knot.state !== 'valid' ? ' font-mono' : '';
  // knot.response is '' (not blessed yet, see tree.ts's addChild) rather than genuinely null -
  // normalize to null so renderDiff can tell "never blessed" apart from "blessed as empty text".
  const responseText = renderDiff(knot.response || null, knot.unblessedResponse);

  // The response container below is whitespace-pre-wrap (needed to preserve the game's real
  // newlines), so its content must be built with no stray template-literal indentation/blank
  // lines of its own - unlike everywhere else in this file, a naive multi-line template with
  // conditionally-empty ${...} slots would leave visible leading whitespace before the text.
  const responseContainerContent = [lockAndLabel, keystrokeChip, responseText].filter(Boolean).join('');

  return `<div class="flex flex-row" id="knot-${knot.id}" data-knot-id="${knot.id}">
  <div class="w-5 shrink-0 flex flex-col items-center justify-start pt-2 gap-1 pr-1">
    ${activeMarker}
    ${statusIcon}
  </div>
  <div class="border-x-8 grow${active ? ' border-l-primary' : ''} ${STATUS_BORDER_CLASS[knot.state]}">
    <div class="w-full whitespace-pre-wrap break-words p-2 bg-base-100${monoClass}">${responseContainerContent}</div>
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
 * matching dialog-tool's own data-on:change. data-init="el.focus()" covers the initial page
 * load; after each submission, service.ts's execute-script broadcast (main.js's
 * sk.resetAndFocusCommandInput) clears and refocuses it - Datastar's morph preserves this
 * element's identity across patches (same id), so focus survives ordinary re-renders on its own.
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
         data-bind="newCommand" data-init="el.focus()"
         data-on:change="@post('/actions/send-command')" />
</div>`;
}

export function renderNavbar(info: SessionDisplayInfo, tree: SkeinTree): string {
  const t = totals(tree);
  return `<nav class="bg-base-100 text-base-content border-base-200 divide-base-200 px-2 sm:px-4 py-2.5 w-full border-b">
  <div class="w-full flex items-center gap-2">
    <div class="self-center truncate text-xl font-semibold shrink min-w-0">${escapeHtml(info.sessionId)}.skein &middot; ${escapeHtml(info.engine)} &middot; seed ${info.seed}</div>
    <div class="join shrink-0 mx-auto">
      <div class="bg-success text-success-content p-2 font-semibold rounded-l-lg" aria-label="${t.valid} ok knots">${t.valid}</div>
      <div class="bg-warning text-warning-content p-2 font-semibold" aria-label="${t.new} new knots">${t.new}</div>
      <div class="bg-error text-error-content p-2 font-semibold rounded-r-lg" aria-label="${t.error} error knots">${t.error}</div>
    </div>
  </div>
</nav>`;
}

export function renderKnotList(tree: SkeinTree): string {
  const activeId = tree.getActiveKnotId();
  return selectedKnots(tree)
    .map((knot) => renderKnot(tree, knot, activeId))
    .join('\n');
}

/**
 * The #skein-app patch target - service.ts's SSE broadcast re-renders this on every session
 * change and sends it as a Datastar datastar-patch-elements event, which morphs it into the
 * live DOM by matching this id.
 */
export function renderApp(info: SessionDisplayInfo, tree: SkeinTree): string {
  return `<div id="skein-app">
  ${renderNavbar(info, tree)}
  <div class="flex-1 min-w-0 px-2">
    ${renderKnotList(tree)}
    ${renderCommandInput(tree)}
  </div>
</div>`;
}

export function renderPage(info: SessionDisplayInfo | undefined, tree: SkeinTree | undefined): string {
  const body =
    info && tree ? renderApp(info, tree) : '<div id="skein-app" class="p-4">No skein session running.</div>';

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
