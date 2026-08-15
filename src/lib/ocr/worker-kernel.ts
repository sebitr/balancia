import {
  ACTIVE_MODEL_SET,
  RECOGNITION_HEIGHT,
  RECOGNITION_MAX_WIDTH,
  type OcrModelSet,
} from "./config";

/**
 * The OCR engine's arithmetic, as source text.
 *
 * This is the same trick `src/lib/semantic/worker-source.ts` uses and it is
 * here for the same reason: the worker has to be a *module* worker, because
 * its whole job is a dynamic `import()` of a runtime this instance serves, and
 * Turbopack's `new Worker(new URL(...))` handling strips the `type` option and
 * produces a classic worker. Built from a string and handed to
 * `new Worker(blobUrl, { type: "module" })`, the type is ours to choose.
 *
 * What is different here is that there is real logic to get wrong — a
 * bilinear resample, a connected-components pass and a CTC decoder — and source
 * text is not type-checked. So the kernel is split out from the worker
 * plumbing, and `worker-kernel.test.ts` evaluates *this exact text* and runs
 * the functions against known inputs. The compiler cannot check it; the tests
 * do.
 */

/** ImageNet statistics, which is what PP-OCR's detector was normalized with. */
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

/**
 * Smallest region worth recognizing, in detector pixels.
 *
 * Unlike the detector's thresholds — which came with the weights and live on
 * the model set — this one is about what a *receipt* is, and holds whichever
 * release is installed.
 */
const MIN_BOX_SIDE = 3;

/**
 * The kernel, tuned for one model set.
 *
 * The three detector numbers below (`thresh`, `box_thresh`, `unclip_ratio` in
 * PaddleOCR's own configuration) are published per release and differ between
 * them, so they arrive with the model rather than being baked in here. See
 * `OcrModelSet`. The unclip ratio in particular is what stops DB's shrunken
 * polygon from clipping the tops and tails of the glyphs; this computes the
 * same expansion from the box's area and perimeter, which is all that survives
 * of the polygon once the region has been reduced to a rectangle.
 */
