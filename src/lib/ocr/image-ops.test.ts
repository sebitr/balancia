import { describe, expect, it } from "vitest";
import {
  CONTRAST_THRESHOLD,
  cropAndResize,
  fitDetectionSize,
  measureLuminance,
  stretchContrast,
  type Bitmap,
} from "./image-ops";
import { DETECTION_STRIDE, MAX_DETECTION_SIDE } from "./config";

function solid(width: number, height: number, value: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { data, width, height };
}

describe("fitDetectionSize", () => {
  it("reduces a phone photograph to the working size", () => {
    // A 12 megapixel portrait shot, which is what this feature actually gets.
    const size = fitDetectionSize(3024, 4032);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
      MAX_DETECTION_SIDE,
    );
  });

  it("always returns multiples of the detector's stride", () => {
    for (const [width, height] of [
      [3024, 4032],
      [1000, 1333],
      [640, 480],
      [37, 91],
    ]) {
      const size = fitDetectionSize(width, height);
      expect(size.width % DETECTION_STRIDE).toBe(0);
      expect(size.height % DETECTION_STRIDE).toBe(0);
    }
  });

  it("roughly preserves the aspect ratio", () => {
    const size = fitDetectionSize(3024, 4032);
    expect(size.width / size.height).toBeCloseTo(3024 / 4032, 1);
  });

  it("never enlarges a small image", () => {
    // Upscaling invents detail and pays memory for it.
    const size = fitDetectionSize(320, 200);
    expect(size.width).toBeLessThanOrEqual(320 + DETECTION_STRIDE);
  });

  it("survives a degenerate size", () => {
    expect(fitDetectionSize(0, 0)).toEqual({
      width: DETECTION_STRIDE,
      height: DETECTION_STRIDE,
    });
  });
});

describe("measureLuminance", () => {
  it("reports no range for a flat image", () => {
    expect(measureLuminance(solid(16, 16, 128)).range).toBe(0);
  });

  it("reports the range of a photograph that uses it", () => {
    const image = solid(100, 100, 0);
    // Half the pixels white.
    for (let offset = 0; offset < image.data.length / 2; offset += 4) {
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
    }
    expect(measureLuminance(image).range).toBeGreaterThan(200);
  });

  it("ignores a single blown-out speck", () => {
    // Percentiles, not min/max: one bright pixel must not claim a full range
    // on a photograph that plainly has none.
    const image = solid(100, 100, 100);
    image.data[0] = 255;
    image.data[1] = 255;
    image.data[2] = 255;
    expect(measureLuminance(image).range).toBeLessThan(10);
  });
});

describe("stretchContrast", () => {
  it("opens up a dim photograph", () => {
    const image = solid(64, 64, 100);
    // A band of slightly lighter pixels: a receipt photographed in the dark.
    for (let offset = 0; offset < image.data.length / 2; offset += 4) {
      image.data[offset] = 140;
      image.data[offset + 1] = 140;
      image.data[offset + 2] = 140;
    }

    const before = measureLuminance(image);
    expect(before.range).toBeLessThan(CONTRAST_THRESHOLD);
    stretchContrast(image, before);
    expect(measureLuminance(image).range).toBeGreaterThan(before.range);
  });

  it("leaves a well-lit photograph alone", () => {
    // Stretching a good photo only amplifies its noise.
    const image = solid(64, 64, 0);
    for (let offset = 0; offset < image.data.length / 2; offset += 4) {
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
    }
    const copy = Uint8ClampedArray.from(image.data);
    stretchContrast(image, measureLuminance(image));
    expect(image.data).toEqual(copy);
  });

  it("does nothing to a perfectly flat image", () => {
    const image = solid(16, 16, 128);
    const copy = Uint8ClampedArray.from(image.data);
    stretchContrast(image, measureLuminance(image));
    expect(image.data).toEqual(copy);
  });

  it("leaves the alpha channel untouched", () => {
    const image = solid(16, 16, 100);
    image.data[4] = 130;
    stretchContrast(image, measureLuminance(image));
    expect(image.data[3]).toBe(255);
  });
});

describe("cropAndResize", () => {
  /** 4×4, left half black, right half white. */
  function split(): Bitmap {
    const image = solid(4, 4, 0);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 2; x < 4; x += 1) {
        const offset = (y * 4 + x) * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 255;
        image.data[offset + 2] = 255;
      }
    }
    return image;
  }

  it("returns the requested size", () => {
    const output = cropAndResize(split(), { x0: 0, y0: 0, x1: 4, y1: 4 }, 8, 6);
    expect(output.width).toBe(8);
    expect(output.height).toBe(6);
    expect(output.data).toHaveLength(8 * 6 * 4);
  });

  it("does not mirror the image", () => {
    const output = cropAndResize(split(), { x0: 0, y0: 0, x1: 4, y1: 4 }, 8, 8);
    expect(output.data[0]).toBeLessThan(128);
    expect(output.data[(8 - 1) * 4]).toBeGreaterThan(128);
  });

  it("crops the region it was asked for", () => {
    // The right half only: every pixel should be white.
    const output = cropAndResize(split(), { x0: 2, y0: 0, x1: 4, y1: 4 }, 4, 4);
    for (let offset = 0; offset < output.data.length; offset += 4) {
      expect(output.data[offset]).toBeGreaterThan(200);
    }
  });

  it("clamps a box that runs past the edge instead of reading out of bounds", () => {
    const output = cropAndResize(
      split(),
      { x0: -50, y0: -50, x1: 500, y1: 500 },
      8,
      8,
    );
    expect(output.data.some(Number.isNaN)).toBe(false);
  });

  it("copes with a box given backwards", () => {
    const output = cropAndResize(split(), { x0: 4, y0: 4, x1: 0, y1: 0 }, 4, 4);
    expect(output.data).toHaveLength(4 * 4 * 4);
  });
});
