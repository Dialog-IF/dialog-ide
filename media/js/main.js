// Client-side JS the server-rendered skein page relies on. Actual event dispatch to the server
// (click -> POST) is Datastar's job via data-on:*="@post(...)" attributes baked directly into
// the server-rendered markup (see render.ts/tree-pane.ts) - this file only holds what Datastar
// has no opinion about: focus management, SVG drawing, drag math, and popover positioning.
window.sk = {
  // scrollToKnotId (service.ts's select-knot/new-child broadcasts) scrolls that knot's own
  // transcript row into view instead of the command input - the transcript always shows the
  // whole spine root-to-leaf regardless of which knot on it was clicked (tree.ts's selectKnot
  // never truncates it), so scrolling to the input alone only happened to land on the right knot
  // when it was already the leaf; clicking any ancestor scrolled straight past it to the bottom.
  // Omitted (handleSendCommand/handleSseConnect's own bare calls) falls back to the input itself -
  // correct there since a just-run command's new response is always the last thing shown, right
  // above it.
  //
  // Only focuses the input when the target is the spine's actual leaf (or unspecified) - there's
  // nothing to type into anyway unless you're actually looking at the spine's end.
  resetAndFocusCommandInput(scrollToKnotId) {
    // Deferred, not run inline: this executes from a dynamically-appended <script> patch
    // (service.ts's sendScript), which can run before Datastar has fully finished settling the
    // *separate*, immediately-preceding content patch in the same SSE stream - the two are
    // independent datastar-patch-elements events, not one atomic update. A single
    // requestAnimationFrame (the fix used elsewhere in this file, e.g. initTreeGraph's own
    // MutationObserver-triggered drawTreeArrows) was NOT enough here and left scrollIntoView a
    // silent no-op - confirmed by direct comparison against a real running instance of this page,
    // embedded the same way extension.ts's outer webview embeds it (an iframe next to a
    // position:sticky sibling, the tree pane): identical code, only the delay changed, and only a
    // real ~150ms setTimeout reliably let whatever else still needed to settle finish first. A
    // plain rAF, and even rAF-then-rAF, both still landed too early in testing.
    setTimeout(() => {
      const el = document.getElementById('new-command-input');
      const isLeaf = scrollToKnotId == null || scrollToKnotId === spineLeafId();
      if (el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const knotEl = scrollToKnotId != null && document.getElementById(`knot-${scrollToKnotId}`);
      if (knotEl) {
        // block: 'center', not 'nearest' - also verified empirically: 'nearest' and 'end' silently
        // no-op for a transcript row in this layout, while 'start' and 'center' reliably scroll.
        // 'center' keeps some surrounding context visible instead of jamming the knot against the
        // very top edge.
        knotEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        // No specific knot (or it wasn't found) - fall back to the input itself, where 'nearest'
        // has always worked reliably (it's the last element in the column, so "nearest" and
        // "aligned to the bottom" naturally coincide).
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      if (isLeaf) {
        el?.focus({ preventScroll: true });
      }
    }, 150);
  },

  // An acknowledging flash (service.ts's broadcastFlash) - ported near-verbatim from dialog-tool's
  // own sk.showFlash: top-center, one at a time (a new flash dismisses whatever's currently
  // showing rather than stacking), fades in then auto-dismisses. Built client-side rather than
  // server-rendered into renderApp, so the ordinary #skein-app morph a tree change triggers can
  // never clip one mid-display. type is 'info' (default; blue, no dismiss button, auto-fades) or
  // 'error' (red, persists until the user dismisses it via the X button or Escape) - service.ts's
  // broadcastFlash sends 'error' for a rejected action with no other UI to surface through (e.g.
  // deleting a knot with a locked descendant), since postAction's fire-and-forget callers never
  // look at the response.
  _dismissFlash() {
    if (this._flashTimer) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    if (this._flashEl) {
      this._flashEl.remove();
      this._flashEl = null;
    }
  },

  showFlash(message, type = 'info') {
    const isError = type === 'error';
    this._dismissFlash();

    const wrapper = document.createElement('div');
    wrapper.className = 'fixed top-20 left-1/2 -translate-x-1/2 z-50';
    wrapper.style.pointerEvents = isError ? 'auto' : 'none';

    const inner = document.createElement('div');
    inner.className = isError
      ? 'flex items-center gap-3 bg-red-600 text-white px-6 py-3 rounded-lg shadow-lg'
      : 'bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg transition-opacity duration-500';
    if (!isError) inner.style.opacity = '0';

    const msg = document.createElement('span');
    msg.textContent = message;
    inner.appendChild(msg);

    if (isError) {
      inner.setAttribute('tabindex', '-1');
      inner.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._dismissFlash();
      });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ml-2 opacity-80 hover:opacity-100 text-lg font-bold cursor-pointer';
      btn.textContent = '✕';
      btn.addEventListener('click', () => this._dismissFlash());
      inner.appendChild(btn);
    }

    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    this._flashEl = wrapper;

    if (isError) {
      inner.focus();
    } else {
      requestAnimationFrame(() => {
        inner.style.opacity = '1';
        this._flashTimer = setTimeout(() => {
          inner.style.opacity = '0';
          this._flashTimer = setTimeout(() => this._dismissFlash(), 600);
        }, 2000);
      });
    }
  },

  // A centered progress modal for Replay All (service.ts's ProgressHost implementation) - ported
  // visually from dialog-tool's modals/progress + components/modal.clj (backdrop, centered white
  // panel, header/body layout, <progress> bar), but with a Cancel button that actually works:
  // dialog-tool's own sets a :continue flag that's never read anywhere in its codebase, so
  // clicking it does nothing there. Here it POSTs to /actions/cancel-replay, which flips the
  // CancellationToken session.ts's replayTo checks between each replayed command (see service.ts's
  // withProgress/cancelCurrentReplay).
  showProgress(title, cancellable) {
    this.hideProgress();

    const overlay = document.createElement('div');
    overlay.id = 'progress-modal';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-grayscale';

    const panel = document.createElement('div');
    panel.className = 'bg-base-100 rounded-lg shadow-xl max-w-full min-w-md mx-4';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'px-6 py-4 border-b border-base-200';
    const heading = document.createElement('h3');
    heading.className = 'text-lg font-medium text-base-content';
    heading.textContent = title;
    header.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'px-6 py-4';

    const statusRow = document.createElement('div');
    statusRow.className = 'flex justify-between mb-2';
    const percentEl = document.createElement('span');
    percentEl.id = 'progress-modal-percent';
    percentEl.className = 'text-sm font-medium text-base-content';
    percentEl.textContent = '0%';
    const labelEl = document.createElement('span');
    labelEl.id = 'progress-modal-label';
    labelEl.className = 'text-sm text-base-content opacity-70';
    statusRow.append(percentEl, labelEl);

    const bar = document.createElement('progress');
    bar.id = 'progress-modal-bar';
    bar.className = 'progress progress-primary w-full';
    bar.value = 0;
    bar.max = 100;
    bar.setAttribute('aria-label', title);

    body.append(statusRow, bar);

    if (cancellable) {
      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex justify-end gap-2 mt-4';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-neutral';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        fetch('/actions/cancel-replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      });
      buttonRow.appendChild(cancelBtn);
      body.appendChild(buttonRow);
    }

    panel.append(header, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  },

  updateProgress(percent, message) {
    const bar = document.getElementById('progress-modal-bar');
    if (bar) bar.value = percent;
    const percentEl = document.getElementById('progress-modal-percent');
    if (percentEl) percentEl.textContent = Math.round(percent) + '%';
    const labelEl = document.getElementById('progress-modal-label');
    if (labelEl) labelEl.textContent = message || '';
  },

  hideProgress() {
    const el = document.getElementById('progress-modal');
    if (el) el.remove();
  },

  // A real modal (OK/Cancel, Escape-to-cancel) for editing a knot's label - replaces an earlier
  // window.prompt()-based attempt, which VS Code's webview sandbox (no allow-modals) silently
  // swallows entirely. Built the same way as showProgress above: plain DOM construction, not
  // server-rendered Datastar markup, since there's no session-level "which modal is open" state
  // worth tracking server-side for something this transient. Submitting POSTs to /actions/set-label
  // directly; a 409 (tree.ts's LabelConflictError - labels are tree-unique) shows its message
  // inline via the alert-error block and leaves the modal open with the input focused for another
  // try, rather than closing on failure. Success (204) relies on the session's own 'change'
  // broadcast to re-render the knot's label chip - this modal only ever closes itself, never
  // touches #skein-app.
  showLabelModal(knotId, currentLabel) {
    this.hideLabelModal();
    // The trigger is a menu item inside an open dropdown - that dropdown's content is a native
    // Popover (see knot-menu.ts's own doc comment on why), which renders in the browser's top
    // layer, *above* this modal's plain fixed/z-50 overlay regardless of z-index. Left open, it
    // would keep visually covering the modal until some unrelated click closed it. closeAllDropdowns
    // (below) is the same close-and-sync-with-server logic the outside-click listener already uses.
    closeAllDropdowns();

    const overlay = document.createElement('div');
    overlay.id = 'label-modal';
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-grayscale';

    const panel = document.createElement('div');
    panel.className = 'bg-base-100 rounded-lg shadow-xl max-w-full min-w-md mx-4';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('tabindex', '-1');

    const header = document.createElement('div');
    header.className = 'px-6 py-4 border-b border-base-200';
    const heading = document.createElement('h3');
    heading.className = 'text-lg font-medium text-base-content';
    heading.textContent = 'Edit Label';
    header.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'px-6 py-4';

    const errorEl = document.createElement('div');
    errorEl.className = 'alert alert-error text-sm mb-3 hidden';
    errorEl.setAttribute('role', 'alert');
    errorEl.setAttribute('aria-live', 'assertive');
    body.appendChild(errorEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input input-bordered w-full';
    input.value = currentLabel || '';
    input.placeholder = 'Label (blank to clear)';
    input.setAttribute('aria-label', 'Label');
    body.appendChild(input);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'flex justify-end gap-2 mt-4';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-neutral';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.hideLabelModal());

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = 'OK';
    const submit = async () => {
      errorEl.classList.add('hidden');
      let res;
      try {
        res = await fetch('/actions/set-label', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ knotId, label: input.value })
        });
      } catch {
        errorEl.textContent = 'Failed to reach the server.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (res.status === 204) {
        this.hideLabelModal();
        return;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        errorEl.textContent = body.error || 'That label is already in use.';
      } else {
        errorEl.textContent = 'Failed to save label.';
      }
      errorEl.classList.remove('hidden');
      input.focus();
      input.select();
    };
    okBtn.addEventListener('click', submit);

    buttonRow.append(cancelBtn, okBtn);
    body.appendChild(buttonRow);

    panel.append(header, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hideLabelModal();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        // Native Cmd/Ctrl+A select-all doesn't reach the input reliably inside a VS Code webview
        // (the same class of platform quirk documented elsewhere in this file - see the keydown
        // accelerator listener below on why Option+letter needs evt.code instead of evt.key), so
        // this does it explicitly rather than relying on the browser default.
        e.preventDefault();
        input.select();
      }
    });

    input.focus();
    input.select();
  },

  hideLabelModal() {
    document.getElementById('label-modal')?.remove();
  },

  // ---------------------------------------------------------------------------
  // Tree/graph pane: SVG connector lines + drag-to-pan.
  // Ported from dialog-tool's own main.js (initTreeGraph/drawTreeArrows) - same element ids
  // (#tree-pane, [data-tree-node-id], [data-parent-id], [data-active-knot]) so this applies
  // unchanged to tree-pane.ts's markup.

  _treeGraphReady: false,
  _arrowSvg: null,

  initTreeGraph() {
    if (this._treeGraphReady) return;
    this._treeGraphReady = true;

    const pane = document.getElementById('tree-pane');
    if (!pane) return;

    requestAnimationFrame(() => this.drawTreeArrows());
    const self = this;
    const observer = new MutationObserver(() => {
      observer.disconnect();
      requestAnimationFrame(() => {
        self.drawTreeArrows();
        observer.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-active-knot'] });
      });
    });
    observer.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-active-knot'] });

    new ResizeObserver(() => requestAnimationFrame(() => self.drawTreeArrows())).observe(pane);

    // Drag-to-scroll (pan): clicking the pane background and dragging scrolls the pane. Clicks
    // on interactive descendants (the node pill, the "..." trigger) are left alone so they still
    // fire their own data-on:click handlers. The pill is a div[role="button"] rather than a real
    // <button> (it has to contain the menu's nested <details>), so that's excluded explicitly
    // alongside the genuine form controls.
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let scrollX = 0;
    let scrollY = 0;

    pane.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea, [role="button"], details')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollX = pane.scrollLeft;
      scrollY = pane.scrollTop;
      pane.style.cursor = 'grabbing';
      pane.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      pane.scrollLeft = scrollX - (e.clientX - startX);
      pane.scrollTop = scrollY - (e.clientY - startY);
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      pane.style.cursor = '';
      pane.style.userSelect = '';
    });
  },

  drawTreeArrows() {
    const pane = document.getElementById('tree-pane');
    if (!pane) return;

    this._arrowSvg?.remove();
    this._arrowSvg = null;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(svg.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: pane.scrollWidth + 'px',
      height: pane.scrollHeight + 'px',
      overflow: 'visible',
      pointerEvents: 'none'
    });

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'tree-arrow');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '5');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tip.setAttribute('d', 'M0,0 L0,6 L6,3 z');
    tip.setAttribute('fill', 'currentColor');
    marker.appendChild(tip);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const paneRect = pane.getBoundingClientRect();
    const scrollLeft = pane.scrollLeft;
    const scrollTop = pane.scrollTop;
    const nodes = {};
    pane.querySelectorAll('[data-tree-node-id]').forEach((el) => {
      const id = el.getAttribute('data-tree-node-id');
      const pid = el.getAttribute('data-parent-id'); // absent on root
      const r = el.getBoundingClientRect();
      nodes[id] = {
        parentId: pid || null,
        cx: r.left - paneRect.left + scrollLeft + r.width / 2,
        top: r.top - paneRect.top + scrollTop,
        bottom: r.bottom - paneRect.top + scrollTop
      };
    });

    for (const n of Object.values(nodes)) {
      if (!n.parentId || !nodes[n.parentId]) continue;
      const p = nodes[n.parentId];
      const x1 = p.cx;
      const y1 = p.bottom;
      const x2 = n.cx;
      const y2 = n.top;
      const gap = Math.min(Math.abs(y2 - y1) / 3, 36);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${x1},${y1 + gap} ${x1},${y2 - gap} ${x2},${y2}`);
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-opacity', '0.35');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#tree-arrow)');
      svg.appendChild(path);
    }

    this._arrowSvg = svg;
    pane.appendChild(svg);

    const activeId = pane.getAttribute('data-active-knot');
    if (activeId) {
      pane.querySelector(`[data-tree-node-id="${activeId}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  },

  // ---------------------------------------------------------------------------
  // Tree pane drag-to-resize. Ported from dialog-tool's own main.js, same element ids
  // (#tree-pane-handle, #tree-pane-outer) as render.ts's renderApp.

  _treePaneResizeReady: false,

  initTreePaneResize() {
    if (this._treePaneResizeReady) return;
    this._treePaneResizeReady = true;

    const handle = document.getElementById('tree-pane-handle');
    const pane = document.getElementById('tree-pane-outer');
    if (!handle || !pane) return;

    let currentWidth = localStorage.getItem('treePaneWidth') || null;
    if (currentWidth) pane.style.width = currentWidth;

    new MutationObserver(() => {
      if (currentWidth && pane.style.width !== currentWidth) {
        pane.style.width = currentWidth;
      }
    }).observe(pane, { attributes: true, attributeFilter: ['style'] });

    handle.addEventListener('mousedown', (startEvt) => {
      startEvt.preventDefault();
      const startX = startEvt.clientX;
      const startWidth = pane.getBoundingClientRect().width;

      const onMove = (e) => {
        const delta = e.clientX - startX;
        const maxWidth = Math.floor(window.innerWidth * 0.8);
        currentWidth = Math.min(maxWidth, Math.max(160, startWidth + delta)) + 'px';
        pane.style.width = currentWidth;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (currentWidth) localStorage.setItem('treePaneWidth', currentWidth);
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // The per-knot actions menu (knot-menu.ts's renderKnotMenu) needs almost no client-side code:
  // it's a native <details class="dropdown dropdown-right"> inline in each knot's own markup,
  // opened by posting to /actions/open-graph-menu or /actions/open-transcript-menu (a plain
  // Datastar data-on:click on the trigger, like everything else in this UI) and positioned by plain
  // daisyUI .dropdown/.dropdown-content CSS - the server decides which knot's menu is open in
  // each pane separately (session.ts's graphMenuId/transcriptMenuId) and sets the native `open`
  // attribute directly in the re-rendered markup, plus toggles the dropdown-content's own
  // popover="manual" via a data-effect (see knot-menu.ts's doc comment for why it's a real
  // top-layer popover, and why "manual" rather than the default "auto"). "manual" means nothing
  // ever closes it but that explicit toggle - not outside clicks, not Escape - so the listener
  // below is what actually provides the outside-click-to-close a user expects.
};

// Closes every open per-knot dropdown, both visually (removing `open`/hiding the Popover, for
// instant feedback) and server-side (POST /actions/close-menus keeps session.ts's graphMenuId/
// transcriptMenuId in sync, so a later unrelated SSE patch doesn't re-open it). Shared by the
// outside-click listener below and sk.showLabelModal, which needs the same cleanup when its
// trigger was a menu item inside a still-open dropdown.
function closeAllDropdowns() {
  const openMenus = document.querySelectorAll('details.dropdown[open]');
  if (openMenus.length === 0) return;
  openMenus.forEach((details) => {
    details.removeAttribute('open');
    details.querySelector('[popover]')?.togglePopover(false);
  });
  fetch('/actions/close-menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

// Clicking outside the open dropdown closes it. Skips anything inside a .dropdown entirely - a
// click on a trigger (opening a different knot's menu) or a menu item is already handled by its
// own data-on:click, including closing this one server-side as a side effect (every mutating
// action and plain navigation already calls session.closeAllMenus() - see session.ts).
document.addEventListener('click', (evt) => {
  if (evt.target.closest('.dropdown')) return;
  closeAllDropdowns();
});

// ---------------------------------------------------------------------------
// Keyboard accelerators - mirrors dialog-tool's own Cmd/Option-based scheme (doc/skein.md),
// adapted to dialog-ide's actual routes. One capturing document-level keydown listener,
// intentionally global rather than scoped to "focus is outside a text field": the command input
// auto-refocuses after nearly every action (sk.resetAndFocusCommandInput), so excluding INPUT/
// TEXTAREA focus would make every shortcut below fire almost never, and none of these modifier
// combos (Cmd, Option) are part of normal command typing anyway - same reasoning undo/redo
// already used. Suppressed while the progress modal is up (a replay is already in flight; its own
// Cancel button is the only control that makes sense then).
//
// Knot-scoped shortcuts (Option+letter, no Shift) act on whichever knot is currently active, not
// whichever knot's menu happens to be open/hovered - read from #tree-pane's data-active-knot, the
// same attribute drawTreeArrows already relies on. Root-only guards (id 0 can't be locked,
// labeled, or deleted) mirror knot-menu.ts's own menuItemClass(isRoot) disabling - skipping
// server-side here rather than letting session.ts throw into an unhandled 500.

function postAction(path, body) {
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

function activeKnotId() {
  const raw = document.getElementById('tree-pane')?.getAttribute('data-active-knot');
  return raw ? Number(raw) : null;
}

function spineLeafId() {
  const raw = document.querySelector('nav')?.getAttribute('data-spine-leaf-id');
  return raw ? Number(raw) : null;
}

// ⌥L's target: the knot's current label, read off the "Edit Label" menu button's own
// data-current-label attribute (knot-menu.ts) rather than requiring the dropdown to be open -
// that attribute exists in the DOM regardless of the <details>'s open/closed state.
function currentLabelOf(knotId) {
  return document.querySelector(`#knot-${knotId} [data-current-label]`)?.dataset.currentLabel ?? '';
}

document.addEventListener('keydown', (evt) => {
  if (document.getElementById('progress-modal') || document.getElementById('label-modal')) return;

  const mod = evt.metaKey || evt.ctrlKey;
  const opt = evt.altKey;
  // Cmd/Ctrl never recompose a letter key, so evt.key (plain 's'/'z') is fine for the mod branch
  // below. Option does recompose it on macOS - Option+R types "®", not "r" - so evt.key would
  // never match the letters below and the shortcut would silently fall through to inserting that
  // composed character into whatever's focused instead of calling preventDefault(). evt.code (the
  // physical key position, e.g. "KeyR") is layout/composition-independent and unaffected by
  // Option, so every opt-branch check below matches on that instead.
  const key = evt.key.toLowerCase();
  const code = evt.code;

  // Tree-wide.
  if (mod && !opt && key === 's') {
    evt.preventDefault();
    postAction('/actions/save');
    return;
  }
  if (mod && !opt && key === 'z') {
    evt.preventDefault();
    postAction(evt.shiftKey ? '/actions/redo' : '/actions/undo');
    return;
  }
  if (opt && evt.shiftKey && code === 'KeyR') {
    evt.preventDefault();
    postAction('/actions/replay-all');
    return;
  }
  if (opt && evt.shiftKey && code === 'KeyB') {
    evt.preventDefault();
    const knotId = spineLeafId();
    if (knotId !== null) postAction('/actions/bless-changes', { knotId });
    return;
  }

  // Knot-scoped - act on the active knot.
  if (opt && !evt.shiftKey) {
    const knotId = activeKnotId();
    if (knotId === null) return;

    if (code === 'KeyB') {
      evt.preventDefault();
      postAction('/actions/bless-knot', { knotId });
    } else if (code === 'KeyR') {
      evt.preventDefault();
      postAction('/actions/replay-to', { knotId });
    } else if (code === 'KeyA') {
      evt.preventDefault();
      postAction('/actions/new-child', { knotId });
    } else if (code === 'KeyK' && knotId !== 0) {
      evt.preventDefault();
      postAction('/actions/toggle-lock', { knotId });
    } else if (code === 'KeyD' && knotId !== 0) {
      evt.preventDefault();
      postAction('/actions/delete-knot', { knotId });
    } else if (code === 'KeyL' && knotId !== 0) {
      evt.preventDefault();
      sk.showLabelModal(knotId, currentLabelOf(knotId));
    }
  }
});
