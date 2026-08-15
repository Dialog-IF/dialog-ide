import { SkeinTree } from '../tree';
import { renderApp, renderKnotList, renderNavbar, renderPage, SessionDisplayInfo } from './render';

const INFO: SessionDisplayInfo = { sessionId: 'default', engine: 'dgdebug', seed: 25002 };

// Mirrors render.ts's visibleWhitespace (applied within added/removed diff spans): a space
// becomes a middle-dot (U+00B7) + zero-width space (U+200B), a newline becomes "↵" (U+21B5) +
// the real newline.
function visible(text: string): string {
  return text.replace(/ /g, '·​').replace(/\n/g, '↵\n');
}

describe('renderNavbar', () => {
  // Session identity lives in the webview panel's own tab title (extension.ts's panelTitle)
  // now, not in the navbar itself.
  it('does not duplicate session identity - that lives in the panel tab title now', () => {
    const tree = SkeinTree.newTree('dgdebug', 25002);
    const html = renderNavbar(INFO, tree);
    expect(html).not.toContain('default.skein');
    expect(html).not.toContain('seed 25002');
  });

  it('counts knots by status into the ok/new/error badges', () => {
    // Root is 'valid' by construction; addChild always creates a knot with an unblessed
    // response (nothing bless-related exists yet in this pass), so both children are 'new'.
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .addChild(0, 'xyzzy', { text: 'Nothing happens.\n', inputType: 'line' });
    const html = renderNavbar(INFO, tree);
    expect(html).toContain('aria-label="1 ok knots"');
    expect(html).toContain('aria-label="2 new knots"');
    expect(html).toContain('aria-label="0 error knots"');
  });

  it('wires the new/error badges as clickable buttons that post to seek-status with the matching status signal', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .addChild(0, 'xyzzy', { text: 'Nothing happens.\n', inputType: 'line' });
    const html = renderNavbar(INFO, tree);
    expect(html).toContain(`data-on:click="$seekStatus = 'new'; @post('/actions/seek-status')"`);
    expect(html).toContain(`data-on:click="$seekStatus = 'error'; @post('/actions/seek-status')"`);
  });

  it('disables a badge (rather than hiding it) when its count is zero, and leaves it enabled otherwise', () => {
    const zeroTree = SkeinTree.newTree('dgdebug', 1);
    const zeroHtml = renderNavbar(INFO, zeroTree);
    const newBadge = zeroHtml.split('aria-label="0 new knots"')[1].split('>')[0];
    const errorBadge = zeroHtml.split('aria-label="0 error knots"')[1].split('>')[0];
    expect(newBadge).toContain('disabled');
    expect(errorBadge).toContain('disabled');

    const nonZeroTree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const nonZeroHtml = renderNavbar(INFO, nonZeroTree);
    const enabledNewBadge = nonZeroHtml.split('aria-label="1 new knots"')[1].split('>')[0];
    expect(enabledNewBadge).not.toContain('disabled');
  });

  // The ok badge has no "jump to the next ok knot" use case (matching dialog-tool, where only
  // the yellow/red badges are clickable) - it stays a plain, non-interactive count.
  it('does not make the ok badge clickable', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    const okBadge = html.split('aria-label="1 ok knots"')[1].split('>')[0];
    expect(okBadge).not.toContain('data-on:click');
  });

  it('wires Replay All to a plain @post(), no signal needed - the server targets every leaf itself', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain(`data-on:click="@post('/actions/replay-all')"`);
  });

  it('wires the single Bless Transcript button to bless-changes for the selected spine\'s leaf, baked in server-side at render time', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain(`$knotId = 1; @post('/actions/bless-changes')`);
    expect(html).toContain('Bless Transcript');
    expect(html).not.toContain('/actions/bless-knot');
  });

  // Regression: the button used to target activeKnotId, which stops short the moment the user
  // navigates back to an ancestor (see tree.ts's selectKnot) - the transcript keeps showing
  // everything past it regardless, so "Bless Transcript" silently blessed less than what was
  // actually visible. getSelectedLeafId() is the fix; this pins the button to it.
  it('targets the spine\'s leaf, not the active knot, once navigation has moved the active knot back up the tree', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' }) // knot 2
      .selectKnot(1); // navigate back to knot 1; knot 2 is still shown in the transcript

    const html = renderNavbar(INFO, tree);

    expect(tree.getActiveKnotId()).toBe(1);
    expect(html).toContain(`$knotId = 2; @post('/actions/bless-changes')`);
  });

  // main.js's Option+Shift+B accelerator has no server-rendered button of its own to read a
  // baked-in knot id from (unlike the click-driven Bless Transcript button above) - it reads this
  // attribute directly instead, so it needs to reflect the same spine-leaf target, not activeKnotId.
  it('exposes the spine leaf id as a data attribute for the keyboard accelerator to read', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
      .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' })
      .selectKnot(1);

    const html = renderNavbar(INFO, tree);

    expect(html).toContain('data-spine-leaf-id="2"');
  });

  it('styles Save, Replay All, and Bless Transcript identically as bordered primary buttons, not a dropdown', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    expect(html.match(/class="btn btn-primary"/g)?.length).toBe(3);
    expect(html).not.toContain('dropdown');
  });

  // Search (icon-search) is no longer deferred - see the 'search box' describe block below.
  it('does not render the still-deferred prototype buttons (Undo/Redo/Reload/Quit/Jump)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    for (const deferred of ['icon-undo', 'icon-redo', 'icon-reload', 'icon-quit', 'icon-jump']) {
      expect(html).not.toContain(deferred);
    }
  });

  it('wires Save to a plain @post() with no confirmation - the only thing that ever writes the .skein file', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain(`data-on:click="@post('/actions/save')"`);
    expect(html).toContain('icon-save');
  });

  it('wires the dynamic-state toggle to its own route, reflecting showDynamicState in aria-pressed and styling', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const off = renderNavbar(INFO, tree, false);
    expect(off).toContain(`data-on:click="@post('/actions/toggle-dynamic-state')"`);
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('btn-ghost');

    const on = renderNavbar(INFO, tree, true);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('btn-primary');
  });

  it('disables the dynamic-state toggle for a non-dgdebug engine - @dynamic is a dgdebug-only debug command', () => {
    const tree = SkeinTree.newTree('frotz', 1);
    const html = renderNavbar({ ...INFO, engine: 'frotz' }, tree);
    const toggle = html.split('icon-dynamic')[0];
    expect(toggle).toContain('disabled');
  });
});

