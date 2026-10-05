import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ComparisonPage } from "@/components/marketing/comparison-page";
import { publicPageMetadata } from "@/components/marketing/metadata";

// The English address. `/fr/alternative-tricount` and every other language's
// are served by that language's `[slug]` route, which renders the same
// component; the addresses themselves are in `lib/public-pages.ts`.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("compare.tricount.meta");
  return publicPageMetadata({
    page: "tricount",
    title: t("title"),
    description: t("description"),
  });
}

export default function TricountAlternativePage() {
  return <ComparisonPage product="tricount" />;
}
