import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALES,
  type AppLocale,
} from "@/i18n/locales";

/**
 * The pages a stranger can read, and the address of each in every language.
 *
 * Everything else in Balancia is behind a session or an invitation and is kept
 * out of every index. These are the opposite: they exist to be found, by a
 * person searching and by the crawlers that answer on a search engine's or an
 * assistant's behalf. One table says what they are, because five things have
 * to agree about it and each used to be able to disagree on its own —
 * `proxy.ts` (which language an address means), the `<link rel="alternate">`
 * tags, `sitemap.ts`, `/llms.txt`, and where the page counter may be mounted.
 *
 * Free of server-only imports: `proxy.ts` reads it on every request.
 */

/**
 * The project's own site, and the one address the comparison pages are
 * indexed at.
 *
 * Every instance serves those pages, since its footer links to them, but they
 * say the same words on every instance — and five hundred copies of one page
 * are five hundred competitors for it. So an instance names this origin as the
 * page's canonical URL rather than its own, and a search engine files them all
 * under the one. The homepage is different: it is an instance's own front
 * door, and stays canonical where it is served.
 *
 * Compiled in for the reason the telemetry endpoint is: a fork is building
 * from source and edits this line.
 */
export const OFFICIAL_ORIGIN = "https://balancia.app";

/** Where the source is. */
export const REPOSITORY = "https://github.com/sebitr/balancia";

/**
 * The last segment of each page's address. English is the one every page has;
 * a language without a slug of its own borrows it, so a newly registered
 * language's pages are at `/<code>/<english-slug>` until somebody writes them
 * words of their own here. The old address then redirects; see
 * `matchPublicPath`.
 */
const SLUGS = {
  home: { en: "" },
  splitwise: { en: "splitwise-alternative", fr: "alternative-splitwise" },
  tricount: { en: "tricount-alternative", fr: "alternative-tricount" },
} as const satisfies Record<
  string,
  { readonly en: string } & { readonly [Locale in AppLocale]?: string }
>;

export type PublicPage = keyof typeof SLUGS;

export const PUBLIC_PAGES = Object.keys(SLUGS) as PublicPage[];

function slugFor(page: PublicPage, locale: AppLocale): string {
  const slugs: { readonly [Locale in AppLocale]?: string } = SLUGS[page];
  return slugs[locale] ?? SLUGS[page].en;
}

/**
 * Where `page` lives in `locale`: `/`, `/fr`, `/fr/alternative-splitwise`.
 *
 * English has no prefix. It is the language the unprefixed addresses were
 * already indexed in, and the one a reader with no stated preference gets.
 */
export function publicPath(page: PublicPage, locale: AppLocale): string {
  const slug = slugFor(page, locale);
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  if (slug === "") return prefix || "/";
  return `${prefix}/${slug}`;
}

/**
 * The route file behind an address, relative to `src/app`.
 *
 * English is a folder named after the page. Every other language has a
 * folder named after itself holding two files: its homepage, and one dynamic
 * route for the rest, whose addresses are looked up in the table above. Both
 * are a few lines that hand over to the English page's own components, and
 * they are the one thing registering a language needs here.
 */
export function routeFile(page: PublicPage, locale: AppLocale): string {
  if (locale === DEFAULT_LOCALE) {
    return page === "home" ? "page.tsx" : `${SLUGS[page].en}/page.tsx`;
  }
  return page === "home" ? `${locale}/page.tsx` : `${locale}/[slug]/page.tsx`;
}

export interface PublicRoute {
  readonly page: PublicPage;
  readonly locale: AppLocale;
  /**
   * The one address this page answers at. When it differs from the path that
   * was asked for, the request is for a spelling that has moved — `/en`,
   * `/fr/splitwise-alternative` — and wants redirecting rather than serving,
   * so that no page is ever readable at two addresses.
   */
  readonly path: string;
}

/**
 * Which public page a path names, if any.
 *
 * Unprefixed, a path must be an English address exactly. Under a language
 * prefix it may use that language's slug or the English one, which is what a
 * hand-edited URL looks like and what every address was before its language
 * had a slug.
 */
export function matchPublicPath(pathname: string): PublicRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 2) return null;

  const [first, second] = segments;
  const prefixed = isAppLocale(first);
  if (!prefixed && segments.length > 1) return null;

  const locale = prefixed ? first : DEFAULT_LOCALE;
  const slug = (prefixed ? second : first) ?? "";

  const page = PUBLIC_PAGES.find(
    (candidate) =>
      SLUGS[candidate].en === slug ||
      (prefixed && slugFor(candidate, locale) === slug),
  );
  if (!page) return null;

  return { page, locale, path: publicPath(page, locale) };
}

/** The origin a page's canonical URL, alternates and share card name. */
export function publicOrigin(page: PublicPage, appOrigin: string): string {
  return page === "home" ? appOrigin : OFFICIAL_ORIGIN;
}

/** Whether this instance is where `page` is indexed. */
export function isIndexedHere(page: PublicPage, appOrigin: string): boolean {
  return publicOrigin(page, appOrigin) === appOrigin;
}

/**
 * The absolute URL of a page. The English homepage is the bare origin, with
 * no trailing slash, which is how it has always been written in the canonical
 * tag and the sitemap — a second spelling would be a second URL to a crawler.
 */
export function publicUrl(
  page: PublicPage,
  locale: AppLocale,
  appOrigin: string,
): string {
  const path = publicPath(page, locale);
  const origin = publicOrigin(page, appOrigin);
  return path === "/" ? origin : `${origin}${path}`;
}

/**
 * Every language a page is written in, by `hreflang` code, plus `x-default`.
 *
 * `x-default` is the English address: the one a reader whose language
 * Balancia does not have should be sent to. For the homepage it is also the
 * address that sends a French reader on to `/fr`, which is exactly the case
 * the value was defined for.
 */
export function languageAlternates(
  page: PublicPage,
  appOrigin: string,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      LOCALES.map((locale) => [locale, publicUrl(page, locale, appOrigin)]),
    ),
    "x-default": publicUrl(page, DEFAULT_LOCALE, appOrigin),
  };
}

/** A page's address in each language, for the switcher and the footer. */
export function localePaths(page: PublicPage): Record<AppLocale, string> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, publicPath(page, locale)]),
  ) as Record<AppLocale, string>;
}
