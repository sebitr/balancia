import { describe, expect, it } from "vitest";
import {
  cornerList,
  cornerMovement,
  coverProjection,
  edgeLengths,
  extractionSize,
  isConvex,
  isCredibleDocument,
  isWithinFrame,
  normalizeCorners,
  orderCorners,
  polygonArea,
  projectToCover,
  scaleCorners,
  smoothCorners,
  type DocumentCorners,
  type Size,
} from "./geometry";

/** An A4-ish page filling most of a portrait detection canvas. */
const page: DocumentCorners = {
  topLeft: { x: 100, y: 200 },
  topRight: { x: 620, y: 210 },
  bottomRight: { x: 610, y: 1080 },
  bottomLeft: { x: 90, y: 1090 },
};

/** The detection canvas the corners above live in: 720 wide, portrait. */
const frame: Size = { width: 720, height: 1280 };

describe("orderCorners", () => {
  it("names shuffled corners by position", () => {
    const shuffled = [
      page.bottomRight,
      page.topLeft,
      page.bottomLeft,
      page.topRight,
    ];
    expect(orderCorners(shuffled)).toEqual(page);
  });
});

describe("polygonArea", () => {
  it("measures a rectangle exactly", () => {
    const rectangle = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(polygonArea(rectangle)).toBe(12);
  });

  it("is orientation-independent", () => {
    const clockwise = cornerList(page);
    const counterClockwise = [...clockwise].reverse();
    expect(polygonArea(counterClockwise)).toBeCloseTo(polygonArea(clockwise));
  });
});

describe("isConvex", () => {
  it("accepts a photographed page", () => {
    expect(isConvex(page)).toBe(true);
  });

  it("rejects a self-intersecting quadrilateral", () => {
    // Top edge crosses the bottom edge: an hourglass, not a page.
    expect(
      isConvex({
        topLeft: { x: 0, y: 0 },
        topRight: { x: 100, y: 0 },
        bottomRight: { x: 0, y: 100 },
        bottomLeft: { x: 100, y: 100 },
      }),
    ).toBe(false);
  });

  it("rejects a collapsed quadrilateral", () => {
    expect(
      isConvex({
        topLeft: { x: 0, y: 0 },
        topRight: { x: 50, y: 0 },
        bottomRight: { x: 100, y: 0 },
        bottomLeft: { x: 0, y: 0 },
      }),
    ).toBe(false);
  });
});

describe("isCredibleDocument", () => {
  it("accepts a page filling much of the frame", () => {
    expect(isCredibleDocument(page, frame)).toBe(true);
  });

  it("accepts a till receipt, which is legitimately narrow", () => {
    // Roughly 1:5, filling the frame's height — a real receipt in frame.
    const receipt: DocumentCorners = {
      topLeft: { x: 260, y: 60 },
      topRight: { x: 470, y: 65 },
      bottomRight: { x: 465, y: 1220 },
      bottomLeft: { x: 255, y: 1215 },
    };
    expect(isCredibleDocument(receipt, frame)).toBe(true);
  });

  it("rejects a small object on the table", () => {
    const matchbox: DocumentCorners = {
      topLeft: { x: 300, y: 500 },
      topRight: { x: 420, y: 500 },
      bottomRight: { x: 420, y: 580 },
      bottomLeft: { x: 300, y: 580 },
    };
    expect(isCredibleDocument(matchbox, frame)).toBe(false);
  });

  it("rejects a sliver even when its bounding area is large", () => {
    const sliver: DocumentCorners = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 710, y: 20 },
      bottomRight: { x: 710, y: 60 },
      bottomLeft: { x: 10, y: 50 },
    };
    expect(isCredibleDocument(sliver, frame)).toBe(false);
  });

  it("rejects non-finite corners", () => {
    expect(
      isCredibleDocument({ ...page, topLeft: { x: Number.NaN, y: 0 } }, frame),
    ).toBe(false);
  });
});

describe("isWithinFrame", () => {
  it("accepts corners just over the edge, within tolerance", () => {
    const nearEdge = { ...page, topLeft: { x: -5, y: 200 } };
    expect(isWithinFrame(nearEdge, frame)).toBe(true);
  });

  it("rejects a page partly out of frame", () => {
    const outside = { ...page, topLeft: { x: -100, y: 200 } };
    expect(isWithinFrame(outside, frame)).toBe(false);
  });
});

