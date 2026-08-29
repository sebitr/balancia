import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { UmamiScript } from "@/components/analytics/umami-script";
import { Wordmark } from "@/components/brand/wordmark";
import { MarketingLanguageSwitcher } from "@/components/i18n/language-switcher";
import { InstallCopyButton, SplitDemo } from "@/components/marketing/SplitDemo";
import { INSTALL_COMMANDS } from "@/components/marketing/install-commands";
import { publicPageAnalytics } from "@/lib/analytics/umami";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";

const GITHUB = "https://github.com/sebitr/balancia";
const GITHUB_BLOB = `${GITHUB}/blob/main`;

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2.5 rounded-[13px] bg-primary px-6 font-semibold text-primary-foreground no-underline transition-colors hover:bg-marketing-primary-hover";
const DARK_OUTLINE_BUTTON =
  "inline-flex items-center justify-center gap-2.5 rounded-[13px] border border-white/22 px-[22px] font-medium text-marketing-cream no-underline transition-colors hover:bg-white/8";
const TEXT_LINK =
  "inline-flex items-center gap-1.5 font-semibold text-marketing-link no-underline transition-colors hover:text-marketing-link-hover";

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.1em] text-primary uppercase">
      {children}
    </p>
  );
}

function ArrowIcon() {
  return <ArrowRight aria-hidden="true" className="size-[17px]" />;
}

