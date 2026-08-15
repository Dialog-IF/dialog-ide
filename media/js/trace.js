// Client-side JS for the Trace panel (its own page, served at /trace - see traceRender.ts).
// Independent of main.js: this page has no tree graph, no knot menus, nothing else main.js
// handles - just the hover-to-preview and click-to-open-source interactions specific to trace
// rows, plus the postMessage bridge back to the extension host (only extension.ts has the
// vscode API needed to actually open/focus an editor - see extension.ts's TraceViewProvider).
window.sk = window.sk || {};
window.sk.trace = {
  openSource(file, line) {
    window.parent.postMessage({ type: 'openSource', file, line }, '*');
  }
};

let hoverTimer = null;
let currentHoverRow = null;
// Latest known pointer position, used at show time rather than whatever position the mouse was
// at when the hover first started - the 150ms delay before showing means the cursor may have
// drifted a little further into the row by the time the popover actually appears.
let lastMouseX = 0;
let lastMouseY = 0;

document.addEventListener('mousemove', (evt) => {
  lastMouseX = evt.clientX;
  lastMouseY = evt.clientY;
});

/**
 * Places the popover near (x, y) rather than anchored to the hovered row - the row spans most
 * of the panel's width, so any single fixed side/offset relative to it ran out of room near one
 * end (that's what made the popover behave differently depending on which part of a row -
 * query term vs. filename - triggered the hover). Following the cursor sidesteps the row's own
 * geometry entirely. Offsets and clamps against the viewport so it doesn't open off-screen or
 * directly under the cursor (which would immediately trigger mouseout on the row underneath).
 */
function positionPopover(popover, x, y) {
  const OFFSET = 14;
  const rect = popover.getBoundingClientRect();
  let left = x + OFFSET;
  let top = y + OFFSET;
  if (left + rect.width > window.innerWidth) {
    left = Math.max(0, x - rect.width - OFFSET);
  }
  if (top + rect.height > window.innerHeight) {
    top = Math.max(0, y - rect.height - OFFSET);
  }
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function showSourcePreview(row) {
  const nodeId = row.dataset.nodeId;
  const popover = document.getElementById('trace-source-popover');
  if (!nodeId || !popover) return;

  fetch(`/trace/source-preview?nodeId=${encodeURIComponent(nodeId)}`)
    .then((res) => (res.ok ? res.text() : null))
    .then((html) => {
      // The mouse may have moved to a different row (or off the tree entirely) while this
      // request was in flight - only show it if this row is still the one being hovered.
      if (html == null || currentHoverRow !== row) return;
      popover.innerHTML = html;
      popover.showPopover();
      positionPopover(popover, lastMouseX, lastMouseY);
    })
    .catch(() => {});
}

function hideSourcePreview() {
  clearTimeout(hoverTimer);
  currentHoverRow = null;
  document.getElementById('trace-source-popover')?.hidePopover();
}

document.addEventListener('mouseover', (evt) => {
  const row = evt.target.closest('.trace-row[data-node-id]');
  if (!row || row === currentHoverRow) return;
  currentHoverRow = row;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => showSourcePreview(row), 150);
});

document.addEventListener('mouseout', (evt) => {
  const row = evt.target.closest('.trace-row[data-node-id]');
  if (!row || row !== currentHoverRow) return;
  // Moving within the same row (e.g. onto a child element) isn't leaving it.
  if (evt.relatedTarget && row.contains(evt.relatedTarget)) return;
  hideSourcePreview();
});

document.addEventListener('click', (evt) => {
  const row = evt.target.closest('.trace-row[data-file]');
  if (!row || evt.target.closest('.trace-chevron')) return;
  window.sk.trace.openSource(row.dataset.file, Number(row.dataset.line));
});

// Enter in the search field jumps to the next match and scrolls it into view, cycling back to
// the first once past the last. Purely client-side (no server round trip): a search already
// marks matches with .trace-row-match and expands every ancestor needed to make them visible
// (trace.ts's searchTree/expandToMatches), so by the time the debounced search has landed,
// every match is already a real, visible element to walk through.
let matchIndex = -1;

document.addEventListener('input', (evt) => {
  if (evt.target.matches('input[type="search"]')) {
    matchIndex = -1;
  }
});

document.addEventListener('keydown', (evt) => {
  if (evt.key !== 'Enter' || !evt.target.matches('input[type="search"]')) return;
  const matches = document.querySelectorAll('.trace-row-match');
  if (matches.length === 0) return;
  evt.preventDefault();
  matchIndex = (matchIndex + 1) % matches.length;
  matches[matchIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
});

// Cmd/Ctrl+A (select-all) inside the search field: VS Code's own "Select All" keybinding can
// intercept this before it ever reaches a doubly-nested webview -> iframe -> input, since VS
// Code's focus-aware keybinding suppression is built around its own top-level webview content,
// not a further iframe nested inside it. Handling it explicitly here is a harmless no-op if the
// browser's native behavior already worked, and a real fix if VS Code's own binding got there
// first.
document.addEventListener('keydown', (evt) => {
  const mod = evt.metaKey || evt.ctrlKey;
  // !shiftKey: Cmd/Ctrl+Shift+A is a separate relay (below), not select-all.
  if (mod && !evt.shiftKey && evt.key.toLowerCase() === 'a' && evt.target.matches('input[type="search"]')) {
    evt.preventDefault();
    evt.target.select();
  }
});

// Command Palette - same relay as the Skein panel's main.js (see its own comment for why this is
// needed): VS Code's webview-forwarding bridge only reaches the outer webview shell
// (getTraceWebviewHtml in extension.ts), not this nested localhost iframe where keydowns
// actually land. Posted up via postMessage; the shell re-dispatches a synthetic keydown that VS
// Code's bridge can forward to workbench.action.showCommands (package.json's
// contributes.keybindings, scoped to focusedView == 'dialogIdeTraceView').
document.addEventListener('keydown', (evt) => {
  const mod = evt.metaKey || evt.ctrlKey;
  if (mod && evt.shiftKey && evt.code === 'KeyA') {
    evt.preventDefault();
    window.parent.postMessage(
      { type: 'forward-keydown', key: 'a', code: 'KeyA', metaKey: evt.metaKey, ctrlKey: evt.ctrlKey, shiftKey: true, altKey: false },
      '*'
    );
  }
});
