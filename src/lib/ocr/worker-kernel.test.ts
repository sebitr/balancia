import { describe, expect, it } from "vitest";
import { transform } from "esbuild";
import { ocrKernelSource } from "./worker-kernel";
import { ocrWorkerSource } from "./worker-source";
import { DET_MODEL_URL, REC_MODEL_URL, RUNTIME_URL } from "./config";

/**
 * The worker is source text, so nothing type-checks it — and unlike the
 * embedding worker, this one contains real arithmetic that can be quietly
 * wrong. So these tests do not just parse the text: they *run* it, against
 * inputs whose right answers are known by hand.
 *
 * Every bug this file has caught was invisible in review: a CTC decoder that
 * doubles letters, a dictionary loader that puts a carriage return between
 * every glyph, a crop that samples half a pixel off.
 */

interface Kernel {
  normalizeDetection(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Float32Array;
  extractBoxes(
    probabilities: Float32Array,
    width: number,
    height: number,
  ): { x0: number; y0: number; x1: number; y1: number; score: number }[];
  mergeIntoLines(
    boxes: { x0: number; y0: number; x1: number; y1: number; score: number }[],
  ): { x0: number; y0: number; x1: number; y1: number; score: number }[];
  decodeCtc(
    data: Float32Array,
    steps: number,
    classes: number,
    charset: string[],
  ): { text: string; confidence: number };
  buildCharset(text: string): string[];
  cropForRecognition(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    box: { x0: number; y0: number; x1: number; y1: number },
    targetWidth: number,
  ): Float32Array;
  recognitionWidth(width: number, height: number): number;
  scaleBox(
    box: { x0: number; y0: number; x1: number; y1: number; score: number },
    scaleX: number,
    scaleY: number,
  ): { x0: number; y0: number; x1: number; y1: number };
}

/** Evaluates the kernel exactly as the browser would, and hands back its API. */
function loadKernel(): Kernel {
  const factory = new Function(
    `${ocrKernelSource()}
     return {
       normalizeDetection, extractBoxes, mergeIntoLines, decodeCtc,
       buildCharset, cropForRecognition, recognitionWidth, scaleBox,
     };`,
  );
  return factory() as Kernel;
}

const kernel = loadKernel();

/** Builds a probability map with rectangles of text on a blank page. */
function probabilityMap(
  width: number,
  height: number,
  regions: readonly { x0: number; y0: number; x1: number; y1: number }[],
): Float32Array {
  const map = new Float32Array(width * height);
  for (const region of regions) {
    for (let y = region.y0; y < region.y1; y += 1) {
      for (let x = region.x0; x < region.x1; x += 1) {
        map[y * width + x] = 0.9;
      }
    }
  }
  return map;
}

describe("the worker source", () => {
  it("parses as an ES module", async () => {
    await expect(
      transform(ocrWorkerSource(), { loader: "js", format: "esm" }),
    ).resolves.toBeDefined();
  });

  it("carries the configured paths, with no second definition of them", () => {
    const source = ocrWorkerSource();
    expect(source).toContain(RUNTIME_URL);
    expect(source).toContain(DET_MODEL_URL);
    expect(source).toContain(REC_MODEL_URL);
  });

  it("names no host but this one", () => {
    // Every URL it uses is a path on this origin. A scheme in here would mean
    // the browser talking to somebody else about somebody's receipt.
    expect(ocrWorkerSource()).not.toMatch(/https?:\/\//);
  });

  it("asks for WebAssembly when there is no WebGPU, and never requires it", () => {
    const source = ocrWorkerSource();
    expect(source).toContain('providers = ["wasm"]');
    expect(source).toContain("navigator.gpu");
  });

  it("does not send an error stack back to the page", () => {
    // Stacks and payloads can carry fragments of the receipt itself.
    expect(ocrWorkerSource()).not.toContain("error.stack");
  });
});

describe("decodeCtc", () => {
  const charset = ["<blank>", "a", "b", "c"];

  /** One timestep's class scores, as the recognizer would emit them. */
  function steps(sequence: readonly number[]): Float32Array {
    const data = new Float32Array(sequence.length * charset.length);
    sequence.forEach((best, step) => {
      data[step * charset.length + best] = 0.9;
    });
    return data;
  }

  it("collapses a class repeated on consecutive steps", () => {
    // The whole of CTC's collapsing rule. Getting it wrong spells "aabb".
    const decoded = kernel.decodeCtc(
      steps([1, 1, 2, 2, 2]),
      5,
      charset.length,
      charset,
    );
    expect(decoded.text).toBe("ab");
  });

  it("keeps a repeat that is separated by a blank", () => {
    // `a`, blank, `a` is a genuine double letter.
    const decoded = kernel.decodeCtc(
      steps([1, 0, 1]),
      3,
      charset.length,
      charset,
    );
    expect(decoded.text).toBe("aa");
  });

  it("drops blanks", () => {
    const decoded = kernel.decodeCtc(
      steps([0, 1, 0, 2, 0]),
      5,
      charset.length,
      charset,
    );
    expect(decoded.text).toBe("ab");
  });

  it("reports mean confidence over the characters it emitted", () => {
    const decoded = kernel.decodeCtc(
      steps([1, 2, 3]),
      3,
      charset.length,
      charset,
    );
    expect(decoded.confidence).toBeCloseTo(0.9, 5);
  });

  it("returns nothing, and zero confidence, for an all-blank line", () => {
    const decoded = kernel.decodeCtc(
      steps([0, 0, 0]),
      3,
      charset.length,
      charset,
    );
    expect(decoded).toEqual({ text: "", confidence: 0 });
  });
});

describe("buildCharset", () => {
  it("puts the CTC blank first and a space last", () => {
    const charset = kernel.buildCharset("a\nb\nc\n");
    expect(charset[0]).toBe("<blank>");
    expect(charset[1]).toBe("a");
    expect(charset.at(-1)).toBe(" ");
    expect(charset).toHaveLength(5);
  });

  it("survives the CRLF line endings the dictionary actually ships with", () => {
    // A stray \r is decoded as a character and lands between every glyph:
    // "C\ra\rs\ra". The file really does have them.
    const charset = kernel.buildCharset("a\r\nb\r\nc\r\n");
    expect(charset[1]).toBe("a");
    expect(charset[3]).toBe("c");
    expect(charset.join("")).not.toContain("\r");
  });
});

describe("extractBoxes", () => {
  it("finds one box per region of text", () => {
    const map = probabilityMap(64, 64, [
      { x0: 5, y0: 5, x1: 30, y1: 15 },
      { x0: 5, y0: 40, x1: 40, y1: 50 },
    ]);
    expect(kernel.extractBoxes(map, 64, 64)).toHaveLength(2);
  });

  it("finds nothing on a blank page", () => {
    expect(kernel.extractBoxes(new Float32Array(64 * 64), 64, 64)).toEqual([]);
  });

  it("grows the region, because the detector shrinks it", () => {
    const map = probabilityMap(64, 64, [{ x0: 20, y0: 20, x1: 40, y1: 30 }]);
    const [box] = kernel.extractBoxes(map, 64, 64);
    expect(box.x0).toBeLessThan(20);
    expect(box.x1).toBeGreaterThan(40);
  });

  it("never grows a region past the edge of the image", () => {
    const map = probabilityMap(64, 64, [{ x0: 0, y0: 0, x1: 20, y1: 10 }]);
    const [box] = kernel.extractBoxes(map, 64, 64);
    expect(box.x0).toBeGreaterThanOrEqual(0);
    expect(box.y0).toBeGreaterThanOrEqual(0);
    expect(box.x1).toBeLessThanOrEqual(64);
  });

  it("ignores specks", () => {
    const map = probabilityMap(64, 64, [{ x0: 10, y0: 10, x1: 12, y1: 12 }]);
    expect(kernel.extractBoxes(map, 64, 64)).toEqual([]);
  });
});

describe("mergeIntoLines", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({
    x0,
    y0,
    x1,
    y1,
    score: 0.9,
  });

  it("joins words that sit on one line", () => {
    const merged = kernel.mergeIntoLines([
      box(10, 10, 40, 30),
      box(44, 10, 70, 30),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ x0: 10, x1: 70 });
  });

  it("keeps a description and a price in separate columns apart", () => {
    // Joining them would hand the recognizer a crop that is mostly blank paper.
    const merged = kernel.mergeIntoLines([
      box(10, 10, 60, 30),
      box(300, 10, 360, 30),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps separate rows separate", () => {
    const merged = kernel.mergeIntoLines([
      box(10, 10, 60, 30),
      box(10, 40, 60, 60),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("takes the lowest score of what it merged", () => {
    const merged = kernel.mergeIntoLines([
      { x0: 10, y0: 10, x1: 40, y1: 30, score: 0.99 },
      { x0: 44, y0: 10, x1: 70, y1: 30, score: 0.51 },
    ]);
    expect(merged[0].score).toBe(0.51);
  });
});

describe("normalizeDetection", () => {
  it("lays the image out as planar RGB", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    // Two pixels, so the layout is [R0, R1, G0, G1, B0, B1] — not interleaved.
    const output = kernel.normalizeDetection(rgba, 2, 1);
    expect(output).toHaveLength(6);
    // The red pixel leads the red plane…
    expect(output[0]).toBeGreaterThan(output[1]);
    // …and trails the green one.
    expect(output[2]).toBeLessThan(output[3]);
  });

  it("applies the statistics the detector was trained with", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const output = kernel.normalizeDetection(rgba, 1, 1);
    expect(output[0]).toBeCloseTo(-0.485 / 0.229, 5);
  });
});

describe("cropForRecognition", () => {
  /** A 4×4 image, left half black and right half white. */
  function split(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const value = x < 2 ? 0 : 255;
        const offset = (y * 4 + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
      }
    }
    return data;
  }

  it("scales into [-1, 1]", () => {
    const output = kernel.cropForRecognition(
      split(),
      4,
      4,
      { x0: 0, y0: 0, x1: 4, y1: 4 },
      8,
    );
    for (const value of output) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("keeps left on the left", () => {
    const width = 8;
    const output = kernel.cropForRecognition(
      split(),
      4,
      4,
      { x0: 0, y0: 0, x1: 4, y1: 4 },
      width,
    );
    // First column dark, last column light — the crop is not mirrored.
    expect(output[0]).toBeLessThan(0);
    expect(output[width - 1]).toBeGreaterThan(0);
  });

  it("clamps a box the detector pushed over the edge", () => {
    expect(() =>
      kernel.cropForRecognition(
        split(),
        4,
        4,
        { x0: -20, y0: -20, x1: 400, y1: 400 },
        8,
      ),
    ).not.toThrow();
  });

  it("produces exactly three planes of the requested size", () => {
    const output = kernel.cropForRecognition(
      split(),
      4,
      4,
      { x0: 0, y0: 0, x1: 4, y1: 4 },
      16,
    );
    expect(output).toHaveLength(3 * 16 * 48);
  });
});

describe("recognitionWidth", () => {
  it("keeps the aspect ratio, rounded to a multiple of eight", () => {
    expect(kernel.recognitionWidth(200, 50) % 8).toBe(0);
    expect(kernel.recognitionWidth(200, 50)).toBeCloseTo(192, -1);
  });

  it("bounds a very wide line", () => {
    expect(kernel.recognitionWidth(20_000, 40)).toBeLessThanOrEqual(480);
  });

  it("does not collapse a very narrow one", () => {
    expect(kernel.recognitionWidth(2, 40)).toBeGreaterThanOrEqual(16);
  });
});

describe("scaleBox", () => {
  it("maps detector coordinates back onto the source image", () => {
    const scaled = kernel.scaleBox(
      { x0: 10, y0: 20, x1: 30, y1: 40, score: 0.9 },
      2,
      3,
    );
    expect(scaled).toMatchObject({ x0: 20, y0: 60, x1: 60, y1: 120 });
  });
});
