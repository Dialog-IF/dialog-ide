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

    it('is never disabled, on root or otherwise - unlike Edit Label/Toggle Lock/Delete', () => {
      const rootHtml = renderKnotMenu(0, true, false, '/actions/open-transcript-menu');
      const traceItem = rootHtml.split('>Trace</button>')[0].split('<li').pop()!;
      expect(traceItem).not.toContain('menu-disabled');
      expect(traceItem).not.toContain('disabled');
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
});
