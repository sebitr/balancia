import {
  ACTIVE_MODEL_SET,
  RUNTIME_URL,
  WASM_PATH,
  type OcrModelSet,
} from "./config";
import { ocrKernelSource } from "./worker-kernel";

/**
 * The OCR worker.
 *
 * Everything expensive happens in here — loading a 6 MB pair of models,
 * compiling WebAssembly, and running two neural networks — so that the expense
 * form stays interactive while a receipt is read. The main thread's only job is
 * to hand over pixels and render what comes back.
 *
 * Execution providers
 * -------------------
 * WebGPU when the browser has it, WebAssembly when it does not, and WebAssembly
 * *again* if WebGPU initialization throws — which it does on drivers that
 * advertise the API and then fail to allocate. WebGPU is never required: on
 * iOS it is behind a flag on older versions, and Firefox only shipped it
 * recently, so the fallback is the path most users will actually take.
 *
 * Threads
 * -------
 * onnxruntime-web's threaded WebAssembly needs `SharedArrayBuffer`, which needs
 * cross-origin isolation, which Balancia does not enable — COOP/COEP would
 * break the OAuth-style popups and embedded content other parts of the app
 * rely on. So the thread count is pinned to 1 rather than left to fail at
 * runtime.
 */

/** Recognitions per progress message. Enough to feel live, not a message storm. */
const PROGRESS_EVERY = 4;

/**
 * Upper bound on regions recognized in one scan.
 *
 * A photograph of a bookshelf can produce thousands of text regions, each of
 * which would be an inference. A long restaurant receipt is well under a
 * hundred lines.
 */
const MAX_REGIONS = 160;

/**
 * The worker, built for one model set.
 *
 * The parameter exists so the eval harness can stand two releases side by side
 * in one browser without editing this file — the same reason `prepareImage`
 * takes `enhance`. The application never passes it.
 */
