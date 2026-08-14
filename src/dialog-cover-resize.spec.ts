import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { resizeCoverPng } from './dialog-cover-resize';

const DEFAULT_COVER = path.join(__dirname, '..', 'resources', 'bundle', 'default-cover.png');

describe('resizeCoverPng', () => {
  it('scales the vendored default cover down to fit within 120px on its longest side', () => {
    const source = fs.readFileSync(DEFAULT_COVER);
    const resizedBuffer = resizeCoverPng(source, 120);
    const resized = PNG.sync.read(resizedBuffer);

    expect(Math.max(resized.width, resized.height)).toBeLessThanOrEqual(120);
    expect(resized.width).toBeGreaterThan(0);
    expect(resized.height).toBeGreaterThan(0);
  });

  it('preserves aspect ratio', () => {
    // Build a synthetic 200x100 source PNG (2:1) rather than relying on the vendored cover's
    // own (square) aspect ratio, so this test actually exercises non-uniform scaling.
    const src = new PNG({ width: 200, height: 100 });
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 255;
      src.data[i + 1] = 0;
      src.data[i + 2] = 0;
      src.data[i + 3] = 255;
    }
    const source = PNG.sync.write(src);

    const resizedBuffer = resizeCoverPng(source, 120);
    const resized = PNG.sync.read(resizedBuffer);

    expect(resized.width).toBe(120);
    expect(resized.height).toBe(60);
  });

  it('does not upscale an image already smaller than maxDimension', () => {
    const src = new PNG({ width: 40, height: 30 });
    const source = PNG.sync.write(src);

    const resizedBuffer = resizeCoverPng(source, 120);
    const resized = PNG.sync.read(resizedBuffer);

    expect(resized.width).toBe(40);
    expect(resized.height).toBe(30);
  });
});