function GithubMark({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8Z" />
    </svg>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([
    getTranslations("marketing.meta"),
    getLocale(),
  ]);
  const env = getEnv();
  const title = t("title");
  const description = t("description");
  const isFrench = locale === "fr";
  const socialTitle = isFrench ? title : `${title} · Balancia`;
  const socialImage = new URL("/icons/icon-512.png", env.appOrigin).toString();

  return {
    title: isFrench ? { absolute: title } : title,
    description,
    alternates: { canonical: env.appOrigin },
    keywords: [
      "shared expense tracker",
      "split expenses with friends",
      "self-hosted Splitwise alternative",
      "self-hosted tricount alternative",
      "open-source expense splitter",
      "multi-currency expense sharing",
      "roommate expense tracker",
    ],
    openGraph: {
      type: "website",
      url: env.appOrigin,
      siteName: "Balancia",
      locale: isFrench ? "fr_FR" : "en_US",
      title: socialTitle,
      description,
      ...(isFrench
        ? {
            images: [
              {
                url: socialImage,
                width: 512,
                height: 512,
                alt: "Balancia",
                type: "image/png",
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: isFrench ? "summary" : "summary_large_image",
      title: socialTitle,
      description,
      ...(isFrench ? { images: [socialImage] } : {}),
    },
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

export default async function LandingPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  const env = getEnv();

  // A demo instance has no marketing to do. Whoever opened it followed a "Try
  // the demo" link that already made the pitch, and the page they want is one
  // click further on — so spend that click for them. The real instance keeps
  // its homepage, which is the only place this page was ever aimed at.
  if (env.DEMO_MODE) redirect("/sign-in");
  const [t, analytics, locale] = await Promise.all([
    getTranslations("marketing"),
    publicPageAnalytics(),
    getLocale(),
  ]);

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

  const defaultFaqItems = [
    [t("faq.items.free.question"), t("faq.items.free.answer")],
    [t("faq.items.accounts.question"), t("faq.items.accounts.answer")],
    [t("faq.items.export.question"), t("faq.items.export.answer")],
    [t("faq.items.currency.question"), t("faq.items.currency.answer")],
    [t("faq.items.privacy.question"), t("faq.items.privacy.answer")],
    [t("faq.items.selfHost.question"), t("faq.items.selfHost.answer")],
  ];
  const frenchFaqItems = [
    [t("faq.items.free.question"), t("faq.items.free.answer")],
    [t("faq.items.accounts.question"), t("faq.items.accounts.answer")],
    [t("faq.items.sharing.question"), t("faq.items.sharing.answer")],
    [t("faq.items.unequal.question"), t("faq.items.unequal.answer")],
    [t("faq.items.currency.question"), t("faq.items.currency.answer")],
    [t("faq.items.splitwise.question"), t("faq.items.splitwise.answer")],
    [t("faq.items.openSource.question"), t("faq.items.openSource.answer")],
    [t("faq.items.selfHost.question"), t("faq.items.selfHost.answer")],
    [t("faq.items.devices.question"), t("faq.items.devices.answer")],
    [t("faq.items.comparison.question"), t("faq.items.comparison.answer")],
  ];
  const faqItems = locale === "fr" ? frenchFaqItems : defaultFaqItems;

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
    t("seo.features.selfHost"),
  ];
  const installNotes = [
    t("selfHosting.install.steps.1"),
    t("selfHosting.install.steps.2"),
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${env.appOrigin}/#software`,
        name: "Balancia",
        alternateName: t("seo.alternateName"),
        applicationCategory: "FinanceApplication",
        applicationSubCategory: t("seo.applicationSubCategory"),
        operatingSystem: t("seo.operatingSystem"),
        description: t("seo.description"),
        url: env.appOrigin,
        codeRepository: GITHUB,
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
        inLanguage: locale,
      },
      {
        "@type": "WebSite",
        "@id": `${env.appOrigin}/#website`,
        name: "Balancia",
        alternateName: t("seo.alternateName"),
        url: env.appOrigin,
        description: t("meta.description"),
        inLanguage: locale,
      },
      {
        "@type": "FAQPage",
        "@id": `${env.appOrigin}/#faq`,
        inLanguage: locale,
        mainEntity: faqItems.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };

  const footerColumns = [
    {
      heading: t("footer.runIt"),
      links: [
        [t("footer.links.selfHosting"), `${GITHUB_BLOB}/docs/self-hosting.md`],
        [t("footer.links.environment"), `${GITHUB_BLOB}/docs/environment.md`],
        [t("footer.links.backup"), `${GITHUB_BLOB}/docs/backup-and-restore.md`],
        [t("footer.links.migration"), `${GITHUB_BLOB}/docs/data-migration.md`],
      ],
    },
    {
      heading: t("footer.buildIt"),
      links: [
        [t("footer.links.architecture"), `${GITHUB_BLOB}/docs/architecture.md`],
        [t("footer.links.development"), `${GITHUB_BLOB}/docs/development.md`],
        [t("footer.links.contributing"), `${GITHUB_BLOB}/CONTRIBUTING.md`],
        [
          t("footer.links.status"),
          `${GITHUB_BLOB}/docs/implementation-status.md`,
        ],
      ],
    },
    {
      heading: t("footer.trustIt"),
      links: [
        [t("footer.links.security"), `${GITHUB_BLOB}/SECURITY.md`],
        [t("footer.links.license"), `${GITHUB_BLOB}/LICENSE`],
        [
          t("footer.links.receiptScanning"),
          `${GITHUB_BLOB}/docs/receipt-scanning.md`,
        ],
        [t("footer.links.source"), GITHUB],
      ],
    },
  ];

  return (
    <div className="marketing-page min-h-dvh bg-background text-foreground">
      <UmamiScript />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-marketing-plum text-marketing-cream">
        <div className="mx-auto flex h-[68px] w-full max-w-[1120px] items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
          <a
            href="#top"
            className="text-marketing-cream no-underline"
            aria-label={t("header.home")}
          >
            <Wordmark
              className="gap-2.5 text-[18px] tracking-[-0.02em]"
              markClassName="size-[26px]"
            />
          </a>
          <nav
            aria-label={t("header.navigation")}
            className="flex items-center gap-1.5 sm:gap-2"
          >
            <MarketingLanguageSwitcher />
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              aria-label={t("header.github")}
              className="inline-flex h-9 items-center gap-[7px] rounded-[10px] px-3 text-sm font-medium text-marketing-cream no-underline transition-colors hover:bg-white/9"
            >
              <GithubMark />
              <span className="hidden min-[721px]:inline">
                {t("header.github")}
              </span>
            </a>
            <Link
              href="/sign-in"
              className="hidden h-9 items-center rounded-[10px] px-3 text-sm font-medium text-marketing-cream no-underline transition-colors hover:bg-white/9 min-[721px]:inline-flex"
            >
              {t("header.signIn")}
            </Link>
            {env.ALLOW_REGISTRATION && (
              <Link
                href="/register"
                className="inline-flex h-11 w-[82px] shrink-0 items-center justify-center rounded-[10px] bg-primary px-2 text-center text-[13px] leading-[1.05] font-semibold text-primary-foreground no-underline transition-colors hover:bg-marketing-primary-hover min-[721px]:h-9 min-[721px]:w-auto min-[721px]:px-3.5 min-[721px]:text-sm min-[721px]:leading-normal"
              >
                {t("header.createAccount")}
              </Link>
            )}
          </nav>
        </div>
      </header>

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
                  >
                    {t("hero.tryDemo")}
                  </a>
                )}
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noreferrer"
                  className={`${DARK_OUTLINE_BUTTON} h-[52px] text-base`}
                >
                  <GithubMark className="size-[17px]" />
                  {t("hero.readSource")}
                </a>
              </div>
              <p className="mt-[18px] text-sm text-marketing-dark-dim">
                {t("hero.reassurance")}
              </p>
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
                >
                  {t("selfHosting.guide")}
                </a>
                <a
                  href={GITHUB}
                  target="_blank"
                  rel="noreferrer"
                  className={`${DARK_OUTLINE_BUTTON} h-[46px] text-sm`}
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
              {faqItems.map(([question, answer]) => (
                <details
                  key={question}
                  className="group border-t last:border-b"
                >
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
                >
                  {t("cta.tryDemo")}
                </a>
              )}
              <Link
                href="/sign-in"
                className="text-[15px] text-marketing-dark-trust no-underline transition-colors hover:text-marketing-cream"
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
                >
                  <GithubMark />
                  {t("cta.contribute")}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-marketing-cream px-6 pt-14 pb-10">
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-8">
            <div>
              <Wordmark markClassName="size-[22px]" />
              <p className="mt-3 text-[13.5px] leading-[1.5] text-muted-foreground">
                {t("footer.taglineLine1")}
                <br />
                {t("footer.taglineLine2")}
              </p>
            </div>
            {footerColumns.map((column) => (
              <div key={column.heading}>
                <h2 className="mb-3 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  {column.heading}
                </h2>
                <ul className="space-y-[9px] text-sm">
                  {column.links.map(([label, href]) => (
                    <li key={href}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-marketing-link no-underline transition-colors hover:text-marketing-link-hover"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t pt-5 text-[13px] text-muted-foreground">
            <span>{t("footer.bottomTagline")}</span>
            <span>{t("footer.bottomLicense")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
