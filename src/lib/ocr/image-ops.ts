import { DETECTION_STRIDE, MAX_DETECTION_SIDE } from "./config";

/**
 * Pixel arithmetic, kept pure so it can be unit-tested without a browser.
 *
 * Everything here works on plain RGBA byte arrays — the shape `ImageData`
 * gives us — rather than on a canvas, which means the worker needs no
 * `OffscreenCanvas` (Safari only shipped it in 16.4) and the tests need no DOM.
 *
 * The preprocessing philosophy is *do less*. PP-OCR was trained on photographs,
 * not on scans, and every filter applied here is a filter it did not expect:
 * aggressive thresholding in particular destroys the thin strokes on thermal
 * paper and measurably lowers accuracy. So the pipeline resizes, and offers
 * contrast stretching for the genuinely dim photograph, and stops there.
 */

export interface Bitmap {
  /** RGBA, four bytes per pixel, row-major. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The size an image is reduced to before detection: no longer than
 * `MAX_DETECTION_SIDE`, both axes a multiple of the model's stride, and never
 * enlarged — upscaling a small photo invents detail and costs memory for it.
 */
export function fitDetectionSize(width: number, height: number): Size {
  if (width <= 0 || height <= 0) {
    return { width: DETECTION_STRIDE, height: DETECTION_STRIDE };
  }

  const scale = Math.min(MAX_DETECTION_SIDE / Math.max(width, height), 1);
  const round = (value: number): number =>
    Math.max(
      DETECTION_STRIDE,
      Math.round((value * scale) / DETECTION_STRIDE) * DETECTION_STRIDE,
    );

  return { width: round(width), height: round(height) };
}

/**
 * Crops a region and scales it to `targetWidth` × `targetHeight`, bilinearly.
 *
 * Bilinear rather than nearest-neighbour because recognition crops are almost
 * always *downscaled* — a receipt line is 60 px tall in the photo and 48 px in
 * the model — and point sampling a downscale drops whole strokes off thin
 * glyphs. The box is clamped to the image, so a box the detector pushed over
 * the edge samples the edge instead of reading out of bounds.
 */
export function cropAndResize(
  source: Bitmap,
  box: { x0: number; y0: number; x1: number; y1: number },
  targetWidth: number,
  targetHeight: number,
): Bitmap {
  const x0 = clamp(Math.min(box.x0, box.x1), 0, source.width - 1);
  const y0 = clamp(Math.min(box.y0, box.y1), 0, source.height - 1);
  const x1 = clamp(Math.max(box.x0, box.x1), x0 + 1, source.width);
  const y1 = clamp(Math.max(box.y0, box.y1), y0 + 1, source.height);

  const cropWidth = x1 - x0;
  const cropHeight = y1 - y0;
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  const scaleX = cropWidth / targetWidth;
  const scaleY = cropHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    // Sample at pixel centres, so the crop does not drift half a pixel — and
    // clamp inside the crop, so a box never samples the line above it.
    const sourceY = clamp(y0 + (y + 0.5) * scaleY - 0.5, y0, y1 - 1);
    const topY = Math.floor(sourceY);
    const bottomY = Math.min(topY + 1, y1 - 1);
    const weightY = sourceY - topY;

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = clamp(x0 + (x + 0.5) * scaleX - 0.5, x0, x1 - 1);
      const leftX = Math.floor(sourceX);
      const rightX = Math.min(leftX + 1, x1 - 1);
      const weightX = sourceX - leftX;

      const topLeft = (topY * source.width + leftX) * 4;
      const topRight = (topY * source.width + rightX) * 4;
      const bottomLeft = (bottomY * source.width + leftX) * 4;
      const bottomRight = (bottomY * source.width + rightX) * 4;
      const target = (y * targetWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top =
          source.data[topLeft + channel] * (1 - weightX) +
          source.data[topRight + channel] * weightX;
        const bottom =
          source.data[bottomLeft + channel] * (1 - weightX) +
          source.data[bottomRight + channel] * weightX;
        output[target + channel] = top * (1 - weightY) + bottom * weightY;
      }
    }
  }

  return { data: output, width: targetWidth, height: targetHeight };
}

/** Rec.709 luminance, which is what "how dark is this photo" should mean. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface LuminanceStats {
  /** Luminance at the 5th and 95th percentiles, 0–255. */
  readonly low: number;
  readonly high: number;
  /** `high - low`: how much of the available range the photo actually uses. */
  readonly range: number;
}

/**
 * Percentile luminance, sampled rather than exhaustive.
 *
 * Percentiles instead of min/max because a single blown-out highlight or one
 * black speck would otherwise report a full range on a photograph that plainly
 * has none.
 */
export function measureLuminance(image: Bitmap): LuminanceStats {
  const histogram = new Uint32Array(256);
  const pixels = image.width * image.height;
  // Sampling every few pixels is plenty for a percentile and keeps this
  // linear-but-cheap on a multi-megapixel photograph.
  const step = Math.max(1, Math.floor(pixels / 100_000));

  let counted = 0;
  for (let index = 0; index < pixels; index += step) {
    const offset = index * 4;
    histogram[
      Math.round(
        luminance(
          image.data[offset],
          image.data[offset + 1],
          image.data[offset + 2],
        ),
      )
    ] += 1;
    counted += 1;
  }
  if (counted === 0) return { low: 0, high: 255, range: 255 };

  const percentile = (fraction: number): number => {
    const target = counted * fraction;
    let running = 0;
    for (let value = 0; value < 256; value += 1) {
      running += histogram[value];
      if (running >= target) return value;
    }
    return 255;
  };

  const low = percentile(0.05);
  const high = percentile(0.95);
  return { low, high, range: Math.max(0, high - low) };
}

/** Below this, a photograph is dim enough that stretching it is worth doing. */
export const CONTRAST_THRESHOLD = 140;

/**
 * Stretches luminance so the 5th–95th percentile band fills the range.
 *
 * Applied in place, and only when `measureLuminance` says the photograph is
 * flat — a well-lit receipt is left exactly as it was, because stretching a
 * good photo only amplifies its noise.
 */
export function stretchContrast(image: Bitmap, stats: LuminanceStats): void {
  if (stats.range <= 0 || stats.range >= CONTRAST_THRESHOLD) return;

  const scale = 255 / stats.range;
  const lookup = new Uint8ClampedArray(256);
  for (let value = 0; value < 256; value += 1) {
    lookup[value] = (value - stats.low) * scale;
  }

  const { data } = image;
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = lookup[data[offset]];
    data[offset + 1] = lookup[data[offset + 1]];
    data[offset + 2] = lookup[data[offset + 2]];
  }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
