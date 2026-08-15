/**
 * How much does the OCR layer lose?
 *
 * Everything under `src/modules/receipts` is tested against fixtures that are
 * *text* — the boxes a perfect recognizer would have produced. That is the
 * right way to test a parser and it says nothing at all about the models, so a
 * model swap changes only the one layer nothing measures.
 *
 * This closes that gap without inventing a second source of truth. Each
 * fixture is drawn as a receipt, photographed as a JPEG, and put through the
 * real preprocessing, the real worker and the real parser. What comes out is
 * compared against `parseReceipt` on the *same fixture's text* — so the score
 * is exactly "what reading it as an image cost", with the parser's own
 * behaviour cancelled out of both sides.
 *
 *   pnpm ocr:eval                      # every installed model set
 *   pnpm ocr:eval --models v6-tiny     # one of them
 *   pnpm ocr:eval --variants clean     # one photograph quality
 *
 * No fixture is a real receipt, here as everywhere else in this repository.
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "@playwright/test";
import { OCR_MODEL_SETS, type OcrModelKey } from "../src/lib/ocr/config";
import {
  parseReceipt,
  type ParsedReceipt,
  type OcrResult,
} from "../src/modules/receipts";
import {
  buildOcrResult,
  FRENCH_BISTRO,
  GERMAN_RESTAURANT,
  ITALIAN_BARE_QUANTITY,
  ITALIAN_TRATTORIA,
  LARGE_AMOUNTS,
  QUANTITY_AND_SERVICE,
  SWISS_RESTAURANT,
  US_RESTAURANT,
  type FixtureLine,
} from "../src/modules/receipts/test-fixtures";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const OUT_DIR = path.join(ROOT, ".ocr-eval");

type Variant = "clean" | "dim" | "blur" | "noise";
const ALL_VARIANTS: readonly Variant[] = ["clean", "dim", "blur", "noise"];

interface Case {
  readonly name: string;
  readonly lines: readonly FixtureLine[];
  readonly currency: string;
}

/**
 * The corpus, which is the repository's own fixture set.
 *
 * `POORLY_DETECTED` is deliberately absent: it is not a receipt, it is a
 * recording of what a bad *scan* produced, so rendering it as an image and
 * asking a recognizer to reproduce the damage measures nothing.
 */
const CASES: readonly Case[] = [
  { name: "swiss-restaurant", lines: SWISS_RESTAURANT, currency: "CHF" },
  { name: "french-bistro", lines: FRENCH_BISTRO, currency: "EUR" },
  { name: "german-restaurant", lines: GERMAN_RESTAURANT, currency: "EUR" },
  { name: "italian-trattoria", lines: ITALIAN_TRATTORIA, currency: "EUR" },
  {
    name: "italian-bare-quantity",
    lines: ITALIAN_BARE_QUANTITY,
    currency: "EUR",
  },
  { name: "us-diner", lines: US_RESTAURANT, currency: "USD" },
  {
    name: "quantity-and-service",
    lines: QUANTITY_AND_SERVICE,
    currency: "CHF",
  },
  { name: "large-amounts", lines: LARGE_AMOUNTS, currency: "CHF" },
];

/* ------------------------------------------------------------- scoring */

/** The fields a person would check before accepting a scan. */
const FIELDS = [
  "merchant",
  "date",
  "currency",
  "total",
  "subtotal",
  "tax",
] as const;
type Field = (typeof FIELDS)[number];

interface CaseScore {
  readonly model: OcrModelKey;
  readonly case: string;
  readonly variant: Variant;
  readonly fields: Record<Field, boolean | null>;
  /** Expected items that came back with the right name and the right amount. */
  readonly itemsMatched: number;
  readonly itemsExpected: number;
  readonly scanMs: number;
  readonly backend: string;
  readonly failure?: string;
}

function fieldValue(receipt: ParsedReceipt, field: Field): string | undefined {
  const value = receipt[field];
  if (value === undefined) return undefined;
  return typeof value === "bigint" ? value.toString() : String(value);
}

