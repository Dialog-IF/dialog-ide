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

  // Edit Command's modal - near-identical to showLabelModal above, except a blank command is
  // rejected client-side (never even POSTed) rather than treated as "clear" the way a blank label
  // is, since a knot has to have *some* command text. A command matching a sibling's is no longer
  // a rejection (service.ts's setCommand merges the two knots together instead - see tree.ts's
  // mergeSiblingInto). Success (204) relies on the session's own 'change' broadcast to refresh
  // the knot's response (service.ts's setCommand replays it under the corrected text) - this
  // modal never touches #skein-app directly, same as the label modal.
  showCommandModal(knotId, currentCommand) {
    this.hideCommandModal();
    closeAllDropdowns();

    const overlay = document.createElement('div');
    overlay.id = 'command-modal';
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
    heading.textContent = 'Edit Command';
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
    input.className = 'input input-bordered w-full font-mono';
    input.value = currentCommand || '';
    input.placeholder = 'Command';
    input.setAttribute('aria-label', 'Command');
    body.appendChild(input);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'flex justify-end gap-2 mt-4';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-neutral';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.hideCommandModal());

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = 'OK';
    const submit = async () => {
      errorEl.classList.add('hidden');
      if (input.value.trim() === '') {
        errorEl.textContent = 'Command cannot be blank.';
        errorEl.classList.remove('hidden');
        input.focus();
        return;
      }
      let res;
      try {
        res = await fetch('/actions/set-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ knotId, command: input.value })
        });
      } catch {
        errorEl.textContent = 'Failed to reach the server.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (res.status === 204) {
        this.hideCommandModal();
        return;
      }
      errorEl.textContent = 'Failed to save command.';
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
        this.hideCommandModal();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        input.select();
      }
    });

    input.focus();
    input.select();
  },

  hideCommandModal() {
    document.getElementById('command-modal')?.remove();
  },

  // Insert Parent's modal - near-identical to showCommandModal above (same field, same
  // Escape/Enter/Cmd+A keydown wiring), with three deliberate differences: the field always
  // starts blank (it's the new knot's own command, not a rename of the existing one, so there's
  // no "current" text to pre-fill or select-all on open), the heading/placeholder/endpoint are
  // its own, and success moves the active knot (service.ts's handleInsertParent broadcasts its
  // own resetAndFocusCommandInput) rather than just refreshing the edited knot in place.
  showInsertParentModal(knotId) {
    this.hideInsertParentModal();
    closeAllDropdowns();

    const overlay = document.createElement('div');
    overlay.id = 'insert-parent-modal';
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
    heading.textContent = 'Insert Parent';
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
    input.className = 'input input-bordered w-full font-mono';
    input.placeholder = 'New command';
    input.setAttribute('aria-label', 'Command');
    body.appendChild(input);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'flex justify-end gap-2 mt-4';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-neutral';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.hideInsertParentModal());

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = 'OK';
    const submit = async () => {
      errorEl.classList.add('hidden');
      if (input.value.trim() === '') {
        errorEl.textContent = 'Command cannot be blank.';
        errorEl.classList.remove('hidden');
        input.focus();
        return;
      }
      let res;
      try {
        res = await fetch('/actions/insert-parent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ knotId, command: input.value })
        });
      } catch {
        errorEl.textContent = 'Failed to reach the server.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (res.status === 204) {
        this.hideInsertParentModal();
        return;
      }
      errorEl.textContent = 'Failed to insert parent.';
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
        this.hideInsertParentModal();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        input.select();
      }
    });

    input.focus();
  },

  hideInsertParentModal() {
    document.getElementById('insert-parent-modal')?.remove();
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
    //
    // Pointer events + setPointerCapture, not plain mouse events on document: this pane lives
    // inside the skein webview's own iframe, so a document-level mouseup listener never fires at
    // all if the button is released outside that iframe (or outside the VS Code window entirely,
    // e.g. dragging past its edge) - dragging was left stuck true forever, and the pane kept
    // panning on the next mousemove even with the button up (regression reported after the dot-
    // grid background made panning motion visible enough to notice).
    //
    // setPointerCapture alone isn't enough here: it doesn't reliably survive the pointer leaving
    // this webview's own iframe for VS Code's surrounding chrome (a separate frame/document our
    // script has no visibility into at all), so a release out there can still go unseen. Two
    // independent backstops cover that: (1) document's pointerleave - unlike move/up, per spec
    // enter/leave events keep targeting wherever the pointer actually is even while captured, so
    // this reliably fires the instant the cursor exits the iframe, and we proactively end the
    // drag right then (we'd get no further events out there to track anyway); (2) e.buttons on
    // every pointermove we do still receive - a direct, always-accurate read of which buttons are
    // physically down *right now*, independent of whether we ever saw the up/cancel event for
    // this pointer - catches the drag having ended out-of-frame if the cursor re-enters afterward
    // with the button already released.
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let scrollX = 0;
    let scrollY = 0;

    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      pane.style.cursor = '';
      pane.style.userSelect = '';
    };

    pane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea, [role="button"], details')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollX = pane.scrollLeft;
      scrollY = pane.scrollTop;
      pane.style.cursor = 'grabbing';
      pane.style.userSelect = 'none';
      pane.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    pane.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if ((e.buttons & 1) === 0) {
        stopDragging();
        return;
      }
      pane.scrollLeft = scrollX - (e.clientX - startX);
      pane.scrollTop = scrollY - (e.clientY - startY);
    });

    pane.addEventListener('pointerup', stopDragging);
    pane.addEventListener('pointercancel', stopDragging);
    document.addEventListener('pointerleave', stopDragging);
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
      // Elbow connector: straight down from the parent, a sharp turn to horizontal at the
      // midpoint, then a slightly curved turn back to vertical into the child.
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (x1 === x2) {
        path.setAttribute('d', `M${x1},${y1} L${x2},${y2}`);
      } else {
        const ymid = (y1 + y2) / 2;
        const dir = x2 > x1 ? 1 : -1;
        const r = Math.min(10, Math.abs(x2 - x1) / 2, Math.max(0, y2 - ymid));
        const xTurn = x2 - dir * r;
        path.setAttribute(
          'd',
          `M${x1},${y1} L${x1},${ymid} L${xTurn},${ymid} Q${x2},${ymid} ${x2},${ymid + r} L${x2},${y2}`
        );
      }
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
  },

  // The search box's own ArrowUp/ArrowDown navigation (render.ts's renderSearchBox/
  // renderSearchResults - SEARCH_RESULT_KEYDOWN calls this from both the input and every result
  // button). Without this, ArrowDown/ArrowUp inside the results dropdown just did the browser's
  // default thing - scrolled the (overflow-y-auto) list - instead of moving between results, since
  // there's no native way to make plain buttons in a list behave like a real listbox. current is
  // whichever element the keydown fired on (el, via Datastar); direction is 1 (down) or -1 (up).
  // Clamps at the last result rather than wrapping - going past the first one refocuses the input,
  // a normal combobox convention - so there's always an obvious way back to typing.
  navigateSearchResults(current, direction) {
    const results = Array.from(document.querySelectorAll('[data-search-result]'));
    if (results.length === 0) return;

    const currentIndex = results.indexOf(current);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0) {
      document.getElementById('skein-search-input')?.focus();
      return;
    }
    results[Math.min(results.length - 1, nextIndex)]?.focus();
  },

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