describe('renderNavbar search box', () => {
  it('renders the input bound to searchQuery, firing on every debounced keystroke - live narrowing, not submit-and-wait', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain('data-bind="searchQuery"');
    expect(html).toContain(`data-on:input__debounce.300ms="@post('/actions/search')"`);
  });

  it('has a plain "Search" placeholder, and a stable id for main.js\'s Alt+F focus shortcut and outside-click dismissal', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain('placeholder="Search"');
    expect(html).toContain('id="skein-search-input"');
    expect(html).toContain('id="skein-search-box"');
  });

  it("carries the query's current value back into the input, so a server-pushed re-render doesn't clobber what the user typed", () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty');
    expect(html).toContain('value="dusty"');
  });

  it('renders no results dropdown at all when the query is blank', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, '');
    expect(html).not.toContain('No matches.');
    expect(html).not.toContain('role="listbox"');
  });

  it('renders a "No matches." dropdown for a non-blank query with no results', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'nonexistent', { results: [], totalMatches: 0 });
    expect(html).toContain('No matches.');
  });

  it("renders each result as '> command', then the label chip (if present), then the matched snippet - never the field name or knot id - with a click handler that jumps and clears the query", () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [
        {
          knotId: 3,
          field: 'response',
          command: 'look',
          label: 'checkpoint',
          snippet: 'A <mark class="bg-warning/60 rounded-sm px-0.5">dusty</mark> room.'
        }
      ],
      totalMatches: 1
    });

    expect(html).toContain('&gt; look');
    expect(html).toContain('>checkpoint<');
    expect(html).toContain('<mark class="bg-warning/60 rounded-sm px-0.5">dusty</mark>');
    expect(html).not.toContain('Response');
    expect(html).not.toContain('Knot 3');
    expect(html).toContain(
      `data-on:click="$knotId = 3; $searchQuery = ''; @post('/actions/select-knot'); @post('/actions/search')"`
    );
  });

  it('renders the command in the normal (not mono) font, left-justified, with its label floated to the right in the same row - like the transcript\'s own label chip', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: 'checkpoint', snippet: 'a' }],
      totalMatches: 1
    });

    const command = html.split('&gt; look')[0].split('<span').pop()!;
    expect(command).not.toContain('font-mono');

    const row = html.split('&gt; look')[1].split('</div>')[0];
    expect(row).toContain('checkpoint');
    expect(row).toContain('ml-auto');
    // Same chip styling as the transcript's own label chip (render.ts's floatCluster).
    expect(row).toContain('font-bold bg-neutral text-neutral-content');
  });

  it('shows no "> command" prompt line for the root knot - its command is a synthetic placeholder ("START"), not real text', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'start', {
      results: [{ knotId: 0, field: 'label', command: 'START', label: 'START', snippet: 'START' }],
      totalMatches: 1
    });

    expect(html).not.toContain('&gt; START');
  });

  it('still floats a root result\'s label to the right even with no prompt line before it', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'start', {
      results: [{ knotId: 0, field: 'label', command: 'START', label: 'START', snippet: 'START' }],
      totalMatches: 1
    });

    expect(html).toContain('ml-auto');
  });

  it('omits the label chip entirely for a knot with no label, rather than rendering an empty one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: null, snippet: 'a' }],
      totalMatches: 1
    });
    expect(html).not.toContain('bg-neutral text-neutral-content');
  });

  it('notes when results were truncated (more matches than are shown), telling the user to narrow further', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: null, snippet: 'a' }],
      totalMatches: 51
    });
    expect(html).toContain('Showing 1 of 51 matches');
  });

  it('says nothing about truncation when every match is already shown', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: null, snippet: 'a' }],
      totalMatches: 1
    });
    expect(html).not.toContain('Showing');
  });

  it('clears the query and dismisses the dropdown on Escape, without leaving the browser default (which would submit the <input type="search">) to run', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty');
    expect(html).toContain(`if (evt.key === 'Escape') { $searchQuery = ''; @post('/actions/search') }`);
  });

  it('explicitly selects all the input text on Cmd/Ctrl+A - native select-all is unreliable inside a VS Code webview', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty');
    expect(html).toContain(`(evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === 'a') { evt.preventDefault(); el.select() }`);
  });

  it('moves focus into the first result on ArrowDown from the input, instead of the browser just scrolling the results list', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: null, snippet: 'a' }],
      totalMatches: 1
    });
    const input = html.split('id="skein-search-input"')[1].split('/>')[0];
    expect(input).toContain("evt.key === 'ArrowDown'");
    expect(input).toContain('sk.navigateSearchResults(el, 1)');
  });

  it('wires each result as a focusable button that continues ArrowUp/ArrowDown navigation and Escape-dismisses', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderNavbar(INFO, tree, false, 'dusty', {
      results: [{ knotId: 1, field: 'response', command: 'look', label: null, snippet: 'a' }],
      totalMatches: 1
    });
    expect(html).toContain('data-search-result');
    expect(html).toContain('sk.navigateSearchResults(el, 1)');
    expect(html).toContain('sk.navigateSearchResults(el, -1)');
  });
});

