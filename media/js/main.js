// Client-side JS the server-rendered skein page relies on. Actual event dispatch to the server
// (click -> POST) is Datastar's job via data-on:*="@post(...)" attributes baked directly into
// the server-rendered markup (see render.ts/tree-pane.ts) - this file only holds what Datastar
// has no opinion about: focus management, SVG drawing, drag math, and popover positioning.
window.sk = {
  resetAndFocusCommandInput() {
    const el = document.getElementById('new-command-input');
    if (el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
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

// Clicking outside the open dropdown closes it. Skips anything inside a .dropdown entirely - a
// click on a trigger (opening a different knot's menu) or a menu item is already handled by its
// own data-on:click, including closing this one server-side as a side effect (every mutating
// action and plain navigation already calls session.closeAllMenus() - see session.ts). Removing
// `open`/hiding the popover here first gives instant visual feedback; the fetch just keeps the
// server in sync so a later, unrelated SSE patch doesn't re-open it.
document.addEventListener('click', (evt) => {
  if (evt.target.closest('.dropdown')) return;
  const openMenus = document.querySelectorAll('details.dropdown[open]');
  if (openMenus.length === 0) return;
  openMenus.forEach((details) => {
    details.removeAttribute('open');
    details.querySelector('[popover]')?.togglePopover(false);
  });
  fetch('/actions/close-menus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
});