// Dismisses the search box's results dropdown the same way Escape does (clears the query - see
// render.ts's renderSearchBox) - mirrors closeAllDropdowns' own direct-DOM-update-plus-raw-fetch
// shape, since a plain click listener has no Datastar action/signal access of its own. Setting
// input.value directly (rather than going through Datastar) is fine here: the POST below tells
// the server the query is now blank, and the next SSE patch re-renders the input from that
// server-side truth anyway, same as every other patched element.
function dismissSearch() {
  const input = document.getElementById('skein-search-input');
  if (!input || input.value === '') return;
  input.value = '';
  fetch('/actions/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchQuery: '' }) });
}

// Clicking outside the open dropdown closes it; clicking outside the search box dismisses its
// results the same way. Skips anything inside a .dropdown/#skein-search-box entirely - a click on
// a trigger, menu item, or search result is already handled by its own data-on:click.
document.addEventListener('click', (evt) => {
  if (!evt.target.closest('.dropdown')) closeAllDropdowns();
  if (!evt.target.closest('#skein-search-box')) dismissSearch();
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

// ⌥E's target: the knot's current command, read off the "Edit Command" menu button's own
// data-current-command attribute (knot-menu.ts) - same convention as currentLabelOf above.
function currentCommandOf(knotId) {
  return document.querySelector(`#knot-${knotId} [data-current-command]`)?.dataset.currentCommand ?? '';
}

document.addEventListener('keydown', (evt) => {
  if (
    document.getElementById('progress-modal') ||
    document.getElementById('label-modal') ||
    document.getElementById('command-modal') ||
    document.getElementById('insert-parent-modal')
  ) return;

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

  // Command Palette - VS Code's webview-forwarding bridge only reaches the outer webview shell
  // (getWebviewHtml in extension.ts), not this nested localhost iframe where keydowns actually
  // land, so there's no when-clause that can catch this directly. Instead, relay it up via
  // postMessage; the shell re-dispatches a synthetic keydown on itself, which the bridge *can*
  // see and forward on to workbench.action.showCommands (bound in package.json's
  // contributes.keybindings, scoped to activeWebviewPanelId == 'dialogIdeSkein'). Deliberately
  // narrow (just this one combo) rather than relaying every unhandled key - the same modifier
  // combos without Shift (Cmd/Ctrl+A/C/V/X/Z) have native text-editing meaning in whatever's
  // focused, which relaying would break.
  if (mod && evt.shiftKey && !opt && code === 'KeyA') {
    evt.preventDefault();
    window.parent.postMessage(
      { type: 'forward-keydown', key: 'a', code, metaKey: evt.metaKey, ctrlKey: evt.ctrlKey, shiftKey: true, altKey: false },
      '*'
    );
    return;
  }

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
  if (opt && !evt.shiftKey && code === 'KeyF') {
    evt.preventDefault();
    document.getElementById('skein-search-input')?.focus();
    return;
  }
  // First Knot / Last Knot - jump straight to root / the selected spine's leaf. Unlike every
  // other shortcut here, these (and the four plain-arrow ones below) don't need activeKnotId() -
  // session.ts's navigateSpine reads the current active knot and computes the target itself, so
  // there's nothing for the client to look up first.
  if (opt && evt.shiftKey && code === 'ArrowUp') {
    evt.preventDefault();
    postAction('/actions/navigate-spine', { direction: 'first' });
    return;
  }
  if (opt && evt.shiftKey && code === 'ArrowDown') {
    evt.preventDefault();
    postAction('/actions/navigate-spine', { direction: 'last' });
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
    } else if (code === 'KeyT') {
      // Trace - root has no parent to replay to, so its own Trace action traces startup instead
      // (same isRoot branch knot-menu.ts's Trace item uses). Doesn't check whether this knot was
      // reached via a keystroke prompt first (unlike knot-menu.ts's up-front disabling) - session.
      // ts's traceKnot itself already refuses that case safely, same as every other accelerator
      // here that doesn't pre-validate a knot's specific state before firing.
      evt.preventDefault();
      if (knotId === 0) {
        postAction('/actions/trace-startup');
      } else {
        postAction('/actions/trace-knot', { knotId });
      }
    } else if (code === 'KeyK' && knotId !== 0) {
      evt.preventDefault();
      postAction('/actions/toggle-lock', { knotId });
    } else if (code === 'KeyD' && knotId !== 0) {
      evt.preventDefault();
      postAction('/actions/delete-knot', { knotId });
    } else if (code === 'KeyL' && knotId !== 0) {
      evt.preventDefault();
      sk.showLabelModal(knotId, currentLabelOf(knotId));
    } else if (code === 'KeyE' && knotId !== 0) {
      evt.preventDefault();
      sk.showCommandModal(knotId, currentCommandOf(knotId));
    } else if (code === 'KeyX') {
      // Toggle Expand - the nav graph's ▾/▸ chevron (tree-pane.ts), otherwise mouse-only.
      evt.preventDefault();
      postAction('/actions/toggle-tree-node', { knotId });
    } else if (code === 'ArrowUp') {
      // Parent Knot.
      evt.preventDefault();
      postAction('/actions/navigate-spine', { direction: 'up' });
    } else if (code === 'ArrowDown') {
      // Child Knot (whichever child is currently on the spine).
      evt.preventDefault();
      postAction('/actions/navigate-spine', { direction: 'down' });
    } else if (code === 'ArrowLeft') {
      // Previous Sibling (alphabetical order, matching the nav graph).
      evt.preventDefault();
      postAction('/actions/navigate-spine', { direction: 'left' });
    } else if (code === 'ArrowRight') {
      // Next Sibling.
      evt.preventDefault();
      postAction('/actions/navigate-spine', { direction: 'right' });
    }
  }
});
