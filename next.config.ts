import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Locale is resolved per request from a cookie (see src/i18n/request.ts), so
// no routing configuration is involved — the plugin only needs to know where
// that request configuration lives.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-hosting: emit a minimal server bundle with only the dependencies the
  // app actually uses, so the Docker runtime stage needs no node_modules copy.
  output: "standalone",

  // Trust the reverse proxy's forwarded headers for the request origin. The
  // proxy itself must set them (see docs/self-hosting.md).
  poweredByHeader: false,

  // pg and pg-boss must stay outside the bundler: they load native/dynamic
  // modules that Turbopack cannot statically resolve.
  //
  // @electric-sql/pglite is here for a neighbouring reason, and it is the demo
  // instance's whole database (docs/demo.md). It ships pre-minified ESM whose
  // Emscripten glue reaches its WebAssembly two ways the bundler breaks: the
  // payload is addressed as `new URL("./pglite.wasm", import.meta.url)`, which
  // stops pointing at anything once the module is moved into a chunk, and the
  // `instantiateWasm` hook the glue calls is a cross-chunk import that happens
  // to share its name with the option it is assigned to. Re-bundled, the two
  // collapse onto each other and starting a demo dies in the instrumentation
  // hook with `h.instantiateWasm is not a function` — before the first request,
  // so every page is an Internal Server Error and the log says nothing about a
  // database. Left external it is loaded by Node from node_modules, which is
  // what the runtime stage of the Dockerfile copies in whole.
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "pino",
    "pino-pretty",
    "@electric-sql/pglite",
  ],

  images: {
    // Balancia serves only its own images; no remote loaders are configured.
    remotePatterns: [],
  },

  /**
   * Public paths whose handler cannot live at the matching location.
   *
   * ## The collector
   *
   * `POST /v1/report` and `POST /v1/crash` are the endpoints Balancia sends to
   * (docs/telemetry.md); the handlers live under `/api/telemetry/v1/…`. The
   * mapping is unconditional because rewrites are compiled into the build's
   * route manifest — a list computed from an environment variable would be
   * fixed at build time, which is exactly the wrong moment for a setting that
   * decides what one image does at runtime.
   *
   * Mapping them everywhere costs nothing: the handler behind each path
   * answers 404 unless `TELEMETRY_RECEIVER` is on, which it is not on any
   * self-hosted installation. A rewrite to a 404 is a 404.
   *
   * ## The Apple App Site Association document
   *
   * `/.well-known/apple-app-site-association` is what lets the iOS app claim
   * Balancia's invitation links, and it has to be served from that exact path
   * with no extension. Next's file-system router skips dot-prefixed
   * directories under `app/`, so the handler lives one dot away at
   * `app/well-known/…` and this maps the real path onto it.
   *
   * It must stay a rewrite. Apple's fetcher requires a plain 200 and will not
   * follow a redirect, and when it gives up it says so nowhere: no error on
   * the device, none in the developer portal, links simply keep opening
   * Safari. See `src/lib/apple-app-site-association.ts`.
   */
  async rewrites() {
    return [
      { source: "/v1/report", destination: "/api/telemetry/v1/report" },
      { source: "/v1/crash", destination: "/api/telemetry/v1/crash" },
      {
        source: "/.well-known/apple-app-site-association",
        destination: "/well-known/apple-app-site-association",
      },
    ];
  },

  experimental: {
    // Server Actions carry expense payloads with receipts already uploaded
    // separately, so a small limit is plenty and bounds request memory.
    serverActions: {
      bodySizeLimit: "1mb",
    },

    // Every screen here is dynamic — each one reads a cookie to find out who
    // is asking — and a dynamic route's prefetch is thrown away the moment it
    // is used unless it is given a lifetime. Without this, stepping back to a
    // tab you were just on refetches it from scratch and the screen slides in
    // empty; with it, the tab bar behaves like a native one, where the screens
    // are still there when you come back.
    //
    // Staleness is bounded by more than the clock: a server action that
    // changes something calls revalidatePath, which drops these entries, and a
    // push from someone else's change triggers router.refresh(), which
    // ignores them. Thirty seconds is what is left over — a window in which
    // nobody told us anything had changed.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default withNextIntl(nextConfig);
