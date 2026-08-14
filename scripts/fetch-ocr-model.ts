/**
 * Installs the optional OCR models for on-device receipt scanning.
 *
 * Run with `pnpm tsx scripts/fetch-ocr-model.ts --yes`.
 *
 * As with the semantic model, this is the *only* moment Balancia talks to a
 * model host, and it is an operator running a command rather than the
 * application. Afterwards everything is served from this instance: the runtime,
 * the WebAssembly binary and the weights all live under `public/models`, the
 * browser does the inference, and no receipt image ever leaves the device.
 *
 * The download is roughly 47 MB and lands in `public/models`, which is
 * git-ignored. Nothing else in Balancia depends on it: without these files the
 * scan button is not rendered and expenses are entered by hand, which is the
 * default.
 *
 * Afterwards, set `RECEIPT_SCANNING=1` and restart. That switch also adds
 * `'wasm-unsafe-eval'` to the Content-Security-Policy, which WebAssembly needs
 * and which is otherwise deliberately absent.
 *
 * Licensing
 * ---------
 * PP-OCRv5 is Apache-2.0, from the PaddlePaddle project, and the ONNX
 * conversion used here is redistributed under the same licence. Apache-2.0 is
 * compatible with Balancia's AGPL-3.0-or-later distribution. See
 * docs/receipt-scanning.md for the full attribution.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Pinned, so a rerun installs the same bytes it installed last time. */
const ONNXRUNTIME_VERSION = "1.23.0";

/**
 * The ONNX export of PP-OCRv5 mobile. PaddlePaddle publishes the models in
 * Paddle's own inference format; this is a straight conversion of the same
 * weights, redistributed under the same Apache-2.0 licence.
 */
const MODEL_REPO = "bukuroo/PPOCRv5-ONNX";
const MODEL_REVISION = "main";

const HF_BASE = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}`;
const JSDELIVR = "https://cdn.jsdelivr.net/npm";

const OUTPUT_ROOT = path.join(process.cwd(), "public", "models");

interface Download {
  readonly url: string;
  /** Path relative to `public/models`. */
  readonly target: string;
  readonly optional?: boolean;
}

const DOWNLOADS: readonly Download[] = [
  // The runtime. `ort.webgpu.min.mjs` carries both the WebGPU and the
  // WebAssembly execution providers, so one bundle covers every device.
  {
    url: `${JSDELIVR}/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/ort.webgpu.min.mjs`,
    target: "runtime/ort/ort.webgpu.min.mjs",
  },
  /*
   * The binary that bundle actually loads, and the reason it is this one
   * rather than the `.jsep.` pair the semantic model installs: at 1.23 the
   * WebGPU bundle asks for the *asyncify* build by name, and given the jsep
   * files it fails with "no available backend found". The two features
   * therefore ship different WebAssembly binaries and do not share this
   * download — which costs an instance that enables both about 25 MB on disk,
   * and nothing at runtime, since a browser only ever loads the one its
   * feature needs.
   */
  {
    url: `${JSDELIVR}/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
    target: "runtime/ort/ort-wasm-simd-threaded.asyncify.wasm",
  },
  {
    url: `${JSDELIVR}/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/ort-wasm-simd-threaded.asyncify.mjs`,
    target: "runtime/ort/ort-wasm-simd-threaded.asyncify.mjs",
  },
  // Text detection: finds the lines. ~4.7 MB.
  {
    url: `${HF_BASE}/ppocrv5-mobile-det.onnx`,
    target: "ocr/ppocrv5-mobile-det.onnx",
  },
  // Text recognition: reads them. ~16.5 MB.
  {
    url: `${HF_BASE}/ppocrv5-mobile-rec.onnx`,
    target: "ocr/ppocrv5-mobile-rec.onnx",
  },
  // The recognizer's character list.
  { url: `${HF_BASE}/ppocrv5_dict.txt`, target: "ocr/ppocrv5_dict.txt" },
];

async function download(item: Download): Promise<boolean> {
  const destination = path.join(OUTPUT_ROOT, item.target);
  await mkdir(path.dirname(destination), { recursive: true });

  const response = await fetch(item.url);
  if (!response.ok) {
    if (item.optional) {
      console.warn(`  skipped ${item.target} (${response.status})`);
      return false;
    }
    throw new Error(`${item.url} → HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  console.log(`  ${item.target} (${(bytes.length / 1e6).toFixed(1)} MB)`);
  return true;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.log(
      [
        "This downloads the optional OCR models for on-device receipt scanning.",
        "",
        `  models:   ${MODEL_REPO} — PP-OCRv5 mobile, Apache-2.0 (huggingface.co)`,
        `  runtime:  onnxruntime-web@${ONNXRUNTIME_VERSION} (cdn.jsdelivr.net)`,
        `  into:     ${OUTPUT_ROOT}`,
        "  size:     ~47 MB",
        "",
        "Receipts can already be attached without it; this only adds reading",
        "them. Re-run with --yes to proceed.",
      ].join("\n"),
    );
    return;
  }

  console.log(`Downloading into ${OUTPUT_ROOT}`);
  for (const item of DOWNLOADS) {
    await download(item);
  }
  console.log(
    [
      "",
      "Done. Now set RECEIPT_SCANNING=1 in .env and restart.",
      "In Docker, mount public/models into the container so the files survive",
      "an image rebuild — see docs/receipt-scanning.md.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
