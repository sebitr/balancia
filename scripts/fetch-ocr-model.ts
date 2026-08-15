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
 * The download is roughly 32 MB and lands in `public/models`, which is
 * git-ignored. Nothing else in Balancia depends on it: without these files the
 * scan button is not rendered and expenses are entered by hand, which is the
 * default.
 *
 * Afterwards, set `RECEIPT_SCANNING=true` and restart. That switch also adds
 * `'wasm-unsafe-eval'` to the Content-Security-Policy, which WebAssembly needs
 * and which is otherwise deliberately absent.
 *
 * `--model <key>` installs a set other than the one the application reads,
 * which is what the eval harness uses to hold two releases on disk at once.
 * With no flag it installs `ACTIVE_MODEL_KEY`, so the default can never be the
 * one the build cannot use.
 *
 * Licensing
 * ---------
 * Every set here is Apache-2.0, from the PaddlePaddle project, which is
 * compatible with Balancia's AGPL-3.0-or-later distribution. See
 * docs/receipt-scanning.md for the full attribution.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ACTIVE_MODEL_KEY,
  OCR_MODEL_SETS,
  type OcrModelKey,
  type OcrModelSet,
} from "../src/lib/ocr/config";
import {
  extractCharacterDictionary,
  toDictionaryText,
} from "../src/lib/ocr/paddle-dict";

/** Pinned, so a rerun installs the same bytes it installed last time. */
const ONNXRUNTIME_VERSION = "1.23.0";

const JSDELIVR = "https://cdn.jsdelivr.net/npm";

const OUTPUT_ROOT = path.join(process.cwd(), "public", "models");

function huggingFace(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}

/**
 * Where each model set's files come from, and how its character list arrives.
 *
 * PP-OCRv5 comes from a third-party ONNX conversion because PaddlePaddle
 * publishes v5 only in Paddle's own inference format. PP-OCRv6 needs no such
 * detour: PaddlePaddle publishes the ONNX exports itself, one repository per
 * model, each under Apache-2.0.
 *
 * The two releases also disagree about the character list. v5 ships a plain
 * `.txt`; v6 ships no `.txt` at all and embeds the list in the recognizer's
 * `inference.yml`. Both end up on disk as the `.txt` the worker reads, so the
 * browser never learns there was a difference — see `paddle-dict.ts`.
 */
interface ModelSource {
  readonly detUrl: string;
  readonly recUrl: string;
  readonly dictionary:
    | { readonly kind: "text"; readonly url: string }
    | { readonly kind: "inference-yaml"; readonly url: string };
  /** Roughly what the weights weigh, for the confirmation prompt. */
  readonly approximateWeightsMb: number;
  readonly attribution: string;
}

const SOURCES: Record<OcrModelKey, ModelSource> = {
  "v5-mobile": {
    detUrl: huggingFace("bukuroo/PPOCRv5-ONNX", "ppocrv5-mobile-det.onnx"),
    recUrl: huggingFace("bukuroo/PPOCRv5-ONNX", "ppocrv5-mobile-rec.onnx"),
    dictionary: {
      kind: "text",
      url: huggingFace("bukuroo/PPOCRv5-ONNX", "ppocrv5_dict.txt"),
    },
    approximateWeightsMb: 21,
    attribution: "bukuroo/PPOCRv5-ONNX — PP-OCRv5 mobile, Apache-2.0",
  },
  "v6-tiny": {
    detUrl: huggingFace(
      "PaddlePaddle/PP-OCRv6_tiny_det_onnx",
      "inference.onnx",
    ),
    recUrl: huggingFace(
      "PaddlePaddle/PP-OCRv6_tiny_rec_onnx",
      "inference.onnx",
    ),
    dictionary: {
      kind: "inference-yaml",
      url: huggingFace("PaddlePaddle/PP-OCRv6_tiny_rec_onnx", "inference.yml"),
    },
    approximateWeightsMb: 6,
    attribution: "PaddlePaddle/PP-OCRv6_tiny_*_onnx — Apache-2.0",
  },
  "v6-small": {
    detUrl: huggingFace(
      "PaddlePaddle/PP-OCRv6_small_det_onnx",
      "inference.onnx",
    ),
    recUrl: huggingFace(
      "PaddlePaddle/PP-OCRv6_small_rec_onnx",
      "inference.onnx",
    ),
    dictionary: {
      kind: "inference-yaml",
      url: huggingFace("PaddlePaddle/PP-OCRv6_small_rec_onnx", "inference.yml"),
    },
    approximateWeightsMb: 31,
    attribution: "PaddlePaddle/PP-OCRv6_small_*_onnx — Apache-2.0",
  },
};

