import { renderTracePage } from './traceRender';

describe('renderTracePage', () => {
  describe('theme', () => {
    it('defaults <html data-theme> to light when unspecified', () => {
      const html = renderTracePage(null);
      expect(html).toContain('<html lang="en" data-theme="light">');
    });

    it('honors an explicit dark theme', () => {
      const html = renderTracePage(null, false, 'dark');
      expect(html).toContain('<html lang="en" data-theme="dark">');
    });
  });
});
