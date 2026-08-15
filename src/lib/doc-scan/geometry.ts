/**
 * Geometry for the live document scanner, kept pure so it can be unit-tested
 * without a camera or a DOM.
 *
 * Three coordinate spaces are involved and deliberately kept apart:
 *
 *  1. Camera-frame pixels — what the sensor delivers, `video.videoWidth` by
 *     `video.videoHeight`.
 *  2. Detection-canvas pixels — the reduced copy OpenCV actually looks at.
 *  3. Display pixels — the on-screen video, which `object-fit: cover` scales
 *     *and crops*, so it is not simply a rescaled frame.
 *
 * Corners are normalized to 0–1 of the frame as soon as they leave the
 * detector. Everything downstream — smoothing, stability, the overlay — then
 * works unchanged when the phone rotates, the layout resizes or the detection
 * resolution adapts. Pixels reappear only at the two edges: projecting onto
 * the visible video (`projectToCover`) and scaling onto the full-resolution
 * capture (`scaleCorners`).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The four corners of a detected document, named rather than positional. */
export interface DocumentCorners {
  readonly topLeft: Point;
  readonly topRight: Point;
  readonly bottomRight: Point;
  readonly bottomLeft: Point;
}

/** The corners as a polygon, in drawing order. */
export function cornerList(corners: DocumentCorners): readonly Point[] {
  return [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Names four arbitrary corners.
 *
 * Top-left is the point with the smallest x+y and bottom-right the largest;
 * top-right has the largest x−y and bottom-left the smallest. For anything a
 * camera plausibly sees of a page this is unambiguous; a quadrilateral twisted
 * enough to confuse it ends up degenerate and is rejected by
 * `isCredibleDocument` anyway.
 */
export function orderCorners(points: readonly Point[]): DocumentCorners {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDifference = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
  return {
    topLeft: bySum[0],
    bottomRight: bySum[bySum.length - 1],
    topRight: byDifference[byDifference.length - 1],
    bottomLeft: byDifference[0],
  };
}

/** Shoelace area of a simple polygon. */
export function polygonArea(points: readonly Point[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Whether the corners, walked in drawing order, turn the same way at every
 * vertex. A self-intersecting or collapsed quadrilateral fails this; every
 * photograph of a flat page passes it.
 */
export function isConvex(corners: DocumentCorners): boolean {
  const points = cornerList(corners);
  let turn = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    const sign = Math.sign(cross);
    if (turn === 0) {
      turn = sign;
    } else if (sign !== turn) {
      return false;
    }
  }
  return true;
}

export interface EdgeLengths {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export function edgeLengths(corners: DocumentCorners): EdgeLengths {
  return {
    top: distance(corners.topLeft, corners.topRight),
    right: distance(corners.topRight, corners.bottomRight),
    bottom: distance(corners.bottomRight, corners.bottomLeft),
    left: distance(corners.bottomLeft, corners.topLeft),
  };
}

/**
 * The smallest fraction of the frame a quadrilateral must cover to count as
 * the document being scanned. Low enough not to refuse a till receipt — a
 * receipt filling the frame's whole height at its natural aspect can still
 * cover well under a fifth of its area — but high enough that a matchbox on
 * the table does not become the subject.
 */
export const MIN_AREA_FRACTION = 0.15;

/** Shortest credible document edge, as a fraction of the frame's short side. */
export const MIN_EDGE_FRACTION = 0.1;

/**
 * Whether a detected quadrilateral is plausibly the document, judged in the
 * pixel space it was detected in.
 *
 * Deliberately no aspect-ratio ceiling: a supermarket receipt can be six
 * times taller than wide, and rejecting narrow shapes would reject the very
 * documents this application scans most. Degenerate slivers are caught by the
 * area and edge minimums instead.
 */
export function isCredibleDocument(
  corners: DocumentCorners,
  frame: Size,
  minAreaFraction: number = MIN_AREA_FRACTION,
): boolean {
  const points = cornerList(corners);
  if (points.some((point) => !Number.isFinite(point.x + point.y))) {
    return false;
  }
  if (!isConvex(corners)) return false;

  const frameArea = frame.width * frame.height;
  if (frameArea <= 0) return false;
  if (polygonArea(points) < frameArea * minAreaFraction) return false;

  const edges = edgeLengths(corners);
  const shortestAllowed =
    Math.min(frame.width, frame.height) * MIN_EDGE_FRACTION;
  return (
    Math.min(edges.top, edges.right, edges.bottom, edges.left) >=
    shortestAllowed
  );
}

/**
 * Whether every corner sits inside the frame, with a small tolerance for
 * detection noise at the borders. A document may be *shown* while a corner is
 * out of frame, but it should not be called ready for capture.
 */
export function isWithinFrame(
  corners: DocumentCorners,
  frame: Size,
  marginFraction = 0.02,
): boolean {
  const marginX = frame.width * marginFraction;
  const marginY = frame.height * marginFraction;
  return cornerList(corners).every(
    (point) =>
      point.x >= -marginX &&
      point.y >= -marginY &&
      point.x <= frame.width + marginX &&
      point.y <= frame.height + marginY,
  );
}

function mapCorners(
  corners: DocumentCorners,
  transform: (point: Point) => Point,
): DocumentCorners {
  return {
    topLeft: transform(corners.topLeft),
    topRight: transform(corners.topRight),
    bottomRight: transform(corners.bottomRight),
    bottomLeft: transform(corners.bottomLeft),
  };
}

/** Pixel corners → 0–1 of the frame they were detected in. */
export function normalizeCorners(
  corners: DocumentCorners,
  frame: Size,
): DocumentCorners {
  return mapCorners(corners, (point) => ({
    x: point.x / frame.width,
    y: point.y / frame.height,
  }));
}

/** Normalized corners → pixels of another frame, e.g. the full capture. */
export function scaleCorners(
  corners: DocumentCorners,
  frame: Size,
): DocumentCorners {
  return mapCorners(corners, (point) => ({
    x: point.x * frame.width,
    y: point.y * frame.height,
  }));
}

/** Mean corner displacement between two sets, in whatever space both share. */
export function cornerMovement(a: DocumentCorners, b: DocumentCorners): number {
  const from = cornerList(a);
  const to = cornerList(b);
  let total = 0;
  for (let index = 0; index < from.length; index += 1) {
    total += distance(from[index], to[index]);
  }
  return total / from.length;
}

/** Per-corner exponential moving average; `alpha` weighs the new detection. */
export function smoothCorners(
  previous: DocumentCorners,
  detected: DocumentCorners,
  alpha: number,
): DocumentCorners {
  const from = cornerList(previous);
  const to = cornerList(detected);
  const blended = from.map((point, index) => ({
    x: point.x * (1 - alpha) + to[index].x * alpha,
    y: point.y * (1 - alpha) + to[index].y * alpha,
  }));
  return {
    topLeft: blended[0],
    topRight: blended[1],
    bottomRight: blended[2],
    bottomLeft: blended[3],
  };
}

/**
 * The output size for perspective correction, derived from the document's own
 * measured edges rather than forced to a paper standard — a receipt is not A4
 * and must not come out shaped like one.
 *
 * The longer of each opposing pair is used, because perspective *shortens*
 * edges: the longer one is closer to the true side, and sampling at it keeps
 * the small print legible. `maxSide` bounds the result so a close-up capture
 * does not produce an absurdly large image.
 */
export function extractionSize(
  corners: DocumentCorners,
  maxSide: number,
): Size {
  const edges = edgeLengths(corners);
  const width = Math.max(edges.top, edges.bottom);
  const height = Math.max(edges.left, edges.right);
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * How `object-fit: cover` places a frame inside a container: uniformly scaled
 * until it covers, centred, with the overflow cropped equally on both sides
 * of the overflowing axis. The offsets are therefore zero or negative.
 */
export interface CoverProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function coverProjection(frame: Size, container: Size): CoverProjection {
  if (frame.width <= 0 || frame.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.max(
    container.width / frame.width,
    container.height / frame.height,
  );
  return {
    scale,
    offsetX: (container.width - frame.width * scale) / 2,
    offsetY: (container.height - frame.height * scale) / 2,
  };
}

/**
 * Projects a normalized camera-frame point onto a container displaying that
 * frame with `object-fit: cover`. Multiplying by the container size alone
 * would be wrong whenever the aspect ratios differ — the crop must be
 * accounted for, or the outline drifts off the physical document.
 */
export function projectToCover(
  point: Point,
  frame: Size,
  container: Size,
): Point {
  const projection = coverProjection(frame, container);
  return {
    x: point.x * frame.width * projection.scale + projection.offsetX,
    y: point.y * frame.height * projection.scale + projection.offsetY,
  };
}
