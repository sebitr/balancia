import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { InstallCopyButton, SplitDemo } from "@/components/marketing/SplitDemo";
import { INSTALL_COMMANDS } from "@/components/marketing/install-commands";
import { homeQuestions } from "@/components/marketing/questions";
import {
  ArrowIcon,
  DARK_OUTLINE_BUTTON,
  Eyebrow,
  GITHUB,
  GITHUB_BLOB,
  GithubMark,
  JsonLd,
  MarketingShell,
  PRIMARY_BUTTON,
  TEXT_LINK,
} from "@/components/marketing/shell";
import { AreaMessages } from "@/i18n/area-messages";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locales";
import { resolvePreferredLocale } from "@/i18n/request";
import { track } from "@/lib/analytics/events";
import { publicPageAnalytics } from "@/lib/analytics/umami";
import { getEnv } from "@/lib/env";
import { publicPath, publicUrl } from "@/lib/public-pages";
import {
  publicPageMetadata,
  publisherGraph,
} from "@/components/marketing/metadata";
import { getCurrentUser } from "@/lib/security/actor";
import { appVersion } from "@/lib/telemetry/environment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("marketing.meta");

  return {
    ...(await publicPageMetadata({
      page: "home",
      title: t("title"),
      description: t("description"),
    })),
    keywords: [
      "shared expense tracker",
      "split expenses with friends",
      "self-hosted Splitwise alternative",
      "self-hosted tricount alternative",
      "open-source expense splitter",
      "multi-currency expense sharing",
      "roommate expense tracker",
    ],
  };
}

