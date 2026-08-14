import {
  extractionSize,
  type DocumentCorners,
  type Size,
} from "./geometry";

/**
 * Perspective correction without OpenCV: a 4-point homography, solved
 * directly, and an inverse-mapped bilinear resample. See raster.ts for why
 * OpenCV is not an option here.
 *
 * The homography is built from the *output* rectangle to the *source*
 * quadrilateral, so warping walks each output pixel once and asks where in
 * the photograph it came from — no holes, no splatting.
 */

/** Row-major 3×3 projective transform. */
export type Homography = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * The homography mapping each `from` corner to its `to` counterpart, via the
 * standard 8×8 linear system solved by Gaussian elimination with partial
 * pivoting. Returns null for degenerate input (three collinear corners), so
 * a nonsense quadrilateral fails loudly rather than warping to garbage.
 */
export function solveHomography(
  from: readonly { x: number; y: number }[],
  to: readonly { x: number; y: number }[],
): Homography | null {
  // Each correspondence contributes two rows in the unknowns [a…h]:
  //   a·x + b·y + c − g·x·X − h·y·X = X
  //   d·x + e·y + f − g·x·Y − h·y·Y = Y
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: mappedX, y: mappedY } = to[index];
    matrix.push([x, y, 1, 0, 0, 0, -x * mappedX, -y * mappedX]);
    matrix.push([0, 0, 0, x, y, 1, -x * mappedY, -y * mappedY]);
    rhs.push(mappedX, mappedY);
  }

  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot][column]) < 1e-9) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    [rhs[column], rhs[pivot]] = [rhs[pivot], rhs[column]];

    for (let row = column + 1; row < 8; row += 1) {
      const factor = matrix[row][column] / matrix[column][column];
      if (factor === 0) continue;
      for (let k = column; k < 8; k += 1) {
        matrix[row][k] -= factor * matrix[column][k];
      }
      rhs[row] -= factor * rhs[column];
    }
  }

  const solution = new Array<number>(8);
  for (let row = 7; row >= 0; row -= 1) {
    let value = rhs[row];
    for (let column = row + 1; column < 8; column += 1) {
      value -= matrix[row][column] * solution[column];
    }
    solution[row] = value / matrix[row][row];
  }

  const [a, b, c, d, e, f, g, h] = solution;
  return [a, b, c, d, e, f, g, h, 1];
}

export function applyHomography(
  transform: Homography,
  x: number,
  y: number,
): { x: number; y: number } {
  const w = transform[6] * x + transform[7] * y + transform[8];
  return {
    x: (transform[0] * x + transform[1] * y + transform[2]) / w,
    y: (transform[3] * x + transform[4] * y + transform[5]) / w,
  };
}

export interface WarpedDocument {
  /** RGBA pixels of the flattened document, plain-buffer-backed so the
   * result can be handed to `new ImageData` as-is. */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/**
 * Flattens the quadrilateral out of an RGBA frame into a rectangle sized by
 * `extractionSize` — the document's own measured shape, capped at `maxSide`.
 *
 * Sampling clamps to the frame, so a corner detected a pixel outside it
 * repeats the edge rather than reading out of bounds — the same convention
 * as `cropAndResize` in the OCR pipeline.
 */
export function warpPerspective(
  rgba: Uint8ClampedArray,
  frame: Size,
  corners: DocumentCorners,
  maxSide: number,
): WarpedDocument | null {
  const size = extractionSize(corners, maxSide);
  const transform = solveHomography(
    [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ],
    [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft],
  );
  if (transform === null) return null;

  const output = new Uint8ClampedArray(size.width * size.height * 4);
  const maxX = frame.width - 1;
  const maxY = frame.height - 1;

  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      // Sample at the output pixel's centre for a half-pixel-true mapping.
      const source = applyHomography(transform, x + 0.5, y + 0.5);
      const clampedX = source.x < 0 ? 0 : source.x > maxX ? maxX : source.x;
      const clampedY = source.y < 0 ? 0 : source.y > maxY ? maxY : source.y;

      const leftX = Math.floor(clampedX);
      const topY = Math.floor(clampedY);
      const rightX = Math.min(leftX + 1, maxX);
      const bottomY = Math.min(topY + 1, maxY);
      const weightX = clampedX - leftX;
      const weightY = clampedY - topY;

      const topLeft = (topY * frame.width + leftX) * 4;
      const topRight = (topY * frame.width + rightX) * 4;
      const bottomLeft = (bottomY * frame.width + leftX) * 4;
      const bottomRight = (bottomY * frame.width + rightX) * 4;
      const target = (y * size.width + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top =
          rgba[topLeft + channel] * (1 - weightX) +
          rgba[topRight + channel] * weightX;
        const bottom =
          rgba[bottomLeft + channel] * (1 - weightX) +
          rgba[bottomRight + channel] * weightX;
        output[target + channel] = top * (1 - weightY) + bottom * weightY;
      }
    }
  }

  return { data: output, width: size.width, height: size.height };
}
