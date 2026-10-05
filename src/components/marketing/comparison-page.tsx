import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import {
  COMPARISON_REVIEWED,
  COMPARISONS,
  type ComparedProduct,
} from "@/components/marketing/comparison-content";
import {
  ArrowIcon,
  DARK_OUTLINE_BUTTON,
  Eyebrow,
  GITHUB,
  GithubMark,
  JsonLd,
  MarketingShell,
  PRIMARY_BUTTON,
  TEXT_LINK,
} from "@/components/marketing/shell";
import { AreaMessages } from "@/i18n/area-messages";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locales";
import { track } from "@/lib/analytics/events";
import { getEnv } from "@/lib/env";
import { publisherGraph } from "@/components/marketing/metadata";
import { publicOrigin, publicPath, publicUrl } from "@/lib/public-pages";

/**
 * Balancia beside one other product: the page somebody lands on having typed
 * "Splitwise alternative" into a search box, or having asked an assistant for
 * one.
 *
 * It is written to be quoted. The first paragraph answers the question on its
 * own; the table says each thing as a whole sentence, with the product's name
 * in it, so a row lifted out of the page still means what it meant in it; and
 * the other product gets the reasons to choose it stated as plainly as
 * Balancia's. A comparison that only flatters its author is one neither a
 * reader nor a ranking system has any reason to believe — and every claim
 * about the other product here is one its own pages make, linked at the end
 * and dated.
 */