export function ocrKernelSource(model: OcrModelSet = ACTIVE_MODEL_SET): string {
  const constants = {
    detMean: DET_MEAN,
    detStd: DET_STD,
    detThreshold: model.detThreshold,
    boxThreshold: model.boxThreshold,
    unclipRatio: model.unclipRatio,
    minBoxSide: MIN_BOX_SIDE,
    recHeight: RECOGNITION_HEIGHT,
    recMaxWidth: RECOGNITION_MAX_WIDTH,
  };

  return `
const KERNEL = ${JSON.stringify(constants)};

/**
 * RGBA bytes to the detector's NCHW float input.
 */
function normalizeDetection(rgba, width, height) {
  const plane = width * height;
  const output = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      output[channel * plane + index] =
        (rgba[offset + channel] / 255 - KERNEL.detMean[channel]) /
        KERNEL.detStd[channel];
    }
  }
  return output;
}

/**
 * Connected components over the binarized probability map.
 *
 * PaddleOCR runs OpenCV's contour finder here. There is no OpenCV in the
 * browser without shipping another eight megabytes of WebAssembly, and a
 * receipt is axis-aligned text on a light background, so an 8-connected flood
 * fill and the bounding box of each component gets the same rectangles for a
 * fraction of the cost. What it gives up is rotated boxes, which is why the
 * UI asks for a straight-on photograph.
 */
function extractBoxes(probabilities, width, height) {
  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const boxes = [];

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || probabilities[start] <= KERNEL.detThreshold) continue;

    let top = 0;
    stack[top++] = start;
    visited[start] = 1;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    let scoreSum = 0, count = 0;

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      scoreSum += probabilities[index];
      count += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (visited[neighbour]) continue;
          if (probabilities[neighbour] <= KERNEL.detThreshold) continue;
          visited[neighbour] = 1;
          stack[top++] = neighbour;
        }
      }
    }

    const score = scoreSum / count;
    if (score < KERNEL.boxThreshold) continue;

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (boxWidth < KERNEL.minBoxSide || boxHeight < KERNEL.minBoxSide) continue;

    const pad = Math.max(
      1,
      Math.round(
        ((boxWidth * boxHeight * KERNEL.unclipRatio) /
          (2 * (boxWidth + boxHeight))) *
          0.5,
      ),
    );

    boxes.push({
      x0: Math.max(0, minX - pad),
      y0: Math.max(0, minY - pad),
      x1: Math.min(width, maxX + 1 + pad),
      y1: Math.min(height, maxY + 1 + pad),
      score: score,
    });
  }

  return boxes;
}

/**
 * Joins regions that sit on one text line.
 *
 * The recognizer reads a whole line better than it reads the same line in
 * pieces — it has a language model's worth of context in its decoder — and one
 * inference for a line is far cheaper than four for its words. Regions are
 * merged when they overlap vertically and are separated by less than roughly
 * one character of white space.
 */
function mergeIntoLines(boxes) {
  const sorted = boxes.slice().sort(function (a, b) {
    return a.y0 - b.y0 || a.x0 - b.x0;
  });
  const lines = [];

  for (const box of sorted) {
    const height = Math.max(1, box.y1 - box.y0);
    let merged = false;

    for (const line of lines) {
      const overlap = Math.min(line.y1, box.y1) - Math.max(line.y0, box.y0);
      if (overlap <= 0.5 * Math.min(height, line.y1 - line.y0)) continue;
      // Only ever merge along the line, and only across a small gap: the
      // description and the price of an item are a column apart, and joining
      // them would hand the recognizer a crop that is mostly blank paper.
      const gap = box.x0 - line.x1;
      if (gap > height * 1.2 || gap < -height * 4) continue;

      line.x0 = Math.min(line.x0, box.x0);
      line.y0 = Math.min(line.y0, box.y0);
      line.x1 = Math.max(line.x1, box.x1);
      line.y1 = Math.max(line.y1, box.y1);
      line.score = Math.min(line.score, box.score);
      merged = true;
      break;
    }

    if (!merged) {
      lines.push({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1, score: box.score });
    }
  }

  return lines;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** Maps a box from detector coordinates back onto the source image. */
function scaleBox(box, scaleX, scaleY) {
  return {
    x0: Math.round(box.x0 * scaleX),
    y0: Math.round(box.y0 * scaleY),
    x1: Math.round(box.x1 * scaleX),
    y1: Math.round(box.y1 * scaleY),
    score: box.score,
  };
}

/**
 * The width a crop is recognized at: proportional to its shape, a multiple of
 * eight so the recognizer's downsampling divides evenly, and bounded so one
 * very wide line cannot allocate an unbounded tensor.
 */
function recognitionWidth(boxWidth, boxHeight) {
  const ratio = boxWidth / Math.max(1, boxHeight);
  const proportional = Math.round(ratio * KERNEL.recHeight);
  const bounded = clamp(proportional, 16, KERNEL.recMaxWidth);
  return Math.ceil(bounded / 8) * 8;
}

/**
 * Crops a region and scales it into the recognizer's NCHW input, bilinearly.
 *
 * Bilinear because these crops are nearly always downscaled, and point
 * sampling a downscale drops strokes off thin glyphs entirely.
 */
function cropForRecognition(rgba, width, height, box, targetWidth) {
  const targetHeight = KERNEL.recHeight;
  const x0 = clamp(Math.min(box.x0, box.x1), 0, width - 1);
  const y0 = clamp(Math.min(box.y0, box.y1), 0, height - 1);
  const x1 = clamp(Math.max(box.x0, box.x1), x0 + 1, width);
  const y1 = clamp(Math.max(box.y0, box.y1), y0 + 1, height);

  const scaleX = (x1 - x0) / targetWidth;
  const scaleY = (y1 - y0) / targetHeight;

  const plane = targetWidth * targetHeight;
  const output = new Float32Array(3 * plane);

  for (let y = 0; y < targetHeight; y += 1) {
    // Sample at pixel centres, and clamp inside the crop: a line's box must
    // never pull in a stroke from the line above it.
    const sourceY = clamp(y0 + (y + 0.5) * scaleY - 0.5, y0, y1 - 1);
    const topY = Math.floor(sourceY);
    const bottomY = Math.min(topY + 1, y1 - 1);
    const weightY = sourceY - topY;

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = clamp(x0 + (x + 0.5) * scaleX - 0.5, x0, x1 - 1);
      const leftX = Math.floor(sourceX);
      const rightX = Math.min(leftX + 1, x1 - 1);
      const weightX = sourceX - leftX;

      const topLeft = (topY * width + leftX) * 4;
      const topRight = (topY * width + rightX) * 4;
      const bottomLeft = (bottomY * width + leftX) * 4;
      const bottomRight = (bottomY * width + rightX) * 4;
      const target = y * targetWidth + x;

      for (let channel = 0; channel < 3; channel += 1) {
        const top =
          rgba[topLeft + channel] * (1 - weightX) +
          rgba[topRight + channel] * weightX;
        const bottom =
          rgba[bottomLeft + channel] * (1 - weightX) +
          rgba[bottomRight + channel] * weightX;
        const value = top * (1 - weightY) + bottom * weightY;
        // The recognizer wants [-1, 1], not ImageNet statistics.
        output[channel * plane + target] = value / 255 / 0.5 - 1;
      }
    }
  }

  return output;
}

/**
 * Greedy CTC decoding.
 *
 * Class 0 is the blank, and a class repeated on consecutive timesteps is one
 * character, not several — that is the whole of CTC's collapsing rule, and
 * getting it wrong spells "Caarrbboonnaarraa".
 *
 * PaddleOCR's exported recognizers apply softmax inside the graph, so the
 * winning value is already a probability and the mean of those is a usable
 * per-line confidence.
 */
function decodeCtc(data, steps, classes, charset) {
  let text = "";
  let confidenceSum = 0;
  let counted = 0;
  let previous = -1;

  for (let step = 0; step < steps; step += 1) {
    const base = step * classes;
    let best = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < classes; index += 1) {
      const value = data[base + index];
      if (value > bestValue) {
        bestValue = value;
        best = index;
      }
    }

    if (best !== 0 && best !== previous) {
      text += charset[best] === undefined ? "" : charset[best];
      confidenceSum += bestValue;
      counted += 1;
    }
    previous = best;
  }

  const confidence = counted === 0 ? 0 : confidenceSum / counted;
  return {
    text: text,
    confidence: confidence < 0 ? 0 : confidence > 1 ? 1 : confidence,
  };
}

/**
 * The recognizer's character list.
 *
 * PaddleOCR's convention: index 0 is the CTC blank, the dictionary follows,
 * and a space is appended at the end. The dictionary ships with CRLF line
 * endings, and a stray carriage return would be decoded as a character and
 * land between every glyph — hence the split on both.
 */
function buildCharset(dictionaryText) {
  const lines = dictionaryText.split(/\\r?\\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return ["<blank>"].concat(lines).concat([" "]);
}
`;
}
