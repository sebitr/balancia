/**
 * Installs the optional embedding model for semantic categorization.
 *
 * Run with `pnpm tsx scripts/fetch-semantic-model.ts --yes`.
 *
 * This is the *only* moment Balancia ever talks to a model host, and it is an
 * operator running a command, not the application. Afterwards everything is
 * served from this instance: the runtime, the WebAssembly binaries and the
 * weights all live under `public/models`, the browser does the inference, and
 * no transaction text leaves the device.
 *
 * The download is roughly 150 MB and lands in `public/models`, which is
 * git-ignored. Nothing else in Balancia depends on it: without these files
 * categorization runs on its deterministic rules, which is the default.
 *
 * Afterwards, set `SEMANTIC_CATEGORIZATION=1` and restart. That switch also
 * adds `'wasm-unsafe-eval'` to the Content-Security-Policy, which WebAssembly
 * needs and which is otherwise deliberately absent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODEL_ID } from "../src/lib/semantic/config";

/** Pinned, so a rerun installs the same bytes it installed last time. */
const TRANSFORMERS_VERSION = "3.7.6";
const ONNXRUNTIME_VERSION = "1.23.0";

const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const JSDELIVR = "https://cdn.jsdelivr.net/npm";

const OUTPUT_ROOT = path.join(process.cwd(), "public", "models");

interface Download {
  readonly url: string;
  /** Path relative to `public/models`. */
  readonly target: string;
  readonly optional?: boolean;
}

const DOWNLOADS: readonly Download[] = [
  {
    url: `${JSDELIVR}/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js`,
    target: "runtime/transformers.min.js",
  },
  {
    url: `${JSDELIVR}/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm`,
    target: "runtime/ort/ort-wasm-simd-threaded.jsep.wasm",
  },
  {
    url: `${JSDELIVR}/onnxruntime-web@${ONNXRUNTIME_VERSION}/dist/ort-wasm-simd-threaded.jsep.mjs`,
    target: "runtime/ort/ort-wasm-simd-threaded.jsep.mjs",
  },
  { url: `${HF_BASE}/config.json`, target: `${MODEL_ID}/config.json` },
  {
    url: `${HF_BASE}/tokenizer.json`,
    target: `${MODEL_ID}/tokenizer.json`,
  },
  {
    url: `${HF_BASE}/tokenizer_config.json`,
    target: `${MODEL_ID}/tokenizer_config.json`,
  },
  {
    url: `${HF_BASE}/special_tokens_map.json`,
    target: `${MODEL_ID}/special_tokens_map.json`,
    optional: true,
  },
  {
    url: `${HF_BASE}/onnx/model_quantized.onnx`,
    target: `${MODEL_ID}/onnx/model_quantized.onnx`,
  },
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
        "This downloads the optional embedding model for semantic categorization.",
        "",
        `  model:    ${MODEL_ID} (huggingface.co)`,
        `  runtime:  @huggingface/transformers@${TRANSFORMERS_VERSION} (cdn.jsdelivr.net)`,
        `  runtime:  onnxruntime-web@${ONNXRUNTIME_VERSION} (cdn.jsdelivr.net)`,
        `  into:     ${OUTPUT_ROOT}`,
        "  size:     ~150 MB",
        "",
        "Categorization already works without it. Re-run with --yes to proceed.",
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
      "Done. Now set SEMANTIC_CATEGORIZATION=1 in .env and restart.",
      "In Docker, mount public/models into the container so the files survive",
      "an image rebuild — see docs/categorization.md.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
