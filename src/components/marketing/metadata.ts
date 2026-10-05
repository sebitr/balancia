import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { alt as cardAlt, size as cardSize } from "@/app/opengraph-image";
import { DEFAULT_LOCALE, isAppLocale, LOCALES } from "@/i18n/locales";
import { getEnv } from "@/lib/env";
import {
  languageAlternates,
  OFFICIAL_ORIGIN,
  publicUrl,
  REPOSITORY,
  type PublicPage,
} from "@/lib/public-pages";

/**
 * The `<head>` of a public page: everything a search engine reads before it
 * reads the page.
 *
 * One function for all of them, because the parts are a set and a page that
 * has some of them is worse off than a page with none. A canonical URL that
 * names one language and alternates that name another, or a French page whose
 * share card announces itself in English, are each a contradiction a crawler
 * resolves by trusting neither.
 */

/**
 * `fr` as Open Graph wants it written: `fr_FR`. Worked out rather than listed,
 * so that a language registered in `LOCALES` has one without anybody having
 * to remember this file exists.
 */
function openGraphLocale(locale: string): string {
  const { language, region } = new Intl.Locale(locale).maximize();
  return region ? `${language}_${region}` : language;
}

export async function publicPageMetadata({
  page,
  title,
  description,
}: {
  page: PublicPage;
  /** Whole, brand included: the root layout's template is not applied. */
  title: string;
  description: string;
}): Promise<Metadata> {
  const requestLocale = await getLocale();
  const locale = isAppLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
  const { appOrigin } = getEnv();
  const url = publicUrl(page, locale, appOrigin);

  // The drawn share card (`opengraph-image.tsx`) has English words in it, so
  // English gets it and every other language gets the icon — a card with no
  // words rather than one in the wrong language.
  //
  // The homepage is handed the card by the file convention, with a hash on
  // its URL that changes when the drawing does. A page in a folder beneath
  // is not: the `openGraph` it returns replaces the root's whole, drawn card
  // included, and the comparison pages went out with no image at all until
  // somebody looked at their `<head>`. So they name it.
  const drawnCard = locale === DEFAULT_LOCALE;
  const icon = new URL("/icons/icon-512.png", appOrigin).toString();
  const card =
    page === "home"
      ? null
      : {
          url: new URL("/opengraph-image", appOrigin).toString(),
          ...cardSize,
          alt: cardAlt,
          type: "image/png",
        };
  const openGraphImages = drawnCard
    ? card && { images: [card] }
    : {
        images: [
          {
            url: icon,
            width: 512,
            height: 512,
            alt: "Balancia",
            type: "image/png",
          },
        ],
      };
  const twitterImages = drawnCard
    ? card && { images: [new URL("/twitter-image", appOrigin).toString()] }
    : { images: [icon] };

  return {
    // Absolute, because the template in the root layout only reaches the
    // segments beneath it. The homepage sits beside that layout, and its
    // English title had been going out as the tagline alone, with the name
    // of the thing it describes nowhere in it.
    title: { absolute: title },
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(page, appOrigin),
    },
    openGraph: {
      type: "website",
      url,
      siteName: "Balancia",
      locale: openGraphLocale(locale),
      alternateLocale: LOCALES.filter((other) => other !== locale).map(
        openGraphLocale,
      ),
      title,
      description,
      ...openGraphImages,
    },
    twitter: {
      card: drawnCard ? "summary_large_image" : "summary",
      title,
      description,
      ...twitterImages,
    },
    // The root layout says `noindex` for the whole application, and it is the
    // right default: everything else is somebody's account. A public page has
    // to say otherwise for itself.
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

/**
 * Who publishes Balancia, as structured data.
 *
 * An entry of its own so that every page can point at one node rather than
 * each describing a publisher slightly differently. `sameAs` is the part that
 * matters: it is how an engine learns that the Balancia on this site and the
 * `sebitr/balancia` repository are one project, which is most of what it
 * takes for an answer about one to cite the other.
 */
export function publisherGraph(appOrigin: string) {
  return {
    "@type": "Organization",
    "@id": `${appOrigin}/#publisher`,
    name: "Balancia",
    url: OFFICIAL_ORIGIN,
    logo: new URL("/icons/icon-512.png", appOrigin).toString(),
    sameAs: [REPOSITORY],
  };
}