describe('renderKnotList', () => {
  it('renders the active spine from root to the active leaf', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    expect(html).toContain('id="knot-0"');
    expect(html).toContain('id="knot-1"');
    expect(html).toContain(visible('You see nothing.\n'));
  });

  // Regression: renderKnotList used to walk root-to-activeKnotId, so navigating (selectKnot) to
  // an ancestor made everything already explored past it vanish from the transcript, even though
  // nothing was actually deleted - only creating a new child should ever do that. See
  // tree.ts's selectKnot and this function's own doc comment.
  it('keeps showing everything already explored past the selected knot - selecting it is not the same as creating a new child', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' }) // knot 1
      .addChild(1, 'take orb', { text: 'Got it.\n', inputType: 'line' }) // knot 2
      .selectKnot(1); // navigate back to knot 1, after having already explored down to knot 2

    const html = renderKnotList(tree);
    expect(html).toContain('id="knot-0"');
    expect(html).toContain('id="knot-1"');
    expect(html).toContain('id="knot-2"');
  });

  it('switches the displayed branch when selecting a knot in a different, previously-unselected branch', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // knot 1
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' }) // knot 2, now root's selectedChild
      .selectKnot(1); // click back to knot 1's branch

    const html = renderKnotList(tree);
    expect(html).toContain('id="knot-1"');
    expect(html).not.toContain('id="knot-2"');
  });

  it('marks the active knot with the arrow icon', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('icon-arrow-right');
  });

  // main.js's Option+letter accelerators always act on the active knot, regardless of which
  // knot's menu is open/hovered - a shortcut hint on every knot's copy of this menu would
  // misleadingly suggest otherwise, so knot-menu.ts's renderKnotMenu only adds it for the one
  // that's actually active.
  it("shows keyboard-shortcut hints only on the active knot's own menu items", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .addChild(0, 'inventory', { text: 'b', inputType: 'line' })
      .selectKnot(1);
    const html = renderKnotList(tree);

    // '<div class="flex flex-row" id="knot-' (the exact per-row wrapper render.ts emits), not the
    // bare 'id="knot-' boundary other tests in this file use - that shorter form also matches the
    // menu popover's own id="knot-menu-transcript-N" and would truncate the section before any of
    // its menu items.
    const rowBoundary = '<div class="flex flex-row" id="knot-';
    const knot1Section = html.split('id="knot-1"')[1].split(rowBoundary)[0];
    expect(knot1Section).toContain('title="Delete (⌥D)"');

    const knot0Section = html.split('id="knot-0"')[1].split(rowBoundary)[0];
    expect(knot0Section).not.toContain('title=');
  });

  it('wires the row to select the knot on click, with no right-click affordance, both plain Datastar @post - and renders that knot\'s menu inline, closed by default', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1].split('id="knot-')[0];
    expect(knot1Section).toContain(`data-on:click="if (!evt.target.closest('details')) { $knotId = 1; @post('/actions/select-knot') }"`);
    expect(knot1Section).not.toContain('data-on:contextmenu');
    expect(knot1Section).toContain('<details class="dropdown dropdown-left font-sans" style="anchor-name: --knot-menu-transcript-1">'); // present, but not open
    expect(knot1Section).not.toContain('<details class="dropdown dropdown-left font-sans" open style="anchor-name: --knot-menu-transcript-1">');
  });

  it("wires the menu's New Child item to its own route, distinct from plain select-knot navigation", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1].split('<div class="flex flex-row" id="knot-')[0];
    expect(knot1Section).toContain(`data-on:click="$knotId = 1; @post('/actions/new-child')"`);
  });

  // Regression: window.prompt() is silently swallowed inside a VS Code webview (sandboxed without
  // allow-modals), so Edit Label used to appear to do nothing there even though it worked fine in
  // a plain browser tab. An inline input, submitted on its own change event (same pattern as the
  // main command input), doesn't depend on any dialog API.
  it("wires Edit Label to the modal (not prompt()), carrying the knot's current label", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint');
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1].split('<div class="flex flex-row" id="knot-')[0];
    expect(knot1Section).not.toContain('prompt(');
    expect(knot1Section).toContain('data-current-label="checkpoint"');
    expect(knot1Section).toContain('data-on:click="sk.showLabelModal(1, el.dataset.currentLabel)"');
  });

  it("wires Edit Command to the modal, carrying the knot's current command", () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1].split('<div class="flex flex-row" id="knot-')[0];
    expect(knot1Section).toContain('data-current-command="look"');
    expect(knot1Section).toContain('data-on:click="sk.showCommandModal(1, el.dataset.currentCommand)"');
  });

  // The transcript's "..." trigger sits on a plain bg-base-100 background (unlike the tree pane's
  // colored pills), where the tree pane's original tiny/compact trigger was easy to miss.
  it('renders a more visible ("prominent") menu trigger than the tree pane\'s compact one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1].split('<div class="flex flex-row" id="knot-')[0];
    expect(knot1Section).toContain('class="btn btn-xs btn-ghost py-0 px-1 min-h-0 h-6 w-6 leading-none bg-base-content/10"');
  });

  it('opens knot 1\'s menu (and only knot 1\'s) when menuKnotId matches it', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree, 1);
    const knot0Section = html.split('id="knot-0"')[1].split('id="knot-1"')[0];
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot0Section).not.toContain('<details class="dropdown dropdown-left font-sans" open style="anchor-name: --knot-menu-transcript-0">');
    expect(knot1Section).toContain('<details class="dropdown dropdown-left font-sans" open style="anchor-name: --knot-menu-transcript-1">');
  });

  it('escapes HTML and converts ANSI bold to a [B]...[/B] marker within a diff (never-blessed knot)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: '\x1b[1mBold <b>text</b> & stuff\x1b[0m\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    expect(html).toContain(visible('[B]Bold &lt;b&gt;text&lt;/b&gt; &amp; stuff[/B]\n'));
    expect(html).not.toContain('\x1b[1m');
  });

  it('renders real ANSI bold as a styled span for a settled/blessed knot (no diff)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: '\x1b[1mBold text\x1b[0m\n', inputType: 'line' })
      .blessKnot(1)
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('<span class="ansi-bold">Bold text</span>');
  });

  it('shows a lock icon and label badge for locked/labeled knots', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint')
      .setLockStatus(1, true)
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    expect(html).toContain('icon-lock');
    expect(html).toContain('checkpoint');
  });

  it('does not show a lock icon for a labeled knot that is not explicitly locked (deletion protection is implicit, but the icon reflects only the explicit locked flag)', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setLabel(1, 'checkpoint')
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).not.toContain('icon-lock');
  });

  it('has no stray leading whitespace before the response text on a labeled root knot (regression - the response container is whitespace-pre-wrap, so template-literal indentation around an empty keystroke chip used to render as a visible leading blank line/indent)', () => {
    // Root already has label 'START' (from newTree) - the floated cluster (label badge + menu
    // trigger) and the response text must be immediately adjacent, with no
    // whitespace-pre-wrap-significant gap between them.
    const tree = SkeinTree.newTree('dgdebug', 1)
      .updateKnotResponse(0, { text: 'The Featureless Space\nAn interactive fiction.\n', inputType: 'line' })
      .blessKnot(0);
    const html = renderKnotList(tree);
    expect(html).toContain('</details></div>The Featureless Space\nAn interactive fiction.\n</div>');
  });

  it('shows the command as a keystroke chip when the parent ended on a keystroke prompt', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'start combat', { text: 'Press any key...\n', inputType: 'key' })
      .addChild(1, 'y', { text: 'You attack!\n', inputType: 'line' })
      .setActiveKnotId(2);
    const html = renderKnotList(tree);
    const knot2Section = html.split('id="knot-2"')[1];
    expect(knot2Section).toContain('bg-neutral-content');
    expect(knot2Section).toContain('>y</div>');
  });

  it('applies the error border class to a knot whose response diverges from its blessed one', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'original', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'changed', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('border-error');
  });

  // Regression: a response differing only by a trailing newline still flips the knot to 'error'
  // (tree.ts's responsesMatch is a strict string comparison), but used to render as a plain,
  // unstyled diff - diffWords (unlike diff.ts's diffWordsWithSpace) ignores whitespace when
  // computing the diff, so the extra newline was silently absorbed into an 'unchanged' segment
  // and never got visibleWhitespace's "↵" marker, leaving no visible reason for the error border.
  it('shows an extra trailing newline as a visible added span, not silently as unchanged text', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'Room A.\n\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('border-error');
    expect(knot1Section).toContain(`<span class="text-info font-bold">${visible('\n')}</span>`);
  });

  it('renders a real word-level diff for a knot whose response changed - added/removed spans, unchanged text plain', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'take orb', { text: 'You take the White Orb.\n', inputType: 'line' })
      .blessKnot(1)
      .updateKnotResponse(1, { text: 'You take the Blue Orb.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];

    // Unchanged text renders plain (no span) - only the changed word gets diff styling.
    expect(knot1Section).toContain('You take the ');
    expect(knot1Section).toContain(`<span class="text-error font-bold line-through">${visible('White')}</span>`);
    expect(knot1Section).toContain(`<span class="text-info font-bold">${visible('Blue')}</span>`);
    expect(knot1Section).toContain(' Orb.');
  });

  it('renders several knots down the active spine, each with its own diff state', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You are in a room.\n', inputType: 'line' })
      .blessKnot(1)
      .addChild(1, 'take orb', { text: 'You take the orb.\n', inputType: 'line' })
      .blessKnot(2)
      .updateKnotResponse(2, { text: 'You grab the orb.\n', inputType: 'line' }) // now diverges - 'error'
      .addChild(2, 'inventory', { text: 'You are carrying: the orb.\n', inputType: 'line' }) // never blessed - 'new'
      .setActiveKnotId(3);

    const html = renderKnotList(tree);
    expect(html).toContain('id="knot-0"');
    expect(html).toContain('id="knot-1"');
    expect(html).toContain('id="knot-2"');
    expect(html).toContain('id="knot-3"');

    const knot1Section = html.split('id="knot-1"')[1].split('id="knot-2"')[0];
    // Settled/blessed with no pending change - plain text, no diff span, no visible-whitespace
    // transform (that's only meaningful within an actual diff).
    expect(knot1Section).toContain('You are in a room.\n');
    expect(knot1Section).not.toContain('text-info font-bold');

    const knot2Section = html.split('id="knot-2"')[1].split('id="knot-3"')[0];
    expect(knot2Section).toContain('border-error');
    expect(knot2Section).toContain(`<span class="text-error font-bold line-through">${visible('take')}</span>`);
    expect(knot2Section).toContain(`<span class="text-info font-bold">${visible('grab')}</span>`);

    const knot3Section = html.split('id="knot-3"')[1];
    expect(knot3Section).toContain('border-warning'); // never-blessed - 'new'
    expect(knot3Section).toContain(
      `<span class="text-info font-bold">${visible('You are carrying: the orb.\n')}</span>`
    );
  });

  it('shows a never-blessed knot as fully "added" text (a diff against empty), matching dialog-tool', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('icon-warning');
    expect(knot1Section).toContain(`<span class="text-info font-bold">${visible('You see nothing.\n')}</span>`);
  });
});

