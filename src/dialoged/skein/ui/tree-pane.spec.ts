import { SkeinTree } from '../tree';
import { renderTreePane } from './tree-pane';

/**
 * The full pill markup (a div[role="button"], not a real <button> - it has to contain the
 * menu's nested <details>) for the node with the given tree-node id, including its nested menu.
 */
function nodeHtml(html: string, id: number): string {
  const idAttrIndex = html.indexOf(`data-tree-node-id="${id}"`);
  const openIndex = html.lastIndexOf('<div role="button"', idAttrIndex);
  const endMarker = '</details></span></div>';
  const endIndex = html.indexOf(endMarker, idAttrIndex) + endMarker.length;
  return html.slice(openIndex, endIndex);
}

/** The data-locked/data-has-unblessed/data-is-root attribute tail on the node's wrapper div. */
function wrapperAttrs(html: string, id: number): string {
  return html.split(`data-knot-id="${id}"`)[1].split('>')[0];
}

describe('renderTreePane', () => {
  it('renders every knot in the tree, not just the active spine', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderTreePane(tree);
    expect(html).toContain('data-tree-node-id="0"');
    expect(html).toContain('data-tree-node-id="1"');
    expect(html).toContain('data-tree-node-id="2"');
  });

  it('carries data-knot-id and data-parent-id for the arrow-drawing JS', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    expect(html).toContain('data-tree-node-id="0"');
    expect(html).not.toMatch(/data-tree-node-id="0"[^>]*data-parent-id/); // root has no parent
    expect(html).toMatch(/data-tree-node-id="1" data-parent-id="0"/);
    expect(html).toContain('data-knot-id="1"');
  });

  it('wires the node pill to select the knot on click, with no right-click affordance - plain Datastar @post', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain(`data-on:click="if (!evt.target.closest('details')) { $knotId = 1; @post('/actions/select-knot') }"`);
    expect(wrapperAttrs(html, 1)).not.toContain('data-on:contextmenu');
  });

  it('renders each node\'s actions menu inline as a native <details class="dropdown dropdown-right font-sans">, disabling root-only items and Bless Knot when nothing is pending - no client-side positioning code needed', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // never blessed - hasUnblessed
      .blessKnot(1);
    const html = renderTreePane(tree);

    const root = html.split('data-tree-node-id="0"')[1].split('data-tree-node-id="1"')[0];
    // Root: Toggle Lock (a root-only item) is disabled; nothing is pending on root either, so
    // Bless Knot is also disabled.
    expect(root).toContain(`disabled data-on:click="$knotId = 0; @post('/actions/toggle-lock')"`);
    expect(root).toContain(`disabled data-on:click="$knotId = 0; @post('/actions/bless-knot')"`);

    const knot1 = html.split('data-tree-node-id="1"')[1];
    // Knot 1 has just been blessed, nothing pending - Bless Knot is disabled; it's not root, so
    // the root-only items (e.g. Toggle Lock) are enabled.
    expect(knot1).toContain(`disabled data-on:click="$knotId = 1; @post('/actions/bless-knot')"`);
    expect(knot1).not.toContain(`disabled data-on:click="$knotId = 1; @post('/actions/toggle-lock')"`);
  });

  // tree.ts's newTree bakes command: 'START' and label: 'START' into the root knot - real,
  // typed-command knots show a label chip and a command span side by side because the two are
  // genuinely different text, but root's placeholder command is just its label repeated, so the
  // pill should show it once ("START"), not twice ("START START").
  it("shows the root knot's label once, not duplicated by its synthetic 'START' command", () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderTreePane(tree);
    const root = nodeHtml(html, 0);
    // The label chip (bold, boxed "START") still shows - only the plain command span next to it,
    // which would otherwise repeat the same placeholder text, is suppressed for root.
    expect(root).toContain('bg-neutral text-neutral-content px-1 rounded shrink-0">START</span>');
    expect(root).not.toContain('<span class="truncate font-mono text-xs">START</span>');
  });

  it("wires the menu's New Child item to its own route, and Edit Label to the modal (not prompt()), carrying the current label", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');
    const html = renderTreePane(tree);
    const knot1 = html.split('data-tree-node-id="1"')[1];

    expect(knot1).toContain(`data-on:click="$knotId = 1; @post('/actions/new-child')"`);
    expect(knot1).not.toContain('prompt(');
    expect(knot1).toContain('data-current-label="checkpoint"');
    expect(knot1).toContain('data-on:click="sk.showLabelModal(1, el.dataset.currentLabel)"');
  });

  it("wires the menu's Edit Command item to the modal, carrying the knot's current command", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    const knot1 = html.split('data-tree-node-id="1"')[1];

    expect(knot1).toContain('data-current-command="look"');
    expect(knot1).toContain('data-on:click="sk.showCommandModal(1, el.dataset.currentCommand)"');
  });

  // main.js's Option+letter accelerators always act on the active knot - see render.spec.ts's
  // equivalent test on the transcript side for the full rationale.
  it("shows keyboard-shortcut hints only on the active node's own menu items", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).setActiveKnotId(1);
    const html = renderTreePane(tree);

    const root = html.split('data-tree-node-id="0"')[1].split('data-tree-node-id="1"')[0];
    expect(root).not.toContain('title=');

    const knot1 = html.split('data-tree-node-id="1"')[1];
    expect(knot1).toContain('title="Delete (⌥D)"');
  });

  it('renders a visible "..." trigger for each node\'s menu, for discoverability and keyboard access', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    expect(html.match(/aria-label="Knot actions"/g)?.length).toBe(2); // one per node
  });

  it('opens the requested node\'s menu (and only that one) when menuKnotId matches it', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree, 1);
    const root = html.split('data-tree-node-id="0"')[1].split('data-tree-node-id="1"')[0];
    const knot1 = html.split('data-tree-node-id="1"')[1];
    expect(root).not.toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-0">');
    expect(knot1).toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">');
  });

  it('marks the active knot with border-primary and aria-pressed="true"', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('border-primary');
    expect(knot1).toContain('aria-pressed="true"');
  });

  it('escapes command text and renders a status icon for a new (never-blessed) knot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, '<script>', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('icon-warning');
    expect(knot1).toContain('bg-warning');
  });

  it('tints an error knot distinctly from a new one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'original', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'changed', inputType: 'line' });
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('icon-error');
    expect(knot1).toContain('bg-error');
  });

  it('shows a lock icon and label chip for a locked, labeled knot', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint')
      .setLockStatus(1, true);
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('icon-lock');
    expect(knot1).toContain('checkpoint');
  });

  it('renders siblings side by side and a lone child directly beneath its parent', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'c', inputType: 'line' });
    const html = renderTreePane(tree);
    // Root has two children (1, 2) - rendered side by side.
    expect(html).toContain('flex flex-row items-start gap-6');
    // Knot 1 has a single child (3) - no side-by-side wrapper needed for that pair.
    const afterKnot1 = html.split('data-tree-node-id="1"')[1];
    const beforeKnot3 = afterKnot1.split('data-tree-node-id="3"')[0];
    expect(beforeKnot3).not.toContain('flex flex-row items-start gap-6');
  });

  describe('expand/collapse toggle', () => {
    it('renders no toggle for a childless knot', () => {
      const tree = SkeinTree.newTree('dgdebug', 1);
      const html = renderTreePane(tree);
      expect(html).not.toContain("@post('/actions/toggle-tree-node')");
    });

    it('renders a toggle for a knot with children, wired to its own id', () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const html = renderTreePane(tree);
      expect(html).toContain(`$knotId = 0; @post('/actions/toggle-tree-node')`);
    });

    it('omits a collapsed knot\'s children entirely, but still renders its own toggle', () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).toggleCollapsed(0);
      const html = renderTreePane(tree);
      expect(html).not.toContain('data-tree-node-id="1"');
      expect(html).toContain(`$knotId = 0; @post('/actions/toggle-tree-node')`);
      expect(html).toContain('aria-label="Expand"');
      expect(html).toContain('aria-expanded="false"');
    });

    it('renders every knot when nothing is collapsed (the default)', () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
      const html = renderTreePane(tree);
      expect(html).toContain('data-tree-node-id="1"');
      expect(html).toContain('aria-label="Collapse"');
      expect(html).toContain('aria-expanded="true"');
    });
  });
});