/**
 * Whether one field survived the round trip.
 *
 * `null` where the text-level parse did not produce the field either: a
 * fixture with no tax line cannot lose its tax, and counting that as a success
 * would quietly inflate every score by the number of fields receipts do not
 * have.
 */
function compareField(
  expected: ParsedReceipt,
  actual: ParsedReceipt,
  field: Field,
): boolean | null {
  const wanted = fieldValue(expected, field);
  if (wanted === undefined) return null;
  return normalize(wanted) === normalize(fieldValue(actual, field) ?? "");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Levenshtein ratio, for item names the recognizer got nearly right. */
function similarity(left: string, right: string): number {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

/**
 * How many expected items came back.
 *
 * The amount must be exact — an item whose price is off by a digit is wrong,
 * not nearly right, because it is the number that reaches the split. The name
 * only has to be close: "Cacio e pepe" read as "Cacio e pepé" is a successful
 * read of a line somebody is about to see and correct anyway.
 */
function scoreItems(
  expected: ParsedReceipt,
  actual: ParsedReceipt,
): { matched: number; total: number } {
  const remaining = [...actual.items];
  let matched = 0;

  for (const item of expected.items) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.total === item.total &&
        similarity(candidate.name, item.name) >= 0.7,
    );
    if (index >= 0) {
      remaining.splice(index, 1);
      matched += 1;
    }
  }

  return { matched, total: expected.items.length };
}

/* -------------------------------------------------------------- serving */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Balancia OCR eval</title>
<body><p>OCR eval harness. Driven by scripts/ocr-eval.ts.</p>
<script src="/eval.js"></script>
`;

/**
 * A static origin for the run.
 *
 * The worker is built from a Blob, so it has no usable base URL of its own and
 * resolves everything against the page's origin — which means the harness
 * needs a real one. `about:blank` and `page.setContent` give an opaque origin,
 * where the worker's first dynamic import fails.
 */
async function serve(
  bundle: string,
): Promise<{ url: string; close: () => void }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/" || url.pathname === "/eval.html") {
      response.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
      response.end(PAGE);
      return;
    }

    if (url.pathname === "/eval.js") {
      response.writeHead(200, { "content-type": CONTENT_TYPES[".js"] });
      response.end(bundle);
      return;
    }

    if (url.pathname.startsWith("/models/")) {
      const file = path.join(PUBLIC_DIR, url.pathname.slice(1));
      // The models directory is the only thing served, and only by exact path.
      if (!file.startsWith(path.join(PUBLIC_DIR, "models"))) {
        response.writeHead(403).end();
        return;
      }
      readFile(file).then(
        (bytes) => {
          response.writeHead(200, {
            "content-type":
              CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
            "content-length": String(bytes.length),
          });
          response.end(bytes);
        },
        () => response.writeHead(404).end(),
      );
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("server did not bind a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => server.close(),
  };
}

/* ----------------------------------------------------------------- run */

function requested<T extends string>(
  flag: string,
  all: readonly T[],
): readonly T[] {
  const index = process.argv.indexOf(flag);
  if (index < 0) return all;
  const values = (process.argv[index + 1] ?? "").split(",").filter(Boolean);
  const chosen = values.filter((value): value is T => all.includes(value as T));
  const unknown = values.filter((value) => !all.includes(value as T));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${flag}: ${unknown.join(", ")}`);
  }
  return chosen;
}