describe('renderKnotList dynamic state', () => {
  function treeWithDynamicKnots(): SkeinTree {
    return SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'Room A.\n', inputType: 'line' }) // id 1
      .updateDynamicState(1, { flags: new Set(['(game started)']), vars: {} })
      .addChild(1, 'light torch', { text: 'It flickers to life.\n', inputType: 'line' }) // id 2
      .updateDynamicState(2, { flags: new Set(['(game started)', '(torch lit)']), vars: {} })
      .setActiveKnotId(2);
  }

  it('is omitted entirely when showDynamicState is false, regardless of captured state', () => {
    const html = renderKnotList(treeWithDynamicKnots(), null, false);
    expect(html).not.toContain('(torch lit)');
  });

  it('shows added predicates relative to the parent\'s own captured state when the toggle is on', () => {
    const html = renderKnotList(treeWithDynamicKnots(), null, true);
    const knot2Section = html.split('id="knot-2"')[1];
    expect(knot2Section).toContain('(torch lit)');
    expect(knot2Section).toContain('border-success'); // added
    // (game started) was already true at the parent - not repeated as a change here.
    expect(knot2Section).not.toContain('(game started)');
  });

  it('renders nothing for a knot with no dynamic capture of its own, even with the toggle on', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderKnotList(tree, null, true);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).not.toContain('flex flex-wrap gap-1 mt-4 text-xs');
  });

  it('never shows a diff for root, even though its own startup banner has captured dynamic state (a baseline for knot 1, not something to diff itself)', () => {
    const tree = treeWithDynamicKnots().updateDynamicState(0, { flags: new Set(['(game started)']), vars: {} });
    const html = renderKnotList(tree, null, true);
    const knot0Section = html.split('id="knot-0"')[1].split('id="knot-1"')[0];
    expect(knot0Section).not.toContain('flex flex-wrap gap-1 mt-4 text-xs');
  });

  it("diffs the first real command against root's own captured startup state, instead of an empty baseline", () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .updateDynamicState(0, { flags: new Set(['(game started)']), vars: {} })
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1
      .updateDynamicState(1, { flags: new Set(['(game started)']), vars: {} })
      .setActiveKnotId(1);
    const html = renderKnotList(tree, null, true);
    const knot1Section = html.split('id="knot-1"')[1];
    // (game started) was already true at root - not shown as newly "added" by 'look'.
    expect(knot1Section).not.toContain('(game started)');
  });

  it('shows removed and changed predicates too, sorted together', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' }) // id 1
      .updateDynamicState(1, { flags: new Set(['(lit)']), vars: { '(score)': '(score) is 0' } })
      .addChild(1, 'wait', { text: 'b', inputType: 'line' }) // id 2
      .updateDynamicState(2, { flags: new Set(), vars: { '(score)': '(score) is 5' } })
      .setActiveKnotId(2);
    const html = renderKnotList(tree, null, true);
    const knot2Section = html.split('id="knot-2"')[1];
    expect(knot2Section).toContain('border-warning'); // (lit) removed
    expect(knot2Section).toContain('(score) is 5'); // changed value shown, not the old one
    expect(knot2Section).not.toContain('(score) is 0');
  });
});