interface Download {
  readonly url: string;
  /** Path relative to `public/models`. */
  readonly target: string;
  readonly optional?: boolean;
}

/** The runtime, which is the same whichever model set is installed. */
const RUNTIME_DOWNLOADS: readonly Download[] = [
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
];

/** The two graphs for one model set, named as `config.ts` expects to find them. */
function weightDownloads(
  model: OcrModelSet,
  source: ModelSource,
): readonly Download[] {
  return [
    // Text detection: finds the lines.
    { url: source.detUrl, target: relativeTarget(model.detUrl) },
    // Text recognition: reads them.
    { url: source.recUrl, target: relativeTarget(model.recUrl) },
  ];
}

/**
 * `/models/ocr/x.onnx` as `ocr/x.onnx`.
 *
 * The model set holds browser URLs, because that is what the worker needs; the
 * installer needs the same names as paths under `public/models`. Deriving one
 * from the other keeps a rename from silently installing files the browser
 * then cannot find.
 */
function relativeTarget(url: string): string {
  const prefix = "/models/";
  if (!url.startsWith(prefix)) {
    throw new Error(`Model URL outside ${prefix}: ${url}`);
  }
  return url.slice(prefix.length);
}

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

/**
 * Puts the character list on disk in the one shape the worker reads.
 *
 * For v5 that is a copy. For v6 it is a conversion: the list lives inside the
 * recognizer's `inference.yml`, and it is pulled out here — on one machine, at
 * install time — rather than in the worker, which would have to carry a YAML
 * reader into every browser to do the same job.
 */
async function installDictionary(
  model: OcrModelSet,
  source: ModelSource,
): Promise<void> {
  const target = path.join(OUTPUT_ROOT, relativeTarget(model.dictUrl));
  await mkdir(path.dirname(target), { recursive: true });

  const response = await fetch(source.dictionary.url);
  if (!response.ok) {
    throw new Error(`${source.dictionary.url} → HTTP ${response.status}`);
  }
  const body = await response.text();

  const text =
    source.dictionary.kind === "text"
      ? body
      : toDictionaryText(extractCharacterDictionary(body));

  await writeFile(target, text, "utf8");

  const characters = text.split(/\r?\n/).filter((line) => line !== "").length;
  console.log(`  ${relativeTarget(model.dictUrl)} (${characters} characters)`);
}

/** `--model v6-tiny`, or whichever set the application is built to read. */
function selectedModel(): OcrModelKey {
  const flag = process.argv.findIndex((argument) => argument === "--model");
  if (flag < 0) return ACTIVE_MODEL_KEY;

  const value = process.argv[flag + 1];
  if (value && value in OCR_MODEL_SETS) return value as OcrModelKey;

  throw new Error(
    `Unknown --model ${value ?? "(missing)"}. One of: ${Object.keys(OCR_MODEL_SETS).join(", ")}`,
  );
}

async function main(): Promise<void> {
  const key = selectedModel();
  const model = OCR_MODEL_SETS[key];
  const source = SOURCES[key];
  const totalMb = source.approximateWeightsMb + 26;

  if (!process.argv.includes("--yes")) {
    console.log(
      [
        "This downloads the optional OCR models for on-device receipt scanning.",
        "",
        `  model:    ${model.name} (--model ${key})`,
        `  weights:  ${source.attribution} (huggingface.co)`,
        `  runtime:  onnxruntime-web@${ONNXRUNTIME_VERSION} (cdn.jsdelivr.net)`,
        `  into:     ${OUTPUT_ROOT}`,
        `  size:     ~${totalMb} MB`,
        "",
        `  others:   ${Object.keys(OCR_MODEL_SETS).join(", ")}`,
        "",
        "Receipts can already be attached without it; this only adds reading",
        "them. Re-run with --yes to proceed.",
      ].join("\n"),
    );
    return;
  }

  console.log(`Downloading ${model.name} into ${OUTPUT_ROOT}`);
  for (const item of [
    ...RUNTIME_DOWNLOADS,
    ...weightDownloads(model, source),
  ]) {
    await download(item);
  }
  await installDictionary(model, source);

  console.log(
    [
      "",
      "Done. Now set RECEIPT_SCANNING=true in .env and restart.",
      "In Docker, mount public/models into the container so the files survive",
      "an image rebuild — see docs/receipt-scanning.md.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
