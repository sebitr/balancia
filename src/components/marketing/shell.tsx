import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { UmamiScript } from "@/components/analytics/umami-script";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import { Wordmark } from "@/components/brand/wordmark";
import { MarketingLanguageSwitcher } from "@/components/i18n/language-switcher";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locales";
import { track } from "@/lib/analytics/events";
import { getEnv } from "@/lib/env";
import {
  localePaths,
  publicPath,
  REPOSITORY,
  type PublicPage,
} from "@/lib/public-pages";

/**
 * What every public page stands in: the plum header, the footer, the page
 * counter, and the handful of pieces the pages share.
 *
 * It was the top and bottom of the homepage until there was a second page.
 * It is also the one place the tracker is mounted for these pages, which is
 * why `umami-script.test.tsx` checks who imports this file as closely as it
 * checks who imports the tracker.
 */

export const GITHUB = REPOSITORY;
export const GITHUB_BLOB = `${GITHUB}/blob/main`;

export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2.5 rounded-[13px] bg-primary px-6 font-semibold text-primary-foreground no-underline transition-colors hover:bg-marketing-primary-hover";
export const DARK_OUTLINE_BUTTON =
  "inline-flex items-center justify-center gap-2.5 rounded-[13px] border border-white/22 px-[22px] font-medium text-marketing-cream no-underline transition-colors hover:bg-white/8";
export const TEXT_LINK =
  "inline-flex items-center gap-1.5 font-semibold text-marketing-link no-underline transition-colors hover:text-marketing-link-hover";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-[0.1em] text-primary uppercase">
      {children}
    </p>
  );
}

export function ArrowIcon() {
  return <ArrowRight aria-hidden="true" className="size-[17px]" />;
}

export function GithubMark({ className = "size-4" }: { className?: string }) {
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

/**
 * A script of structured data. `<` is escaped so that no string in it — a
 * translated answer, say — can close the tag it is printed inside.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

export async function MarketingShell({
  page,
  children,
}: {
  page: PublicPage;
  children: ReactNode;
}) {
  const [t, requestLocale] = await Promise.all([
    getTranslations("marketing"),
    getLocale(),
  ]);
  const env = getEnv();
  const locale = isAppLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE;
  const home = publicPath("home", locale);

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

  // No message provider here, though this renders the language menu: the
  // page mounts it, around the shell. `client-messages.test.ts` finds a
  // Client Component's provider by walking up its imports, and the demo is
  // imported by the homepage, not by this file.
  return (
    <div className="marketing-page min-h-dvh bg-background text-foreground">
      <UmamiScript />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-marketing-plum text-marketing-cream">
        <div className="mx-auto flex h-[68px] w-full max-w-[1120px] items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
          {/* On the homepage the mark goes to the top of the page it is
              already on, which costs no request; anywhere else it goes
              home, in the language being read. */}
          <a
            href={page === "home" ? "#top" : home}
            className="text-marketing-cream no-underline"
            aria-label={t("header.home")}
          >
            <SplittingWordmark
              className="gap-2.5 text-[18px] tracking-[-0.02em]"
              markClassName="size-[26px]"
              wordClassName="hidden min-[440px]:inline"
            />
          </a>
          <nav
            aria-label={t("header.navigation")}
            className="flex items-center gap-1.5 sm:gap-2"
          >
            <MarketingLanguageSwitcher paths={localePaths(page)} />
            {/* A phone header has room for the switcher, one text link and
                the button, and not for a fourth thing: on a 360pt phone the
                row is 328pt wide and the mark, the switcher, "Se connecter"
                and the button take 322 of them. The link is "Sign in" —
                somebody who already has an account is the one reader the
                hero's button does nothing for, and the source is linked
                twice more down the page. GitHub comes back at 721px, and the
                wordmark's word at 440px, the width at which the row first
                fits in French with the word in it. The link keeps its label
                on one line whatever the width: wrapped inside a fixed 36px
                box, "Se" and "connecter" would both show and neither read. */}
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className="hidden h-9 items-center gap-[7px] rounded-[10px] px-3 text-sm font-medium text-marketing-cream no-underline transition-colors hover:bg-white/9 min-[721px]:inline-flex"
              {...track({ name: "source", at: "header" })}
            >
              <GithubMark />
              {t("header.github")}
            </a>
            <Link
              href="/sign-in"
              className="inline-flex h-9 items-center rounded-[10px] px-2 text-sm font-medium whitespace-nowrap text-marketing-cream no-underline transition-colors hover:bg-white/9 min-[721px]:px-3"
              {...track({ name: "sign-in", at: "header" })}
            >
              {t("header.signIn")}
            </Link>
            {env.ALLOW_REGISTRATION && (
              <Link
                href="/register"
                className="inline-flex h-11 w-[82px] shrink-0 items-center justify-center rounded-[10px] bg-primary px-2 text-center text-[13px] leading-[1.05] font-semibold text-primary-foreground no-underline transition-colors hover:bg-marketing-primary-hover min-[721px]:h-9 min-[721px]:w-auto min-[721px]:px-3.5 min-[721px]:text-sm min-[721px]:leading-normal"
                {...track({ name: "signup", at: "header" })}
              >
                {t("header.createAccount")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-t bg-marketing-cream px-6 pt-14 pb-10">
        <div className="mx-auto w-full max-w-[1120px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-8">
            <div>
              <Wordmark markClassName="size-[22px]" />
              <p className="mt-3 text-[13.5px] leading-[1.5] text-muted-foreground">
                {t("footer.taglineLine1")}
                <br />
                {t("footer.taglineLine2")}
              </p>
            </div>
            {/* The one column that stays on this site. These are the links a
                crawler follows from the homepage to the comparison pages, and
                the words in them are what it files those pages under — so
                they are plain links, in the page's own language, and say
                what the page is rather than "learn more". */}
            <div>
              <h2 className="mb-3 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                {t("footer.compareIt")}
              </h2>
              <ul className="space-y-[9px] text-sm">
                {(["splitwise", "tricount"] as const).map((other) => (
                  <li key={other}>
                    <Link
                      href={publicPath(other, locale)}
                      className="text-marketing-link no-underline transition-colors hover:text-marketing-link-hover"
                      {...track({
                        name: "comparison",
                        with: other,
                        at: "footer",
                      })}
                    >
                      {t(`footer.links.${other}`)}
                    </Link>
                  </li>
                ))}
              </ul>
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
