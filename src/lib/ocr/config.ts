/**
 * Where the optional OCR models live.
 *
 * Same arrangement as the semantic categorization model, for the same reasons:
 * Balancia never downloads a model at runtime from anywhere but this instance,
 * and never calls a hosted inference API. An operator who wants receipt
 * scanning runs `pnpm ocr:install`, which places the files under
 * `public/models` (git-ignored), and sets `RECEIPT_SCANNING=true`.
 *
 * With no files present, `probeOcrAvailable()` fails its one HEAD request, no
 * worker is ever created, and the scan button is not rendered.
 *
 * The runtime path is deliberately shared with `src/lib/semantic/config.ts`:
 * both features run on onnxruntime-web, and an instance that installs both
 * downloads the 23 MB WebAssembly binary once.
 */

/** Served from `public/models`, so same-origin and covered by `'self'`. */
export const MODEL_BASE_PATH = "/models";

/** onnxruntime-web's ESM API bundle: WebGPU and WebAssembly in one build. */
export const RUNTIME_URL = `${MODEL_BASE_PATH}/runtime/ort/ort.webgpu.min.mjs`;

/** Directory the runtime loads its `.wasm` and glue `.mjs` from. */
export const WASM_PATH = `${MODEL_BASE_PATH}/runtime/ort/`;

export const OCR_MODEL_PATH = `${MODEL_BASE_PATH}/ocr`;

/**
 * A model set: two ONNX graphs, a character list, and the handful of numbers
 * its detector's post-processing was published with.
 *
 * The thresholds belong here rather than in the kernel because they are a
 * property of the weights, not of the arithmetic. PaddleOCR ships them in each
 * model's `inference.yml` and they are not the same across releases — PP-OCRv5
 * mobile is tuned at 0.3/0.5/1.6, PP-OCRv6 at 0.2/0.4/1.4. Running one
 * release's weights on the other's thresholds is not a crash, it is a quietly
 * worse read, which is the kind of regression nothing catches.
 */
export interface OcrModelSet {
  /** For logs and for the eval harness's report. */
  readonly name: string;
  readonly detUrl: string;
  readonly recUrl: string;
  readonly dictUrl: string;
  /** Probability above which a detector pixel counts as text. */
  readonly detThreshold: number;
  /** Mean probability a whole region needs before it is believed. */
  readonly boxThreshold: number;
  /** How far a detected region is grown before it is cropped. */
  readonly unclipRatio: number;
}

/**
 * PP-OCRv5 mobile: what `pnpm ocr:install` has always installed.
 *
 * The file names carry the release, so an instance can hold more than one set
 * on disk and the eval harness can compare them without a reinstall between
 * runs.
 */
export const PP_OCR_V5_MOBILE: OcrModelSet = {
  name: "PP-OCRv5_mobile",
  detUrl: `${OCR_MODEL_PATH}/ppocrv5-mobile-det.onnx`,
  recUrl: `${OCR_MODEL_PATH}/ppocrv5-mobile-rec.onnx`,
  dictUrl: `${OCR_MODEL_PATH}/ppocrv5_dict.txt`,
  detThreshold: 0.3,
  boxThreshold: 0.5,
  unclipRatio: 1.6,
};

/** PP-OCRv6 tiny: a third of the download, and its own detector thresholds. */
export const PP_OCR_V6_TINY: OcrModelSet = {
  name: "PP-OCRv6_tiny",
  detUrl: `${OCR_MODEL_PATH}/ppocrv6-tiny-det.onnx`,
  recUrl: `${OCR_MODEL_PATH}/ppocrv6-tiny-rec.onnx`,
  dictUrl: `${OCR_MODEL_PATH}/ppocrv6_tiny_dict.txt`,
  detThreshold: 0.2,
  boxThreshold: 0.4,
  unclipRatio: 1.4,
};

/** PP-OCRv6 small: the accurate one, and half again the download of v5. */
export const PP_OCR_V6_SMALL: OcrModelSet = {
  name: "PP-OCRv6_small",
  detUrl: `${OCR_MODEL_PATH}/ppocrv6-small-det.onnx`,
  recUrl: `${OCR_MODEL_PATH}/ppocrv6-small-rec.onnx`,
  dictUrl: `${OCR_MODEL_PATH}/ppocrv6_small_dict.txt`,
  detThreshold: 0.2,
  boxThreshold: 0.4,
  unclipRatio: 1.4,
};

export const OCR_MODEL_SETS = {
  "v5-mobile": PP_OCR_V5_MOBILE,
  "v6-tiny": PP_OCR_V6_TINY,
  "v6-small": PP_OCR_V6_SMALL,
} as const;

export type OcrModelKey = keyof typeof OCR_MODEL_SETS;

/**
 * What the application scans with.
 *
 * One constant, so there is exactly one answer to "which model is this
 * instance using" and the probe, the worker and the docs cannot drift apart.
 */
export const ACTIVE_MODEL_SET: OcrModelSet = PP_OCR_V6_TINY;

/** The key of the set above, so `pnpm ocr:install` cannot install the wrong one. */
export const ACTIVE_MODEL_KEY: OcrModelKey = "v6-tiny";

/**
 * Roughly what a first scan downloads, for the "this will take a moment"
 * notice. Approximate on purpose — the exact figure depends on the server's
 * compression, and a precise-looking number that is wrong is worse than a
 * round one that is right.
 */
export const APPROXIMATE_DOWNLOAD_MB = 32;

/** One file that must exist for the feature to work at all. */
const PROBE_URL = ACTIVE_MODEL_SET.detUrl;

/**
 * Cheap existence check, so an instance without the models pays one HEAD
 * request and never loads a worker or a runtime.
 */
export async function probeOcrAvailable(): Promise<boolean> {
  try {
    const response = await fetch(PROBE_URL, {
      method: "HEAD",
      cache: "force-cache",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- geometry */

/**
 * Longest side an image is reduced to before detection.
 *
 * A current phone photographs a receipt at 12 megapixels. Normalizing that at
 * full resolution would allocate about 150 MB of float32 for the detector's
 * input alone, which is how an iOS tab gets killed rather than slowed. The
 * detector was trained around this scale, so the reduction costs no accuracy
 * that matters on printed receipts.
 */
export const MAX_DETECTION_SIDE = 960;

/** The detector's input must be a multiple of this on both axes. */
export const DETECTION_STRIDE = 32;

/** Height every recognizer crop is scaled to. */
export const RECOGNITION_HEIGHT = 48;

/** Widest recognizer crop; anything longer is squeezed to fit. */
export const RECOGNITION_MAX_WIDTH = 480;
