import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Balancia has one public, canonical marketing URL; application URLs are private. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: getEnv().appOrigin,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
