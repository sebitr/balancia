import type { MetadataRoute } from "next";

/** Public marketing and documentation artifacts are available to every crawler. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
  };
}
