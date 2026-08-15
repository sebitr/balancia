import { serwist } from "@serwist/next/config";
import { precacheManifestTransform } from "./src/lib/pwa/precache-urls.mjs";

/**
 * Serwist "configurator" mode.
 *
 * The default `withSerwist` plugin is webpack-only, and Next.js 16 builds with
 * Turbopack. Configurator mode instead builds the service worker with the
 * Serwist CLI *after* `next build`, reading the same Next config — so the PWA
 * works without opting the whole app out of Turbopack.
 *
 * See package.json: `build` runs `next build` then `serwist build`.
 */
export default await serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  globDirectory: ".next",
  // Precache the offline shell and the versioned static assets only. Nothing
  // authenticated is ever precached.
  globPatterns: ["static/**/*.{js,css,woff2}", "server/app/offline.html"],
  /*
   * The precache is the app shell, and a chunk approaching a megabyte is not
   * shell — it is one optional feature's payload, which every install would
   * then download whether or not the instance even has that feature switched
   * on. pdf.js is the current example at 1.1 MB, against 442 KB for the next
   * largest chunk. It is still cached the first time it is used, by the
   * CacheFirst rule over `/_next/static/` in `src/app/sw.ts` — the same trade
   * the OCR models get, and for the same reason.
   *
   * Anything skipped is named in a build warning, so a chunk that grows past
   * this line says so rather than quietly leaving the offline shell.
   */
  maximumFileSizeToCacheInBytes: 768 * 1024,
  // Globbing yields paths relative to `.next`, which are not URLs this app
  // serves — see src/lib/pwa/precache-urls.mjs for what that cost.
  manifestTransforms: [precacheManifestTransform],
  disablePrecacheManifest: process.env.NODE_ENV !== "production",
});
