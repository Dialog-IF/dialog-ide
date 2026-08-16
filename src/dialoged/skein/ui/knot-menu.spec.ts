import { renderKnotMenu } from './knot-menu';

describe('renderKnotMenu', () => {
  describe('Trace item', () => {
    it('posts to trace-knot with the knot id for a non-root knot', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu');
      expect(html).toContain(`data-on:click="$knotId = 3; @post('/actions/trace-knot')"`);
    });

    it("posts to trace-startup for the root knot - there's no parent to replay to, so root's own Trace action traces startup instead", () => {
      const html = renderKnotMenu(0, true, false, '/actions/open-transcript-menu');
      expect(html).toContain(`data-on:click="@post('/actions/trace-startup')"`);
      expect(html).not.toContain('trace-knot');
    });

    it('is not disabled by default, on root or otherwise - unlike Edit Label/Toggle Lock/Delete', () => {
      const rootHtml = renderKnotMenu(0, true, false, '/actions/open-transcript-menu');
      const traceItem = rootHtml.split('>Trace</button>')[0].split('<li').pop()!;
      expect(traceItem).not.toContain('menu-disabled');
      expect(traceItem).not.toContain('disabled');
    });

    it('is disabled, with an explanatory title, for a knot reached via a keystroke prompt', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', false, null, null, 'compact', true);
      const traceItem = html.split('>Trace</button>')[0].split('<li').pop()!;
      expect(traceItem).toContain('menu-disabled');
      expect(traceItem).toContain(' disabled');
      expect(traceItem).toContain('title="Tracing isn');
    });

    it('is disabled, with an explanatory title, for a non-dgdebug engine - tracing is a dgdebug-only debug-console concept', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', false, null, null, 'compact', false, 'frotz');
      const traceItem = html.split('>Trace</button>')[0].split('<li').pop()!;
      expect(traceItem).toContain('menu-disabled');
      expect(traceItem).toContain(' disabled');
      expect(traceItem).toContain('title="Tracing requires the dgdebug engine"');
    });

    it('is not disabled for the dgdebug engine (the default)', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', false, null, null, 'compact', false, 'dgdebug');
      const traceItem = html.split('>Trace</button>')[0].split('<li').pop()!;
      expect(traceItem).not.toContain('menu-disabled');
    });
  });

  describe('Insert Parent item', () => {
    it('posts to the modal for a non-root knot', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu');
      expect(html).toContain('data-on:click="sk.showInsertParentModal(3)"');
    });

    it('is disabled for the root knot - root has no parent to insert above', () => {
      const html = renderKnotMenu(0, true, false, '/actions/open-transcript-menu');
      const item = html.split('>Insert Parent&hellip;</button>')[0].split('<li').pop()!;
      expect(item).toContain('menu-disabled');
      expect(item).toContain(' disabled');
    });

    it('is disabled, with an explanatory title, for a knot reached via a keystroke prompt', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', false, null, null, 'compact', true);
      const item = html.split('>Insert Parent&hellip;</button>')[0].split('<li').pop()!;
      expect(item).toContain('menu-disabled');
      expect(item).toContain(' disabled');
      expect(item).toContain('title="Insert Parent isn');
    });

    it('has no keyboard-accelerator hint even when active - rare enough to work without one', () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', true);
      const item = html.split('>Insert Parent&hellip;</button>')[0].split('<li').pop()!;
      expect(item).not.toContain('title="Insert Parent (');
    });
  });

  describe('Edit Command item', () => {
    it("carries the knot's current command and posts to the modal for a non-root knot", () => {
      const html = renderKnotMenu(3, true, false, '/actions/open-transcript-menu', false, null, 'look');
      expect(html).toContain('data-current-command="look"');
      expect(html).toContain('data-on:click="sk.showCommandModal(3, el.dataset.currentCommand)"');
    });

    it('is disabled for the root knot - root\'s command is a synthetic placeholder, not real user text', () => {
      const rootHtml = renderKnotMenu(0, true, false, '/actions/open-transcript-menu');
      const editCommandItem = rootHtml.split('>Edit Command&hellip;</button>')[0].split('<li').pop()!;
      expect(editCommandItem).toContain('menu-disabled');
      expect(editCommandItem).toContain('disabled');
    });

    it('HTML-escapes the current command', () => {
      const html = renderKnotMenu(1, true, false, '/actions/open-transcript-menu', false, null, '<script>');
      expect(html).toContain('data-current-command="&lt;script&gt;"');
    });
  });

  describe('trigger sizing', () => {
    it("defaults to the tree pane's original compact trigger when unspecified", () => {
      const html = renderKnotMenu(1, true, false, '/actions/open-graph-menu');
      expect(html).toContain('class="btn btn-xs btn-ghost py-0 px-0.5 min-h-0 h-4 w-4 leading-none"');
      expect(html).toContain('class="icon icon-dots-vertical w-3 h-3"');
    });

    // The transcript's trigger sits on a plain bg-base-100 background (unlike the tree pane's
    // colored pills), where the tiny compact trigger was easy to miss - 'prominent' bumps its size
    // and gives it a persistent faint backdrop instead.
    it("'prominent' renders a bigger trigger with a persistent backdrop, for the transcript", () => {
      const html = renderKnotMenu(1, true, false, '/actions/open-transcript-menu', false, null, null, 'prominent');
      expect(html).toContain('class="btn btn-xs btn-ghost py-0 px-1 min-h-0 h-6 w-6 leading-none bg-base-content/10"');
      expect(html).toContain('class="icon icon-dots-vertical w-4 h-4"');
    });
  });
});
