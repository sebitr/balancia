import { serwist } from "@serwist/next/config";

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
  disablePrecacheManifest: process.env.NODE_ENV !== "production",
});
