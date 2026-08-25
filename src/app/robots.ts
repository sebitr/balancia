import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Only the marketing page is public search content. Everything else is an
 * account, invitation or instance-administration surface and has no place in
 * an index even when a crawler discovers a URL.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getEnv().appOrigin;

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/llms.txt", "/manifest.webmanifest"],
      disallow: [
        "/api/",
        "/administration",
        "/confirm-email",
        "/dashboard",
        "/forgot-password",
        "/groups/",
        "/invite",
        "/join/",
        "/notifications",
        "/offline",
        "/profile",
        "/register",
        "/reset-password",
        "/security",
        "/settings",
        "/sign-in",
        "/verify-email",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
