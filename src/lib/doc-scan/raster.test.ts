import { describe, expect, it } from "vitest";
import { cornerList, type DocumentCorners, type Point } from "./geometry";
import {
  boxBlur,
  cornersFromRegion,
  documentIsBright,
  findDocumentCorners,
  largestRegion,
  otsuThreshold,
  toGrayscale,
} from "./raster";

/**
 * Synthetic frames: an RGBA buffer with a filled convex quadrilateral of one
 * shade on a background of another — a paper document, reduced to what the
 * detector actually sees.
 */
function frameWithQuad(
  width: number,
  height: number,
  corners: DocumentCorners,
  paper: number,
  table: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const polygon = cornerList(corners);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = inConvexPolygon({ x, y }, polygon) ? paper : table;
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

function inConvexPolygon(point: Point, polygon: readonly Point[]): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

/** A tilted page well inside a 240×320 frame. */
const page: DocumentCorners = {
  topLeft: { x: 40, y: 50 },
  topRight: { x: 200, y: 60 },
  bottomRight: { x: 190, y: 270 },
  bottomLeft: { x: 30, y: 260 },
};

function expectCornersClose(
  found: DocumentCorners,
  expected: DocumentCorners,
  tolerance: number,
) {
  const foundList = cornerList(found);
  const expectedList = cornerList(expected);
  for (let index = 0; index < 4; index += 1) {
    expect(
      Math.hypot(
        foundList[index].x - expectedList[index].x,
        foundList[index].y - expectedList[index].y,
      ),
    ).toBeLessThanOrEqual(tolerance);
  }
}

describe("toGrayscale and boxBlur", () => {
  it("maps grey RGBA to its own value", () => {
    const rgba = new Uint8ClampedArray([100, 100, 100, 255]);
    expect(toGrayscale(rgba, 1, 1)[0]).toBe(100);
  });

  it("blur preserves a uniform field", () => {
    const gray = new Uint8Array(64).fill(200);
    expect(Array.from(boxBlur(gray, 8, 8))).toEqual(
      Array.from(new Uint8Array(64).fill(200)),
    );
  });

  it("blur softens an isolated spike", () => {
    const gray = new Uint8Array(25);
    gray[12] = 255;
    const blurred = boxBlur(gray, 5, 5);
    expect(blurred[12]).toBeLessThan(100);
    expect(blurred[12]).toBeGreaterThan(0);
  });
});

describe("otsuThreshold", () => {
  it("separates a bimodal histogram between its modes", () => {
    const gray = new Uint8Array(1000);
    gray.fill(40, 0, 600);
    gray.fill(220, 600);
    const threshold = otsuThreshold(gray);
    expect(threshold).toBeGreaterThanOrEqual(40);
    expect(threshold).toBeLessThan(220);
  });
});

describe("documentIsBright", () => {
  it("calls the document bright when the border is dark", () => {
    const rgba = frameWithQuad(240, 320, page, 230, 40);
    const gray = toGrayscale(rgba, 240, 320);
    const threshold = otsuThreshold(gray);
    expect(documentIsBright(gray, 240, 320, threshold)).toBe(true);
  });

  it("calls the document dark when the border is bright", () => {
    const rgba = frameWithQuad(240, 320, page, 40, 230);
    const gray = toGrayscale(rgba, 240, 320);
    const threshold = otsuThreshold(gray);
    expect(documentIsBright(gray, 240, 320, threshold)).toBe(false);
  });
});

describe("largestRegion", () => {
  it("finds the page and ignores a smaller spill", () => {
    const rgba = frameWithQuad(240, 320, page, 230, 40);
    const gray = toGrayscale(rgba, 240, 320);
    // A second, smaller bright blob: a napkin next to the receipt.
    for (let y = 290; y < 310; y += 1) {
      for (let x = 210; x < 235; x += 1) {
        gray[y * 240 + x] = 230;
      }
    }
    const region = largestRegion(gray, 240, 320, otsuThreshold(gray), true);
    expect(region).not.toBeNull();
    // The centroid is inside the page, nowhere near the blob.
    expect(region!.centroid.x).toBeGreaterThan(80);
    expect(region!.centroid.x).toBeLessThan(160);
    expect(region!.centroid.y).toBeGreaterThan(120);
    expect(region!.centroid.y).toBeLessThan(200);
  });

  it("returns null on an empty frame", () => {
    const gray = new Uint8Array(240 * 320).fill(40);
    // Threshold 0 puts every pixel at or below it: no document class.
    expect(largestRegion(gray, 240, 320, 255, true)).toBeNull();
  });

  it("unites runs across a concave row", () => {
    // A U shape is one region even though its middle rows hold two runs.
    const gray = new Uint8Array(100);
    const set = (x: number, y: number) => {
      gray[y * 10 + x] = 255;
    };
    for (let y = 2; y < 8; y += 1) {
      set(2, y);
      set(7, y);
    }
    for (let x = 2; x <= 7; x += 1) set(x, 7);
    const region = largestRegion(gray, 10, 10, 127, true);
    expect(region!.area).toBe(6 + 6 + 4);
  });
});

describe("cornersFromRegion and findDocumentCorners", () => {
  it("recovers the corners of a bright page on a dark table", () => {
    const rgba = frameWithQuad(240, 320, page, 235, 35);
    const found = findDocumentCorners(rgba, 240, 320);
    expect(found).not.toBeNull();
    expectCornersClose(found!, page, 4);
  });

  it("recovers the corners of a dark document on a bright table", () => {
    const rgba = frameWithQuad(240, 320, page, 35, 235);
    const found = findDocumentCorners(rgba, 240, 320);
    expect(found).not.toBeNull();
    expectCornersClose(found!, page, 4);
  });

  it("recovers a narrow receipt", () => {
    const receipt: DocumentCorners = {
      topLeft: { x: 95, y: 20 },
      topRight: { x: 150, y: 22 },
      bottomRight: { x: 148, y: 300 },
      bottomLeft: { x: 93, y: 298 },
    };
    const rgba = frameWithQuad(240, 320, receipt, 235, 35);
    const found = findDocumentCorners(rgba, 240, 320);
    expect(found).not.toBeNull();
    expectCornersClose(found!, receipt, 4);
  });

  it("survives moderate noise", () => {
    const rgba = frameWithQuad(240, 320, page, 225, 45);
    // Deterministic speckle, ±25 levels.
    let seed = 7;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const noise = (seed % 51) - 25;
      rgba[offset] += noise;
      rgba[offset + 1] += noise;
      rgba[offset + 2] += noise;
    }
    const found = findDocumentCorners(rgba, 240, 320);
    expect(found).not.toBeNull();
    expectCornersClose(found!, page, 6);
  });

  it("rejects a frame with nothing on it", () => {
    const rgba = new Uint8ClampedArray(240 * 320 * 4);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      rgba[offset] = 120;
      rgba[offset + 1] = 120;
      rgba[offset + 2] = 120;
      rgba[offset + 3] = 255;
    }
    expect(findDocumentCorners(rgba, 240, 320)).toBeNull();
  });

  it("rejects a small object", () => {
    const matchbox: DocumentCorners = {
      topLeft: { x: 100, y: 140 },
      topRight: { x: 140, y: 140 },
      bottomRight: { x: 140, y: 175 },
      bottomLeft: { x: 100, y: 175 },
    };
    const rgba = frameWithQuad(240, 320, matchbox, 235, 35);
    expect(findDocumentCorners(rgba, 240, 320)).toBeNull();
  });

  it("rejects a region that does not fill its quadrilateral", () => {
    // An L-shaped bright region: the corner rule spans a big quad over it,
    // but the fill check sees mostly table inside that quad.
    const rgba = frameWithQuad(240, 320, page, 35, 35);
    const gray = (x: number, y: number, value: number) => {
      const offset = (y * 240 + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
    };
    for (let y = 40; y < 280; y += 1) {
      for (let x = 30; x < 70; x += 1) gray(x, y, 235);
    }
    for (let y = 240; y < 280; y += 1) {
      for (let x = 70; x < 210; x += 1) gray(x, y, 235);
    }
    expect(findDocumentCorners(rgba, 240, 320)).toBeNull();
  });

  it("needs all four quadrants populated", () => {
    expect(
      cornersFromRegion({
        area: 4,
        centroid: { x: 10, y: 10 },
        // Everything in one quadrant: no quadrilateral to be had.
        edgePoints: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 2, y: 3 },
          { x: 3, y: 3 },
        ],
      }),
    ).toBeNull();
  });
});