export async function ComparisonPage({
  product,
}: {
  product: ComparedProduct;
}) {
  const requestLocale = await getLocale();
  const locale = isAppLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
  const env = getEnv();
  const [comparison, common, t] = await Promise.all([
    COMPARISONS[product](locale),
    getTranslations("compare.common"),
    getTranslations("marketing"),
  ]);
  const { name } = comparison;
  const alternative: ComparedProduct =
    product === "splitwise" ? "tricount" : "splitwise";

  // The canonical copy of this page, which is the project's own site whatever
  // instance is serving it — see `OFFICIAL_ORIGIN`. The structured data names
  // the same origin the canonical tag does, so the two cannot describe
  // different pages.
  const origin = publicOrigin(product, env.appOrigin);
  const url = publicUrl(product, locale, env.appOrigin);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": url,
        url,
        name: comparison.meta.title,
        description: comparison.meta.description,
        inLanguage: locale,
        dateModified: COMPARISON_REVIEWED,
        isPartOf: { "@id": `${origin}/#website` },
        about: { "@id": `${origin}/#software` },
        mentions: {
          "@type": "SoftwareApplication",
          name,
          applicationCategory: "FinanceApplication",
        },
        publisher: { "@id": `${origin}/#publisher` },
        breadcrumb: { "@id": `${url}#breadcrumb` },
      },
      publisherGraph(origin),
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Balancia",
            item: publicUrl("home", locale, origin),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: comparison.eyebrow,
            item: url,
          },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: locale,
        mainEntity: comparison.faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };

  const page = (
    <MarketingShell page={product}>
      <JsonLd data={jsonLd} />

      <main>
        <section className="bg-marketing-plum px-6 pt-[clamp(48px,6vw,88px)] pb-[clamp(56px,7vw,96px)] text-marketing-cream">
          <div className="mx-auto w-full max-w-[860px]">
            <Eyebrow>{comparison.eyebrow}</Eyebrow>
            <h1 className="mt-[18px] text-[clamp(34px,4.6vw,56px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
              {comparison.title}
              <span className="font-editorial mt-1.5 block text-primary">
                {comparison.titleAccent}
              </span>
            </h1>
            <p className="mt-6 max-w-[62ch] text-[19px] leading-[1.6] text-pretty text-marketing-dark-muted">
              {comparison.lead}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={env.ALLOW_REGISTRATION ? "/register" : "/sign-in"}
                className={`${PRIMARY_BUTTON} h-[52px] text-base`}
                {...track({
                  name: env.ALLOW_REGISTRATION ? "signup" : "sign-in",
                  at: "hero",
                })}
              >
                {env.ALLOW_REGISTRATION
                  ? t("hero.createAccount")
                  : t("header.signIn")}
                <ArrowIcon />
              </Link>
              {env.DEMO_URL && (
                <a
                  href={env.DEMO_URL}
                  className={`${DARK_OUTLINE_BUTTON} h-[52px] text-base`}
                  {...track({ name: "demo", at: "hero" })}
                >
                  {t("hero.tryDemo")}
                </a>
              )}
              <a
                href={GITHUB}
                target="_blank"
                rel="noreferrer"
                className={`${DARK_OUTLINE_BUTTON} h-[52px] text-base`}
                {...track({ name: "source", at: "hero" })}
              >
                <GithubMark className="size-[17px]" />
                {t("hero.readSource")}
              </a>
            </div>
            {/* The date is on the page, where the claims are, rather than only
                in the markup: a comparison is true as of a day, and a reader
                deserves to know which. */}
            <p className="mt-7 max-w-[70ch] border-t border-white/12 pt-5 text-sm leading-[1.6] text-marketing-dark-dim">
              {comparison.checked}
            </p>
          </div>
        </section>

        <section className="bg-marketing-cream px-6 py-[clamp(56px,7vw,88px)]">
          <div className="mx-auto w-full max-w-[1120px]">
            <h2 className="text-[clamp(26px,3vw,36px)] leading-[1.12] font-semibold tracking-[-0.03em]">
              {common("shortAnswer")}
            </h2>
            <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5">
              <article className="rounded-[18px] bg-card p-6 shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.09)]">
                <h3 className="text-lg font-semibold">
                  {common("chooseBalancia")}
                </h3>
                <p className="mt-2.5 text-[15.5px] leading-[1.62] text-pretty text-muted-foreground">
                  {comparison.verdict.balancia}
                </p>
              </article>
              <article className="rounded-[18px] bg-marketing-soft p-6 shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.09)]">
                <h3 className="text-lg font-semibold">
                  {common("chooseOther", { name })}
                </h3>
                <p className="mt-2.5 text-[15.5px] leading-[1.62] text-pretty text-muted-foreground">
                  {comparison.verdict.other}
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="border-t bg-marketing-cream-deep px-6 py-[clamp(56px,7vw,88px)]">
          <div className="mx-auto w-full max-w-[1120px]">
            <h2 className="text-[clamp(26px,3vw,36px)] leading-[1.12] font-semibold tracking-[-0.03em]">
              {common("tableTitle", { name })}
            </h2>
            {/* A real table, because that is what it is, and because a table
                is the one shape every crawler lifts intact. On a phone three
                columns do not fit, so each row stands as a block there and
                every answer carries its product's name above it, the header
                row being out of sight. */}
            <div className="mt-8 overflow-hidden rounded-[20px] bg-card shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.1)]">
              <table className="block w-full border-collapse text-left md:table">
                <thead className="sr-only md:not-sr-only md:table-header-group">
                  <tr className="text-[11px] font-semibold tracking-[0.06em] uppercase">
                    <th
                      scope="col"
                      className="w-[26%] bg-marketing-soft px-[18px] py-3.5 text-muted-foreground"
                    >
                      {common("question")}
                    </th>
                    <th
                      scope="col"
                      className="w-[37%] px-[18px] py-3.5 text-marketing-label"
                    >
                      Balancia
                    </th>
                    <th
                      scope="col"
                      className="w-[37%] bg-marketing-soft px-[18px] py-3.5 text-muted-foreground"
                    >
                      {name}
                    </th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {comparison.rows.map((row) => (
                    <tr
                      key={row.key}
                      className="block border-t first:border-t-0 md:table-row md:first:border-t"
                    >
                      <th
                        scope="row"
                        className="block bg-marketing-soft px-[18px] pt-4 pb-3 text-[15px] font-semibold md:table-cell md:py-4 md:align-top"
                      >
                        {row.question}
                      </th>
                      <td className="block px-[18px] py-3.5 text-[14.5px] leading-[1.55] md:table-cell md:py-4 md:align-top">
                        <span className="mb-1 block text-[11px] font-semibold tracking-[0.06em] text-marketing-label uppercase md:hidden">
                          Balancia
                        </span>
                        {row.balancia}
                      </td>
                      <td className="block bg-marketing-soft px-[18px] pt-3.5 pb-4 text-[14.5px] leading-[1.55] text-muted-foreground md:table-cell md:py-4 md:align-top">
                        <span className="mb-1 block text-[11px] font-semibold tracking-[0.06em] uppercase md:hidden">
                          {name}
                        </span>
                        {row.other}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="border-t bg-marketing-cream px-6 py-[clamp(56px,7vw,88px)]">
          <div className="mx-auto w-full max-w-[1120px]">
            {comparison.sections.map((section) => (
              <div
                key={section.key}
                className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-12 gap-y-4 border-t py-10 first:border-t-0 first:pt-0 last:pb-0"
              >
                <h2 className="text-[clamp(22px,2.4vw,28px)] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">
                  {section.title}
                </h2>
                <div className="space-y-4 text-base leading-[1.65] text-pretty text-muted-foreground">
                  {section.steps && (
                    <ol className="space-y-3 text-foreground">
                      {section.steps.map((step, index) => (
                        <li
                          key={step}
                          className="flex items-start gap-3 text-[15px]"
                        >
                          <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                            {index + 1}
                          </span>
                          <span className="pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t bg-marketing-cream px-6 py-[clamp(56px,7vw,88px)]">
          <div className="mx-auto w-full max-w-[900px]">
            <h2 className="text-[clamp(26px,3vw,36px)] leading-[1.12] font-semibold tracking-[-0.03em]">
              {common("faqTitle")}
            </h2>
            <div className="mt-8">
              {comparison.faq.map(({ key, question, answer }) => (
                <details key={key} className="group border-t last:border-b">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 text-[17px] font-medium">
                    {question}
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-xl font-medium text-primary transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mb-5 max-w-[68ch] text-[15.5px] leading-[1.65] text-pretty text-muted-foreground">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-marketing-cream-deep px-6 py-[clamp(44px,5vw,64px)]">
          <div className="mx-auto w-full max-w-[900px] text-[13.5px] leading-[1.65] text-muted-foreground">
            <h2 className="text-xs font-semibold tracking-[0.06em] uppercase">
              {common("sourcesTitle")}
            </h2>
            <p className="mt-3">{comparison.sourcesIntro}</p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
              {comparison.sources.map((source) => (
                <li key={source.href}>
                  {/* `nofollow` is not here on purpose. These are the pages
                      the claims above rest on; a link that vouches for its
                      source is the point of citing one. */}
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-marketing-link underline decoration-marketing-link/40 underline-offset-4 transition-colors hover:text-marketing-link-hover"
                  >
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 max-w-[80ch]">{comparison.trademark}</p>
            <p className="mt-4">
              {common("alsoSee")}{" "}
              <Link
                href={publicPath(alternative, locale)}
                className={`${TEXT_LINK} text-[13.5px]`}
                {...track({
                  name: "comparison",
                  with: alternative,
                  at: "comparison",
                })}
              >
                {t(`footer.links.${alternative}`)}
                <ArrowIcon />
              </Link>
            </p>
          </div>
        </section>

        <section className="bg-marketing-plum px-6 py-[clamp(64px,8vw,100px)] text-marketing-cream">
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-[clamp(28px,4vw,56px)]">
            <div>
              <h2 className="text-[clamp(30px,3.6vw,44px)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
                {t("cta.title")}
                <span className="font-editorial mt-1.5 block text-primary">
                  {t("cta.titleAccent")}
                </span>
              </h2>
              <p className="mt-5 max-w-[44ch] text-[17px] leading-[1.6] text-marketing-dark-muted">
                {t("cta.body")}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3.5">
              {env.ALLOW_REGISTRATION ? (
                <Link
                  href="/register"
                  className={`${PRIMARY_BUTTON} h-[54px] text-[17px]`}
                  {...track({ name: "signup", at: "closing" })}
                >
                  {t("cta.createAccount")}
                  <ArrowRight aria-hidden="true" className="size-[18px]" />
                </Link>
              ) : (
                <p className="max-w-[52ch] text-[15px] leading-[1.6] text-marketing-dark-muted">
                  {t("cta.registrationClosed")}
                </p>
              )}
              {env.DEMO_URL && (
                <a
                  href={env.DEMO_URL}
                  className="text-[15px] text-marketing-dark-trust no-underline transition-colors hover:text-marketing-cream"
                  {...track({ name: "demo", at: "closing" })}
                >
                  {t("cta.tryDemo")}
                </a>
              )}
              <Link
                href="/sign-in"
                className="text-[15px] text-marketing-dark-trust no-underline transition-colors hover:text-marketing-cream"
                {...track({ name: "sign-in", at: "closing" })}
              >
                {t("cta.haveAccount")}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );

  // The page is the server's work throughout; the browser needs only the
  // language menu's strings, which the marketing area carries.
  return <AreaMessages area="marketing">{page}</AreaMessages>;
}
