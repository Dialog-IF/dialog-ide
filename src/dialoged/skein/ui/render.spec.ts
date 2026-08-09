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
  it('shows the session id, engine, and seed', () => {
    const tree = SkeinTree.newTree('dgdebug', 25002);
    const html = renderNavbar(INFO, tree);
    expect(html).toContain('default.skein');
    expect(html).toContain('dgdebug');
    expect(html).toContain('25002');
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

  it('marks the active knot with the arrow icon', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('icon-arrow-right');
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

  it('has no stray leading whitespace before the response text on a labeled root knot (regression - the response container is whitespace-pre-wrap, so template-literal indentation around an empty keystroke chip used to render as a visible leading blank line/indent)', () => {
    // Root already has label 'START' (from newTree) - the label badge and the response text
    // must be immediately adjacent, with no whitespace-pre-wrap-significant gap between them.
    const tree = SkeinTree.newTree('dgdebug', 1)
      .updateKnotResponse(0, { text: 'The Featureless Space\nAn interactive fiction.\n', inputType: 'line' })
      .blessKnot(0);
    const html = renderKnotList(tree);
    expect(html).toContain('START</span></div>The Featureless Space\nAn interactive fiction.\n</div>');
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

describe('renderApp', () => {
  it('wraps the navbar and knot list in the #skein-app patch target', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderApp(INFO, tree);
    expect(html).toMatch(/^<div id="skein-app">/);
    expect(html).toContain('default.skein');
    expect(html).toContain('id="knot-0"');
  });

  it('renders the command input, focused and submitting to the send-command action, when the active knot expects a line', () => {
    const tree = SkeinTree.newTree('dgdebug', 1); // root is 'line'
    const html = renderApp(INFO, tree);
    expect(html).toContain('id="new-command-input"');
    expect(html).toContain('data-init="el.focus()"');
    expect(html).toContain(`data-on:change="@post('/actions/send-command')"`);
  });

  it('shows a disabled placeholder instead of the input when the active knot expects a keystroke', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'start combat', { text: 'Press any key...\n', inputType: 'key' })
      .setActiveKnotId(1);
    const html = renderApp(INFO, tree);
    expect(html).not.toContain('id="new-command-input"');
    expect(html).toContain("Keystroke input isn't supported yet");
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
});
