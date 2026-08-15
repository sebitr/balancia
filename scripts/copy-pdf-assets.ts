#!/usr/bin/env tsx
import { createRequire } from "node:module";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Puts pdf.js's image codecs somewhere the browser can fetch them.
 *
 * A scanned PDF is a page with a picture on it, and some scanners encode that
 * picture as JBIG2 or JPEG 2000 — formats no browser decodes natively. pdf.js
 * decodes them itself, in WebAssembly, but it does not bundle those modules:
 * it fetches them at the moment it meets such an image, from whatever
 * `wasmUrl` says. Without them the page renders with a hole where the receipt
 * was, and the scanner reads a blank sheet — a silent wrong answer rather than
 * an error, which is the worst kind.
 *
 * So they are copied into `public/` at build time and `wasmUrl` points there.
 * Nothing is downloaded until a document actually contains one of these
 * images, which most never will: an emailed invoice has no pictures at all,
 * and a phone scan is a JPEG, which the browser decodes on its own.
 *
 * Deliberately not copied: `quickjs-eval.*`, which runs JavaScript embedded in
 * a PDF. Balancia never enables PDF scripting, and shipping an interpreter for
 * untrusted code that arrives by email is not something to do by accident.
 */

const require = createRequire(import.meta.url);

/** Each codec, and the pure-JavaScript fallback pdf.js uses without WebAssembly. */
const ASSETS = [
  "jbig2.wasm",
  "jbig2_nowasm_fallback.js",
  "openjpeg.wasm",
  "openjpeg_nowasm_fallback.js",
  "qcms_bg.wasm",
  // AGPL obliges us to carry these with the code they cover.
  "LICENSE_JBIG2",
  "LICENSE_OPENJPEG",
  "LICENSE_QCMS",
  "LICENSE_PDFJS_JBIG2",
  "LICENSE_PDFJS_OPENJPEG",
  "LICENSE_PDFJS_QCMS",
] as const;

/** Must match `PDFJS_WASM_PATH` in `src/lib/pdf/read-pdf.ts`. */
const DESTINATION = "public/pdfjs";

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const source = dirname(require.resolve("pdfjs-dist/wasm/jbig2.wasm"));
  const target = join(process.cwd(), DESTINATION);
  await mkdir(target, { recursive: true });

  let copied = 0;
  for (const asset of ASSETS) {
    const from = join(source, asset);
    const to = join(target, asset);

    // This runs before every `dev` and every `build`. Same size means same
    // file — the version is pinned in the lockfile, so there is nothing else
    // it could be — and skipping saves a megabyte of copying on each start.
    if ((await sizeOf(from)) === (await sizeOf(to))) continue;

    await copyFile(from, to);
    copied += 1;
  }

  if (copied > 0) {
    console.log(`pdf.js: copied ${copied} codec file(s) into ${DESTINATION}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
