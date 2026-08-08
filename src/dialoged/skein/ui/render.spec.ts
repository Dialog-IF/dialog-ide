import { SkeinTree } from '../tree';
import { renderApp, renderKnotList, renderNavbar, renderPage, SessionDisplayInfo } from './render';

const INFO: SessionDisplayInfo = { sessionId: 'default', engine: 'dgdebug', seed: 25002 };

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
    expect(html).toContain('You see nothing.');
  });

  it('marks the active knot with the arrow icon', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('icon-arrow-right');
  });

  it('escapes HTML and strips ANSI escape codes from response text', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: '\x1b[1mBold <b>text</b> & stuff\x1b[0m\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    expect(html).toContain('Bold &lt;b&gt;text&lt;/b&gt; &amp; stuff');
    expect(html).not.toContain('\x1b[1m');
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

  it('shows a never-blessed knot as fully "added" text (a diff against empty), matching dialog-tool', () => {
    const tree = SkeinTree.newTree('dgdebug', 1)
      .addChild(0, 'look', { text: 'You see nothing.\n', inputType: 'line' })
      .setActiveKnotId(1);
    const html = renderKnotList(tree);
    const knot1Section = html.split('id="knot-1"')[1];
    expect(knot1Section).toContain('icon-warning');
    expect(knot1Section).toContain('<span class="text-info font-bold">You see nothing.\n</span>');
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
});

describe('renderPage', () => {
  it('embeds the SSE connect action and the vendored static assets', () => {
    const tree = SkeinTree.newTree('dgdebug', 1);
    const html = renderPage(INFO, tree);
    expect(html).toContain(`data-init="@get('/events', {openWhenHidden: true})"`);
    expect(html).toContain('<link rel="stylesheet" href="/style.css" />');
    expect(html).toContain('<script type="module" src="/js/datastar.js"></script>');
  });

  it('shows a placeholder when no session is active', () => {
    const html = renderPage(undefined, undefined);
    expect(html).toContain('No skein session running');
  });
});
