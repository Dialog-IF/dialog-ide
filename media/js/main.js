// Client-side JS the server-rendered skein page relies on, invoked either directly from
// data-on:*/data-init hiccup attributes or triggered server-side via an execute-script SSE
// event (see service.ts's broadcastScript). Ported from dialog-tool's own main.js - just the
// one function this pass needs, not the whole file (search, tree-pane drag, etc. don't exist
// here yet).
window.sk = {
  resetAndFocusCommandInput() {
    const el = document.getElementById('new-command-input');
    if (el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.focus({ preventScroll: true });
    }
  }
};
