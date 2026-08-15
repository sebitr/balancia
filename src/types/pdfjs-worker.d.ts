/**
 * pdf.js ships its worker as a build artefact with no type declaration.
 *
 * `src/lib/pdf/read-pdf.ts` imports it as an ordinary module and registers it
 * as pdf.js's main-thread message handler, rather than pointing `workerSrc` at
 * a URL — see that file for why. Only its identity is needed, never its shape,
 * so `unknown` is the honest declaration: it says the module exists and
 * nothing about what is in it.
 */
declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  const handler: unknown;
  export = handler;
}
