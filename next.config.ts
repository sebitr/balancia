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
  serverExternalPackages: ["pg", "pg-boss", "pino", "pino-pretty"],

  images: {
    // Balancia serves only its own images; no remote loaders are configured.
    remotePatterns: [],
  },

  experimental: {
    // Server Actions carry expense payloads with receipts already uploaded
    // separately, so a small limit is plenty and bounds request memory.
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

export default withNextIntl(nextConfig);
