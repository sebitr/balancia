import {
  cornerList,
  isCredibleDocument,
  orderCorners,
  polygonArea,
  type DocumentCorners,
  type Point,
} from "./geometry";

/**
 * Finding a document in a frame of pixels, in plain TypeScript.
 *
 * This deliberately does not use OpenCV. OpenCV.js's bindings generate code
 * with `new Function()` when they initialize, which this application's
 * Content-Security-Policy forbids — the policy grants `'wasm-unsafe-eval'`
 * for the OCR models and nothing more, and weakening it to `'unsafe-eval'`
 * for every page to ease one feature would invert the project's priorities.
 * The pipeline a paper scanner actually needs is small enough to own, in the
 * same style as `src/lib/ocr/image-ops.ts`: pure functions over byte arrays,
 * testable without a browser.
 *
 * The pipeline: grayscale → box blur → Otsu threshold → largest connected
 * region → corner extraction — with one refinement over the usual recipe.
 * Otsu only separates bright from dark; *which* side is the document is
 * decided by the frame's border, on the observation that the border is
 * almost always background. White receipt on dark wood and dark menu on a
 * white tablecloth both work.
 */

/** Rec.709 luminance of an RGBA buffer, one byte per pixel out. */
export function toGrayscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] =
      0.2126 * rgba[offset] +
      0.7152 * rgba[offset + 1] +
      0.0722 * rgba[offset + 2];
  }
  return gray;
}

/**
 * 3×3 box blur, separable, edges clamped. One pass of denoise is enough to
 * keep paper texture and sensor noise from fragmenting the threshold.
 */
export function boxBlur(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const horizontal = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = gray[row + Math.max(0, x - 1)];
      const right = gray[row + Math.min(width - 1, x + 1)];
      horizontal[row + x] = (left + gray[row + x] + right) / 3;
    }
  }
  const blurred = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const above = Math.max(0, y - 1) * width;
    const below = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      blurred[row + x] =
        (horizontal[above + x] + horizontal[row + x] + horizontal[below + x]) /
        3;
    }
  }
  return blurred;
}

/**
 * Otsu's threshold: the split of the histogram that maximizes the variance
 * between the two classes. The classic choice for "paper versus table".
 */
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Float64Array(256);
  for (let index = 0; index < gray.length; index += 1) {
    histogram[gray[index]] += 1;
  }

  let totalMean = 0;
  for (let value = 0; value < 256; value += 1) {
    totalMean += value * histogram[value];
  }

  let bestThreshold = 127;
  let bestVariance = -1;
  let backgroundCount = 0;
  let backgroundSum = 0;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundCount += histogram[threshold];
    if (backgroundCount === 0) continue;
    const foregroundCount = gray.length - backgroundCount;
    if (foregroundCount === 0) break;

    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (totalMean - backgroundSum) / foregroundCount;
    const difference = backgroundMean - foregroundMean;
    const variance =
      backgroundCount * foregroundCount * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

/**
 * Whether the document is the bright class or the dark one.
 *
 * The frame's border is sampled: whichever class dominates there is taken to
 * be the background, and the document is the other one. A white receipt on a
 * dark table and a dark card on a white one are both found without trying
 * the detection twice.
 */