/** A model set counts as installed when its detector is on disk. */
function installed(key: OcrModelKey): boolean {
  const url = OCR_MODEL_SETS[key].detUrl;
  return existsSync(path.join(PUBLIC_DIR, url.replace(/^\//, "")));
}

async function main(): Promise<void> {
  const models = requested<OcrModelKey>(
    "--models",
    Object.keys(OCR_MODEL_SETS) as OcrModelKey[],
  ).filter((key) => {
    if (installed(key)) return true;
    console.log(`skipping ${key}: not installed`);
    return false;
  });

  if (models.length === 0) {
    throw new Error("No model set installed. Run pnpm ocr:install first.");
  }

  const variants = requested<Variant>("--variants", ALL_VARIANTS);

  const bundled = await build({
    entryPoints: [path.join(ROOT, "scripts/ocr-eval/browser.ts")],
    bundle: true,
    format: "iife",
    target: "es2022",
    write: false,
    logLevel: "warning",
  });
  const bundle = bundled.outputFiles[0].text;

  const server = await serve(bundle);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const failures: string[] = [];
  page.on("pageerror", (error: Error) => failures.push(error.message));

  await page.goto(`${server.url}/eval.html`);
  await page.waitForFunction(() => Boolean(window.__balanciaOcrEval));

  const scores: CaseScore[] = [];

  for (const model of models) {
    console.log(`\n${OCR_MODEL_SETS[model].name}`);
    for (const testCase of CASES) {
      const expected = parseReceipt(buildOcrResult(testCase.lines), {
        fallbackCurrency: testCase.currency,
      });

      for (const variant of variants) {
        let score: CaseScore;
        try {
          const report = await page.evaluate(
            (input: {
              lines: readonly FixtureLine[];
              variant: Variant;
              model: OcrModelKey;
            }) =>
              window.__balanciaOcrEval.run(
                input.lines,
                input.variant,
                input.model,
              ),
            { lines: testCase.lines, variant, model },
          );

          const actual = parseReceipt(report.result as OcrResult, {
            fallbackCurrency: testCase.currency,
          });
          const items = scoreItems(expected, actual);

          if (process.argv.includes("--dump")) {
            await dump(
              testCase,
              variant,
              model,
              page,
              report.result as OcrResult,
            );
          }

          score = {
            model,
            case: testCase.name,
            variant,
            fields: Object.fromEntries(
              FIELDS.map((field) => [
                field,
                compareField(expected, actual, field),
              ]),
            ) as Record<Field, boolean | null>,
            itemsMatched: items.matched,
            itemsExpected: items.total,
            scanMs: report.scanMs,
            backend: report.backend,
          };
        } catch (error) {
          score = {
            model,
            case: testCase.name,
            variant,
            fields: Object.fromEntries(
              FIELDS.map((field) => [field, false]),
            ) as Record<Field, boolean | null>,
            itemsMatched: 0,
            itemsExpected: expected.items.length,
            scanMs: 0,
            backend: "none",
            failure: error instanceof Error ? error.message : String(error),
          };
        }

        scores.push(score);
        console.log(
          `  ${testCase.name.padEnd(24)} ${variant.padEnd(6)} ` +
            `items ${score.itemsMatched}/${score.itemsExpected}  ` +
            `total ${mark(score.fields.total)} date ${mark(score.fields.date)} ` +
            `merchant ${mark(score.fields.merchant)}  ${score.scanMs.toFixed(0)}ms` +
            (score.failure ? `  FAILED: ${score.failure}` : ""),
        );
      }
    }
  }

  await browser.close();
  server.close();

  report(scores, models);

  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${models.join("-vs-")}.json`);
  await writeFile(file, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
  console.log(`\nWritten to ${path.relative(ROOT, file)}`);

  if (failures.length > 0) {
    console.error(`\nPage errors:\n  ${failures.join("\n  ")}`);
  }
}

function mark(value: boolean | null): string {
  return value === null ? "-" : value ? "y" : "N";
}

/**
 * What the recognizer actually read, and the photograph it read it from.
 *
 * A score of zero is far more often the harness than the model, and the only
 * way to tell the two apart is to look at the boxes and at the image.
 */
async function dump(
  testCase: Case,
  variant: Variant,
  model: OcrModelKey,
  page: Page,
  result: OcrResult,
): Promise<void> {
  const stem = `${model}-${testCase.name}-${variant}`;
  await mkdir(OUT_DIR, { recursive: true });

  const dataUrl = await page.evaluate(
    (input: { lines: readonly FixtureLine[]; variant: Variant }) =>
      window.__balanciaOcrEval.renderPreview(input.lines, input.variant),
    { lines: testCase.lines, variant },
  );
  await writeFile(
    path.join(OUT_DIR, `${stem}.jpg`),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );

  const lines = result.boxes
    .map(
      (box) =>
        `  [${box.box.x0},${box.box.y0}-${box.box.x1},${box.box.y1}] ` +
        `${box.confidence.toFixed(2)} ${JSON.stringify(box.text)}`,
    )
    .join("\n");
  await writeFile(
    path.join(OUT_DIR, `${stem}.txt`),
    `${result.boxes.length} boxes in ${result.width}x${result.height}\n${lines}\n`,
    "utf8",
  );
  console.log(`      dumped ${stem}.jpg / .txt (${result.boxes.length} boxes)`);
}

function report(
  scores: readonly CaseScore[],
  models: readonly OcrModelKey[],
): void {
  console.log(`\n${"".padEnd(72, "=")}`);
  console.log(
    "Summary — share of the text-level parse that survived the image",
  );
  console.log("".padEnd(72, "="));

  const header = ["", ...models.map((key) => OCR_MODEL_SETS[key].name)];
  const rows: string[][] = [];

  for (const field of FIELDS) {
    rows.push([
      field,
      ...models.map((model) => {
        const relevant = scores.filter(
          (score) => score.model === model && score.fields[field] !== null,
        );
        const right = relevant.filter((score) => score.fields[field]).length;
        return relevant.length === 0
          ? "n/a"
          : `${((right / relevant.length) * 100).toFixed(0)}% (${right}/${relevant.length})`;
      }),
    ]);
  }

  rows.push([
    "items",
    ...models.map((model) => {
      const relevant = scores.filter((score) => score.model === model);
      const matched = relevant.reduce(
        (sum, score) => sum + score.itemsMatched,
        0,
      );
      const total = relevant.reduce(
        (sum, score) => sum + score.itemsExpected,
        0,
      );
      return `${((matched / total) * 100).toFixed(0)}% (${matched}/${total})`;
    }),
  ]);

  rows.push([
    "median scan",
    ...models.map((model) => {
      const times = scores
        .filter((score) => score.model === model && score.scanMs > 0)
        .map((score) => score.scanMs)
        .sort((a, b) => a - b);
      return times.length === 0
        ? "n/a"
        : `${times[Math.floor(times.length / 2)].toFixed(0)} ms`;
    }),
  ]);

  rows.push(header.map(() => ""));

  /*
   * The same score split by how the photograph was taken.
   *
   * Averaging the four together hides the finding that matters most: the
   * variants are not equally hard, and a stress case both models fail tells
   * you nothing about which to install. `noise` in particular collapses DB's
   * detection — regions fragment, lines lose their ends, and the amount column
   * stops being found at all — so a single blended number reads as "both
   * models are mediocre" when three quarters of the corpus says otherwise.
   */
  for (const variant of ALL_VARIANTS) {
    const relevant = scores.filter((score) => score.variant === variant);
    if (relevant.length === 0) continue;
    rows.push([
      `items · ${variant}`,
      ...models.map((model) => {
        const mine = relevant.filter((score) => score.model === model);
        const matched = mine.reduce(
          (sum, score) => sum + score.itemsMatched,
          0,
        );
        const total = mine.reduce((sum, score) => sum + score.itemsExpected, 0);
        return total === 0
          ? "n/a"
          : `${((matched / total) * 100).toFixed(0)}% (${matched}/${total})`;
      }),
    ]);
  }

  for (const variant of ALL_VARIANTS) {
    const relevant = scores.filter((score) => score.variant === variant);
    if (relevant.length === 0) continue;
    rows.push([
      `total · ${variant}`,
      ...models.map((model) => {
        const mine = relevant.filter(
          (score) => score.model === model && score.fields.total !== null,
        );
        const right = mine.filter((score) => score.fields.total).length;
        return mine.length === 0
          ? "n/a"
          : `${((right / mine.length) * 100).toFixed(0)}% (${right}/${mine.length})`;
      }),
    ]);
  }

  const widths = header.map((_, column) =>
    Math.max(
      header[column].length,
      ...rows.map((row) => (row[column] ?? "").length),
    ),
  );
  const line = (cells: readonly string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");

  console.log(line(header));
  console.log(widths.map((width) => "".padEnd(width, "-")).join("  "));
  for (const row of rows) console.log(line(row));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
