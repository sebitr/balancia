import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ComparisonPage } from "@/components/marketing/comparison-page";
import { publicPageMetadata } from "@/components/marketing/metadata";
import type { AppLocale } from "@/i18n/locales";
import { matchPublicPath, type PublicPage } from "@/lib/public-pages";

/**
 * The comparison pages of one language, as a route: what
 * `app/<locale>/[slug]/page.tsx` exports.
 *
 * English has a folder per page, named after it. Another language's pages
 * have that language's own words in their addresses —
 * `/fr/alternative-splitwise` — and those words live in the table in
 * `lib/public-pages.ts`, not in folder names: a slug reworded there should
 * not need a folder renamed to match, and an address that has moved has to
 * keep answering with a redirect. So the language's folder holds one dynamic
 * route, and this looks the address up.
 *
 * The language itself arrives the way it does for the homepage — in the
 * header `proxy.ts` sets from the address.
 */
export function comparisonRoute(locale: AppLocale) {
  type Props = { params: Promise<{ slug: string }> };

  async function comparisonAt({
    params,
  }: Props): Promise<Exclude<PublicPage, "home"> | null> {
    const address = `/${locale}/${(await params).slug}`;
    const route = matchPublicPath(address);
    // The address has to be the page's own. One that merely names the page —
    // its English slug under this language's prefix — has already been sent
    // on by `proxy.ts`, and is not served here either.
    if (!route || route.page === "home" || route.path !== address) return null;
    return route.page;
  }

  return {
    async generateMetadata(props: Props): Promise<Metadata> {
      const product = await comparisonAt(props);
      if (!product) return {};

      const t = await getTranslations(`compare.${product}.meta`);
      return publicPageMetadata({
        page: product,
        title: t("title"),
        description: t("description"),
      });
    },

    async Page(props: Props) {
      const product = await comparisonAt(props);
      if (!product) notFound();
      return <ComparisonPage product={product} />;
    },
  };
}