describe('renderApp', () => {
  it('wraps the navbar and knot list in the #skein-app patch target', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderApp(INFO, tree);
    expect(html).toMatch(/^<div id="skein-app" class="[^"]*"/);
    expect(html).toContain('aria-label="1 ok knots"');
    expect(html).toContain('id="knot-0"');
  });

  // #skein-app fills exactly one viewport (h-screen flex column) and the navbar is a shrink-0
  // row within it - so the navbar can never scroll out of view, since neither it nor the
  // document around it scrolls; only the tree pane and transcript pane (each their own
  // overflow-y-auto column below it) do.
  it('sizes the app to the viewport and keeps the navbar outside any scrolling area', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderApp(INFO, tree);
    expect(html).toMatch(/<div id="skein-app" class="[^"]*\bflex\b[^"]*\bflex-col\b[^"]*\bh-screen\b/);
    expect(html).toMatch(/<nav class="[^"]*\bshrink-0\b/);
  });

  it('always renders the command input for a line-expecting active knot - "time travel" (jumping to an earlier knot and typing a different command) needs no special confirmation', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'a', inputType: 'line' })
      .setActiveKnotId(0); // active knot is root, an "earlier" point relative to knot 1
    const html = renderApp(INFO, tree);
    expect(html).toContain('id="new-command-input"');
    expect(html).toContain('data-init="el.focus(); el.scrollIntoView({block: \'nearest\', behavior: \'smooth\'})"');
    expect(html).toContain(`data-on:change="@post('/actions/send-command')"`);
  });

  it('shows the keystroke widget instead of the normal input when the active knot expects a keystroke', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'start combat', { text: 'Press any key...\n', inputType: 'key' })
      .setActiveKnotId(1);
    const html = renderApp(INFO, tree);
    // Same id as the normal widget (see renderKeystrokeInput's doc comment - main.js's
    // resetAndFocusCommandInput keeps working unchanged for either), but a 1-character field
    // rather than the free-text one, plus buttons for the replies with no visible character.
    expect(html).toContain('id="new-command-input"');
    expect(html).toContain('maxlength="1"');
    expect(html).not.toContain(`data-on:change="@post('/actions/send-command')"`);
    expect(html).toContain("@post('/actions/send-keystroke')");
    expect(html).toContain('>Enter</button>');
    expect(html).toContain('>Space</button>');
    expect(html).toContain('>Backspace</button>');
    // The field's own keydown handles Enter/Backspace directly too, not just the buttons -
    // keypress (what dialog-tool's own widget relies on) never fires for either in a real
    // browser, so a keyboard-only user needs keydown to reach them at all.
    expect(html).toContain(`evt.key === 'Enter'`);
    expect(html).toContain(`evt.key === 'Backspace'`);
    expect(html).toContain("$newKeystroke = 'enter'");
    expect(html).toContain("$newKeystroke = 'backspace'");
  });

  it('includes the resizable tree pane and its drag handle alongside the transcript', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' });
    const html = renderApp(INFO, tree);
    expect(html).toContain('id="tree-pane-outer"');
    expect(html).toContain('id="tree-pane-handle"');
    expect(html).toContain('id="tree-pane"'); // from renderTreePane
    expect(html).toContain('data-tree-node-id="0"');
    expect(html).toContain('data-init="sk.initTreePaneResize()"');
  });

  it('threads graphMenuId and transcriptMenuId through independently - each pane only opens its own', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).setActiveKnotId(1);
    const graphOpen = '<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">';
    const transcriptOpen = '<details class="dropdown dropdown-left font-sans" open style="anchor-name: --knot-menu-transcript-1">';

    // Only the graph pane's menu open (transcriptMenuId omitted/null).
    const graphOnly = renderApp(INFO, tree, 1);
    expect(graphOnly).toContain(graphOpen);
    expect(graphOnly).not.toContain(transcriptOpen);

    // Both open, independently, even though it's the same knot in both panes.
    const both = renderApp(INFO, tree, 1, 1);
    expect(both).toContain(graphOpen);
    expect(both).toContain(transcriptOpen);

    // Neither open.
    const neither = renderApp(INFO, tree);
    expect(neither).not.toContain(graphOpen);
    expect(neither).not.toContain(transcriptOpen);
  });
});

