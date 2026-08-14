/**
 * Resizes a PNG cover image into a small thumbnail for "Export Web Page..." - mirrors
 * dialog-tool's `magick cover.png -resize 120 out/web/cover-small.jpg`, but via `pngjs` (a
 * single, zero-dependency, pure-JS package) instead of shelling out to ImageMagick, and produces
 * a PNG rather than a JPEG (pngjs has no JPEG encoder, and a resized PNG is an equally fine
 * thumbnail for this purpose).
 */

import { PNG } from 'pngjs';

/**
 * Reads a PNG file and returns a re-encoded PNG buffer scaled down so its longest dimension is
 * at most `maxDimension` (default 120, matching dialog-tool's `-resize 120`), preserving aspect
 * ratio. Returns the original image unscaled (re-encoded, not a byte-for-byte copy) if it's
 * already within maxDimension on both axes.
 */
export function resizeCoverPng(source: Buffer, maxDimension: number = 120): Buffer {
  const png = PNG.sync.read(source);
  const scale = Math.min(1, maxDimension / Math.max(png.width, png.height));
  const targetWidth = Math.max(1, Math.round(png.width * scale));
  const targetHeight = Math.max(1, Math.round(png.height * scale));

  const resized = new PNG({ width: targetWidth, height: targetHeight });
  boxResize(png, resized);
  return PNG.sync.write(resized);
}

/**
 * Box (area-average) downsampling of `src`'s RGBA pixel buffer into `dest`'s - each destination
 * pixel is the average of the source pixels whose centers fall within its corresponding source
 * region. Simple and dependency-free; quality is more than sufficient for a ~120px thumbnail.
 */
function boxResize(src: PNG, dest: PNG): void {
  const xRatio = src.width / dest.width;
  const yRatio = src.height / dest.height;

  for (let destY = 0; destY < dest.height; destY++) {
    const srcYStart = Math.floor(destY * yRatio);
    const srcYEnd = Math.max(srcYStart + 1, Math.floor((destY + 1) * yRatio));

    for (let destX = 0; destX < dest.width; destX++) {
      const srcXStart = Math.floor(destX * xRatio);
      const srcXEnd = Math.max(srcXStart + 1, Math.floor((destX + 1) * xRatio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let srcY = srcYStart; srcY < srcYEnd && srcY < src.height; srcY++) {
        for (let srcX = srcXStart; srcX < srcXEnd && srcX < src.width; srcX++) {
          const srcIdx = (src.width * srcY + srcX) << 2;
          r += src.data[srcIdx];
          g += src.data[srcIdx + 1];
          b += src.data[srcIdx + 2];
          a += src.data[srcIdx + 3];
          count++;
        }
      }

      const destIdx = (dest.width * destY + destX) << 2;
      dest.data[destIdx] = Math.round(r / count);
      dest.data[destIdx + 1] = Math.round(g / count);
      dest.data[destIdx + 2] = Math.round(b / count);
      dest.data[destIdx + 3] = Math.round(a / count);
    }
  }
}
