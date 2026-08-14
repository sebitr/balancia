import { describe, expect, it } from "vitest";
import type { DocumentCorners } from "./geometry";
import { applyHomography, solveHomography, warpPerspective } from "./warp";

describe("solveHomography", () => {
  const unitSquare = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("maps every control point exactly", () => {
    const quad = [
      { x: 20, y: 30 },
      { x: 200, y: 40 },
      { x: 190, y: 260 },
      { x: 10, y: 250 },
    ];
    const transform = solveHomography(unitSquare, quad);
    expect(transform).not.toBeNull();
    for (let index = 0; index < 4; index += 1) {
      const mapped = applyHomography(
        transform!,
        unitSquare[index].x,
        unitSquare[index].y,
      );
      expect(mapped.x).toBeCloseTo(quad[index].x, 6);
      expect(mapped.y).toBeCloseTo(quad[index].y, 6);
    }
  });

  it("reduces to the identity for identical quads", () => {
    const transform = solveHomography(unitSquare, unitSquare);
    const mapped = applyHomography(transform!, 0.3, 0.7);
    expect(mapped.x).toBeCloseTo(0.3, 6);
    expect(mapped.y).toBeCloseTo(0.7, 6);
  });

  it("refuses collinear corners", () => {
    expect(
      solveHomography(unitSquare, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ]),
    ).toBeNull();
  });
});

describe("warpPerspective", () => {
  /** A frame whose pixel values encode their own x coordinate. */
  function gradientFrame(width: number, height: number): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = x;
        rgba[offset + 1] = y;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 255;
      }
    }
    return rgba;
  }

  it("an axis-aligned extraction is a crop", () => {
    const frame = { width: 100, height: 100 };
    const corners: DocumentCorners = {
      topLeft: { x: 20, y: 30 },
      topRight: { x: 60, y: 30 },
      bottomRight: { x: 60, y: 80 },
      bottomLeft: { x: 20, y: 80 },
    };
    const warped = warpPerspective(gradientFrame(100, 100), frame, corners, 500);
    expect(warped).not.toBeNull();
    expect(warped!.width).toBe(40);
    expect(warped!.height).toBe(50);
    // The output's first column reads from source x=20, its last from x≈60.
    const first = warped!.data[0];
    const lastOffset = (warped!.width - 1) * 4;
    const last = warped!.data[lastOffset];
    expect(first).toBeGreaterThanOrEqual(19);
    expect(first).toBeLessThanOrEqual(21);
    expect(last).toBeGreaterThanOrEqual(58);
    expect(last).toBeLessThanOrEqual(61);
  });

  it("respects the size cap without changing shape", () => {
    const frame = { width: 200, height: 200 };
    const corners: DocumentCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 200 },
      bottomLeft: { x: 0, y: 200 },
    };
    const warped = warpPerspective(
      gradientFrame(200, 200),
      frame,
      corners,
      100,
    );
    expect(warped!.height).toBe(100);
    expect(warped!.width).toBe(50);
  });

  it("returns opaque pixels", () => {
    const frame = { width: 50, height: 50 };
    const corners: DocumentCorners = {
      topLeft: { x: 5, y: 5 },
      topRight: { x: 40, y: 8 },
      bottomRight: { x: 38, y: 44 },
      bottomLeft: { x: 4, y: 42 },
    };
    const warped = warpPerspective(gradientFrame(50, 50), frame, corners, 100);
    for (let offset = 3; offset < warped!.data.length; offset += 4) {
      expect(warped!.data[offset]).toBe(255);
    }
  });

  it("clamps sampling for corners nudged out of frame", () => {
    const frame = { width: 50, height: 50 };
    const corners: DocumentCorners = {
      topLeft: { x: -3, y: -2 },
      topRight: { x: 49, y: 0 },
      bottomRight: { x: 48, y: 49 },
      bottomLeft: { x: -2, y: 48 },
    };
    const warped = warpPerspective(gradientFrame(50, 50), frame, corners, 100);
    expect(warped).not.toBeNull();
    // Every red channel is a valid source x, never wrapped garbage.
    for (let offset = 0; offset < warped!.data.length; offset += 4) {
      expect(warped!.data[offset]).toBeLessThanOrEqual(49);
    }
  });
});