describe('renderPage', () => {
  it('embeds the SSE connect action and the vendored static assets', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderPage(INFO, tree);
    expect(html).toContain(`data-init="@get('/events', {openWhenHidden: true})"`);
    expect(html).toContain('<link rel="stylesheet" href="/style.css" />');
    expect(html).toContain('<script type="module" src="/js/datastar.js"></script>');
    expect(html).toContain('<script type="module" src="/js/main.js"></script>');
  });

  it('shows a placeholder when no session is active', () => {
    const html = renderPage(undefined, undefined);
    expect(html).toContain('No skein session running');
  });

  // No confirm()/prompt(): both are silently swallowed inside a VS Code webview (sandboxed
  // without allow-modals - see knot-menu.ts's Edit Label input, which replaced a prompt() call
  // for exactly this reason), so relying on either here would look like a dead button in the
  // real extension even though it'd work fine in a plain browser tab.
  it('renders each knot\'s actions menu inline, declaratively wired, with no confirm()/prompt() gates anywhere', () => {
    const html = renderPage(INFO, SkeinTree.newTree('dgdebug', 1));
    expect(html).toContain('class="dropdown dropdown-right font-sans"');
    expect(html).toContain(`data-on:click="$knotId = 0; @post('/actions/bless-knot')"`);
    expect(html).toContain(`data-on:click="$knotId = 0; @post('/actions/toggle-lock')"`);
    expect(html).toContain(`data-on:click="$knotId = 0; @post('/actions/splice-knot')"`);
    expect(html).toContain(`data-on:click="$knotId = 0; @post('/actions/delete-knot')"`);
    expect(html).not.toContain('confirm(');
    expect(html).not.toContain('prompt(');
  });

  it('opens the requested knot\'s menu (native <details open>) when graphMenuId is passed through', () => {
    const tree = SkeinTree.newTree('dgdebug', 1).addChild(0, 'look', { text: 'a', inputType: 'line' }).setActiveKnotId(1);
    const html = renderPage(INFO, tree, 1);
    expect(html).toContain('<details class="dropdown dropdown-right font-sans" open style="anchor-name: --knot-menu-graph-1">');
  });
});
