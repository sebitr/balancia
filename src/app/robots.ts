import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Only the public pages are search content — the homepage and the comparison
 * pages, in each language; `lib/public-pages.ts` has the list. Everything else
 * is an account, invitation or instance-administration surface and has no
 * place in an index even when a crawler discovers a URL.
 *
 * One group, for every crawler, and that is a decision rather than an
 * omission. The crawlers that feed assistants — GPTBot, OAI-SearchBot,
 * ClaudeBot, PerplexityBot and the rest — are welcome on exactly the pages a
 * search engine is, because being read by them is how Balancia comes to be
 * named when somebody asks one for an alternative to Splitwise. Naming them
 * here would also be a trap: a crawler that finds a group addressed to it
 * obeys that group and ignores `*`, so a list of names is a second copy of
 * the disallow list that has to be kept in step with the first.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getEnv().appOrigin;

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/llms.txt", "/llms-full.txt", "/manifest.webmanifest"],
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
