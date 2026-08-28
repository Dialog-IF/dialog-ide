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

  // Regression: #tree-pane isn't itself a flex container, so its sole child (the root's own
  // renderSubtree wrapper) is a plain block box - without an explicit width, that stretches to
  // fill the whole pane whenever the tree is narrower than it, and items-center then re-centers
  // the tree within that pane-width box instead of around its own content. That made the tree's
  // on-screen position (and therefore the expand/collapse icon vs. its SVG connector line, drawn
  // separately by main.js) depend on the pane's current width - invisible once a tree is wide
  // enough to overflow the pane (min-w-max alone already pins it there), but visible for a small
  // one. w-max pins the root wrapper to its own content width unconditionally; only the root
  // wrapper needs it - a nested wrapper is a flex item of a sibling row instead, where min-w-max's
  // job is resisting flex-shrink, not fill-vs-content sizing.
  it('sizes the root wrapper to its own content width (w-max), not the pane\'s, so tree position never depends on pane width', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree);
    expect(html).toContain('<div class="flex flex-col items-center gap-10 min-w-max w-max origin-top-left" id="tree-pane-content" data-preserve-attr="style">');
    // Only the root wrapper - the recursive per-child call still gets the plain, un-widened class.
    expect(html).toContain('<div class="flex flex-col items-center gap-10 min-w-max">');
  });

  // Regression: spineIds used to walk up from activeKnotId (via parentId) rather than from the
  // selected spine's actual leaf (getSelectedLeafId), so navigating back to an ancestor left every
  // already-explored knot between it and the leaf marked off-spine (dim/neutral) even though the
  // transcript still shows them as part of the same spine (render.ts's selectedKnots, which always
  // walks root->selectedChild-leaf, not root->activeKnotId).
  it('keeps already-explored knots below the active knot colored as on-spine, not off-spine, after navigating back to an ancestor', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .blessKnot(1)
      .addChild(1, 'take orb', { text: 'b', inputType: 'line' })
      .blessKnot(2)
      .setActiveKnotId(1); // back up to knot 1 - knot 2 is still selectedChild, still on-spine

    const html = renderTreePane(tree);

    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('bg-primary text-primary-content'); // active knot itself
    const knot2 = nodeHtml(html, 2);
    expect(knot2).toContain('bg-primary-content text-primary'); // on-spine, not active
    expect(knot2).not.toContain('bg-neutral-content text-neutral'); // was: off-spine
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

    // Menu content is only ever rendered for the one knot whose menu is open (see knot-menu.ts),
    // so root and knot 1 each need their own render with that knot passed as the open menuKnotId.
    const rootOpenHtml = renderTreePane(tree, 0);
    const root = rootOpenHtml.split('data-tree-node-id="0"')[1].split('data-tree-node-id="1"')[0];
    // Root: Toggle Lock (a root-only item) is disabled; nothing is pending on root either, so
    // Bless Knot is also disabled.
    expect(root).toContain(`disabled data-on:click="$knotId = 0; @post('/actions/toggle-lock')"`);
    expect(root).toContain(`disabled data-on:click="$knotId = 0; @post('/actions/bless-knot')"`);

    const knot1OpenHtml = renderTreePane(tree, 1);
    const knot1 = knot1OpenHtml.split('data-tree-node-id="1"')[1];
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
    expect(root).toContain('bg-neutral text-neutral-content px-1 rounded truncate min-w-0">START</span>');
    expect(root).not.toContain('<span class="truncate font-mono text-xs min-w-0">START</span>');
  });

  it("wires the menu's New Child item to its own route, and Edit Label to the modal (not prompt()), carrying the current label", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');
    const html = renderTreePane(tree, 1);
    const knot1 = html.split('data-tree-node-id="1"')[1];

    expect(knot1).toContain(`data-on:click="$knotId = 1; @post('/actions/new-child')"`);
    expect(knot1).not.toContain('prompt(');
    expect(knot1).toContain('data-current-label="checkpoint"');
    expect(knot1).toContain('data-on:click="sk.showLabelModal(1, el.dataset.currentLabel)"');
  });

  it("wires the menu's Edit Command item to the modal, carrying the knot's current command", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderTreePane(tree, 1);
    const knot1 = html.split('data-tree-node-id="1"')[1];

    expect(knot1).toContain('data-current-command="look"');
    expect(knot1).toContain('data-on:click="sk.showCommandModal(1, el.dataset.currentCommand)"');
  });

  // main.js's Option+letter accelerators always act on the active knot - see render.spec.ts's
  // equivalent test on the transcript side for the full rationale.
  it("shows keyboard-shortcut hints only on the active node's own menu items", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).setActiveKnotId(1);

    // Menu content only renders for whichever knot's menu is open (see knot-menu.ts) - open
    // root's own menu to confirm it gets no hints despite that, then knot 1's to confirm it does.
    const rootOpenHtml = renderTreePane(tree, 0);
    const root = rootOpenHtml.split('data-tree-node-id="0"')[1].split('data-tree-node-id="1"')[0];
    expect(root).not.toContain('title=');

    const knot1OpenHtml = renderTreePane(tree, 1);
    const knot1 = knot1OpenHtml.split('data-tree-node-id="1"')[1];
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

  it('does not show a lock icon for a labeled knot that is not explicitly locked (deletion protection is implicit, but the icon reflects only the explicit locked flag)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).not.toContain('icon-lock');
  });

  it('shows a marker swatch for a marked knot, and omits it for an unmarked one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1, marked
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // id 2, unmarked
      .setMarker(1, 3);
    const html = renderTreePane(tree);
    // The per-knot marker indicator (w-2 h-2) is distinct from the always-present marker-picker
    // swatches (w-4 h-4) inside every knot's own actions menu, which use the same color classes
    // regardless of that knot's current marker.
    expect(nodeHtml(html, 1)).toContain('w-2 h-2 rounded-full shrink-0 bg-green-500');
    expect(nodeHtml(html, 2)).not.toContain('w-2 h-2 rounded-full shrink-0 bg-green-500');
  });

  // Regression: a long label chip previously had shrink-0 (refusing to shrink) while the pill
  // itself had no overflow-hidden, so its background bled out past the pill's rounded bounds and
  // obscured the next knot's command entirely instead of truncating.
  it("truncates a long label chip within the pill's bounds instead of overflowing it", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'go south', { text: 'a', inputType: 'line' })
      .setLabel(1, "Can't go south from Backtracking");
    const html = renderTreePane(tree);
    const knot1 = nodeHtml(html, 1);
    expect(knot1).toContain('rounded truncate min-w-0');
    expect(html).toMatch(/class="flex flex-row items-center gap-1 px-2 py-1 rounded-lg border-2 cursor-pointer select-none text-sm min-w-16 max-w-48 overflow-hidden/);
  });

  describe('marker filter', () => {
    it('shows a matching knot and all its ancestors, omitting an unrelated sibling branch entirely', () => {
      const tree = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'go north', { text: 'a', inputType: 'line' }) // id 1
        .addChild(1, 'take orb', { text: 'b', inputType: 'line' }) // id 2, deep match
        .addChild(0, 'go south', { text: 'c', inputType: 'line' }) // id 3, unrelated branch
        .setMarker(2, 1);

      const html = renderTreePane(tree, null, 1);

      expect(html).toContain('data-tree-node-id="0"');
      expect(html).toContain('data-tree-node-id="1"');
      expect(html).toContain('data-tree-node-id="2"');
      expect(html).not.toContain('data-tree-node-id="3"');
    });

    it('still renders just the root when the filter matches nothing anywhere', () => {
      const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });

      const html = renderTreePane(tree, null, 2);

      expect(html).toContain('data-tree-node-id="0"');
      expect(html).not.toContain('data-tree-node-id="1"');
    });

    it('renders every knot when no filter is active', () => {
      const tree = SkeinTree.newTree('dgdebug', 1)
        .addChild(0, 'look', { text: 'a', inputType: 'line' })
        .addChild(0, 'inventory', { text: 'b', inputType: 'line' });

      const html = renderTreePane(tree);

      expect(html).toContain('data-tree-node-id="1"');
      expect(html).toContain('data-tree-node-id="2"');
    });
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
