import { NextResponse } from "next/server";

/**
 * Web app manifest.
 *
 * Served from a route handler rather than a static file so the icons and
 * start URL stay consistent with the app's routing, and so the response
 * carries the correct `application/manifest+json` content type.
 */
export function GET() {
  const manifest = {
    id: "/",
    name: "Balancia — shared expenses",
    short_name: "Balancia",
    description:
      "Privacy-focused, self-hosted shared expense tracking. Shared expenses. Fairly balanced.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#fbf7f1",
    theme_color: "#2a0e31",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Your groups",
        url: "/dashboard",
      },
      {
        name: "Create a group",
        url: "/groups/new",
      },
    ],
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
