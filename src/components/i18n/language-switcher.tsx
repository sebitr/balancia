"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocaleAction } from "@/i18n/actions";
import { track } from "@/lib/analytics/events";
import { loadDocument } from "@/lib/load-document";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALES,
  LOCALE_LABELS,
  type AppLocale,
} from "@/i18n/locales";

const LOCALE_FLAGS: Record<AppLocale, string> = {
  en: "🇬🇧",
  fr: "🇫🇷",
};

function useLanguageChoice(paths?: Record<AppLocale, string>) {
  const router = useRouter();
  const requestedLocale = useLocale();
  const activeLocale = isAppLocale(requestedLocale)
    ? requestedLocale
    : DEFAULT_LOCALE;
  const [isPending, startTransition] = useTransition();

  const choose = (locale: AppLocale) => {
    if (locale === activeLocale) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      if (paths) {
        // A public page has an address per language, so changing language is
        // going to the other address — and going there as a document, not
        // through the router: the root layout wrote `<html lang>` and handed
        // the browser its messages for the language it was first rendered
        // in, and a soft navigation keeps a layout rather than rendering it
        // again. The cookie written above is what stops `/` sending a reader
        // who has just chosen English straight back to their browser's
        // language.
        loadDocument(paths[locale]);
        return;
      }
      router.refresh();
    });
  };

  return { activeLocale, choose, isPending };
}

/**
 * A public language picker for the marketing header.
 *
 * The current choice stays visible at phone widths, where a generic globe
 * would make the visitor open the menu just to learn which language is active.
 * Language names are written in their own language so they remain recognisable
 * even when the rest of the page is not.
 */
export function MarketingLanguageSwitcher({
  paths,
}: {
  /** Where the page being read lives in each language. */
  paths: Record<AppLocale, string>;
}) {
  const t = useTranslations("nav");
  const { activeLocale, choose, isPending } = useLanguageChoice(paths);
  const activeLabel = LOCALE_LABELS[activeLocale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t("language")}: ${activeLabel}`}
        className="tap-target group inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-input px-2.5 text-sm font-semibold text-marketing-cream transition-colors hover:bg-wash-3 data-open:bg-wash-3"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {LOCALE_FLAGS[activeLocale]}
        </span>
        <span>{activeLocale.toUpperCase()}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 opacity-65 transition-transform group-data-open:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={7}
        aria-label={t("language")}
        className="w-44 rounded-xl bg-marketing-cream p-1.5 text-marketing-plum shadow-xl ring-marketing-plum/12"
      >
        {LOCALES.map((locale) => {
          const isActive = locale === activeLocale;
          return (
            <DropdownMenuItem
              key={locale}
              disabled={isPending}
              onSelect={() => choose(locale)}
              aria-current={isActive ? "true" : undefined}
              className="gap-2 rounded-lg px-2.5 py-2 text-sm focus:bg-marketing-cream-deep focus:text-marketing-plum"
              {...track({ name: "language", to: locale })}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {LOCALE_FLAGS[locale]}
              </span>
              <span className={isActive ? "font-semibold" : undefined}>
                {LOCALE_LABELS[locale]}
              </span>
              <Check
                aria-hidden="true"
                className={`ml-auto size-4 text-primary-ink ${isActive ? "opacity-100" : "opacity-0"}`}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