export function ocrWorkerSource(model: OcrModelSet = ACTIVE_MODEL_SET): string {
  const constants = {
    runtimeUrl: RUNTIME_URL,
    wasmPath: WASM_PATH,
    detUrl: model.detUrl,
    recUrl: model.recUrl,
    dictUrl: model.dictUrl,
    progressEvery: PROGRESS_EVERY,
    maxRegions: MAX_REGIONS,
  };

  return `
const CONFIG = ${JSON.stringify(constants)};

${ocrKernelSource(model)}

let runtime = null;
let sessions = null;
let charset = null;
let backend = "unknown";

/**
 * The page's origin, supplied with every request.
 *
 * This worker is built from a Blob, so its own base URL is a \`blob:\` URL —
 * an opaque string that a module specifier or a relative fetch cannot be
 * resolved against. A path like \`/models/...\` that
 * works perfectly from the page fails here with "Failed to resolve module
 * specifier", and it fails at the dynamic import, which is the first thing
 * this worker does.
 *
 * So every URL is made absolute against the origin the page passes in. The
 * source still names no host of its own: the only origin it can ever use is
 * the one it is running on.
 */
let origin = "";

function resolve(path) {
  return new URL(path, origin).href;
}

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

async function loadRuntime() {
  const ort = await import(resolve(CONFIG.runtimeUrl));

  // Also absolute: onnxruntime resolves this against the worker's location,
  // which is the blob, and would look for its WebAssembly in the wrong place.
  ort.env.wasm.wasmPaths = resolve(CONFIG.wasmPath);
  // See the note on threads above: no cross-origin isolation, no SharedArrayBuffer.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  // The worker is already off the main thread; ORT's own logging is noise.
  ort.env.logLevel = "error";
  return ort;
}

/**
 * Downloads a file, reporting real bytes as they arrive.
 *
 * The progress the UI shows has to be true, so it is counted rather than
 * animated: a response with no Content-Length reports no percentage at all and
 * the UI falls back to saying it is working, which is honest, rather than to a
 * bar that moves for reassurance.
 */
async function fetchBytes(url, onProgress) {
  const response = await fetch(resolve(url));
  if (!response.ok) {
    throw new Error("Model download failed with status " + response.status);
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (!response.body || !declared) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const bytes = new Uint8Array(declared);
  let loaded = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    // A cached response can exceed its declared length after decompression.
    if (loaded + step.value.length > bytes.length) {
      const rest = new Uint8Array(await new Response(response.body).arrayBuffer());
      const combined = new Uint8Array(loaded + rest.length);
      combined.set(bytes.subarray(0, loaded), 0);
      combined.set(rest, loaded);
      return combined;
    }
    bytes.set(step.value, loaded);
    loaded += step.value.length;
    onProgress(loaded, declared);
  }
  return loaded === bytes.length ? bytes : bytes.subarray(0, loaded);
}

async function initialize() {
  if (sessions) return sessions;

  runtime = runtime || (await loadRuntime());

  /*
   * Order matters for the progress the user sees. The model files are fetched
   * first, where the bytes can be counted honestly, and the sessions are built
   * from those bytes afterwards — which is when onnxruntime pulls and compiles
   * its own WebAssembly, a step with no progress to report. Building the
   * sessions straight from URLs would interleave the two and make the only
   * number on screen a lie.
   */
  const weights = {};
  const files = [
    { key: "detection", url: CONFIG.detUrl },
    { key: "recognition", url: CONFIG.recUrl },
  ];

  let completed = 0;
  for (const file of files) {
    weights[file.key] = await fetchBytes(file.url, function (loaded, total) {
      post({
        type: "progress",
        stage: "downloading",
        done: completed + loaded,
        total: 0,
        file: file.key,
        fileLoaded: loaded,
        fileTotal: total,
      });
    });
    completed += weights[file.key].length;
  }

  if (!charset) {
    const response = await fetch(resolve(CONFIG.dictUrl));
    if (!response.ok) {
      throw new Error("Character dictionary failed to load");
    }
    charset = buildCharset(await response.text());
  }

  // Compiling: this is where the runtime's own WebAssembly is fetched and
  // built, and there is nothing meaningful to count.
  post({ type: "progress", stage: "preparing" });

  // WebGPU first, WebAssembly if it is absent or if it fails on this device.
  let providers = ["wasm"];
  if (typeof navigator !== "undefined" && navigator.gpu) {
    providers = ["webgpu", "wasm"];
  }

  async function build(list) {
    const options = { executionProviders: list, graphOptimizationLevel: "all" };
    return {
      detection: await runtime.InferenceSession.create(weights.detection, options),
      recognition: await runtime.InferenceSession.create(weights.recognition, options),
    };
  }

  try {
    sessions = await build(providers);
    backend = providers[0];
  } catch (error) {
    if (providers[0] !== "webgpu") throw error;
    // A driver that advertises WebGPU and then cannot allocate is common
    // enough that this retry is the difference between working and not.
    sessions = await build(["wasm"]);
    backend = "wasm";
  }

  return sessions;
}

function firstOutput(results, session) {
  return results[session.outputNames[0]];
}

async function detect(rgba, width, height) {
  const input = normalizeDetection(rgba, width, height);
  const tensor = new runtime.Tensor("float32", input, [1, 3, height, width]);
  const results = await sessions.detection.run({
    [sessions.detection.inputNames[0]]: tensor,
  });
  const output = firstOutput(results, sessions.detection);
  const probabilities = output.data;

  // The probability map is the detector's own resolution, which for DB is the
  // input size. Read the shape rather than assuming it.
  const dims = output.dims;
  const mapHeight = dims[dims.length - 2];
  const mapWidth = dims[dims.length - 1];

  const regions = mergeIntoLines(extractBoxes(probabilities, mapWidth, mapHeight));
  const scaleX = width / mapWidth;
  const scaleY = height / mapHeight;
  return regions.map(function (box) {
    return scaleBox(box, scaleX, scaleY);
  });
}

async function recognize(rgba, width, height, box) {
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;
  if (boxWidth < 4 || boxHeight < 4) return null;

  const targetWidth = recognitionWidth(boxWidth, boxHeight);
  const input = cropForRecognition(rgba, width, height, box, targetWidth);
  const tensor = new runtime.Tensor("float32", input, [
    1,
    3,
    KERNEL.recHeight,
    targetWidth,
  ]);

  const results = await sessions.recognition.run({
    [sessions.recognition.inputNames[0]]: tensor,
  });
  const output = firstOutput(results, sessions.recognition);
  const steps = output.dims[1];
  const classes = output.dims[2];
  return decodeCtc(output.data, steps, classes, charset);
}

async function scan(payload) {
  await initialize();

  const rgba = new Uint8ClampedArray(payload.buffer);
  const width = payload.width;
  const height = payload.height;

  post({ type: "progress", stage: "detecting" });
  const regions = await detect(rgba, width, height);

  post({ type: "progress", stage: "reading", total: regions.length });

  const boxes = [];
  const limit = Math.min(regions.length, CONFIG.maxRegions);
  for (let index = 0; index < limit; index += 1) {
    const region = regions[index];
    let reading = null;
    try {
      reading = await recognize(rgba, width, height, region);
    } catch (error) {
      // One unreadable crop must not lose the whole receipt.
      reading = null;
    }
    if (reading && reading.text.trim() !== "") {
      boxes.push({
        text: reading.text,
        confidence: reading.confidence,
        box: { x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 },
      });
    }
    if ((index + 1) % CONFIG.progressEvery === 0) {
      post({ type: "progress", stage: "reading", done: index + 1, total: limit });
    }
  }

  return { boxes: boxes, width: width, height: height };
}

self.addEventListener("message", function (event) {
  const request = event.data;

  // Set before anything can fetch or import; see the note on \`origin\`.
  if (typeof request.origin === "string") origin = request.origin;

  if (request.type === "initialize") {
    initialize().then(
      function () {
        post({ type: "ready", backend: backend });
      },
      function (error) {
        post({ type: "error", message: describe(error) });
      },
    );
    return;
  }

  if (request.type === "scan") {
    scan(request).then(
      function (result) {
        post({ type: "result", id: request.id, result: result, backend: backend });
      },
      function (error) {
        post({ type: "error", id: request.id, message: describe(error) });
      },
    );
  }
});

/**
 * Error text that can safely cross back to the page.
 *
 * Only the message, never the stack and never the payload: an exception raised
 * halfway through reading a receipt can otherwise carry fragments of it, and
 * this string ends up in the UI and potentially in a log.
 */
function describe(error) {
  if (error && typeof error.message === "string") return error.message;
  return "Receipt scanning failed";
}
`;
}