export default async function LandingPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  const env = getEnv();

  // A demo instance has no marketing to do. Whoever opened it followed a "Try
  // the demo" link that already made the pitch, and the page they want is one
  // click further on — so spend that click for them. The real instance keeps
  // its homepage, which is the only place this page was ever aimed at.
  if (env.DEMO_MODE) redirect("/sign-in");
  const [t, analytics, requestLocale, preferredLocale] = await Promise.all([
    getTranslations("marketing"),
    publicPageAnalytics(),
    getLocale(),
    resolvePreferredLocale(),
  ]);
  const locale = isAppLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;

  // `/` is English, and it is also where somebody who typed the name arrives
  // — so a reader whose cookie or browser asks for a language Balancia has is
  // sent on to that language's own address, where this used to answer them in
  // it on the spot. The words did not change for them; what changed is that
  // the French ones now have a URL a search engine can be given. A crawler
  // states no preference and reads the English page here, which is the page
  // this address is indexed as.
  if (locale === DEFAULT_LOCALE && preferredLocale !== DEFAULT_LOCALE) {
    redirect(publicPath("home", preferredLocale));
  }

  const features = [
    ["01", t("features.items.splits.title"), t("features.items.splits.body")],
    ["02", t("features.items.payers.title"), t("features.items.payers.body")],
    [
      "03",
      t("features.items.currency.title"),
      t("features.items.currency.body"),
    ],
    [
      "04",
      t("features.items.passkeys.title"),
      t("features.items.passkeys.body"),
    ],
    [
      "05",
      t("features.items.receipts.title"),
      t("features.items.receipts.body"),
    ],
    [
      "06",
      t("features.items.recurring.title"),
      t("features.items.recurring.body"),
    ],
    [
      "07",
      t("features.items.repayments.title"),
      t("features.items.repayments.body"),
    ],
  ];

  const useCases = [
    [t("useCases.items.trip.title"), t("useCases.items.trip.body")],
    [t("useCases.items.flat.title"), t("useCases.items.flat.body")],
    [t("useCases.items.partner.title"), t("useCases.items.partner.body")],
    [t("useCases.items.event.title"), t("useCases.items.event.body")],
    [t("useCases.items.ownership.title"), t("useCases.items.ownership.body")],
    [t("useCases.items.club.title"), t("useCases.items.club.body")],
  ];

  const comparisonRows = [
    [t("comparison.rows.hosting.before"), t("comparison.rows.hosting.after")],
    [t("comparison.rows.features.before"), t("comparison.rows.features.after")],
    [t("comparison.rows.accounts.before"), t("comparison.rows.accounts.after")],
    [t("comparison.rows.export.before"), t("comparison.rows.export.after")],
  ];

  // What an assistant is told in the example below. The exchange is an
  // illustration, so it says so in its caption; the names and the group are
  // the ones the demo above already uses.
  const conversation = [
    ["you", t("assistants.chat.ask")],
    ["assistant", t("assistants.chat.answer")],
    ["you", t("assistants.chat.add")],
    ["assistant", t("assistants.chat.added")],
  ] as const;

  const faqItems = homeQuestions(env.agentAccessEnabled).map((key) => ({
    key,
    question: t(`faq.items.${key}.question`),
    answer: t(`faq.items.${key}.answer`),
  }));

  // The page speaks for the instance it is served from: where an
  // administrator has switched assistants off, `/mcp` answers 404, and the
  // section, the question and the structured data's feature all go with it.
  const featureList = [
    t("seo.features.splits"),
    t("seo.features.payers"),
    t("seo.features.currency"),
    t("seo.features.recurring"),
    t("seo.features.income"),
    t("seo.features.settlements"),
    t("seo.features.guests"),
    t("seo.features.import"),
    t("seo.features.export"),
    t("seo.features.receipts"),
    ...(env.agentAccessEnabled ? [t("seo.features.assistants")] : []),
    t("seo.features.selfHost"),
  ];
  const installNotes = [
    t("selfHosting.install.steps.1"),
    t("selfHosting.install.steps.2"),
  ];

  // The software is one thing however many pages describe it and in however
  // many languages, so it has one identifier — on this instance's origin,
  // which is the copy being described. The page-level entries below are this
  // address's own.
  const softwareId = `${env.appOrigin}/#software`;
  const pageUrl = publicUrl("home", locale, env.appOrigin);
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": softwareId,
        name: "Balancia",
        alternateName: t("seo.alternateName"),
        applicationCategory: "FinanceApplication",
        applicationSubCategory: t("seo.applicationSubCategory"),
        operatingSystem: t("seo.operatingSystem"),
        description: t("seo.description"),
        url: pageUrl,
        // Where else this same software is described. An engine deciding
        // whether two mentions of "Balancia" are one thing looks here first.
        sameAs: [GITHUB],
        codeRepository: GITHUB,
        softwareVersion: appVersion(),
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "EUR",
          description: t("seo.offerDescription"),
        },
        featureList,
        keywords: t("seo.keywords"),
        audience: {
          "@type": "Audience",
          audienceType: t("seo.audience"),
        },
        publisher: { "@id": `${env.appOrigin}/#publisher` },
        inLanguage: locale,
      },
      publisherGraph(env.appOrigin),
      {
        "@type": "WebSite",
        "@id": `${env.appOrigin}/#website`,
        name: "Balancia",
        alternateName: t("seo.alternateName"),
        url: env.appOrigin,
        description: t("meta.description"),
        publisher: { "@id": `${env.appOrigin}/#publisher` },
        inLanguage: locale,
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        inLanguage: locale,
        about: { "@id": softwareId },
        mainEntity: faqItems.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };

  const page = (
    <MarketingShell page="home">
      <JsonLd data={jsonLd} />

      <main>
        <section
          id="top"
          className="bg-marketing-plum px-6 pt-[clamp(56px,7vw,104px)] pb-[clamp(64px,8vw,112px)] text-marketing-cream"
        >
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-center gap-[clamp(32px,5vw,72px)]">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.1em] text-primary uppercase">
                <span className="marketing-pulse-slow size-1.5 rounded-full bg-primary" />
                {t("hero.eyebrow")}
              </p>
              <h1 className="mt-[18px] text-[clamp(40px,5.4vw,68px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
                {t("hero.titleLine1")} {t("hero.titleLine2")}
                <span className="font-editorial mt-1.5 block text-primary">
                  {t("hero.titleAccent")}
                </span>
              </h1>
              <p className="mt-6 max-w-[52ch] text-[19px] leading-[1.6] text-pretty text-marketing-dark-muted">
                {t("hero.lead")}
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
                {/* Second, not first: the demo is the low-commitment way in,
                    but an account is still what the page is asking for. */}
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
              <p className="mt-[18px] text-sm text-marketing-dark-dim">
                {t("hero.reassurance")}
              </p>
              {/* For the reader the button above does nothing for. The
                  header's link sits squeezed beside that button and the
                  closing section's is a page away; this one is where the
                  choice is being made. With registration closed the button
                  itself is "Sign in", and the line would only repeat it. */}
              {env.ALLOW_REGISTRATION && (
                <p className="mt-2.5 text-sm text-marketing-dark-muted">
                  {t("hero.haveAccount")}{" "}
                  <Link
                    href="/sign-in"
                    className="font-semibold text-marketing-cream underline decoration-white/40 underline-offset-4 transition-colors hover:decoration-marketing-cream"
                    {...track({ name: "sign-in", at: "hero" })}
                  >
                    {t("header.signIn")}
                  </Link>
                </p>
              )}
              <ul className="mt-9 flex flex-wrap gap-x-[26px] gap-y-2.5 border-t border-white/12 pt-[22px] text-sm text-marketing-dark-trust">
                {[
                  t("hero.trust.noAds"),
                  t("hero.trust.noPaywall"),
                  t("hero.trust.guests"),
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="size-[5px] rounded-full bg-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <SplitDemo />
          </div>
        </section>

        <section className="bg-marketing-cream px-6 py-[clamp(72px,9vw,116px)]">
          <div className="mx-auto w-full max-w-[1120px]">
            <Eyebrow>{t("features.eyebrow")}</Eyebrow>
            <h2 className="mt-3 max-w-[20ch] text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
              {t("features.title")}
            </h2>
            <ol className="mt-11 grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-12">
              {features.map(([number, title, body]) => (
                <li
                  key={number}
                  className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t py-[26px]"
                >
                  <span className="pt-1 font-mono text-xs text-marketing-link">
                    {number}
                  </span>
                  <div>
                    <h3 className="text-[17px] font-semibold">{title}</h3>
                    <p className="mt-1 text-[15px] leading-[1.6] text-pretty text-muted-foreground">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t bg-marketing-cream px-6 py-[clamp(72px,9vw,116px)]">
          <div className="mx-auto w-full max-w-[1120px]">
            <Eyebrow>{t("useCases.eyebrow")}</Eyebrow>
            <h2 className="mt-3 max-w-[24ch] text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
              {t("useCases.title")}
            </h2>
            <p className="mt-5 max-w-[58ch] text-[17px] leading-[1.6] text-pretty text-muted-foreground">
              {t("useCases.intro")}
            </p>
            <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(290px,100%),1fr))] gap-5">
              {useCases.map(([title, body]) => (
                <article
                  key={title}
                  className="rounded-[18px] bg-card p-6 shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.09)]"
                >
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2.5 text-[15px] leading-[1.62] text-pretty text-muted-foreground">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t bg-marketing-cream-deep px-6 py-[clamp(72px,9vw,116px)]">
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-[clamp(32px,5vw,64px)]">
            <div>
              <Eyebrow>{t("comparison.eyebrow")}</Eyebrow>
              <h2 className="mt-3 text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
                {t("comparison.title")}
              </h2>
              <p className="mt-5 max-w-[48ch] text-[17px] leading-[1.6] text-pretty text-muted-foreground">
                {t("comparison.body")}
              </p>
              <ol className="mt-7 space-y-3.5">
                {[
                  t("comparison.steps.upload"),
                  t("comparison.steps.preview"),
                  t("comparison.steps.map"),
                ].map((step, index) => (
                  <li key={step} className="flex items-start gap-3 text-[15px]">
                    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                      {index + 1}
                    </span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <a
                href={`${GITHUB_BLOB}/docs/data-migration.md`}
                target="_blank"
                rel="noreferrer"
                className={`${TEXT_LINK} mt-7 text-sm`}
              >
                {t("comparison.link")}
                <ArrowIcon />
              </a>
              {/* Beside the import guide rather than instead of it: one is
                  for somebody who has decided, the other for somebody still
                  deciding — and this one stays on the site, which is how a
                  crawler reaches the comparison from the page it trusts
                  most. */}
              <Link
                href={publicPath("splitwise", locale)}
                className={`${TEXT_LINK} mt-3 flex w-fit text-sm`}
                {...track({
                  name: "comparison",
                  with: "splitwise",
                  at: "comparison",
                })}
              >
                {t("comparison.compareLink")}
                <ArrowIcon />
              </Link>
            </div>
            <div className="grid grid-cols-1 overflow-hidden rounded-[20px] bg-card shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.1)] min-[721px]:grid-cols-2">
              {comparisonRows.flatMap(([before, after], index) => [
                <div
                  key={`before-${index}`}
                  className="bg-marketing-soft px-[18px] py-4 text-[14.5px] leading-[1.5] text-muted-foreground"
                >
                  <p className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase">
                    {t("comparison.beforeLabel")}
                  </p>
                  {before}
                </div>,
                <div
                  key={`after-${index}`}
                  className="bg-card px-[18px] py-4 text-[14.5px] leading-[1.5]"
                >
                  <p className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-marketing-label uppercase">
                    {t("comparison.afterLabel")}
                  </p>
                  {after}
                </div>,
              ])}
            </div>
          </div>
        </section>

        {env.agentAccessEnabled && (
          <section className="border-t bg-marketing-cream px-6 py-[clamp(72px,9vw,116px)]">
            <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-center gap-[clamp(32px,5vw,64px)]">
              <div>
                <Eyebrow>{t("assistants.eyebrow")}</Eyebrow>
                <h2 className="mt-3 text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
                  {t("assistants.title")}
                </h2>
                <p className="mt-5 max-w-[50ch] text-[17px] leading-[1.6] text-pretty text-muted-foreground">
                  {t("assistants.body")}
                </p>
                <ul className="mt-7 space-y-3">
                  {[
                    t("assistants.control.access"),
                    t("assistants.control.scope"),
                    t("assistants.control.disconnect"),
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-3 text-[15px]"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[9px] size-[5px] shrink-0 rounded-full bg-primary"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
                <a
                  href={`${GITHUB_BLOB}/docs/ai-agents.md`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${TEXT_LINK} mt-7 text-sm`}
                >
                  {t("assistants.link")}
                  <ArrowIcon />
                </a>
              </div>
              <figure className="overflow-hidden rounded-[20px] bg-card shadow-[0_0_0_1px_oklch(0.226_0.072_319_/_0.1)]">
                <ol className="space-y-3 p-5 sm:p-6">
                  {conversation.map(([who, text]) => (
                    <li
                      key={text}
                      className={`flex ${who === "you" ? "justify-end" : "justify-start"}`}
                    >
                      <p
                        className={`max-w-[88%] rounded-[18px] px-4 py-3 text-[15px] leading-[1.55] ${
                          who === "you"
                            ? "rounded-br-[6px] bg-marketing-plum text-marketing-cream"
                            : "rounded-bl-[6px] bg-marketing-soft"
                        }`}
                      >
                        <span className="sr-only">
                          {t(`assistants.chat.${who}`)}:{" "}
                        </span>
                        {text}
                      </p>
                    </li>
                  ))}
                </ol>
                <figcaption className="border-t px-5 py-3.5 text-[13px] leading-[1.5] text-pretty text-muted-foreground sm:px-6">
                  {t("assistants.chat.caption")}
                </figcaption>
              </figure>
            </div>
          </section>
        )}

        <section className="bg-marketing-plum px-6 py-[clamp(72px,9vw,116px)] text-marketing-cream">
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-[clamp(32px,5vw,64px)]">
            <div>
              <Eyebrow>{t("selfHosting.eyebrow")}</Eyebrow>
              <h2 className="mt-3 text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">
                {t("selfHosting.title")}
              </h2>
              <p className="mt-5 max-w-[50ch] text-[17px] leading-[1.6] text-pretty text-marketing-dark-muted">
                {analytics
                  ? t("selfHosting.bodyAnalytics")
                  : t("selfHosting.body")}
              </p>
              <p className="mt-5 max-w-[50ch] text-[17px] leading-[1.6] text-pretty text-marketing-dark-muted">
                {t("selfHosting.exportBody")}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href={`${GITHUB_BLOB}/docs/self-hosting.md`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${PRIMARY_BUTTON} h-[46px] text-sm`}
                  {...track({ name: "self-hosting-guide", at: "self-hosting" })}
                >
                  {t("selfHosting.guide")}
                </a>
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noreferrer"
                  className={`${DARK_OUTLINE_BUTTON} h-[46px] text-sm`}
                  {...track({ name: "source", at: "self-hosting" })}
                >
                  <GithubMark />
                  github.com/sebitr/balancia
                </a>
              </div>
            </div>
            <div>
              <div className="overflow-hidden rounded-[18px] border border-white/12 bg-marketing-plum-raised">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
                  <p className="text-xs font-semibold tracking-[0.06em] text-marketing-dark-dim uppercase">
                    {t("selfHosting.install.title")}
                  </p>
                  <InstallCopyButton />
                </div>
                <ol>
                  {INSTALL_COMMANDS.map((command, index) => (
                    <li
                      key={command}
                      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-white/8 px-4 py-[13px] last:border-b-0"
                    >
                      <span className="font-mono text-[13px] text-primary">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <code className="marketing-command-scroll block overflow-x-auto font-mono text-[13px] whitespace-nowrap text-marketing-cream">
                          {command}
                        </code>
                        <p className="mt-1 text-[12.5px] text-marketing-dark-dim">
                          {installNotes[index]}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <dl className="mt-5 overflow-hidden rounded-[14px] border border-white/10">
                {[
                  [t("selfHosting.facts.license"), "AGPL-3.0-or-later"],
                  [
                    t("selfHosting.facts.runtime"),
                    t("selfHosting.facts.runtimeValue"),
                  ],
                  [
                    t("selfHosting.facts.services"),
                    t("selfHosting.facts.servicesValue"),
                  ],
                  [
                    t("selfHosting.facts.telemetry"),
                    t("selfHosting.facts.telemetryValue"),
                  ],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between gap-4 px-4 py-3 text-sm ${index > 0 ? "border-t border-white/10" : ""}`}
                  >
                    <dt className="text-marketing-dark-dim">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-[13.5px] leading-[1.6] text-pretty text-marketing-dark-dim">
                {t("selfHosting.licenseNote")}
              </p>
            </div>
          </div>
        </section>

        <section className="border-b bg-marketing-cream px-6 py-[clamp(64px,8vw,96px)]">
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-8">
            <div>
              <Eyebrow>{t("status.eyebrow")}</Eyebrow>
              <h2 className="mt-3 text-[clamp(24px,2.6vw,32px)] leading-[1.15] font-semibold tracking-[-0.03em]">
                {t("status.title")}
              </h2>
            </div>
            <div>
              <p className="text-base leading-[1.6] text-pretty text-muted-foreground">
                {t("status.body")}
              </p>
              <a
                href={`${GITHUB_BLOB}/docs/implementation-status.md`}
                target="_blank"
                rel="noreferrer"
                className={`${TEXT_LINK} mt-5 text-sm`}
              >
                {t("status.link")}
                <ArrowIcon />
              </a>
            </div>
          </div>
        </section>

        <section className="bg-marketing-cream px-6 py-[clamp(72px,9vw,116px)]">
          <div className="mx-auto w-full max-w-[900px]">
            <Eyebrow>{t("faq.eyebrow")}</Eyebrow>
            <h2 className="mt-3 text-[clamp(30px,3.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.03em]">
              {t("faq.title")}
            </h2>
            <div className="mt-10">
              {faqItems.map(({ key, question, answer }) => (
                <details key={key} className="group border-t last:border-b">
                  <summary
                    className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 text-[17px] font-medium"
                    {...track({ name: "faq", question: key })}
                  >
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

        <section className="bg-marketing-plum px-6 py-[clamp(72px,9vw,112px)] text-marketing-cream">
          <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-[clamp(28px,4vw,56px)]">
            <div>
              <h2 className="text-[clamp(32px,4vw,48px)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance">
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
              <div className="mt-3 w-full border-t border-white/12 pt-[18px]">
                <p className="text-sm text-marketing-dark-dim">
                  {t("cta.contributorBody")}
                </p>
                <a
                  href={`${GITHUB_BLOB}/CONTRIBUTING.md`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${DARK_OUTLINE_BUTTON} mt-3 h-[42px] rounded-[11px] text-sm`}
                  {...track({ name: "source", at: "closing" })}
                >
                  <GithubMark />
                  {t("cta.contribute")}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );

  // Everything above renders here, on the server, so the browser needs only
  // the strings of the demo, the install block and the language menu — and no
  // other page needs those.
  return <AreaMessages area="marketing">{page}</AreaMessages>;
}