export function documentIsBright(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): boolean {
  let bright = 0;
  let counted = 0;
  const sample = (index: number) => {
    if (gray[index] > threshold) bright += 1;
    counted += 1;
  };
  for (let x = 0; x < width; x += 1) {
    sample(x);
    sample((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(y * width);
    sample(y * width + width - 1);
  }
  // A mostly-bright border means a bright background, so a dark document.
  return counted === 0 || bright / counted <= 0.5;
}

/** A horizontal run of document pixels; the unit the labelling works in. */
interface Run {
  readonly row: number;
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  /** Union-find parent index into the runs array; mutated while labelling. */
  parent: number;
}

export interface Region {
  /** Pixels in the region. */
  readonly area: number;
  readonly centroid: Point;
  /**
   * Left- and right-edge points of the region, two per covered row — the
   * boundary samples the corner search works on.
   */
  readonly edgePoints: readonly Point[];
}

/**
 * The largest connected region of document-class pixels, found by run-length
 * labelling with union-find: rows are cut into runs, runs that touch a run
 * on the previous row are united, and the heaviest root wins. Linear in
 * pixels, no recursion, no per-pixel label map.
 */
export function largestRegion(
  gray: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  bright: boolean,
): Region | null {
  const runs: Run[] = [];
  let previousRowStart = 0;
  let previousRowEnd = 0;

  const find = (index: number): number => {
    let root = index;
    while (runs[root].parent !== root) root = runs[root].parent;
    while (runs[index].parent !== index) {
      const next = runs[index].parent;
      runs[index].parent = root;
      index = next;
    }
    return root;
  };

  for (let y = 0; y < height; y += 1) {
    const rowStart = runs.length;
    const rowOffset = y * width;
    let x = 0;
    while (x < width) {
      const isDocument = bright
        ? gray[rowOffset + x] > threshold
        : gray[rowOffset + x] <= threshold;
      if (!isDocument) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width) {
        const inside = bright
          ? gray[rowOffset + x] > threshold
          : gray[rowOffset + x] <= threshold;
        if (!inside) break;
        x += 1;
      }
      const index = runs.length;
      runs.push({ row: y, start, end: x, parent: index });

      // Unite with every overlapping run of the previous row (8-connectivity
      // would allow corner contact; 4-connectivity is fine for solid paper).
      for (let above = previousRowStart; above < previousRowEnd; above += 1) {
        const candidate = runs[above];
        if (candidate.end <= start || candidate.start >= x) continue;
        const rootA = find(above);
        const rootB = find(index);
        if (rootA !== rootB) runs[rootB].parent = rootA;
      }
    }
    previousRowStart = rowStart;
    previousRowEnd = runs.length;
  }

  if (runs.length === 0) return null;

  const areaByRoot = new Map<number, number>();
  for (let index = 0; index < runs.length; index += 1) {
    const root = find(index);
    const length = runs[index].end - runs[index].start;
    areaByRoot.set(root, (areaByRoot.get(root) ?? 0) + length);
  }

  let bestRoot = -1;
  let bestArea = 0;
  for (const [root, area] of areaByRoot) {
    if (area > bestArea) {
      bestArea = area;
      bestRoot = root;
    }
  }

  let sumX = 0;
  let sumY = 0;
  const leftByRow = new Map<number, number>();
  const rightByRow = new Map<number, number>();
  for (let index = 0; index < runs.length; index += 1) {
    if (find(index) !== bestRoot) continue;
    const run = runs[index];
    const length = run.end - run.start;
    sumX += ((run.start + run.end - 1) / 2) * length;
    sumY += run.row * length;
    const left = leftByRow.get(run.row);
    if (left === undefined || run.start < left) {
      leftByRow.set(run.row, run.start);
    }
    const right = rightByRow.get(run.row);
    if (right === undefined || run.end - 1 > right) {
      rightByRow.set(run.row, run.end - 1);
    }
  }

  const edgePoints: Point[] = [];
  for (const [row, left] of leftByRow) {
    edgePoints.push({ x: left, y: row });
    const right = rightByRow.get(row);
    if (right !== undefined && right !== left) {
      edgePoints.push({ x: right, y: row });
    }
  }

  return {
    area: bestArea,
    centroid: { x: sumX / bestArea, y: sumY / bestArea },
    edgePoints,
  };
}

/**
 * jscanify's corner rule, applied to the region's edge points: split them
 * into quadrants around the centroid and take the farthest point in each.
 * Robust to ragged edges, and indifferent to how tilted the page is.
 */
export function cornersFromRegion(region: Region): DocumentCorners | null {
  const farthest: (Point | null)[] = [null, null, null, null];
  const farthestDistance = [0, 0, 0, 0];
  for (const point of region.edgePoints) {
    const quadrant =
      (point.y < region.centroid.y ? 0 : 2) +
      (point.x < region.centroid.x ? 0 : 1);
    const squared =
      (point.x - region.centroid.x) ** 2 +
      (point.y - region.centroid.y) ** 2;
    if (squared > farthestDistance[quadrant]) {
      farthestDistance[quadrant] = squared;
      farthest[quadrant] = point;
    }
  }
  const [topLeft, topRight, bottomLeft, bottomRight] = farthest;
  if (!topLeft || !topRight || !bottomLeft || !bottomRight) return null;
  return orderCorners([topLeft, topRight, bottomRight, bottomLeft]);
}

/**
 * A quadrilateral is only believed if the region actually fills it. The
 * corner rule spans a quad across anything; for an L-shaped or ring-shaped
 * bright region that quad is mostly empty, and claiming it would draw an
 * outline over furniture.
 */
export const MIN_FILL_FRACTION = 0.65;

/**
 * The whole detection, from one RGBA frame to named corners, or null when
 * nothing credible is in view.
 */
export function findDocumentCorners(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): DocumentCorners | null {
  if (width < 8 || height < 8) return null;

  const gray = boxBlur(toGrayscale(rgba, width, height), width, height);
  const threshold = otsuThreshold(gray);
  const bright = documentIsBright(gray, width, height, threshold);
  const region = largestRegion(gray, width, height, threshold, bright);
  if (region === null) return null;

  const corners = cornersFromRegion(region);
  if (corners === null) return null;

  const quadArea = polygonArea(cornerList(corners));
  if (quadArea <= 0 || region.area / quadArea < MIN_FILL_FRACTION) {
    return null;
  }

  return isCredibleDocument(corners, { width, height }) ? corners : null;
}
