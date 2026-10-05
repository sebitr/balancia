import type { MetadataRoute } from "next";
import { COMPARISON_REVIEWED } from "@/components/marketing/comparison-content";
import { LOCALES } from "@/i18n/locales";
import { getEnv } from "@/lib/env";
import {
  isIndexedHere,
  languageAlternates,
  PUBLIC_PAGES,
  publicUrl,
} from "@/lib/public-pages";

export const dynamic = "force-dynamic";

/**
 * The public pages, once per language, each naming the others.
 *
 * Application URLs are private and are never here. Nor is a page this
 * instance serves but does not own: the comparison pages are indexed at the
 * project's own site, so a self-hosted instance lists its homepage and stops.
 *
 * The alternates repeat what each page's `<link rel="alternate">` tags say.
 * That is deliberate — a search engine accepts the pairing from either place
 * and believes it sooner from both — and it cannot drift, both being read
 * from `lib/public-pages.ts`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const { appOrigin } = getEnv();

  return PUBLIC_PAGES.filter((page) => isIndexedHere(page, appOrigin)).flatMap(
    (page) =>
      LOCALES.map((locale) => ({
        url: publicUrl(page, locale, appOrigin),
        // A date only where one is known. The comparisons carry the day they
        // were last checked against the other product's pages; the homepage
        // has no such day, and a sitemap that stamps every URL with "now" is
        // one whose dates a crawler learns to ignore.
        ...(page === "home"
          ? { changeFrequency: "weekly" as const, priority: 1 }
          : { lastModified: COMPARISON_REVIEWED, priority: 0.8 }),
        alternates: { languages: languageAlternates(page, appOrigin) },
      })),
  );
}