describe("normalizeCorners and scaleCorners", () => {
  it("round-trips through another resolution", () => {
    // Detected at 720×1280, applied to the 1080×1920 capture.
    const normalized = normalizeCorners(page, frame);
    const capture: Size = { width: 1080, height: 1920 };
    const scaled = scaleCorners(normalized, capture);
    expect(scaled.topLeft.x).toBeCloseTo((100 / 720) * 1080);
    expect(scaled.bottomLeft.y).toBeCloseTo((1090 / 1280) * 1920);
  });

  it("normalizes into the unit square", () => {
    const normalized = normalizeCorners(page, frame);
    for (const point of cornerList(normalized)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("smoothCorners and cornerMovement", () => {
  it("moves a fraction of the way toward the detection", () => {
    const detected = {
      ...page,
      topLeft: { x: page.topLeft.x + 10, y: page.topLeft.y },
    };
    const smoothed = smoothCorners(page, detected, 0.3);
    expect(smoothed.topLeft.x).toBeCloseTo(page.topLeft.x + 3);
  });

  it("measures mean displacement", () => {
    const shifted = scaleCorners(normalizeCorners(page, frame), frame);
    const moved = {
      topLeft: { x: shifted.topLeft.x + 4, y: shifted.topLeft.y },
      topRight: { x: shifted.topRight.x, y: shifted.topRight.y + 4 },
      bottomRight: {
        x: shifted.bottomRight.x - 4,
        y: shifted.bottomRight.y,
      },
      bottomLeft: {
        x: shifted.bottomLeft.x,
        y: shifted.bottomLeft.y - 4,
      },
    };
    expect(cornerMovement(shifted, moved)).toBeCloseTo(4);
  });
});

describe("extractionSize", () => {
  it("derives the shape from the document's own edges, not A4", () => {
    const receipt: DocumentCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 200, y: 0 },
      bottomRight: { x: 200, y: 1000 },
      bottomLeft: { x: 0, y: 1000 },
    };
    const size = extractionSize(receipt, 2400);
    expect(size).toEqual({ width: 200, height: 1000 });
  });

  it("uses the longer of each opposing edge pair", () => {
    // Perspective shortens the far edge; the near one is closer to true size.
    const edges = edgeLengths(page);
    const size = extractionSize(page, 5000);
    expect(size.width).toBe(Math.round(Math.max(edges.top, edges.bottom)));
    expect(size.height).toBe(Math.round(Math.max(edges.left, edges.right)));
  });

  it("caps the longest side without distorting the ratio", () => {
    const tall: DocumentCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1000, y: 0 },
      bottomRight: { x: 1000, y: 4000 },
      bottomLeft: { x: 0, y: 4000 },
    };
    const size = extractionSize(tall, 2000);
    expect(size.height).toBe(2000);
    expect(size.width).toBe(500);
  });
});

describe("coverProjection and projectToCover", () => {
  it("crops the sides of a landscape frame in a portrait container", () => {
    const landscape: Size = { width: 1920, height: 1080 };
    const container: Size = { width: 300, height: 400 };
    const projection = coverProjection(landscape, container);

    // Scaled to match the container's height; the width overflows equally
    // left and right.
    expect(projection.scale).toBeCloseTo(400 / 1080);
    expect(projection.offsetY).toBeCloseTo(0);
    expect(projection.offsetX).toBeCloseTo((300 - 1920 * (400 / 1080)) / 2);
    expect(projection.offsetX).toBeLessThan(0);
  });

  it("crops top and bottom of a portrait frame in a landscape container", () => {
    const portrait: Size = { width: 1080, height: 1920 };
    const container: Size = { width: 400, height: 300 };
    const projection = coverProjection(portrait, container);
    expect(projection.scale).toBeCloseTo(400 / 1080);
    expect(projection.offsetX).toBeCloseTo(0);
    expect(projection.offsetY).toBeLessThan(0);
  });

  it("maps the frame centre to the container centre", () => {
    const landscape: Size = { width: 1920, height: 1080 };
    const container: Size = { width: 300, height: 400 };
    const centre = projectToCover({ x: 0.5, y: 0.5 }, landscape, container);
    expect(centre.x).toBeCloseTo(150);
    expect(centre.y).toBeCloseTo(200);
  });

  it("pushes a cropped-away point outside the container", () => {
    // In a landscape frame shown portrait, the frame's left edge is cropped
    // off screen — its projection must land at negative x, not be squeezed
    // into view.
    const landscape: Size = { width: 1920, height: 1080 };
    const container: Size = { width: 300, height: 400 };
    const leftEdge = projectToCover({ x: 0, y: 0.5 }, landscape, container);
    expect(leftEdge.x).toBeLessThan(0);
  });

  it("is the identity when frame and container agree", () => {
    const size: Size = { width: 720, height: 1280 };
    const point = projectToCover({ x: 0.25, y: 0.75 }, size, size);
    expect(point.x).toBeCloseTo(180);
    expect(point.y).toBeCloseTo(960);
  });
});
